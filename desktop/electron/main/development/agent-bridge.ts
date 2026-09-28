import type { EnterpriseBusinessCapabilityCatalog } from '../../../src/types/api'
import type { TeamDefinition, TeamWorkspace } from '../../../src/types/team-workspace'
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
}
interface StoredDevelopment {
  context?: Omit<DevelopmentContext, 'catalog'>
  createProposal?: { name: string; objective: string }
}

export class TeamDevelopmentAgentBridge extends CapabilityBridge {
  protected readonly rateLimit = 30
  protected readonly rateLimitError = '团队开发请求过于频繁，请稍后重试'
  private readonly runtimeTokens = new Map<string, string>()
  private readonly contexts = new Map<string, DevelopmentContext>()
  private readonly listedTeams = new Map<string, Array<{ id: string; name: string }>>()
  private readonly createProposals = new Map<string, { name: string; objective: string }>()
  private readonly store: HandoffStore

  constructor(private readonly options: {
    accountKey(): Promise<string>
    developer(): Promise<{ accountId: string }>
    teams(): Promise<Array<{ id: string; name: string; objective?: string }>>
    team(teamId: string, accountId: string): Promise<TeamWorkspace>
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
      ...(context ? { context: { accountKey: context.accountKey, teamId: context.teamId, revision: context.revision, document: context.document, selected: context.selected, proposal: context.proposal } } : {}),
      ...(this.createProposals.has(claim.token) ? { createProposal: this.createProposals.get(claim.token) } : {}),
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
      if (remote.revision !== value.context.revision) return undefined
      if (token && !this.contexts.has(token)) this.contexts.set(token, { ...value.context, catalog: await this.options.catalog() })
    }
    if (token && value.createProposal) this.createProposals.set(token, value.createProposal)
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
    this.contexts.set(token, { ...context, accountKey, document: structuredClone(context.document), proposal: undefined })
    this.createProposals.delete(token)
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
      if (previous?.teamId === teamId && previous.revision === draft.revision && previous.proposal) return { name: previous.document.name, objective: previous.document.objective, message: '该团队已有待应用提案，已在右侧团队开发面板保留。' }
      this.contexts.set(claim.token, { accountKey: await this.options.accountKey(), teamId, revision: draft.revision, document: structuredClone(draft.document), catalog })
      this.createProposals.delete(claim.token)
      await this.persist(claim)
    }
    if (!this.contexts.has(claim.token) && claim.sessionPath) await this.restore(await this.options.accountKey(), claim.sessionPath, claim.token)
    const context = this.contexts.get(claim.token)
    if (!context || await this.options.accountKey() !== context.accountKey) throw new Error('请先在团队开发侧栏选择团队，或调用可开发团队列表')
    if (method === 'open') return { name: context.document.name, objective: context.document.objective, message: '已打开团队草稿；请读取完整上下文后再提修改。' }
    if (method === 'context') return this.readableContext(context)
    if (method === 'propose') {
      const proposal = applyTeamDevelopmentOperations(context.document, this.namedOperations(context, params.operations), context.catalog)
      context.proposal = proposal
      await this.persist(claim)
      return { changes: proposal.changes, message: '修改已在 Pi 主会话右侧的团队开发面板待审，尚未应用、保存或发布。' }
    }
    throw new Error('不支持的团队开发操作')
  }
}
