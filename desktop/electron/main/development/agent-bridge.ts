import { createHash } from 'node:crypto'
import type { EnterpriseBusinessCapability, EnterpriseBusinessCapabilityCatalog } from '../../../src/types/api'
import type { TeamDefinition, TeamWorkspace, TeamWorkspaceCommand } from '../../../src/types/team-workspace'
import { applyTeamDevelopmentOperations, type TeamDevelopmentProposal } from '../../../src/pages/team-workspace/development-proposal'
import { WORKBENCH_RESULT_PROTOCOL } from '../../../src/pages/team-workspace/graph'
import { CapabilityBridge, type CapabilityClaim, type CapabilityScope } from '../lib/capability-bridge'
import { HandoffStore, type HandoffStorage } from '../enterprise/handoff-store'

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
  runId?: string
  stepNames: Record<string, string>
}
interface DevelopmentActivity {
  status?: string
  completeness?: Record<string, string>
  members?: Array<{
    name?: string; status?: string
    stages?: Array<{
      name?: string; status?: string; inputs?: Array<{ source?: string; summary?: string }>
      outputs?: Array<{ kind?: string; path?: string; content?: string; content_type?: string; content_bytes?: number; truncated?: boolean }>
      tools?: Array<{ name?: string; status?: string; input?: string; output?: string }>
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
  createProposal?: { name: string; objective: string }
  trial?: StoredDevelopmentTrial
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
}

function sameDocument(left: TeamDefinition, right: TeamDefinition): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function digest(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex')
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
  return ({ complete: '完整', partial: '部分', unavailable: '不可用' } as Record<string, string>)[value ?? ''] ?? '未确认'
}

export class TeamDevelopmentAgentBridge extends CapabilityBridge {
  protected readonly rateLimit = 30
  protected readonly rateLimitError = '团队开发请求过于频繁，请稍后重试'
  private readonly runtimeTokens = new Map<string, string>()
  private readonly contexts = new Map<string, DevelopmentContext>()
  private readonly listedTeams = new Map<string, Array<{ id: string; name: string }>>()
  private readonly createProposals = new Map<string, { name: string; objective: string }>()
  private readonly trials = new Map<string, DevelopmentTrial>()
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
      ...(this.createProposals.has(claim.token) ? { createProposal: this.createProposals.get(claim.token) } : {}),
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
      const developer = await this.options.developer()
      const remote = await this.options.team(value.context.teamId, developer.accountId)
      if (remote.revision !== value.context.revision || !sameDocument(remote.document, value.context.document)) {
        if (value.context.proposal || value.context.pendingSave) value.context.stale = true
        else {
          value.context.revision = remote.revision
          value.context.document = structuredClone(remote.document)
          value.context.stale = false
        }
      }
      if (token && !this.contexts.has(token)) this.contexts.set(token, { ...value.context, catalog: await this.options.catalog() })
    }
    if (token && value.createProposal) this.createProposals.set(token, value.createProposal)
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
    if (claim.sessionPath && sessionFile && claim.sessionPath !== sessionFile) { this.revoke(token); throw new Error('团队开发会话已变化') }
    if (sessionFile) claim.sessionPath = sessionFile
    this.runtimeTokens.set(runtimeId, token)
  }

  async bindContext(runtimeId: string, context: Omit<DevelopmentContext, 'accountKey' | 'proposal'>, accountKey: string): Promise<void> {
    const token = this.runtimeTokens.get(runtimeId)
    const claim = token ? this.claimForToken(token) : undefined
    if (!token || !claim) throw new Error('Pi 开发会话尚未启动')
    if (!Number.isSafeInteger(context.revision) || context.revision < 0 || !Array.isArray(context.document?.members) || !Array.isArray(context.document?.workflows)) throw new Error('团队草稿不完整')
    this.contexts.set(token, { ...context, accountKey, document: structuredClone(context.document), proposal: undefined, pendingSave: undefined, stale: false })
    this.createProposals.delete(token)
    this.trials.delete(token)
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

  async getState(runtimeId: string): Promise<{ teamId?: string; revision?: number; proposal?: TeamDevelopmentProposal & { baseDocument: TeamDefinition; revision: number }; createProposal?: { name: string; objective: string } }> {
    const token = this.runtimeTokens.get(runtimeId)
    const claim = token ? this.claimForToken(token) : undefined
    if (claim?.sessionPath && !this.contexts.has(token!)) await this.restore(await this.options.accountKey(), claim.sessionPath, token)
    const context = token ? this.contexts.get(token) : undefined
    if (context && await this.options.accountKey() !== context.accountKey) throw new Error('团队开发账号已变化')
    return { ...(context ? { teamId: context.teamId, revision: context.revision } : {}), ...(context?.proposal ? { proposal: { ...structuredClone(context.proposal), baseDocument: structuredClone(context.document), revision: context.revision } } : {}), ...(token && this.createProposals.has(token) ? { createProposal: this.createProposals.get(token) } : {}) }
  }

  async getStateForSession(sessionFile: string): Promise<{ teamId?: string; revision?: number; proposal?: TeamDevelopmentProposal & { baseDocument: TeamDefinition; revision: number }; createProposal?: { name: string; objective: string } }> {
    const saved = await this.restore(await this.options.accountKey(), sessionFile)
    const context = saved?.context
    return { ...(context ? { teamId: context.teamId, revision: context.revision } : {}), ...(context?.proposal ? { proposal: { ...context.proposal, baseDocument: context.document, revision: context.revision } } : {}), ...(saved?.createProposal ? { createProposal: saved.createProposal } : {}) }
  }

  invalidateAccount(): void { this.revokeAllClaims(); this.contexts.clear(); this.runtimeTokens.clear(); this.listedTeams.clear(); this.createProposals.clear() }

  protected onClaimRevoked(claim: CapabilityClaim): void {
    this.contexts.delete(claim.token)
    this.listedTeams.delete(claim.token)
    this.createProposals.delete(claim.token)
    this.trials.delete(claim.token)
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
        draftStatus: context.stale ? '远端草稿已变化；当前修改保留在原版本，保存、试跑和更新团队会先拒绝' : '当前草稿',
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
          return {
            name: flow.name, description: flow.description,
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
      if (found.length !== 1) throw new Error(`成员“${name}”不存在或名称重复，请在侧栏确认准确成员`)
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

  private async saveTeam(context: DevelopmentContext, developer: { accountId: string }, rawOperations: unknown, claim: CapabilityClaim): Promise<unknown> {
    if (!Array.isArray(rawOperations)) throw new Error('修改内容必须是 JSON 数组')
    const operationsDigest = digest(rawOperations)
    let remote = await this.currentTeam(context, developer.accountId)
    let attempt = context.pendingSave

    if (attempt && remote.revision > attempt.baseRevision && sameDocument(remote.document, attempt.proposal.document)) {
      const changes = attempt.proposal.changes
      this.acceptSavedDocument(context, remote)
      await this.persist(claim)
      if (attempt.operationsDigest === operationsDigest) return { team: remote.document.name, changes, message: '团队草稿已保存，当前生效版本没有改变。' }
      attempt = undefined
    }

    if (attempt) {
      if (attempt.operationsDigest !== operationsDigest) throw new Error('上一项团队修改的保存结果尚未确认；请先重试原修改，避免覆盖它。')
      if (remote.revision !== attempt.baseRevision || !sameDocument(remote.document, attempt.baseDocument)) {
        context.stale = true
        await this.persist(claim)
        throw new Error('团队草稿已变化或侧栏存在未保存修改。原修改已保留；请先解决草稿冲突，再继续保存。')
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
        throw new Error('团队草稿已变化或侧栏存在未保存修改。原修改已保留；请先解决草稿冲突，再继续保存。')
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
      await this.persist(claim)
      return { team: saved.document.name, changes, message: '团队草稿已保存，当前生效版本没有改变。' }
    } catch (cause) {
      try {
        remote = await this.currentTeam(context, developer.accountId)
        if (remote.revision > pending.baseRevision && sameDocument(remote.document, pending.proposal.document)) {
          const changes = pending.proposal.changes
          this.acceptSavedDocument(context, remote)
          await this.persist(claim)
          return { team: remote.document.name, changes, message: '团队草稿已保存，已从远端核对到本次修改；当前生效版本没有改变。' }
        }
        context.stale = remote.revision !== pending.baseRevision || !sameDocument(remote.document, pending.baseDocument)
      } catch { /* Keep the durable candidate when the result cannot be checked. */ }
      await this.persist(claim)
      throw cause
    }
  }

  private businessActions(context: DevelopmentContext): EnterpriseBusinessCapability[] {
    const ids = new Set(context.document.members.flatMap((member) => member.configuration.businessCapabilityIds))
    return [...ids].map((id) => {
      const action = context.catalog.capabilities.find((candidate) => candidate.id === id)
      if (!action || action.status !== 'available' || !action.actionName || !action.objectName) throw new Error(action?.unavailableReason ?? '团队选择了暂不可用的 Forge 业务动作，请先修正团队草稿')
      return action
    })
  }

  private async runTrial(context: DevelopmentContext, developer: { accountId: string }, params: Record<string, unknown>, claim: CapabilityClaim): Promise<unknown> {
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
      throw new Error('团队草稿或侧栏修改尚未与远端保存版本一致；请先解决草稿冲突，再试跑。')
    }
    context.stale = false
    const actions = this.businessActions(context)
    const intentDigest = digest({ teamId: context.teamId, revision: context.revision, workflowId: workflow.id, input, actions })
    const prior = this.trials.get(claim.token)
    const trial = prior?.intentDigest === intentDigest ? prior : undefined
    if (!trial) {
      const sessionKey = claim.sessionPath ?? claim.token
      const nextTrial: DevelopmentTrial = {
        teamId: context.teamId, workflowId: workflow.id, workflowName: workflow.name,
        revision: context.revision,
        requestId: stableUuid(`${context.accountKey}:${sessionKey}:${context.teamId}:${intentDigest}`),
        intentDigest,
        stepNames: Object.fromEntries(workflow.graph_definition.nodes.map((node) => [node.id, node.label || '流程步骤'])),
      }
      this.trials.set(claim.token, nextTrial)
      await this.persist(claim)
      return this.submitTrial(context, developer, nextTrial, actions, input, claim)
    }
    return this.submitTrial(context, developer, trial, actions, input, claim)
  }

  private async submitTrial(context: DevelopmentContext, developer: { accountId: string }, trial: DevelopmentTrial, actions: EnterpriseBusinessCapability[], input: string, claim: CapabilityClaim): Promise<unknown> {
    const receipt = await this.options.workspace({
      action: 'trial', teamId: context.teamId, accountId: developer.accountId,
      revision: trial.revision, workflowId: trial.workflowId, requestId: trial.requestId,
      input, businessActions: actions,
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
      this.trials.set(claim.token, trial)
      await this.persist(claim)
    }
    const completeness = activity?.completeness ?? {}
    const fullTrace = ['stages', 'member_inputs', 'member_outputs', 'member_tool_activity'].every((key) => completeness[key] === 'complete')
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
          name: tool.name ?? '工具调用', status: messageStatus(tool.status),
          ...(tool.input !== undefined ? { actual_input: tool.input } : {}),
          ...(tool.output !== undefined ? { actual_output: tool.output } : {}),
          evidence: 'Weave 记录的工具实际输入与输出。',
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
          tool_input_output: completenessLabel(completeness.member_tool_activity),
          deliverables: completenessLabel(completeness.deliverables),
        },
        trajectory: !activity ? '尚未取得完整活动记录' : fullTrace ? '完整活动记录' : '活动记录不完整或只部分可用',
        ...(activityUnavailable ? { activity_note: 'Weave 活动暂不可读取，请稍后再取；不能仅凭最终结果判定调试通过。' } : {}),
        input_note: '固定输入为本次完整试跑材料；各步骤的 inputs 是 Weave 记录的摘要字段，不能当作完整原始输入。工具调用 input/output 是 Weave 保存的实际记录。',
        members, outputs,
      },
    }
  }

  private async updateTeam(context: DevelopmentContext, developer: { accountId: string }, claim: CapabilityClaim): Promise<unknown> {
    const remote = await this.currentTeam(context, developer.accountId)
    if (remote.revision !== context.revision || !sameDocument(remote.document, context.document)) {
      context.stale = true
      await this.persist(claim)
      throw new Error('团队草稿已变化或侧栏有未保存修改；本次没有更新团队，原修改仍保留。')
    }
    if (remote.published_revision === context.revision) return { team: remote.document.name, status: '已更新', message: '该团队版本已经生效。' }
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
    const developer = await this.options.developer()
    if (method === 'list') {
      const teams = await this.options.teams()
      this.listedTeams.set(claim.token, teams.map((team) => ({ id: team.id, name: team.name })))
      return { teams: teams.map((team) => ({ name: team.name, objective: team.objective })) }
    }
    if (method === 'propose_new_team') {
      const name = typeof params.name === 'string' ? params.name.trim() : ''
      const objective = typeof params.objective === 'string' ? params.objective.trim() : ''
      if (!name || name.length > 80 || !objective || objective.length > 2000) throw new Error('新团队需要名称和明确目标')
      this.createProposals.set(claim.token, { name, objective })
      await this.persist(claim)
      return { name, objective, message: '新团队提案已送到右侧开发面板，需开发者检查后创建；创建时系统自动加入负责人和执行成员，流程需随后配置。' }
    }
    if (method === 'open') {
      const teamName = typeof params.team_name === 'string' ? params.team_name : ''
      let known = this.listedTeams.get(claim.token)
      if (!known) { known = (await this.options.teams()).map((team) => ({ id: team.id, name: team.name })); this.listedTeams.set(claim.token, known) }
      const candidates = known.filter((team) => team.name === teamName)
      if (candidates.length !== 1) throw new Error('请使用当前账号可开发且不重复的准确团队名称')
      const teamId = candidates[0]!.id
      if (!this.contexts.has(claim.token) && claim.sessionPath) await this.restore(await this.options.accountKey(), claim.sessionPath, claim.token)
      const [draft, catalog] = await Promise.all([this.options.team(teamId, developer.accountId), this.options.catalog()])
      const previous = this.contexts.get(claim.token)
      if (previous && previous.teamId !== teamId && (previous.proposal || previous.pendingSave)) throw new Error('当前团队有未处理修改，先保存或解决后再切换团队')
      if (previous?.teamId === teamId && previous.pendingSave) {
        const attempt = previous.pendingSave
        if (draft.revision > attempt.baseRevision && sameDocument(draft.document, attempt.proposal.document)) {
          this.acceptSavedDocument(previous, draft)
          await this.persist(claim)
          return { name: draft.document.name, objective: draft.document.objective, message: '上次团队修改已保存，当前草稿已同步。' }
        }
        if (draft.revision !== attempt.baseRevision || !sameDocument(draft.document, attempt.baseDocument)) previous.stale = true
        await this.persist(claim)
        return { name: previous.document.name, objective: previous.document.objective, message: previous.stale
          ? '该团队的修改仍保留，但远端草稿已变化；请先处理保存冲突。'
          : '该团队有一项保存结果待核对，原修改仍保留；请先重试保存或查看当前上下文。' }
      }
      if (previous?.teamId === teamId && previous.proposal) {
        if (previous.revision === draft.revision && sameDocument(previous.document, draft.document)) return { name: previous.document.name, objective: previous.document.objective, message: '该团队已有待应用提案，已在右侧团队开发面板保留。' }
        previous.stale = true
        await this.persist(claim)
        return { name: previous.document.name, objective: previous.document.objective, message: '该团队已有提案且远端草稿已变化；提案仍保留，请先处理草稿冲突。' }
      }
      this.contexts.set(claim.token, { accountKey: await this.options.accountKey(), teamId, revision: draft.revision, document: structuredClone(draft.document), catalog, stale: false })
      this.createProposals.delete(claim.token)
      await this.persist(claim)
    }
    if (!this.contexts.has(claim.token) && claim.sessionPath) await this.restore(await this.options.accountKey(), claim.sessionPath, claim.token)
    const context = this.contexts.get(claim.token)
    if (!context || await this.options.accountKey() !== context.accountKey) throw new Error('请先在团队开发侧栏选择团队，或调用可开发团队列表')
    if (method === 'open') return { name: context.document.name, objective: context.document.objective, message: '已打开团队草稿；请读取完整上下文后再提修改。' }
    if (method === 'context') return this.readableContext(context)
    if (method === 'propose') {
      if (context.pendingSave) throw new Error('上一项团队修改的保存结果尚未确认；请先重试保存或读取当前状态。')
      const proposal = applyTeamDevelopmentOperations(context.document, this.namedOperations(context, params.operations), context.catalog)
      context.proposal = proposal
      await this.persist(claim)
      return { changes: proposal.changes, message: '修改已在 Pi 主会话右侧的团队开发面板待审，尚未应用、保存或发布。' }
    }
    if (method === 'save') return this.saveTeam(context, developer, params.operations, claim)
    if (method === 'trial') return this.runTrial(context, developer, params, claim)
    if (method === 'trial_status') return this.trialStatus(context, developer, claim)
    if (method === 'update_team') return this.updateTeam(context, developer, claim)
    throw new Error('不支持的团队开发操作')
  }
}
