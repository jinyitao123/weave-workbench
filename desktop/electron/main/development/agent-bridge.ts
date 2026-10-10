import { createHash, randomUUID } from 'node:crypto'
import type { EnterpriseBusinessCapability, EnterpriseBusinessCapabilityCatalog } from '../../../src/types/api'
import type { DevelopmentTrialAction, TeamDefinition, TeamWorkspace, TeamWorkspaceCommand } from '../../../src/types/team-workspace'
import { applyTeamDevelopmentOperations, type TeamDevelopmentProposal } from '../../../src/pages/team-workspace/development-proposal'
import { WORKBENCH_RESULT_PROTOCOL } from '../../../src/pages/team-workspace/graph'
import { businessCompletionRequirement, requireBusinessCompletionBindings, requireDeclaredBusinessCompletion } from '../../../src/pages/team-workspace/business-completion'
import { freezeDevelopmentTrialActions, publicationReadinessBlocker, workflowCandidateCapabilityIds, workflowSimulationChoices, workflowTrialBlocker } from '../../../src/pages/team-workspace/development-trial'
import { toolActivityEvidence, trialToolDisplayName, trialToolMissingDetails, trialToolPayload, trialToolPayloadCompleteness, trialToolStatus, type TrialToolEvidence } from '../../../src/lib/trial-tool-evidence'
import { CapabilityBridge, type CapabilityClaim, type CapabilityScope } from '../lib/capability-bridge'
import { HandoffStore, type HandoffStorage } from '../enterprise/handoff-store'
import { MAX_RPC_WRITE_FRAME_BYTES } from '../agent-rpc/limits'
import { requireRecord, requireString } from '../validation'

interface DevelopmentContext {
  accountKey: string
  teamId: string
  revision: number
  document: TeamDefinition
  catalog: EnterpriseBusinessCapabilityCatalog
  selected?: { kind: 'member' | 'step'; id: string }
  proposal?: TeamDevelopmentProposal
  pendingSave?: {
    operationsDigest: string
    baseRevision: number
    baseDocument: TeamDefinition
    proposal: TeamDevelopmentProposal
  }
  stale?: boolean
}
interface DevelopmentTrial {
  teamId: string
  workflowId: string
  workflowName: string
  revision: number
  requestId: string
  intentDigest: string
  authorizationSourceHash?: string
  simulationActionSelectors?: string[]
  businessActions?: DevelopmentTrialAction[]
  runId?: string
  stepNames: Record<string, string>
}
type DevelopmentUserCommandType = 'prompt' | 'steer' | 'follow_up'
interface DevelopmentUserTurnScope {
  teamId: string
  revision: number
  documentHash: string
  workflowId: string
}
interface DevelopmentUserTurn {
  source: 'trusted_desktop_employee_input'
  sourceHash: string
  turnId: string
  accountKey: string
  runtimeId: string
  sessionPath?: string
  commandType: DevelopmentUserCommandType
  text: string
  scope?: DevelopmentUserTurnScope
}
interface PendingDevelopmentUserCommand {
  token: string
  claim: CapabilityClaim
  commandType: DevelopmentUserCommandType
  consumed: boolean
}
interface DevelopmentActivity {
  status?: string
  completeness?: Record<string, string>
  members?: Array<{
    name?: string; status?: string
    stages?: Array<{
      name?: string; status?: string; inputs?: Array<{ source?: string; summary?: string }>
      outputs?: Array<{ kind?: string; path?: string; content?: string; content_type?: string; content_bytes?: number; truncated?: boolean }>
      tools?: Array<TrialToolEvidence & { name?: string }> | null
      tool_calls?: number
      failure_reason?: string
    }>
  }>
  outputs?: Array<Record<string, unknown>>
}
interface DevelopmentTrialInput { input?: string; status?: string; output?: string }
interface DevelopmentTrialReceipt { request_id?: string; run_id?: string }
interface StoredDevelopmentTrial extends DevelopmentTrial {}
interface StoredDevelopment {
  context?: Omit<DevelopmentContext, 'catalog'>
  trial?: StoredDevelopmentTrial
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
}

function comparableDocument(document: TeamDefinition): TeamDefinition {
  // Weave's typed configuration writes these two omitted optional fields as
  // null/0. Normalize only those declared defaults, including persisted older
  // pending saves; all business fields, graph bindings and versions still match.
  return { ...document, members: document.members.map((member) => ({
    ...member, configuration: { ...member.configuration,
      toolLoopControl: member.configuration.toolLoopControl === undefined ? null : member.configuration.toolLoopControl,
      maxToolRepeats: member.configuration.maxToolRepeats === undefined ? 0 : member.configuration.maxToolRepeats,
    },
  })) }
}

function sameDocument(left: TeamDefinition, right: TeamDefinition): boolean {
  return JSON.stringify(canonical(comparableDocument(left))) === JSON.stringify(canonical(comparableDocument(right)))
}

function digest(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex')
}

function requestedSimulationSelectors(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 32 || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 512)) {
    throw new TypeError('本次模拟动作选择无效')
  }
  const selectors = value as string[]
  if (new Set(selectors).size !== selectors.length) throw new TypeError('本次模拟动作不能重复选择')
  return selectors
}

function stableUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function messageStatus(status: string | undefined): string {
  return ({
    submitting: '等待接单', queued: '排队中', running: '执行中', succeeded: '已完成',
    failed: '失败', cancelled: '已取消', blocked: '等待处理', pending: '等待执行',
    completed: '已完成', tool_started: '执行中', tool_completed: '已完成', tool_failed: '失败',
  } as Record<string, string>)[status ?? ''] ?? '等待更新'
}

function completenessLabel(value: string | undefined): string {
  return ({ complete: '完整', partial: '部分', unavailable: '不可用', not_applicable: '不适用（本次零调用）' } as Record<string, string>)[value ?? ''] ?? '未确认'
}

export class TeamDevelopmentAgentBridge extends CapabilityBridge {
  protected readonly rateLimit = 30
  protected readonly rateLimitError = '团队开发请求过于频繁，请稍后重试'
  private readonly runtimeTokens = new Map<string, string>()
  private readonly contexts = new Map<string, DevelopmentContext>()
  private readonly listedTeams = new Map<string, Array<{ id: string; name: string }>>()
  private readonly trials = new Map<string, DevelopmentTrial>()
  private readonly userTurns = new Map<string, DevelopmentUserTurn>()
  private readonly pendingUserCommands = new Map<string, PendingDevelopmentUserCommand>()
  private readonly store: HandoffStore

  constructor(private readonly options: {
    accountKey(): Promise<string>
    developer(): Promise<{ accountId: string }>
    teams(): Promise<Array<{ id: string; name: string; objective?: string }>>
    team(teamId: string, accountId: string): Promise<TeamWorkspace>
    workspace(command: TeamWorkspaceCommand): Promise<unknown>
    catalog(): Promise<EnterpriseBusinessCapabilityCatalog>
    extensionPath: string
    storage?: HandoffStorage
  }) { super(); this.store = new HandoffStore(options.storage) }

  private storageKey(accountKey: string, sessionFile: string): string { return `team-development:${accountKey}:${sessionFile}` }

  private async persist(claim: CapabilityClaim): Promise<void> {
    if (!claim.sessionPath) return
    const accountKey = await this.options.accountKey()
    const context = this.contexts.get(claim.token)
    const value: StoredDevelopment = {
      ...(context ? { context: {
        accountKey: context.accountKey, teamId: context.teamId, revision: context.revision, document: context.document,
        selected: context.selected, proposal: context.proposal, pendingSave: context.pendingSave, stale: context.stale,
      } } : {}),
      ...(this.trials.has(claim.token) ? { trial: this.trials.get(claim.token) } : {}),
    }
    await this.store.checkpoint(this.storageKey(accountKey, claim.sessionPath), 'team-development-v1', value)
  }

  private async restore(accountKey: string, sessionFile: string, token?: string): Promise<StoredDevelopment | undefined> {
    const saved = await this.store.inspect<StoredDevelopment>(this.storageKey(accountKey, sessionFile))
    if (!saved) return undefined
    const value = saved.value
    if (value.context && value.context.accountKey !== accountKey) return undefined
    if (value.context) {
      // A stored preview has nowhere to be applied; only a save awaiting confirmation is kept.
      if (!value.context.pendingSave) value.context.proposal = undefined
      const developer = await this.options.developer()
      const remote = await this.options.team(value.context.teamId, developer.accountId)
      if (remote.revision !== value.context.revision || !sameDocument(remote.document, value.context.document)) {
        if (value.context.pendingSave) value.context.stale = true
        else {
          value.context.revision = remote.revision
          value.context.document = structuredClone(remote.document)
          value.context.stale = false
        }
      }
      if (token && !this.contexts.has(token)) this.contexts.set(token, { ...value.context, catalog: await this.options.catalog() })
    }
    if (token && value.trial) this.trials.set(token, value.trial)
    return value
  }

  protected environmentEntries(url: string, token: string): NodeJS.ProcessEnv {
    return {
      GOOEYPI_TEAM_DEVELOPMENT_URL: url,
      GOOEYPI_TEAM_DEVELOPMENT_TOKEN: token,
      GOOEYPI_TEAM_DEVELOPMENT_EXTENSION_PATH: this.options.extensionPath,
    }
  }

  override environmentFor(scope: CapabilityScope): NodeJS.ProcessEnv {
    if (scope.harness !== 'pi') throw new Error('团队开发只支持桌面 Pi')
    return super.environmentFor(scope)
  }

  bindRuntime(token: string | undefined, runtimeId: string, sessionFile?: string): void {
    if (!token) return
    const claim = this.claimForToken(token)
    if (claim?.harness !== 'pi') return
    const previousToken = this.runtimeTokens.get(runtimeId)
    if (previousToken && previousToken !== token) {
      this.clearUserTurn(previousToken)
      this.pendingUserCommands.delete(runtimeId)
    }
    if (claim.sessionPath && sessionFile && claim.sessionPath !== sessionFile) { this.clearUserTurn(token); this.revoke(token); throw new Error('团队开发会话已变化') }
    if (sessionFile) {
      claim.sessionPath = sessionFile
      const turn = this.userTurns.get(token)
      if (turn && turn.sessionPath === undefined) turn.sessionPath = sessionFile
    }
    this.runtimeTokens.set(runtimeId, token)
  }

  bindRuntimeSession(runtimeId: string, sessionFile: string): void {
    const token = this.runtimeTokens.get(runtimeId)
    if (token) this.bindRuntime(token, runtimeId, sessionFile)
  }

  private clearUserTurn(token: string): void {
    this.userTurns.delete(token)
    for (const [runtimeId, pending] of this.pendingUserCommands) if (pending.token === token) this.pendingUserCommands.delete(runtimeId)
  }

  private documentHash(document: TeamDefinition): string {
    return digest(JSON.stringify(canonical(comparableDocument(document))))
  }

  private draftIdentity(context: Pick<DevelopmentContext, 'teamId' | 'revision' | 'document'>): Pick<DevelopmentUserTurnScope, 'teamId' | 'revision' | 'documentHash'> {
    return { teamId: context.teamId, revision: context.revision, documentHash: this.documentHash(context.document) }
  }

  private sameDraftIdentity(left: Pick<DevelopmentUserTurnScope, 'teamId' | 'revision' | 'documentHash'>, right: Pick<DevelopmentUserTurnScope, 'teamId' | 'revision' | 'documentHash'>): boolean {
    return left.teamId === right.teamId && left.revision === right.revision && left.documentHash === right.documentHash
  }

  private sameTurnScope(left: DevelopmentUserTurnScope, right: DevelopmentUserTurnScope): boolean {
    return this.sameDraftIdentity(left, right) && left.workflowId === right.workflowId
  }

  private assertPiOpenContextChange(
    token: string,
    sourceAtDispatch: DevelopmentUserTurn | undefined,
    contextAtDispatch: DevelopmentContext | undefined,
    nextContext: DevelopmentContext,
  ): void {
    const current = this.userTurns.get(token)
    if (this.contexts.get(token) !== contextAtDispatch) throw new Error('当前团队开发上下文已变化；请重新读取后再打开团队。')
    if (current && current.accountKey !== nextContext.accountKey) throw new Error('账号已变化；不会把当前员工请求绑定到另一个开发账号。')
    const nextIdentity = this.draftIdentity(nextContext)
    const previousIdentity = contextAtDispatch ? this.draftIdentity(contextAtDispatch) : undefined
    if (current !== sourceAtDispatch) {
      if (!previousIdentity || !this.sameDraftIdentity(previousIdentity, nextIdentity)) {
        throw new Error('员工轮次已变化；不会用新请求接续旧团队上下文切换。')
      }
      return
    }
    if (current?.scope && !this.sameDraftIdentity(current.scope, nextIdentity)) {
      throw new Error('本轮员工请求已绑定其他团队或草稿；请在目标上下文重新提出模拟要求。')
    }
  }

  private rebindUserTurnAfterControlledSave(
    token: string,
    sourceAtDispatch: DevelopmentUserTurn | undefined,
    previousIdentity: Pick<DevelopmentUserTurnScope, 'teamId' | 'revision' | 'documentHash'>,
    context: DevelopmentContext,
  ): void {
    const current = this.userTurns.get(token)
    if (!current) return
    if (this.contexts.get(token) !== context) return
    const nextIdentity = this.draftIdentity(context)
    if (current !== sourceAtDispatch) {
      if (!this.sameDraftIdentity(previousIdentity, nextIdentity)) this.clearUserTurn(token)
      return
    }
    if (!current.scope) return
    if (!this.sameDraftIdentity(current.scope, previousIdentity)
      || !context.document.workflows.some((workflow) => workflow.id === current.scope!.workflowId)) {
      this.clearUserTurn(token)
      return
    }
    current.scope = { ...this.draftIdentity(context), workflowId: current.scope.workflowId }
  }

  invalidateEmployeeTurn(runtimeId: string): void {
    const token = this.runtimeTokens.get(runtimeId)
    if (token) this.clearUserTurn(token)
    this.pendingUserCommands.delete(runtimeId)
  }

  /** Called before forwarding a trusted renderer command so previous turns cannot carry forward. */
  beginEmployeeCommand(runtimeId: string, rawType: unknown): void {
    const token = this.runtimeTokens.get(runtimeId)
    const claim = token ? this.claimForToken(token) : undefined
    if (!token || !claim || !['prompt', 'steer', 'follow_up', 'abort', 'compact'].includes(String(rawType))) return
    this.invalidateEmployeeTurn(runtimeId)
    if (rawType === 'prompt' || rawType === 'steer' || rawType === 'follow_up') {
      this.pendingUserCommands.set(runtimeId, { token, claim, commandType: rawType, consumed: false })
    }
  }

  /** Revalidates the captured input through the same trusted desktop input parser as enterprise handoffs. */
  async captureTrustedEmployeeCommand(runtimeId: string, command: unknown, employeeInput?: unknown): Promise<void> {
    const pending = this.pendingUserCommands.get(runtimeId)
    const token = this.runtimeTokens.get(runtimeId)
    if (!pending || pending.consumed || !token || pending.token !== token) return
    pending.consumed = true
    try {
      const value = requireRecord(command, 'command')
      if (value.type !== pending.commandType) return
      const claim = this.claimForToken(token)
      if (!claim || claim !== pending.claim || claim.harness !== 'pi') return
      const prompt = requireString(value.message, 'command.message', { min: 1, max: 1_048_576, trim: false })
      const { captureEmployeeInput } = await import('../enterprise/employee-input')
      const captured = captureEmployeeInput(prompt, employeeInput, claim)
      const images = value.images === undefined ? [] : (() => {
        if (!Array.isArray(value.images) || value.images.length > 8) throw new TypeError('桌面员工输入中的图片来源无效')
        return value.images.map((raw, index) => {
          const image = requireRecord(raw, `images[${index}]`)
          if (image.type !== 'image') throw new TypeError('桌面员工输入中的图片来源无效')
          const mimeType = requireString(image.mimeType, `images[${index}].mimeType`, { min: 1, max: 100 })
          const data = requireString(image.data, `images[${index}].data`, { min: 1, max: MAX_RPC_WRITE_FRAME_BYTES })
          return { mimeType, sha256: createHash('sha256').update(data).digest('hex') }
        })
      })()
      const accountKey = await this.options.accountKey()
      const turnId = randomUUID()
      const sourceHash = createHash('sha256').update(JSON.stringify(canonical({
        source: 'trusted_desktop_employee_input', turnId, commandType: pending.commandType,
        accountKey, runtimeId, sessionPath: claim.sessionPath ?? null,
        prompt, text: captured.text, materials: captured.materials ?? [], images,
      }))).digest('hex')
      if (this.pendingUserCommands.get(runtimeId) !== pending || this.runtimeTokens.get(runtimeId) !== token
        || this.claimForToken(token) !== claim || await this.options.accountKey() !== accountKey) return
      this.userTurns.set(token, {
        source: 'trusted_desktop_employee_input', sourceHash, turnId,
        accountKey, runtimeId, ...(claim.sessionPath ? { sessionPath: claim.sessionPath } : {}),
        commandType: pending.commandType, text: captured.text,
      })
    } finally {
      if (this.pendingUserCommands.get(runtimeId) === pending) this.pendingUserCommands.delete(runtimeId)
    }
  }

  async bindContext(runtimeId: string, context: Omit<DevelopmentContext, 'accountKey' | 'proposal'>, accountKey: string): Promise<void> {
    const token = this.runtimeTokens.get(runtimeId)
    const claim = token ? this.claimForToken(token) : undefined
    if (!token || !claim) throw new Error('Pi 开发会话尚未启动')
    if (!Number.isSafeInteger(context.revision) || context.revision < 0 || !Array.isArray(context.document?.members) || !Array.isArray(context.document?.workflows)) throw new Error('团队草稿不完整')
    const previous = this.contexts.get(token)
    const sameIdentity = Boolean(previous && previous.accountKey === accountKey && previous.teamId === context.teamId
      && previous.revision === context.revision && this.documentHash(previous.document) === this.documentHash(context.document))
    if (!sameIdentity) {
      this.clearUserTurn(token)
    }
    this.contexts.set(token, { ...context, accountKey, document: structuredClone(context.document), proposal: undefined, pendingSave: undefined, stale: false })
    if (!sameIdentity) this.trials.delete(token)
    await this.persist(claim)
  }

  async getProposal(runtimeId: string): Promise<(TeamDevelopmentProposal & { baseDocument: TeamDefinition; revision: number }) | undefined> {
    const token = this.runtimeTokens.get(runtimeId)
    const claim = token ? this.claimForToken(token) : undefined
    if (claim?.sessionPath && !this.contexts.has(token!)) await this.restore(await this.options.accountKey(), claim.sessionPath, token)
    const context = token ? this.contexts.get(token) : undefined
    if (context && await this.options.accountKey() !== context.accountKey) throw new Error('团队开发账号已变化')
    return context?.proposal ? {
      ...structuredClone(context.proposal), baseDocument: structuredClone(context.document), revision: context.revision,
    } : undefined
  }

  async getState(runtimeId: string): Promise<{ teamId?: string; revision?: number; proposal?: TeamDevelopmentProposal & { baseDocument: TeamDefinition; revision: number } }> {
    const token = this.runtimeTokens.get(runtimeId)
    const claim = token ? this.claimForToken(token) : undefined
    if (claim?.sessionPath && !this.contexts.has(token!)) await this.restore(await this.options.accountKey(), claim.sessionPath, token)
    const context = token ? this.contexts.get(token) : undefined
    if (context && await this.options.accountKey() !== context.accountKey) throw new Error('团队开发账号已变化')
    return { ...(context ? { teamId: context.teamId, revision: context.revision } : {}), ...(context?.proposal ? { proposal: { ...structuredClone(context.proposal), baseDocument: structuredClone(context.document), revision: context.revision } } : {}) }
  }

  async getStateForSession(sessionFile: string): Promise<{ teamId?: string; revision?: number; proposal?: TeamDevelopmentProposal & { baseDocument: TeamDefinition; revision: number } }> {
    const saved = await this.restore(await this.options.accountKey(), sessionFile)
    const context = saved?.context
    return { ...(context ? { teamId: context.teamId, revision: context.revision } : {}), ...(context?.proposal ? { proposal: { ...context.proposal, baseDocument: context.document, revision: context.revision } } : {}) }
  }

  invalidateAccount(): void { this.revokeAllClaims(); this.contexts.clear(); this.runtimeTokens.clear(); this.listedTeams.clear(); this.userTurns.clear(); this.pendingUserCommands.clear() }

  protected onClaimRevoked(claim: CapabilityClaim): void {
    this.contexts.delete(claim.token)
    this.listedTeams.delete(claim.token)
    this.trials.delete(claim.token)
    this.clearUserTurn(claim.token)
    for (const [runtimeId, token] of this.runtimeTokens) if (token === claim.token) this.runtimeTokens.delete(runtimeId)
  }

  private readableContext(context: DevelopmentContext) {
    const members = context.document.members
    const workflows = context.document.workflows
    const memberName = (id: unknown) => members.find((item) => item.id === id)?.configuration.displayName ?? '未指定成员'
    const capabilityName = (id: string) => context.catalog.capabilities.find((item) => item.id === id)?.name ?? '当前不可读取的业务动作'
    return {
      team: {
        name: context.document.name,
        objective: context.document.objective,
        draftStatus: context.stale ? '团队草稿已在别处变化；这里显示的是变化前的内容。保存、试跑和更新团队会先拒绝，请重新打开该团队读取最新草稿' : '当前草稿',
        pendingChanges: context.pendingSave?.proposal.changes,
        members: members.map((item) => ({
          name: item.configuration.displayName, role: item.configuration.role === 'avatar' ? '负责人' : '成员',
          duty: item.relationship.duty, whenToUse: item.relationship.whenToUse,
          contextInstruction: item.relationship.contextInstruction,
          resultRequirement: item.relationship.resultRequirement,
          instruction: item.configuration.systemPrompt, model: item.configuration.model,
          skills: item.configuration.skills, businessActions: item.configuration.businessCapabilityIds.map(capabilityName),
        })),
        workflows: workflows.map((flow) => {
          const stepName = (id: unknown) => flow.graph_definition.nodes.find((node) => node.id === id)?.label ?? '未命名步骤'
          const completion = businessCompletionRequirement(flow)
          const candidateIds = workflowCandidateCapabilityIds(context.document, flow)
          const candidateActions = candidateIds.flatMap((id) => context.catalog.capabilities.filter((item) => item.id === id))
          const simulationActions = workflowSimulationChoices(candidateActions).map(({ selector, action }) => ({
            selector, name: action.name, description: action.description,
            effect: action.effect === 'write' ? '业务写动作' : '只读业务动作',
            status: action.status === 'available' ? '可模拟' : '暂不可用',
          }))
          return {
            name: flow.name, description: flow.description,
            ...(completion ? { businessCompletion: { actions: completion.capabilities.map(capabilityName), whenAuthorized: true, allowNeedsInput: completion.allowNeedsInput } } : {}),
            simulation_actions: simulationActions,
            resultProtocol: flow.graph_definition.result_protocol === WORKBENCH_RESULT_PROTOCOL ? '可要求补充材料' : '普通结果',
            steps: flow.graph_definition.nodes.map((node) => ({
              name: node.label || '未命名步骤', type: ({ lead: '负责人处理', worker: '成员执行', parallel: '并行分工', join: '汇合结果', deliver: '交付结果' } as Record<string, string>)[node.type] ?? '流程步骤',
              executor: node.type === 'lead' ? members.find((item) => item.configuration.role === 'avatar')?.configuration.displayName : node.type === 'worker' ? memberName(node.config?.agent_id) : undefined,
              instruction: node.config?.instruction, resultRequirement: node.config?.result_requirement,
              inputs: Object.values((node.inputs ?? {}) as Record<string, { value?: { source?: string; node_id?: string } }>).map((binding) => binding.value?.source === 'run_input' ? '本次任务输入' : binding.value?.source === 'node_output' ? `${stepName(binding.value.node_id)}的结果` : '其他输入'),
              deliveryFrom: node.type === 'deliver' ? stepName((node.config?.result as { node_id?: string } | undefined)?.node_id) : undefined,
              joinPolicy: node.type === 'join' ? node.config?.policy : undefined,
            })),
            connections: flow.graph_definition.edges.map((edge) => ({ from: stepName(edge.from_node_id), to: stepName(edge.to_node_id), relation: ({ success: '继续', branch: '并行分支', join: '汇合', back: '返回' } as Record<string, string>)[edge.route ?? 'success'] ?? '连接' })),
          }
        }),
      },
      selected: context.selected?.kind === 'member' ? memberName(context.selected.id)
        : context.selected?.kind === 'step' ? workflows.flatMap((flow) => flow.graph_definition.nodes).find((node) => node.id === context.selected?.id)?.label : undefined,
      business_actions: context.catalog.capabilities.map((item) => ({ name: item.name, description: item.description, effect: item.effect === 'write' ? '修改业务记录' : '只读取业务资料', status: item.status === 'available' ? '可绑定' : '暂不可用', params: item.params ?? [] })),
    }
  }

  private namedOperations(context: DevelopmentContext, raw: unknown): unknown {
    if (!Array.isArray(raw)) return raw
    const addedMembers = new Set<string>()
    const memberId = (name: unknown) => {
      if (typeof name !== 'string') return name
      if (addedMembers.has(name)) return name
      const found = context.document.members.filter((item) => item.configuration.displayName === name)
      if (found.length !== 1) throw new Error(`成员“${name}”不存在或名称重复，请读取团队上下文确认准确名称`)
      return found[0]!.id
    }
    const flow = (name: unknown) => {
      if (typeof name !== 'string') return undefined
      const found = context.document.workflows.filter((item) => item.name === name)
      if (found.length !== 1) throw new Error(`流程“${name}”不存在或名称重复`)
      return found[0]
    }
    const stepId = (flowName: unknown, name: unknown) => {
      if (typeof name !== 'string') return name
      const found = flow(flowName)?.graph_definition.nodes.filter((item) => item.label === name) ?? []
      if (found.length !== 1) throw new Error(`步骤“${name}”不存在或名称重复`)
      return found[0]!.id
    }
    return raw.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      const item = { ...value } as Record<string, unknown>
      if (item.kind === 'member_add' && typeof item.ref === 'string') addedMembers.add(item.ref)
      if ('member' in item) item.member = memberId(item.member)
      if ('flow' in item) item.flow = flow(item.flow)?.id ?? item.flow
      if ('step' in item) item.step = stepId(value.flow, item.step)
      if ('after' in item) item.after = stepId(value.flow, item.after)
      if ('from' in item && (item.kind === 'step_input' || item.kind === 'delivery' || item.kind === 'result_protocol')) item.from = stepId(value.flow, item.from)
      if (item.kind === 'capability' && typeof item.capability === 'string') {
        const found = context.catalog.capabilities.filter((action) => action.name === item.capability)
        if (found.length !== 1) throw new Error(`业务动作“${item.capability}”不存在或名称重复`)
        item.capability = found[0]!.id
      }
      if (item.kind === 'business_completion') {
        const target = flow(value.flow)
        if (!target || !Array.isArray(item.capabilities) || item.capabilities.length < 1 || item.capabilities.length > 16) throw new Error('完成检查须指定流程及 1 至 16 个准确业务动作名称')
        const ids = item.capabilities.map((name) => {
          if (typeof name !== 'string') throw new Error('完成检查须使用当前目录返回的准确业务动作名称')
          const found = context.catalog.capabilities.filter((action) => action.name === name)
          if (found.length !== 1) throw new Error(`业务动作“${name}”不存在或名称重复`)
          return found[0].id
        })
        item.capabilities = requireBusinessCompletionBindings(context.document, target, ids, context.catalog)
      }
      return item
    })
  }

  private acceptSavedDocument(context: DevelopmentContext, remote: TeamWorkspace): void {
    context.document = structuredClone(remote.document)
    context.revision = remote.revision
    context.proposal = undefined
    context.pendingSave = undefined
    context.stale = false
  }

  private async currentTeam(context: DevelopmentContext, accountId: string): Promise<TeamWorkspace> {
    if (await this.options.accountKey() !== context.accountKey) throw new Error('团队开发账号已变化')
    return this.options.team(context.teamId, accountId)
  }

  private async saveTeam(context: DevelopmentContext, developer: { accountId: string }, rawOperations: unknown, claim: CapabilityClaim, sourceAtDispatch?: DevelopmentUserTurn): Promise<unknown> {
    if (!Array.isArray(rawOperations)) throw new Error('修改内容必须是 JSON 数组')
    const operationsDigest = digest(rawOperations)
    const previousIdentity = this.draftIdentity(context)
    let remote = await this.currentTeam(context, developer.accountId)
    let attempt = context.pendingSave

    if (attempt && remote.revision > attempt.baseRevision && sameDocument(remote.document, attempt.proposal.document)) {
      const changes = attempt.proposal.changes
      this.acceptSavedDocument(context, remote)
      this.rebindUserTurnAfterControlledSave(claim.token, sourceAtDispatch, previousIdentity, context)
      await this.persist(claim)
      if (attempt.operationsDigest === operationsDigest) return { team: remote.document.name, changes, message: '团队草稿已保存，当前生效版本没有改变。' }
      attempt = undefined
    }

    if (attempt) {
      if (attempt.operationsDigest !== operationsDigest) throw new Error('上一项团队修改的保存结果尚未确认；请先重试原修改，避免覆盖它。')
      if (remote.revision !== attempt.baseRevision || !sameDocument(remote.document, attempt.baseDocument)) {
        context.stale = true
        await this.persist(claim)
        throw new Error('团队草稿已变化，与本次修改的起点不一致。原修改已保留但不会覆盖新内容；请重新打开该团队读取最新草稿，再重新提交修改。')
      }
    } else {
      const proposal = applyTeamDevelopmentOperations(context.document, this.namedOperations(context, rawOperations), context.catalog)
      attempt = {
        operationsDigest,
        baseRevision: context.revision,
        baseDocument: structuredClone(context.document),
        proposal,
      }
      context.proposal = proposal
      context.pendingSave = attempt
      await this.persist(claim)
      if (remote.revision !== attempt.baseRevision || !sameDocument(remote.document, attempt.baseDocument)) {
        context.stale = true
        await this.persist(claim)
        throw new Error('团队草稿已变化，与本次修改的起点不一致。原修改已保留但不会覆盖新内容；请重新打开该团队读取最新草稿，再重新提交修改。')
      }
    }

    const pending = attempt!
    try {
      const saved = await this.options.workspace({
        action: 'save', teamId: context.teamId, accountId: developer.accountId,
        revision: pending.baseRevision, document: pending.proposal.document,
      }) as TeamWorkspace
      if (!saved || !Number.isSafeInteger(saved.revision) || !sameDocument(saved.document, pending.proposal.document)) throw new Error('Weave 未返回已保存的团队草稿')
      const changes = pending.proposal.changes
      this.acceptSavedDocument(context, saved)
      this.rebindUserTurnAfterControlledSave(claim.token, sourceAtDispatch, previousIdentity, context)
      await this.persist(claim)
      return { team: saved.document.name, changes, message: '团队草稿已保存，当前生效版本没有改变。' }
    } catch (cause) {
      try {
        remote = await this.currentTeam(context, developer.accountId)
        if (remote.revision > pending.baseRevision && sameDocument(remote.document, pending.proposal.document)) {
          const changes = pending.proposal.changes
          this.acceptSavedDocument(context, remote)
          this.rebindUserTurnAfterControlledSave(claim.token, sourceAtDispatch, previousIdentity, context)
          await this.persist(claim)
          return { team: remote.document.name, changes, message: '团队草稿已保存，已从远端核对到本次修改；当前生效版本没有改变。' }
        }
        context.stale = remote.revision !== pending.baseRevision || !sameDocument(remote.document, pending.baseDocument)
      } catch { /* Keep the durable candidate when the result cannot be checked. */ }
      await this.persist(claim)
      throw cause
    }
  }

  private businessActions(context: DevelopmentContext, workflow: TeamDefinition['workflows'][number]): EnterpriseBusinessCapability[] {
    const ids = workflowCandidateCapabilityIds(context.document, workflow)
    return ids.map((id) => {
      const action = context.catalog.capabilities.find((candidate) => candidate.id === id)
      if (!action || action.executionMode === 'employee_only' || action.status !== 'available' || !action.actionName || !action.objectName) throw new Error(action?.unavailableReason ?? '当前流程候选成员绑定了暂不可用的 Forge 业务动作，请先修正团队草稿')
      return action
    })
  }

  private async requireCurrentUserTurn(context: DevelopmentContext, claim: CapabilityClaim, expected: DevelopmentUserTurn | undefined, workflowId: string): Promise<DevelopmentUserTurn> {
    const turn = expected
    if (!turn || this.userTurns.get(claim.token) !== turn) {
      throw new Error('模拟动作需要绑定当前账号和 Pi 会话中的员工请求；请在当前会话重新提出本轮模拟要求。')
    }
    if (turn.source !== 'trusted_desktop_employee_input' || !/^[0-9a-f]{64}$/.test(turn.sourceHash)
      || turn.accountKey !== context.accountKey || turn.runtimeId.length === 0
      || this.runtimeTokens.get(turn.runtimeId) !== claim.token || claim.harness !== 'pi'
      || turn.sessionPath !== undefined && turn.sessionPath !== claim.sessionPath) {
      throw new Error('模拟动作需要绑定当前账号和 Pi 会话中的员工请求；请在当前会话重新提出本轮模拟要求。')
    }
    const expectedScope: DevelopmentUserTurnScope = { ...this.draftIdentity(context), workflowId }
    if (turn.scope && !this.sameTurnScope(turn.scope, expectedScope)) {
      throw new Error('本轮模拟请求已绑定其他团队、草稿修订或流程；请在目标上下文重新提出模拟要求。')
    }
    const accountKey = await this.options.accountKey()
    if (accountKey !== context.accountKey || this.userTurns.get(claim.token) !== turn
      || this.claimForToken(claim.token) !== claim || this.runtimeTokens.get(turn.runtimeId) !== claim.token) {
      throw new Error('员工账号、会话或当前请求已变化；本次模拟动作不会转移到新的开发上下文。')
    }
    if (turn.scope && !this.sameTurnScope(turn.scope, expectedScope)) {
      throw new Error('本轮模拟请求已绑定其他团队、草稿修订或流程；请在目标上下文重新提出模拟要求。')
    }
    turn.scope ??= expectedScope
    return turn
  }

  private async runTrial(context: DevelopmentContext, developer: { accountId: string }, params: Record<string, unknown>, claim: CapabilityClaim, sourceAtDispatch?: DevelopmentUserTurn): Promise<unknown> {
    if (context.pendingSave) throw new Error('团队草稿还有一项保存结果待确认，请先重试保存，再试跑。')
    const workflowName = typeof params.workflow_name === 'string' ? params.workflow_name.trim() : ''
    const input = typeof params.input === 'string' ? params.input : ''
    if (!input.trim() || Buffer.byteLength(input, 'utf8') > 700_000) throw new Error('请提供 700 KB 以内的测试输入')
    const matches = context.document.workflows.filter((workflow) => workflow.name === workflowName)
    if (matches.length !== 1) throw new Error('请使用当前草稿中的准确流程名称')
    const workflow = matches[0]!
    const remote = await this.currentTeam(context, developer.accountId)
    if (remote.revision !== context.revision || !sameDocument(remote.document, context.document)) {
      context.stale = true
      await this.persist(claim)
      throw new Error('团队草稿已在别处变化，与当前读取的内容不一致；请重新打开该团队读取最新草稿，再试跑。')
    }
    context.stale = false
    const selectors = requestedSimulationSelectors(params.simulation_actions)
    const userTurn = selectors.length ? await this.requireCurrentUserTurn(context, claim, sourceAtDispatch, workflow.id) : undefined
    const intentDigest = digest({ teamId: context.teamId, revision: context.revision, workflowId: workflow.id, input, simulationActions: [...selectors].sort() })
    const prior = this.trials.get(claim.token)
    if (prior && (!Array.isArray(prior.simulationActionSelectors) || !Array.isArray(prior.businessActions))) {
      throw new Error('上次试跑没有保存完整的固定模拟动作范围；请先读取该试跑状态并确认结束，再开始新的试跑。')
    }
    if (prior?.businessActions?.some((action) => action.simulationAuthorized) && !prior.authorizationSourceHash) {
      throw new Error('上次模拟动作没有可信员工请求来源记录；请先读取试跑状态，不会重放旧动作范围。')
    }
    if (prior?.businessActions?.some((action) => action.simulationAuthorized) && !prior.runId && prior.intentDigest !== intentDigest) {
      throw new Error('上次模拟试跑结果尚待核对；请先读取该试跑状态，不会用新请求覆盖固定动作范围。')
    }
    if (userTurn && prior?.intentDigest === intentDigest && prior.authorizationSourceHash && prior.authorizationSourceHash !== userTurn.sourceHash) {
      throw new Error('这组模拟输入与动作已绑定到另一条员工请求；请先读取原试跑状态，勿重复提交。')
    }
    const trial = prior?.intentDigest === intentDigest ? prior : undefined
    if (!trial) {
      const sessionKey = claim.sessionPath ?? claim.token
      const actions = this.businessActions(context, workflow)
      const frozenActions = freezeDevelopmentTrialActions(workflowSimulationChoices(actions), selectors)
      const nextTrial: DevelopmentTrial = {
        teamId: context.teamId, workflowId: workflow.id, workflowName: workflow.name,
        revision: context.revision,
        requestId: stableUuid(`${context.accountKey}:${sessionKey}:${context.teamId}:${intentDigest}`),
        intentDigest,
        ...(userTurn ? { authorizationSourceHash: userTurn.sourceHash } : {}),
        simulationActionSelectors: [...selectors].sort(),
        businessActions: frozenActions,
        stepNames: Object.fromEntries(workflow.graph_definition.nodes.map((node) => [node.id, node.label || '流程步骤'])),
      }
      this.trials.set(claim.token, nextTrial)
      await this.persist(claim)
      return this.submitTrial(context, developer, nextTrial, input, claim)
    }
    return this.submitTrial(context, developer, trial, input, claim)
  }

  private async submitTrial(context: DevelopmentContext, developer: { accountId: string }, trial: DevelopmentTrial, input: string, claim: CapabilityClaim): Promise<unknown> {
    if (!Array.isArray(trial.simulationActionSelectors) || !Array.isArray(trial.businessActions)) throw new Error('本次试跑固定动作范围缺失；不会用新的模拟授权重试')
    let authorizationTurn: DevelopmentUserTurn | undefined
    if (trial.businessActions.some((action) => action.simulationAuthorized)) {
      authorizationTurn = await this.requireCurrentUserTurn(context, claim, this.userTurns.get(claim.token), trial.workflowId)
      if (!trial.authorizationSourceHash || authorizationTurn.sourceHash !== trial.authorizationSourceHash) throw new Error('本次模拟动作与当前员工请求来源不一致；请核对试跑状态后重新提出模拟要求。')
    }
    if (context.teamId !== trial.teamId || context.revision !== trial.revision || await this.options.accountKey() !== context.accountKey) throw new Error('账号、团队或草稿修订已变化；本次固定试跑不会转移到新的开发上下文')
    if (authorizationTurn && this.userTurns.get(claim.token) !== authorizationTurn) throw new Error('员工轮次已变化；本次模拟动作不会转移到新的员工请求。')
    const receipt = await this.options.workspace({
      action: 'trial', teamId: trial.teamId, accountId: developer.accountId,
      revision: trial.revision, workflowId: trial.workflowId, requestId: trial.requestId,
      input, businessActions: trial.businessActions,
    }) as DevelopmentTrialReceipt
    if (receipt?.request_id && receipt.request_id !== trial.requestId) throw new Error('Weave 返回了不同的试跑回执')
    if (typeof receipt?.run_id === 'string') trial.runId = receipt.run_id
    this.trials.set(claim.token, trial)
    await this.persist(claim)
    return { team: context.document.name, workflow: trial.workflowName, status: '已提交隔离试跑', message: '试跑使用 Weave 的隔离模拟，会记录业务动作模拟调用，但不携带凭据、不访问或写入 Forge。可读取试跑状态查看固定输入、步骤记录和实际工具输入输出。' }
  }

  private async trialStatus(context: DevelopmentContext, developer: { accountId: string }, claim: CapabilityClaim): Promise<unknown> {
    if (await this.options.accountKey() !== context.accountKey) throw new Error('团队开发账号已变化')
    const trial = this.trials.get(claim.token)
    if (!trial || trial.teamId !== context.teamId) throw new Error('当前 Pi 会话还没有本团队的试跑记录')
    const remote = await this.options.team(trial.teamId, developer.accountId)
    if (!trial.runId) {
      const receipt = remote.trials.find((item) => item.request_id === trial.requestId)
      if (receipt?.run_id) trial.runId = receipt.run_id
    }
    const [inputResult, activityResult] = await Promise.allSettled([
      this.options.workspace({ action: 'input', teamId: trial.teamId, requestId: trial.requestId, accountId: developer.accountId }) as Promise<DevelopmentTrialInput>,
      trial.runId
        ? this.options.workspace({ action: 'activity', teamId: trial.teamId, runId: trial.runId, accountId: developer.accountId }) as Promise<DevelopmentActivity & { outputs?: Array<Record<string, unknown>> }>
        : Promise.resolve(undefined),
    ])
    if (inputResult.status === 'rejected') throw inputResult.reason
    if (inputResult.value.input === undefined) throw new Error('Weave 未返回本次试跑的固定输入')
    // A newly admitted trial may have a run receipt before its activity exists.
    // Keep the fixed input and live status readable while the trace catches up.
    const activityUnavailable = activityResult.status === 'rejected'
    const material = inputResult.value
    const activity = activityResult.status === 'fulfilled' ? activityResult.value : undefined
    if (activity?.status && ['succeeded', 'failed', 'cancelled'].includes(activity.status)) {
      const legacyTrial = !Array.isArray(trial.simulationActionSelectors) || !Array.isArray(trial.businessActions)
      if (legacyTrial) this.trials.delete(claim.token)
      else this.trials.set(claim.token, trial)
      await this.persist(claim)
    }
    const completeness = activity?.completeness ?? {}
    const callEvidence = toolActivityEvidence(activity)
    const payloadCompleteness = trialToolPayloadCompleteness(activity)
    const fullTrace = ['stages', 'member_inputs', 'member_outputs', 'member_tool_activity'].every((key) => completeness[key] === 'complete') && callEvidence !== 'incomplete'
    const members = (activity?.members ?? []).map((member) => ({
      name: member.name ?? '团队成员', status: messageStatus(member.status),
      steps: (member.stages ?? []).map((stage) => ({
        name: stage.name ?? '流程步骤', status: messageStatus(stage.status),
        inputs: (stage.inputs ?? []).map((item) => ({
          source: item.source === 'run_input' ? '本次试跑输入' : item.source === 'node_output' ? '前序步骤输出' : '其他来源',
          ...(item.summary ? { summary: item.summary } : {}),
          evidence: 'Weave 记录的输入摘要；不是完整原始步骤输入。',
        })),
        outputs: (stage.outputs ?? []).map((item) => ({
          kind: item.kind === 'artifact' ? '步骤文件' : '步骤结果',
          ...(item.path ? { name: item.path } : {}),
          content: item.content ?? '',
          ...(item.content_bytes !== undefined ? { original_bytes: item.content_bytes } : {}),
          truncated: item.truncated === true,
          evidence: item.truncated ? 'Weave 仅保留了该步骤输出的截断内容，不能视为完整原文。' : 'Weave 实际保存的该步骤输出。',
        })),
        tools: (stage.tools ?? []).map((tool) => ({
          name: trialToolDisplayName(tool, trial.businessActions ?? context.catalog.capabilities), status: trialToolStatus(tool),
          ...(trialToolPayload(tool, 'input') !== undefined ? { actual_input: trialToolPayload(tool, 'input') } : {}),
          ...(trialToolPayload(tool, 'output') !== undefined ? { actual_output: trialToolPayload(tool, 'output') } : {}),
          ...(tool.input_state ? { input_state: tool.input_state, input_bytes: tool.input_bytes } : {}),
          ...(tool.output_state ? { output_state: tool.output_state, output_bytes: tool.output_bytes } : {}),
          evidence: trialToolMissingDetails(tool) || 'Weave 记录的工具实际输入与输出；模拟回执不代表 Forge 业务结果。',
        })),
        ...(stage.failure_reason ? { failure: stage.failure_reason } : {}),
      })),
    }))
    const outputs = (activity?.outputs ?? []).map((item) => {
      const content = item.content
      const nodeId = typeof item.node_id === 'string' ? item.node_id : undefined
      return {
        ...(typeof nodeId === 'string' && trial.stepNames[nodeId] ? { step: trial.stepNames[nodeId] } : {}),
        title: typeof item.title === 'string' ? item.title : '试跑结果',
        ...(typeof content === 'string' ? { content } : {}),
      }
    })
    return {
      team: context.document.name, workflow: trial.workflowName,
      status: messageStatus(activity?.status ?? material.status),
      fixed_input: material.input,
      final_result: material.output || undefined,
      trace: {
        completeness: {
          stages: completenessLabel(completeness.stages),
          step_input_summaries: completenessLabel(completeness.member_inputs),
          step_outputs: completenessLabel(completeness.member_outputs),
          tool_activity: completenessLabel(callEvidence === 'incomplete' ? 'partial' : 'complete'),
          tool_input_output: completenessLabel(payloadCompleteness),
          deliverables: completenessLabel(completeness.deliverables),
        },
        trajectory: !activity ? '尚未取得完整活动记录' : !fullTrace ? '活动记录不完整或只部分可用' : ['complete', 'not_applicable'].includes(payloadCompleteness) ? '完整活动记录' : '步骤和调用清单完整；工具实参或回执不完整',
        ...(activityUnavailable ? { activity_note: 'Weave 活动暂不可读取，请稍后再取；不能仅凭最终结果判定调试通过。' } : {}),
        input_note: '固定输入为本次完整试跑材料；各步骤的 inputs 是 Weave 记录的摘要字段，不能当作完整原始输入。工具调用清单与实参、回执完整性分别核对；没有保存的字段不能从模型摘要补作证据。',
        members, outputs,
      },
    }
  }

  private async updateTeam(context: DevelopmentContext, developer: { accountId: string }, claim: CapabilityClaim): Promise<unknown> {
    const remote = await this.currentTeam(context, developer.accountId)
    if (remote.revision !== context.revision || !sameDocument(remote.document, context.document)) {
      context.stale = true
      await this.persist(claim)
      throw new Error('团队草稿已在别处变化，与当前读取的内容不一致；本次没有更新团队。请重新打开该团队读取最新草稿并重新试跑。')
    }
    if (remote.published_revision === context.revision) return { team: remote.document.name, status: '已更新', message: '该团队版本已经生效。' }
    requireDeclaredBusinessCompletion(context.document)
    const trialBlocker = workflowTrialBlocker(remote)
    if (trialBlocker) throw new Error(trialBlocker)
    const readinessBlocker = publicationReadinessBlocker(remote, context.catalog)
    if (readinessBlocker) throw new Error(readinessBlocker)
    try {
      const updated = await this.options.workspace({ action: 'publish', teamId: context.teamId, accountId: developer.accountId, revision: context.revision }) as TeamWorkspace
      if (!updated || updated.published_revision !== context.revision) throw new Error('Weave 尚未确认本次团队版本已生效')
      this.acceptSavedDocument(context, updated)
      await this.persist(claim)
      return { team: updated.document.name, status: '已更新', message: '团队已更新，新工作将使用本次配置。' }
    } catch (cause) {
      try {
        const latest = await this.currentTeam(context, developer.accountId)
        if (latest.published_revision === context.revision) {
          this.acceptSavedDocument(context, latest)
          await this.persist(claim)
          return { team: latest.document.name, status: '已更新', message: '已从 Weave 核对到本次团队版本生效。' }
        }
        if (latest.revision !== context.revision || !sameDocument(latest.document, context.document)) context.stale = true
      } catch { /* Preserve the draft and report the uncertain publication result. */ }
      await this.persist(claim)
      throw cause
    }
  }

  protected async dispatch(method: string, params: Record<string, unknown>, claim: CapabilityClaim): Promise<unknown> {
    const sourceAtDispatch = ['open', 'save', 'trial'].includes(method) ? this.userTurns.get(claim.token) : undefined
    let contextAtDispatch = method === 'open' ? this.contexts.get(claim.token) : undefined
    const developer = await this.options.developer()
    if (method === 'list') {
      const teams = await this.options.teams()
      this.listedTeams.set(claim.token, teams.map((team) => ({ id: team.id, name: team.name })))
      return { teams: teams.map((team) => ({ name: team.name, objective: team.objective })) }
    }
    if (method === 'open') {
      const teamName = typeof params.team_name === 'string' ? params.team_name : ''
      let known = this.listedTeams.get(claim.token)
      if (!known) { known = (await this.options.teams()).map((team) => ({ id: team.id, name: team.name })); this.listedTeams.set(claim.token, known) }
      const candidates = known.filter((team) => team.name === teamName)
      if (candidates.length !== 1) throw new Error('请使用当前账号可开发且不重复的准确团队名称')
      const teamId = candidates[0]!.id
      if (!this.contexts.has(claim.token) && claim.sessionPath) await this.restore(await this.options.accountKey(), claim.sessionPath, claim.token)
      if (!contextAtDispatch) contextAtDispatch = this.contexts.get(claim.token)
      const [draft, catalog] = await Promise.all([this.options.team(teamId, developer.accountId), this.options.catalog()])
      const previous = this.contexts.get(claim.token)
      if (previous && previous.teamId !== teamId && previous.pendingSave) throw new Error('当前团队有一项修改的保存结果尚未确认；请先重新打开该团队核对，再切换团队')
      if (previous?.teamId === teamId && previous.pendingSave) {
        const attempt = previous.pendingSave
        if (draft.revision > attempt.baseRevision && sameDocument(draft.document, attempt.proposal.document)) {
          if (this.contexts.get(claim.token) !== contextAtDispatch) throw new Error('当前团队开发上下文已变化；请重新读取后再打开团队。')
          const previousIdentity = this.draftIdentity(previous)
          this.acceptSavedDocument(previous, draft)
          this.rebindUserTurnAfterControlledSave(claim.token, sourceAtDispatch, previousIdentity, previous)
          await this.persist(claim)
          return { name: draft.document.name, objective: draft.document.objective, message: '上次团队修改已保存，当前草稿已同步。' }
        }
        if (draft.revision === attempt.baseRevision && sameDocument(draft.document, attempt.baseDocument)) {
          await this.persist(claim)
          return { name: previous.document.name, objective: previous.document.objective, message: '该团队有一项保存结果待核对，原修改仍保留；请先重试保存或查看当前上下文。' }
        }
        // The draft moved on elsewhere, so the kept change can never be written
        // on its base. Reopening is the request to start over from the latest draft.
        if (this.contexts.get(claim.token) !== contextAtDispatch) throw new Error('当前团队开发上下文已变化；请重新读取后再打开团队。')
        const previousIdentity = this.draftIdentity(previous)
        this.acceptSavedDocument(previous, draft)
        previous.catalog = catalog
        this.rebindUserTurnAfterControlledSave(claim.token, sourceAtDispatch, previousIdentity, previous)
        await this.persist(claim)
        return { name: draft.document.name, objective: draft.document.objective, discardedChanges: attempt.proposal.changes, message: '团队草稿已在别处变化，上一项未保存的修改已放弃，当前为最新草稿；请读取上下文后按最新内容重新提交。' }
      }
      const nextContext: DevelopmentContext = { accountKey: await this.options.accountKey(), teamId, revision: draft.revision, document: structuredClone(draft.document), catalog, stale: false }
      this.assertPiOpenContextChange(claim.token, sourceAtDispatch, contextAtDispatch, nextContext)
      this.contexts.set(claim.token, nextContext)
      await this.persist(claim)
    }
    if (!this.contexts.has(claim.token) && claim.sessionPath) await this.restore(await this.options.accountKey(), claim.sessionPath, claim.token)
    const context = this.contexts.get(claim.token)
    if (!context || await this.options.accountKey() !== context.accountKey) throw new Error('请先查找可开发团队并打开团队草稿')
    if (method === 'open') return { name: context.document.name, objective: context.document.objective, message: '已打开团队草稿；请读取完整上下文后再提修改。' }
    if (method === 'context') return this.readableContext(context)
    if (method === 'preview') {
      if (context.pendingSave) throw new Error('上一项团队修改的保存结果尚未确认；请先重试保存或读取当前状态。')
      const preview = applyTeamDevelopmentOperations(context.document, this.namedOperations(context, params.operations), context.catalog)
      return { changes: preview.changes, message: '以上是预览，没有保存或发布，也没有留下待处理内容。开发者同意后提交同一组修改保存。' }
    }
    if (method === 'save') return this.saveTeam(context, developer, params.operations, claim, sourceAtDispatch)
    if (method === 'trial') return this.runTrial(context, developer, params, claim, sourceAtDispatch)
    if (method === 'trial_status') return this.trialStatus(context, developer, claim)
    if (method === 'update_team') return this.updateTeam(context, developer, claim)
    throw new Error('不支持的团队开发操作')
  }
}
