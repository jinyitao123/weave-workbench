import { randomUUID } from 'node:crypto'
import type { EnterpriseService } from '../enterprise'
import type { EnterpriseBusinessCapability, EnterpriseWorkChoice, EnterpriseWorkResource, TranscriptMessage } from '../../../src/types/api'
import { CapabilityBridge, type CapabilityClaim } from '../lib/capability-bridge'
import { requireString } from '../validation'
import { digest, HandoffStore, type HandoffStorage } from './handoff-store'
import { executionText, freezeMaterials, materialSelection, type FrozenMaterial } from './materials'
import { searchTeams, type TeamSummary } from './team-catalog'

interface EnterpriseSessionReader { read(filePath: unknown): Promise<TranscriptMessage[]> }
export interface AgentEnterpriseBridgeOptions {
  service: Pick<EnterpriseService, 'accountKey' | 'getTeamCatalog' | 'getTeamChoices' | 'getBusinessCapabilities' | 'findBusinessRecords' | 'stageWorkMaterials' | 'submitWork'>
  sessions: Record<'prime' | 'omp' | 'pi', EnterpriseSessionReader>
  extensionPath: string
  storage?: HandoffStorage
}
interface FrozenHandoffIntent {
  task: string
  materials: FrozenMaterial[]
  authorizedBusinessCapabilityIds: string[]
  sourceMessages: Array<{ messageId: string; eventSeq: number; sha256: string }>
  choice: EnterpriseWorkChoice
  accountKey: string
  idempotencySeed: string
  sessionKey: string
  businessContext?: { objectName: string; recordId: string; name: string; code?: string }
}
interface FrozenHandoff extends FrozenHandoffIntent { resources: EnterpriseWorkResource[] }
interface EmployeeTurn {
  key: string
  prompt: string
  accountKey: string
  baseline: Set<string>
  messageId?: string
}
function messageText(message: TranscriptMessage): string {
  return message.parts.flatMap((part) => part.type === 'text' || part.type === 'agentMessage' ? [part.text] : []).join('\n').trim()
}
function handoffKey(choice: EnterpriseWorkChoice): string { return digest(JSON.stringify([choice.teamId, choice.workflowId, choice.version])).slice(0, 24) }

export class AgentEnterpriseBridge extends CapabilityBridge {
  protected readonly rateLimit = 60
  protected readonly rateLimitError = '企业团队交接请求过于频繁，请稍后重试'
  private readonly teams = new Map<string, Map<string, TeamSummary>>()
  private readonly handoffs = new Map<string, Map<string, EnterpriseWorkChoice>>()
  private readonly businessActions = new Map<string, Map<string, Map<string, EnterpriseBusinessCapability>>>()
  private readonly businessRecords = new Map<string, Map<string, { objectName: string; recordId: string; name: string; code?: string }>>()
  private readonly runtimes = new Map<string, string>()
  private readonly pendingRuntimeTokens = new Map<string, string>()
  private readonly turns = new Map<string, EmployeeTurn>()
  private readonly inputs = new Map<string, symbol>()
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private readonly store: HandoffStore

  constructor(private readonly options: AgentEnterpriseBridgeOptions) { super(); this.store = new HandoffStore(options.storage) }
  protected environmentEntries(url: string, token: string): NodeJS.ProcessEnv {
    return { GOOEYPI_ENTERPRISE_URL: url, GOOEYPI_ENTERPRISE_TOKEN: token, GOOEYPI_ENTERPRISE_EXTENSION_PATH: this.options.extensionPath }
  }
  protected onClaimRevoked(claim: CapabilityClaim): void {
    this.teams.delete(claim.token); this.handoffs.delete(claim.token); this.businessActions.delete(claim.token); this.businessRecords.delete(claim.token); this.turns.delete(claim.token); this.inputs.delete(claim.token)
    for (const [runtime, token] of this.runtimes) if (token === claim.token) this.runtimes.delete(runtime)
    for (const [runtime, token] of this.pendingRuntimeTokens) if (token === claim.token) this.pendingRuntimeTokens.delete(runtime)
  }
  bindSession(token: string | undefined, sessionFile: string | undefined, runtimeId?: string): void {
    if (!token) return
    if (runtimeId && !sessionFile) {
      this.pendingRuntimeTokens.set(runtimeId, token)
      return
    }
    if (!sessionFile) return
    const claim = this.claimForToken(token)
    if (claim && !claim.sessionPath) claim.sessionPath = sessionFile
    if (claim && runtimeId) {
      this.runtimes.set(runtimeId, token)
      this.pendingRuntimeTokens.delete(runtimeId)
    }
  }
  bindRuntimeSession(runtimeId: string, sessionFile: string): void {
    const token = this.pendingRuntimeTokens.get(runtimeId)
    if (token) this.bindSession(token, sessionFile, runtimeId)
  }
  invalidateHandoff(runtimeId: string): void {
    const token = this.runtimes.get(runtimeId)
    if (!token) return
    this.inputs.set(token, Symbol())
    this.turns.delete(token); this.teams.delete(token); this.handoffs.delete(token); this.businessActions.delete(token); this.businessRecords.delete(token)
  }
  invalidateAccount(): void {
    this.revokeAllClaims()
    this.turns.clear(); this.inputs.clear(); this.teams.clear(); this.handoffs.clear(); this.businessActions.clear(); this.businessRecords.clear()
  }
  /** Called only by the trusted desktop input path, before forwarding to the runtime. */
  async employeeCommand(runtimeId: unknown, command: unknown): Promise<void> {
    const value = command as { type?: string; message?: string } | null
    if (!value || !['prompt', 'steer', 'follow_up', 'abort', 'compact'].includes(value.type ?? '')) return
    const token = typeof runtimeId === 'string' ? this.runtimes.get(runtimeId) : undefined
    if (!token) return
    const marker = Symbol()
    this.inputs.set(token, marker)
    this.turns.delete(token); this.teams.delete(token); this.handoffs.delete(token); this.businessActions.delete(token); this.businessRecords.delete(token)
    const claim = this.claimForToken(token)
    if (!claim?.harness || !claim.sessionPath || typeof value.message !== 'string') return
    try {
      const accountKey = await this.options.service.accountKey()
      const messages = await this.options.sessions[claim.harness].read(claim.sessionPath)
      if (this.inputs.get(token) === marker) this.turns.set(token, {
        key: randomUUID(), prompt: value.message.trim(), accountKey,
        baseline: new Set(messages.filter((message) => message.role === 'user').map((message) => message.id)),
      })
    } catch { /* Local work remains available without an enterprise account; handoff fails closed. */ }
  }
  protected async dispatch(method: string, params: Record<string, unknown>, claim: CapabilityClaim): Promise<unknown> {
    if (!claim.harness || !claim.sessionPath) throw new Error('企业团队能力尚未绑定到当前会话')
    const turn = this.turns.get(claim.token)
    if (!turn || this.claimForToken(claim.token) !== claim || await this.options.service.accountKey() !== turn.accountKey) throw new Error('员工轮次或账号已变化，请按当前要求重新处理')
    if (this.turns.get(claim.token) !== turn || this.claimForToken(claim.token) !== claim) throw new Error('员工轮次或账号已变化，请按当前要求重新处理')
    if (method === 'activate') {
      if (params.prompt !== turn.prompt) throw new Error('运行时处理的员工输入与当前轮次不一致')
      return { turn_key: turn.key }
    }
    if (params.turn_key !== turn.key) throw new Error('员工要求已变化，旧交接不能继续')
    await this.evidence(claim, turn)
    if (method === 'search') return this.search(claim, params, turn)
    if (method === 'describe') return this.describe(claim, params, turn)
    if (method === 'find_business_record') return this.findBusinessRecord(claim, params, turn)
    if (method === 'submit') return this.submit(claim, params, turn)
    if (method === 'recover') {
      const recoveryKey = requireString(params.recovery_key, 'recovery_key', { min: 64, max: 64 })
      const intent = await this.store.recover<FrozenHandoffIntent>(recoveryKey)
      if (intent.accountKey !== turn.accountKey || intent.sessionKey !== digest(claim.sessionPath!).slice(0, 24)) throw new Error('该交接不属于当前员工与会话')
      return this.prepareDelivery(claim, turn, intent, recoveryKey)
    }
    throw new TypeError(`Unsupported enterprise method ${method}`)
  }
  private async findBusinessRecord(claim: CapabilityClaim, params: Record<string, unknown>, turn: EmployeeTurn) {
    const key = requireString(params.handoff_key, 'handoff_key', { min: 1, max: 128, trim: true })
    const summary = requireString(params.work_summary, 'work_summary', { min: 1, max: 4_000, trim: true })
    if (!this.handoffs.get(claim.token)?.has(key)) throw new Error('请先查看团队的承接能力')
    const actions = [...(this.businessActions.get(claim.token)?.get(key)?.values() ?? [])]
    const objectNames = [...new Set(actions.map((action) => action.resourceType))]
    const records = await this.options.service.findBusinessRecords(objectNames, summary)
    await this.evidence(claim, turn)
    const mapped = new Map(records.map((item) => [digest(`record:${turn.accountKey}:${item.objectName}:${item.recordId}`).slice(0, 24), item]))
    this.businessRecords.set(claim.token, mapped)
    return { records: [...mapped].map(([recordKey, item]) => ({ record_key: recordKey, name: item.name, ...(item.code ? { code: item.code } : {}), object: '业务记录' })) }
  }
  private async evidence(claim: CapabilityClaim, turn: EmployeeTurn) {
    const transcript = await this.options.sessions[claim.harness!].read(claim.sessionPath!)
    const messages = transcript.map((message, eventSeq) => ({ message, eventSeq, text: messageText(message) }))
    const authorization = [...messages].reverse().find((entry) => entry.message.role === 'user')
    if (await this.options.service.accountKey() !== turn.accountKey || this.turns.get(claim.token) !== turn || this.claimForToken(claim.token) !== claim) throw new Error('员工轮次或账号已变化，旧交接不能继续')
    if (!authorization || authorization.text !== turn.prompt || turn.baseline.has(authorization.message.id) || (turn.messageId && turn.messageId !== authorization.message.id)) throw new Error('当前员工输入尚未进入原会话，或员工要求已经变化')
    turn.messageId = authorization.message.id
    return messages.filter((entry) => entry.eventSeq <= authorization.eventSeq && entry.text).slice(-50).map(({ message, eventSeq, text }) => ({ messageId: message.id, eventSeq, sha256: digest(text) }))
  }
  private async search(claim: CapabilityClaim, params: Record<string, unknown>, turn: EmployeeTurn) {
    const summary = requireString(params.work_summary, 'work_summary', { min: 1, max: 4_000, trim: true })
    const teams = searchTeams(await this.options.service.getTeamCatalog(), summary)
    await this.evidence(claim, turn)
    const discovered = new Map(teams.map((team) => [digest(`team:${team.id}`).slice(0, 24), team]))
    this.teams.set(claim.token, discovered)
    return { teams: [...discovered].map(([key, team]) => ({ team_key: key, name: team.name, summary: team.objective })), matching: '名称与目标文本相关性筛选；请结合完整对话判断是否适合' }
  }
  private async describe(claim: CapabilityClaim, params: Record<string, unknown>, turn: EmployeeTurn) {
    const key = requireString(params.team_key, 'team_key', { min: 1, max: 128, trim: true })
    const team = this.teams.get(claim.token)?.get(key)
    if (!team) throw new Error('请先查找适合当前工作的企业团队')
    const choices = await this.options.service.getTeamChoices(team)
    await this.evidence(claim, turn)
    if (!choices.length) throw new Error('该团队当前没有可承接工作的已发布流程')
    const handoffs = this.handoffs.get(claim.token) ?? new Map<string, EnterpriseWorkChoice>()
    for (const choice of choices) handoffs.set(handoffKey(choice), choice)
    this.handoffs.set(claim.token, handoffs)
    const scopeByHandoff = this.businessActions.get(claim.token) ?? new Map<string, Map<string, EnterpriseBusinessCapability>>()
    const capabilities = await Promise.all(choices.map(async (choice) => {
      const available = await this.options.service.getBusinessCapabilities(choice.businessCapabilityIds)
      const actionMap = new Map(available.map((action) => [digest(`action:${handoffKey(choice)}:${action.id}`).slice(0, 24), action]))
      scopeByHandoff.set(handoffKey(choice), actionMap)
      return {
        handoff_key: handoffKey(choice), name: choice.workflowName, description: choice.workflowDescription,
        business_actions: available.map((action) => ({ action_key: digest(`action:${handoffKey(choice)}:${action.id}`).slice(0, 24), name: action.name, description: action.description })),
      }
    }))
    await this.evidence(claim, turn)
    this.businessActions.set(claim.token, scopeByHandoff)
    return { team: { name: team.name, summary: team.objective }, capabilities }
  }
  private async submit(claim: CapabilityClaim, params: Record<string, unknown>, turn: EmployeeTurn): Promise<unknown> {
    const key = requireString(params.handoff_key, 'handoff_key', { min: 1, max: 128, trim: true })
    const goal = requireString(params.goal, 'goal', { min: 1, max: 20_000, trim: true })
    if (!Array.isArray(params.business_actions) || params.business_actions.length > 32 || params.business_actions.some((value) => typeof value !== 'string')) throw new Error('本次业务动作范围无效')
    const actionKeys = params.business_actions as string[]
    if (new Set(actionKeys).size !== actionKeys.length) throw new Error('本次业务动作不能重复')
    const selections = materialSelection(params.materials)
    const choice = this.handoffs.get(claim.token)?.get(key)
    if (!choice) throw new Error('请先查看团队的承接能力，并使用本轮返回的交接项')
    const actionMap = this.businessActions.get(claim.token)?.get(key)
    if (!actionMap) throw new Error('请先查看团队当前可用的业务动作')
    const authorizedBusinessCapabilityIds = actionKeys.map((actionKey) => {
      const action = actionMap.get(actionKey)
      if (!action) throw new Error('业务动作不属于本轮查看的团队能力')
      return action.id
    }).sort()
    const businessRecordKey = typeof params.business_record_key === 'string' ? params.business_record_key.trim() : ''
    const businessContext = businessRecordKey ? this.businessRecords.get(claim.token)?.get(businessRecordKey) : undefined
    if (businessRecordKey && !businessContext) throw new Error('业务记录选择已失效，请按当前工作重新查找')
    for (const actionKey of actionKeys) {
      const action = actionMap.get(actionKey)!
      if (action.requiresRecord !== false && (!businessContext || businessContext.objectName !== action.resourceType)) throw new Error('请先按当前工作查找并绑定该动作所需的业务记录')
    }
    const sourceMessages = await this.evidence(claim, turn)
    const sessionKey = digest(claim.sessionPath!).slice(0, 24)
    const idempotencySeed = `${sessionKey}:${turn.messageId}:${key}`
    const identity = `${turn.accountKey}:${idempotencySeed}`
    const fingerprint = digest(JSON.stringify({ goal, selections, key, authorizedBusinessCapabilityIds, businessContext }))
    const intent = await this.store.freeze<FrozenHandoffIntent>(identity, fingerprint, async () => {
      const current = await this.options.service.getTeamChoices({ id: choice.teamId, name: choice.teamName })
      if (!current.some((item) => handoffKey(item) === key)) throw new Error('承接流程版本已经变化，请重新查找')
      const materials = await freezeMaterials(claim.cwd, selections)
      const task = executionText(goal, materials, businessContext)
      await this.evidence(claim, turn)
      return { task, materials, authorizedBusinessCapabilityIds, sourceMessages, choice, accountKey: turn.accountKey, idempotencySeed, sessionKey, ...(businessContext ? { businessContext } : {}) }
    })
    return this.prepareDelivery(claim, turn, intent, digest(identity))
  }
  private async prepareDelivery(claim: CapabilityClaim, turn: EmployeeTurn, intent: FrozenHandoffIntent, recoveryKey: string): Promise<unknown> {
    try {
      const resourcesFingerprint = digest(JSON.stringify(intent.materials.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }))))
      const frozen = await this.store.freeze<FrozenHandoff>(`${intent.accountKey}:${intent.idempotencySeed}:resources`, resourcesFingerprint, async () => {
        const resources = await this.options.service.stageWorkMaterials(intent.materials, async () => { await this.evidence(claim, turn) })
        await this.evidence(claim, turn)
        return { ...intent, resources }
      })
      return this.deliver(claim, turn, frozen, recoveryKey)
    } catch (error) {
      return {
        status: 'unknown', recovery_key: recoveryKey,
        message: error instanceof Error ? error.message : '材料交付结果待核对',
        next_step: '已保留本次固定材料。员工仍要求交接时使用恢复工具继续，不得重读或换成另一版材料。',
      }
    }
  }
  private async deliver(claim: CapabilityClaim, turn: EmployeeTurn, frozen: FrozenHandoff, recoveryKey: string): Promise<unknown> {
    await this.evidence(claim, turn)
    const pending = this.inFlight.get(recoveryKey)
    if (pending) return pending
    const operation = this.options.service.submitWork(frozen.choice, frozen.task, {
      idempotencySeed: frozen.idempotencySeed, sessionKey: frozen.sessionKey, sourceMessages: frozen.sourceMessages, accountKey: frozen.accountKey,
      resources: frozen.resources,
      businessContext: frozen.businessContext,
      authorizedBusinessCapabilityIds: frozen.authorizedBusinessCapabilityIds,
      assertCurrent: async () => { await this.evidence(claim, turn) },
    }).then((receipt) => ({
      status: 'accepted', team: frozen.choice.teamName, workflow: frozen.choice.workflowName,
      repeated: receipt.repeated, recovery_key: recoveryKey,
      materials: frozen.materials.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
      receipt,
    })).catch((error: unknown) => ({
      status: 'unknown', recovery_key: recoveryKey,
      message: error instanceof Error ? error.message : '接单结果待核对',
      next_step: '保留原包。员工仍要求交接时使用恢复工具核对同一请求，不得重新提交另一份工作。',
    }))
    this.inFlight.set(recoveryKey, operation)
    try { return await operation } finally { this.inFlight.delete(recoveryKey) }
  }
}
