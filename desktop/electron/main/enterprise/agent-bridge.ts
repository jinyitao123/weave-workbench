import { randomUUID } from 'node:crypto'
import { approvalContextView, type ApprovalRevisionSubmission, type EnterpriseService } from '../enterprise'
import type { EnterpriseApprovalContext, EnterpriseApprovalContextView, EnterpriseBusinessCapability, EnterpriseWorkChoice, EnterpriseWorkResource, TranscriptMessage } from '../../../src/types/api'
import { CapabilityBridge, type CapabilityClaim } from '../lib/capability-bridge'
import { rejectUnknownKeys, requireString } from '../validation'
import { digest, HandoffStore, submissionUUID, type HandoffStorage } from './handoff-store'
import { executionText, freezeMaterials, materialSelection, type FrozenMaterial, type MaterialLimits } from './materials'
import { searchTeams, type TeamSummary } from './team-catalog'

interface EnterpriseSessionReader { read(filePath: unknown): Promise<TranscriptMessage[]> }
export interface AgentEnterpriseBridgeOptions {
  service: Pick<EnterpriseService, 'accountKey' | 'getApprovalContext' | 'getTeamCatalog' | 'getTeamChoices' | 'getBusinessCapabilities' | 'findBusinessRecords' | 'stageWorkMaterials' | 'submitWork' | 'submitApprovalRevision' | 'getApprovalRevisionReceipt'>
  sessions: Record<'prime' | 'omp' | 'pi', EnterpriseSessionReader>
  extensionPath: string
  storage?: HandoffStorage
}
interface FrozenHandoffIntent {
  task: string
  materials: FrozenMaterial[]
  authorizedBusinessCapabilityIds: string[]
  sourceMessages: Array<{ messageId: string; eventSeq: number; sha256: string }>
  employeeMessageId: string
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
interface PendingReturnedApproval {
  accountKey: string
  context: EnterpriseApprovalContext
  fingerprint: string
  createdAt: number
}
interface BoundReturnedApproval extends PendingReturnedApproval { sessionPath: string }
interface FrozenRevisionFile { name: string; mediaType: 'text/plain; charset=utf-8'; bytes: number; sha256: string; bytesBase64: string }
interface FrozenRevisionSourceFile extends FrozenRevisionFile { fileId: string }
interface FrozenRevisionIntent {
  version: 1
  accountKey: string
  sessionKey: string
  employeeRoundId: string
  employeeMessageId: string
  employeeRequest: string
  employeeRequestSha256: string
  sourceMessages: Array<{ messageId: string; eventSeq: number; sha256: string }>
  requestId: string
  returnVersion: string
  sourceMaterialVersion: string
  idempotencyKey: string
  businessObject: EnterpriseApprovalContext['businessObject']
  returnReason: string
  sourceFiles: FrozenRevisionSourceFile[]
  body: { name: string; content: string; bytes: number; sha256: string; bytesBase64: string }
  materials: FrozenRevisionFile[]
}
interface ReturnedRevisionFileReference { fileId: string; name: string; sha256: string }
interface ReturnedRevisionReceipt {
  requestId: string
  bindingId: string
  newVersionDigest: string
  state: 'prepared' | 'resumed' | 'resume_unknown'
  repeated: true
}
interface ReturnedRevisionProgress {
  version: 1
  phase: 'upload_started' | 'uploaded' | 'request_started' | 'receipt' | 'rejected'
  idempotencyKey: string
  rejectionState?: 'unavailable' | 'rejected'
  primary?: ReturnedRevisionFileReference
  attachments?: ReturnedRevisionFileReference[]
  receipt?: ReturnedRevisionReceipt
  message?: string
}
const REVISION_MATERIAL_LIMITS: MaterialLimits = { maxFiles: 10, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024 }
function messageText(message: TranscriptMessage): string {
  return message.parts.flatMap((part) => part.type === 'text' || part.type === 'agentMessage' ? [part.text] : []).join('\n').trim()
}
function handoffKey(choice: EnterpriseWorkChoice): string { return digest(JSON.stringify([choice.teamId, choice.workflowId, choice.version])).slice(0, 24) }
function returnedApprovalFingerprint(context: EnterpriseApprovalContext): string {
  return digest(JSON.stringify({
    requestId: context.requestId, status: context.status, viewer: context.viewer, title: context.title, step: context.step,
    businessObject: context.businessObject, sourceMaterialVersion: context.sourceMaterialVersion,
    returnVersion: context.returnVersion, returnReason: context.returnReason, fields: context.fields,
    files: context.files.map(({ fileId, name, mediaType, bytes, sha256 }) => ({ fileId, name, mediaType, bytes, sha256 })),
  }))
}
function assertReturnedApproval(context: EnterpriseApprovalContext, requestId?: string): asserts context is EnterpriseApprovalContext & {
  status: 'returned'; viewer: 'original_submitter'; returnVersion: string; returnReason: string
} {
  if (context?.status !== 'returned' || context.viewer !== 'original_submitter'
    || (requestId && context.requestId !== requestId)
    || !context.requestId || context.requestId.length > 128 || !context.returnVersion || context.returnVersion.length > 128 || !/^[0-9a-f]{64}$/.test(context.sourceMaterialVersion)
    || !context.businessObject?.objectName || context.businessObject.objectName.length > 160
    || !context.businessObject.recordId || context.businessObject.recordId.length > 128
    || (context.businessObject.recordName !== undefined && context.businessObject.recordName.length > 300)
    || typeof context.returnReason !== 'string' || !Array.isArray(context.files) || context.files.length > 11
    || context.files.some((file) => !file.fileId || file.fileId.length > 128 || !file.name || file.name.length > 255 || file.mediaType !== 'text/plain; charset=utf-8'
      || !Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > 2 * 1024 * 1024
      || !/^[0-9a-f]{64}$/.test(file.sha256) || file.verified !== true
      || Buffer.byteLength(file.content, 'utf8') !== file.bytes || digest(Buffer.from(file.content, 'utf8')) !== file.sha256)) {
    throw new Error('当前退回事项或材料版本不完整，请刷新待办')
  }
}
function revisionFile(material: FrozenMaterial): FrozenRevisionFile {
  const bytes = Buffer.from(material.content, 'utf8')
  if (bytes.length !== material.bytes || digest(bytes) !== material.sha256) throw new Error('工作材料与本轮摘要不一致，请暂停处理')
  return { name: material.name, mediaType: 'text/plain; charset=utf-8', bytes: bytes.length, sha256: material.sha256, bytesBase64: bytes.toString('base64') }
}
function revisionReceipt(value: unknown, requestId: string): ReturnedRevisionReceipt | undefined {
  const envelope = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  const data = envelope?.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) ? envelope.data as Record<string, unknown> : envelope
  if (!data || data.requestId !== requestId || typeof data.bindingId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.bindingId)
    || typeof data.newVersionDigest !== 'string' || !/^[0-9a-f]{64}$/.test(data.newVersionDigest)
    || (data.state !== 'prepared' && data.state !== 'resumed' && data.state !== 'resume_unknown')
    || data.repeated !== true) return undefined
  return { requestId, bindingId: data.bindingId, newVersionDigest: data.newVersionDigest, state: data.state, repeated: true }
}
function restoreRevisionMaterial(file: FrozenRevisionFile): FrozenMaterial {
  const bytes = Buffer.from(file.bytesBase64, 'base64')
  if (bytes.toString('base64') !== file.bytesBase64 || bytes.length !== file.bytes || digest(bytes) !== file.sha256) {
    throw new Error('本地固定材料包无法通过字节摘要校验，请勿重新读取文件')
  }
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new Error('本地固定材料不是有效的 UTF-8 文本') }
  if (!content.trim() || content.includes('\0')) throw new Error('本地固定材料为空或无法安全读取')
  return { name: file.name, content, bytes: bytes.length, sha256: file.sha256 }
}
function revisionReceiptResult(receipt: ReturnedRevisionReceipt, files: Array<{ name: string }>, receiptConfirmed = true): Record<string, unknown> {
  const message = receipt.state === 'resumed'
    ? 'Forge 已确认修订材料递交，原审批已进入下一轮。'
    : receipt.state === 'prepared'
      ? receiptConfirmed ? 'Forge 已固定修订材料，但原审批是否继续尚未确认；请刷新待办核对。' : '上次 Forge 回执显示修订材料已固定，但当前无法刷新；审批是否继续仍未确认。'
      : 'Forge 修订请求状态尚未确认，桌面只查询了原回执，没有重提；请在 Forge 核对。'
  return {
    status: receipt.state, submitted: receipt.state === 'resumed', receiptConfirmed,
    message, materials: files.map((file) => ({ name: file.name })),
  }
}

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
  private readonly revisionInFlight = new Map<string, Promise<unknown>>()
  private readonly pendingReturnedApprovals = new Map<string, PendingReturnedApproval>()
  private readonly returnedApprovals = new Map<string, BoundReturnedApproval>()
  private readonly store: HandoffStore

  constructor(private readonly options: AgentEnterpriseBridgeOptions) { super(); this.store = new HandoffStore(options.storage) }
  protected environmentEntries(url: string, token: string): NodeJS.ProcessEnv {
    return { GOOEYPI_ENTERPRISE_URL: url, GOOEYPI_ENTERPRISE_TOKEN: token, GOOEYPI_ENTERPRISE_EXTENSION_PATH: this.options.extensionPath }
  }
  protected onClaimRevoked(claim: CapabilityClaim): void {
    this.teams.delete(claim.token); this.handoffs.delete(claim.token); this.businessActions.delete(claim.token); this.businessRecords.delete(claim.token); this.turns.delete(claim.token); this.inputs.delete(claim.token); this.returnedApprovals.delete(claim.token)
    for (const [runtime, token] of this.runtimes) if (token === claim.token) this.runtimes.delete(runtime)
    for (const [runtime, token] of this.pendingRuntimeTokens) if (token === claim.token) this.pendingRuntimeTokens.delete(runtime)
  }
  async pinReturnedApprovalContext(requestId: string): Promise<{ handle: string; context: EnterpriseApprovalContextView }> {
    if (!requestId || requestId.length > 128) throw new Error('退回事项上下文无效，请刷新待办')
    const accountBefore = await this.options.service.accountKey()
    const context = await this.options.service.getApprovalContext(requestId)
    const accountAfter = await this.options.service.accountKey()
    assertReturnedApproval(context, requestId)
    if (accountBefore !== accountAfter) throw new Error('当前账号已变化，请重新打开退回事项')
    const now = Date.now()
    for (const [handle, pending] of this.pendingReturnedApprovals) if (now - pending.createdAt > 10 * 60_000) this.pendingReturnedApprovals.delete(handle)
    const handle = randomUUID()
    this.pendingReturnedApprovals.set(handle, { accountKey: accountAfter, context, fingerprint: returnedApprovalFingerprint(context), createdAt: now })
    return { handle, context: approvalContextView(context) }
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
    this.pendingReturnedApprovals.clear(); this.returnedApprovals.clear()
  }
  /** Called only by the trusted desktop input path, before forwarding to the runtime. */
  async employeeCommand(runtimeId: unknown, command: unknown, returnedApprovalContextHandle?: unknown): Promise<void> {
    const value = command as { type?: string; message?: string } | null
    if (!value || !['prompt', 'steer', 'follow_up', 'abort', 'compact'].includes(value.type ?? '')) {
      if (returnedApprovalContextHandle !== undefined) throw new Error('退回事项上下文只能绑定到桌面工作提示')
      return
    }
    const token = typeof runtimeId === 'string' ? this.runtimes.get(runtimeId) : undefined
    if (!token) {
      if (returnedApprovalContextHandle !== undefined) throw new Error('退回事项上下文未绑定到当前桌面会话')
      return
    }
    const marker = Symbol()
    this.inputs.set(token, marker)
    this.turns.delete(token); this.teams.delete(token); this.handoffs.delete(token); this.businessActions.delete(token); this.businessRecords.delete(token)
    const claim = this.claimForToken(token)
    if (!claim?.harness || !claim.sessionPath || typeof value.message !== 'string') {
      if (returnedApprovalContextHandle !== undefined) throw new Error('退回事项上下文未绑定到当前桌面会话')
      return
    }
    let pendingApproval: PendingReturnedApproval | undefined
    let handle: string | undefined
    if (returnedApprovalContextHandle !== undefined) {
      if (value.type !== 'prompt' || typeof returnedApprovalContextHandle !== 'string' || returnedApprovalContextHandle.length < 20 || returnedApprovalContextHandle.length > 128) {
        throw new Error('退回事项上下文与当前会话不匹配')
      }
      handle = returnedApprovalContextHandle
      pendingApproval = this.pendingReturnedApprovals.get(handle)
      if (!pendingApproval || Date.now() - pendingApproval.createdAt > 10 * 60_000) {
        this.pendingReturnedApprovals.delete(handle)
        throw new Error('退回事项上下文已过期，请重新打开待办')
      }
    }
    try {
      const accountKey = await this.options.service.accountKey()
      if (pendingApproval && pendingApproval.accountKey !== accountKey) throw new Error('当前账号已变化，退回事项不能继续')
      if (pendingApproval) {
        const currentContext = await this.options.service.getApprovalContext(pendingApproval.context.requestId)
        assertReturnedApproval(currentContext, pendingApproval.context.requestId)
        if (returnedApprovalFingerprint(currentContext) !== pendingApproval.fingerprint
          || await this.options.service.accountKey() !== accountKey) {
          throw new Error('退回意见或材料版本已变化，请重新打开待办')
        }
      }
      const messages = await this.options.sessions[claim.harness].read(claim.sessionPath)
      if (this.inputs.get(token) === marker) {
        if (pendingApproval) {
          if (this.claimForToken(token) !== claim) throw new Error('退回事项上下文已失效，请重新打开待办')
          this.returnedApprovals.set(token, { ...pendingApproval, sessionPath: claim.sessionPath })
          this.pendingReturnedApprovals.delete(handle!)
        }
        this.turns.set(token, {
          key: randomUUID(), prompt: value.message.trim(), accountKey,
          baseline: new Set(messages.filter((message) => message.role === 'user').map((message) => message.id)),
        })
      } else if (pendingApproval) {
        throw new Error('员工轮次已变化，退回事项不能继续')
      }
    } catch (error) {
      if (pendingApproval) {
        if (handle) this.pendingReturnedApprovals.delete(handle)
        throw error
      }
      /* Local work remains available without an enterprise account; handoff fails closed. */
    }
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
    if (method === 'revision_submit') return this.submitReturnedRevision(claim, params, turn)
    if (method === 'recover') {
      const recoveryKey = requireString(params.recovery_key, 'recovery_key', { min: 64, max: 64 })
      const intent = await this.store.recover<FrozenHandoffIntent>(recoveryKey)
      if (intent.accountKey !== turn.accountKey || intent.sessionKey !== digest(claim.sessionPath!).slice(0, 24)) throw new Error('该交接不属于当前员工与会话')
      if (!intent.employeeMessageId || intent.employeeMessageId !== turn.messageId) throw new Error('员工要求已变化，旧交接不能恢复')
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
    const employeeMessageId = turn.messageId
    if (!employeeMessageId) throw new Error('无法确认当前员工授权消息')
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
      return { task, materials, authorizedBusinessCapabilityIds, sourceMessages, employeeMessageId, choice, accountKey: turn.accountKey, idempotencySeed, sessionKey, ...(businessContext ? { businessContext } : {}) }
    })
    return this.prepareDelivery(claim, turn, intent, digest(identity))
  }
  private async submitReturnedRevision(claim: CapabilityClaim, params: Record<string, unknown>, turn: EmployeeTurn): Promise<unknown> {
    rejectUnknownKeys(params, ['turn_key', 'employee_request', 'body', 'materials'], 'revision')
    const bound = this.returnedApprovals.get(claim.token)
    if (!bound || bound.sessionPath !== claim.sessionPath || bound.accountKey !== turn.accountKey) {
      throw new Error('请从“我的工作”重新打开本人退回的审批事项')
    }
    const employeeRequest = requireString(params.employee_request, 'employee_request', { min: 1, max: 20_000, trim: false })
    if (employeeRequest !== turn.prompt) throw new Error('员工本轮要求已变化，旧修订意图不能继续')
    const body = requireString(params.body, 'body', { min: 1, max: 2 * 1024 * 1024, trim: false })
    if (!body.trim() || body.includes('\0')) throw new Error('修订正文为空或无法安全保存')
    const bodyBytes = Buffer.from(body, 'utf8')
    if (bodyBytes.length > 2 * 1024 * 1024) throw new Error('修订正文超出固定材料大小限制')
    if (!Array.isArray(params.materials) || params.materials.length > REVISION_MATERIAL_LIMITS.maxFiles) {
      throw new Error('修订材料清单无效，请按当前要求重新整理')
    }
    const selections = params.materials.length ? materialSelection(params.materials, REVISION_MATERIAL_LIMITS) : []
    const sourceMessages = await this.evidence(claim, turn)
    const employeeMessageId = turn.messageId
    if (!employeeMessageId) throw new Error('无法核对当前员工轮次，请重新发送本轮要求')
    const sessionKey = digest(claim.sessionPath).slice(0, 24)
    const employeeRequestSha256 = digest(Buffer.from(employeeRequest, 'utf8'))
    const employeeRoundId = digest(JSON.stringify([bound.accountKey, sessionKey, employeeMessageId, employeeRequestSha256]))
    const bodySha256 = digest(bodyBytes)
    const identity = `${bound.accountKey}:returned-revision:${bound.context.requestId}:${bound.context.returnVersion}:${employeeRoundId}`
    const fingerprint = digest(JSON.stringify({
      context: bound.fingerprint, employeeRoundId, bodySha256,
      materials: selections.map((selection) => ({ path: selection.path, sha256: selection.sha256 })),
    }))
    if (!this.options.storage?.codec.available()) throw new Error('安全存储不可用，无法固定修订材料包')
    let intent: FrozenRevisionIntent
    try {
      intent = await this.store.freeze<FrozenRevisionIntent>(identity, fingerprint, async () => {
        const latest = await this.options.service.getApprovalContext(bound.context.requestId)
        assertReturnedApproval(latest, bound.context.requestId)
        if (returnedApprovalFingerprint(latest) !== bound.fingerprint) {
          throw new Error('退回意见、业务对象或原材料版本已变化，请刷新待办后重新处理')
        }
        const frozen = await freezeMaterials(claim.cwd, selections, REVISION_MATERIAL_LIMITS)
        if (bodyBytes.length + frozen.reduce((total, file) => total + file.bytes, 0) > 8 * 1024 * 1024) {
          throw new Error('修订正文和附件总量超出 Forge 固定材料限制')
        }
        await this.evidence(claim, turn)
        if (turn.messageId !== employeeMessageId || await this.options.service.accountKey() !== bound.accountKey) {
          throw new Error('员工账号或轮次已变化，旧修订意图不能继续')
        }
        const sourceFiles = latest.files.map((file): FrozenRevisionSourceFile => {
          const bytes = Buffer.from(file.content, 'utf8')
          if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('原始审批材料与冻结版本不一致，请暂停处理')
          return { fileId: file.fileId, name: file.name, mediaType: file.mediaType, bytes: bytes.length, sha256: file.sha256, bytesBase64: bytes.toString('base64') }
        })
        if (sourceFiles.reduce((total, file) => total + file.bytes, 0) > 8 * 1024 * 1024) throw new Error('原始审批材料超出本地固定包大小限制')
        return {
          version: 1, accountKey: bound.accountKey, sessionKey, employeeRoundId, employeeMessageId,
          employeeRequest, employeeRequestSha256, sourceMessages, requestId: latest.requestId,
          returnVersion: latest.returnVersion, sourceMaterialVersion: latest.sourceMaterialVersion,
          idempotencyKey: submissionUUID(employeeRoundId),
          businessObject: structuredClone(latest.businessObject), returnReason: latest.returnReason,
          sourceFiles, body: { name: '修订正文.md', content: body, bytes: bodyBytes.length, sha256: bodySha256, bytesBase64: bodyBytes.toString('base64') },
          materials: frozen.map(revisionFile),
        }
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('本轮交接内容已冻结')) {
        throw new Error('本轮修订材料已固定；正文或文件改变后请从当前退回事项重新开始')
      }
      throw error
    }
    const prior = this.revisionInFlight.get(identity)
    if (prior) return prior
    const operation = this.deliverReturnedRevision(claim, turn, bound, intent, fingerprint)
    this.revisionInFlight.set(identity, operation)
    try { return await operation } finally { this.revisionInFlight.delete(identity) }
  }
  private async deliverReturnedRevision(
    claim: CapabilityClaim,
    turn: EmployeeTurn,
    bound: BoundReturnedApproval,
    intent: FrozenRevisionIntent,
    intentFingerprint: string,
  ): Promise<unknown> {
    const progressKey = `returned-revision:${intent.accountKey}:${intent.sessionKey}:${intent.requestId}:${intent.returnVersion}:${intent.employeeRoundId}:progress`
    const progressFingerprint = digest(JSON.stringify({
      intentFingerprint, idempotencyKey: intent.idempotencyKey, requestId: intent.requestId,
      returnVersion: intent.returnVersion, sourceMaterialVersion: intent.sourceMaterialVersion,
    }))
    const publicFiles = [{ name: intent.body.name }, ...intent.materials.map(({ name }) => ({ name }))]
    const assertCurrent = async () => {
      await this.evidence(claim, turn)
      if (await this.options.service.accountKey() !== intent.accountKey
        || this.returnedApprovals.get(claim.token) !== bound
        || this.claimForToken(claim.token) === undefined) throw new Error('员工账号或轮次已变化，旧修订意图不能继续')
    }
    const assertApprovalCurrent = async () => {
      await assertCurrent()
      const latest = await this.options.service.getApprovalContext(intent.requestId)
      assertReturnedApproval(latest, intent.requestId)
      if (returnedApprovalFingerprint(latest) !== bound.fingerprint) throw new Error('退回意见、业务对象或原材料版本已变化，请刷新待办后重新处理')
      await assertCurrent()
    }
    const resolveReceipt = async (prior?: ReturnedRevisionProgress): Promise<unknown> => {
      let result: { status: number; body: unknown }
      try {
        result = await this.options.service.getApprovalRevisionReceipt(intent.requestId, intent.idempotencyKey, assertCurrent)
      } catch {
        if (prior?.receipt) return revisionReceiptResult(prior.receipt, publicFiles, false)
        if (prior?.phase === 'upload_started') return {
          status: 'upload_unknown', submitted: false, receiptConfirmed: false, materials: publicFiles,
          message: '修订材料包已固定，但文件上传结果无法确认。审批递交未确认，桌面没有重传；请核对 Forge 后重新打开事项。',
        }
        return {
          status: 'resume_unknown', submitted: false, receiptConfirmed: false, materials: publicFiles,
          message: '修订递交请求可能已发送，但回执暂时无法读取。桌面没有重提；请在 Forge 核对。',
        }
      }
      if (result.status === 404) {
        if (prior?.receipt) return revisionReceiptResult(prior.receipt, publicFiles, false)
        if (prior?.phase === 'upload_started') return {
          status: 'upload_unknown', submitted: false, receiptConfirmed: false, materials: publicFiles,
          message: '修订材料包已固定，但 Forge 没有可核对的修订回执。审批递交未确认，桌面没有重传；请核对 Forge 后重新打开事项。',
        }
        return {
          status: 'resume_unknown', submitted: false, receiptConfirmed: false, materials: publicFiles,
          message: 'Forge 没有返回修订回执。原请求可能已处理，桌面没有重提；请在 Forge 核对。',
        }
      }
      const receipt = result.status >= 200 && result.status < 300 ? revisionReceipt(result.body, intent.requestId) : undefined
      if (!receipt) {
        if (prior?.receipt) return revisionReceiptResult(prior.receipt, publicFiles, false)
        if (prior?.phase === 'upload_started') return {
          status: 'upload_unknown', submitted: false, receiptConfirmed: false, materials: publicFiles,
          message: '修订材料包已固定，但 Forge 上传/修订结果没有可核对的回执。桌面没有重传；请核对 Forge 后重新打开事项。',
        }
        return {
          status: 'resume_unknown', submitted: false, receiptConfirmed: false, materials: publicFiles,
          message: 'Forge 修订回执无效或暂不可用。桌面没有重提；请在 Forge 核对。',
        }
      }
      const progress: ReturnedRevisionProgress = {
        version: 1, phase: 'receipt', idempotencyKey: intent.idempotencyKey,
        ...(prior?.primary ? { primary: prior.primary } : {}), ...(prior?.attachments ? { attachments: prior.attachments } : {}), receipt,
      }
      await this.store.checkpoint(progressKey, progressFingerprint, progress)
      return revisionReceiptResult(receipt, publicFiles)
    }

    const saved = await this.store.inspect<ReturnedRevisionProgress>(progressKey)
    if (saved && saved.fingerprint !== progressFingerprint) throw new Error('本轮修订材料已固定；员工账号、事项或材料变化后不能继续旧请求')
    let progress = saved?.value
    if (progress && (progress.idempotencyKey !== intent.idempotencyKey || progress.version !== 1)) {
      throw new Error('修订请求恢复记录无效，请在 Forge 核对后重新打开事项')
    }
    if (progress?.phase === 'rejected') return {
      status: progress.rejectionState ?? 'rejected', submitted: false, receiptConfirmed: false, materials: publicFiles,
      message: progress.message ?? '修订材料已固定，但 Forge 拒绝了本次请求；审批未确认递交。请刷新待办。',
    }
    if (progress?.phase === 'request_started' || progress?.phase === 'receipt') return resolveReceipt(progress)
    if (progress?.phase === 'upload_started') {
      const receiptResult = await resolveReceipt(progress)
      const receiptState = receiptResult && typeof receiptResult === 'object' && !Array.isArray(receiptResult)
        ? (receiptResult as Record<string, unknown>).status : undefined
      const receiptConfirmed = receiptResult && typeof receiptResult === 'object' && !Array.isArray(receiptResult)
        ? (receiptResult as Record<string, unknown>).receiptConfirmed === true : false
      if (receiptState !== 'resume_unknown' || receiptConfirmed) return receiptResult
      return {
        status: 'upload_unknown', submitted: false, receiptConfirmed: false, materials: publicFiles,
        message: '修订材料包已固定，但上传结果无法确认。审批递交未发送或未确认；为避免重复文件，桌面没有重传。请核对 Forge 后重新打开事项。',
      }
    }

    let references: { primary: ReturnedRevisionFileReference; attachments: ReturnedRevisionFileReference[] }
    if (progress?.phase === 'uploaded' && progress.primary && Array.isArray(progress.attachments)) {
      references = { primary: progress.primary, attachments: progress.attachments }
      const expected = [intent.body, ...intent.materials]
      const actual = [references.primary, ...references.attachments]
      if (actual.length !== expected.length || actual.some((file, index) => file.name !== expected[index]!.name || file.sha256 !== expected[index]!.sha256 || !file.fileId)) {
        throw new Error('上传回执与原固定材料包不一致；桌面不会重新上传')
      }
    } else if (!progress) {
      await assertApprovalCurrent()
      progress = await this.store.checkpoint(progressKey, progressFingerprint, {
        version: 1, phase: 'upload_started', idempotencyKey: intent.idempotencyKey,
      })
      try {
        const uploadMaterials = [
          restoreRevisionMaterial({ name: intent.body.name, mediaType: 'text/plain; charset=utf-8', bytes: intent.body.bytes, sha256: intent.body.sha256, bytesBase64: intent.body.bytesBase64 }),
          ...intent.materials.map(restoreRevisionMaterial),
        ]
        const uploaded = await this.options.service.stageWorkMaterials(uploadMaterials, assertCurrent)
        if (uploaded.length !== uploadMaterials.length || uploaded.some((file, index) => file.type !== 'forge-file'
          || file.name !== uploadMaterials[index]!.name || file.bytes !== uploadMaterials[index]!.bytes || file.sha256 !== uploadMaterials[index]!.sha256 || !file.id)) {
          throw new Error('Forge 上传回执与固定材料包不一致')
        }
        references = {
          primary: { fileId: uploaded[0]!.id, name: uploaded[0]!.name, sha256: uploaded[0]!.sha256 },
          attachments: uploaded.slice(1).map((file) => ({ fileId: file.id, name: file.name, sha256: file.sha256 })),
        }
        progress = await this.store.checkpoint(progressKey, progressFingerprint, {
          version: 1, phase: 'uploaded', idempotencyKey: intent.idempotencyKey,
          primary: references.primary, attachments: references.attachments,
        })
      } catch (error) {
        if (error instanceof Error && /登录已失效|请先登录|账号已切换|员工轮次或账号已变化/.test(error.message)) throw error
        return {
          status: 'upload_unknown', submitted: false, receiptConfirmed: false, materials: publicFiles,
          message: '修订材料包已固定，但 Forge 文件上传未能取得完整回执。审批未递交；桌面不会盲目重传，以免产生重复文件。请重新打开事项后再由员工发起新一轮。',
        }
      }
    } else {
      throw new Error('修订材料上传状态不完整；桌面只查询原回执，不会重传')
    }

    await assertApprovalCurrent()
    progress = await this.store.checkpoint(progressKey, progressFingerprint, {
      version: 1, phase: 'request_started', idempotencyKey: intent.idempotencyKey,
      primary: references.primary, attachments: references.attachments,
    })
    const request: ApprovalRevisionSubmission = {
      returnVersion: intent.returnVersion, sourceMaterialVersion: intent.sourceMaterialVersion,
      idempotencyKey: intent.idempotencyKey, primary: references.primary, attachments: references.attachments,
    }
    let response: { status: number; body: unknown }
    try {
      response = await this.options.service.submitApprovalRevision(intent.requestId, request, assertCurrent)
    } catch (error) {
      if (error instanceof Error && /登录已失效|请先登录|账号已切换|员工轮次或账号已变化/.test(error.message)) {
        throw error
      }
      return resolveReceipt(progress)
    }
    if (response.status === 404) {
      const rejected: ReturnedRevisionProgress = {
        ...progress, phase: 'rejected', rejectionState: 'unavailable',
        message: '当前 Forge 服务没有退回材料修订接口（404）。修订材料已固定，但审批未递交。',
      }
      await this.store.checkpoint(progressKey, progressFingerprint, rejected)
      return { status: 'unavailable', submitted: false, receiptConfirmed: false, materials: publicFiles, message: rejected.message }
    }
    if (response.status === 409 || response.status === 400 || response.status === 413 || response.status === 422) {
      const rejected: ReturnedRevisionProgress = {
        ...progress, phase: 'rejected', rejectionState: 'rejected',
        message: response.status === 409
          ? 'Forge 检测到审批或材料版本冲突，拒绝了本次递交。请刷新待办。'
          : response.status === 413 ? 'Forge 拒绝了超出大小限制的修订材料。审批未递交。'
            : response.status === 422 ? 'Forge 无法核验修订材料及摘要，审批未递交。请刷新材料。'
              : 'Forge 拒绝了修订材料请求，审批未递交。',
      }
      await this.store.checkpoint(progressKey, progressFingerprint, rejected)
      return { status: 'rejected', submitted: false, receiptConfirmed: false, materials: publicFiles, message: rejected.message }
    }
    const receipt = response.status >= 200 && response.status < 300 ? revisionReceipt(response.body, intent.requestId) : undefined
    if (receipt) {
      const confirmed: ReturnedRevisionProgress = { ...progress, phase: 'receipt', receipt }
      try { await this.store.checkpoint(progressKey, progressFingerprint, confirmed) }
      catch { /* request_started remains durable; the next attempt only reads the Forge receipt */ }
      return revisionReceiptResult(receipt, publicFiles)
    }
    return resolveReceipt(progress)
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
