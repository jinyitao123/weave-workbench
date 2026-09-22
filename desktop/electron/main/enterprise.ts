import { teamWorkspaceRequest } from './enterprise/team-workspace'
import type { TeamWorkspaceCommand } from '../../src/types/team-workspace'
import type { EnterpriseBusinessCapability, EnterpriseBusinessCapabilityCatalog, EnterpriseCreateTeamInput, EnterpriseCreateTeamMemberInput, EnterpriseCreateTeamResult, EnterpriseCreateWorkflowInput, EnterpriseCreateWorkflowResult, EnterpriseDevelopmentOverview, EnterpriseEnvironmentStatus, EnterpriseHumanTask, EnterprisePermission, EnterpriseRunObservation, EnterpriseSession, EnterpriseTeamMember, EnterpriseTeamMemberAgentConfiguration, EnterpriseTeamMemberConfigDraft, EnterpriseTeamMemberMutationResult, EnterpriseTeamMemberRelationshipConfiguration, EnterpriseTeamObservation, EnterpriseUpdateTeamInput, EnterpriseUpdateWorkflowDraftInput, EnterpriseUpdateWorkflowDraftResult, EnterpriseWorkflowGraphDefinition, EnterpriseWorkflowObservation, EnterpriseWorkflowValidation, EnterpriseWorkChoice, EnterpriseWorkItem, EnterpriseWorkOverview, EnterpriseWorkReceipt } from '../../src/types/api'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { submissionUUID } from './enterprise/handoff-store'
import { teamCatalog, teamChoices, type TeamSummary } from './enterprise/team-catalog'

const DEFAULT_FORGE_URL = 'http://124.223.189.112'
const DEFAULT_WEAVE_URL = 'http://124.223.189.112:8080'
const REQUEST_TIMEOUT_MS = 8_000

interface EnterpriseServiceOptions {
  fetch?: typeof fetch
  environment?: NodeJS.ProcessEnv
  sessionPath?: string
  sessionCodec?: {
    available(): boolean
    encrypt(value: string): Buffer
    decrypt(value: Buffer): string
  }
}

function environmentUrl(value: string | undefined, fallback: string, label: string): URL {
  const configured = value?.trim() || fallback
  const url = new URL(configured)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new Error(`${label} environment URL must be an HTTP or HTTPS origin without credentials`)
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url
}

function versionFromHealth(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  if (typeof source.version === 'string' && source.version.length <= 80) return source.version
  return versionFromHealth(source.data)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function enterprisePermissions(value: unknown): EnterprisePermission[] | undefined {
  if (!Array.isArray(value)) return undefined
  const permissions = value.filter((item): item is EnterprisePermission => item === 'teams:use' || item === 'teams:develop' || item === 'teams:admin')
  return permissions.includes('teams:use') ? Array.from(new Set(permissions)) : undefined
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function parseMcpResponse(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Forge 没有返回业务能力')
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  const data = trimmed.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).find((line) => line && line !== '[DONE]')
  if (!data) throw new Error('Forge 返回了无法识别的业务能力')
  return JSON.parse(data)
}

function memberAgentConfiguration(value: Record<string, unknown>, agentName: string): EnterpriseTeamMemberAgentConfiguration {
  const outputSchema = value.output_schema === undefined || value.output_schema === null ? '' : JSON.stringify(value.output_schema, null, 2)
  const skills = Array.isArray(value.skills) ? value.skills.flatMap((item) => {
    const skill = record(item), name = textValue(skill?.name), body = textValue(skill?.body)
    return name && body ? [{ name, description: textValue(skill?.description) ?? '', body, alwaysActive: skill?.always_active === true }] : []
  }) : []
  return {
    toolLoopControl: record(value.tool_loop_control) ? { sliceRounds: Number(record(value.tool_loop_control)?.slice_rounds), initialTotalRounds: Number(record(value.tool_loop_control)?.initial_total_rounds) } : null, maxToolRepeats: Number(value.max_tool_repeats ?? 0),
    displayName: textValue(value.display_name) ?? agentName, role: textValue(value.role) ?? 'worker',
    engine: textValue(value.engine) ?? 'loom', runtimeId: textValue(value.runtime_id) ?? '', model: textValue(value.model) ?? '',
    systemPrompt: typeof value.system_prompt === 'string' ? value.system_prompt : '', skillNames: stringList(value.skill_names), skills,
    mcpServerIds: stringList(value.mcp_server_ids), businessCapabilityIds: stringList(value.business_capability_ids), permissionAllow: stringList(value.permission_allow),
    permissionAsk: stringList(value.permission_ask), permissionDeny: stringList(value.permission_deny),
    memoryEnabled: value.memory_enabled === true, memoryScope: textValue(value.memory_scope) ?? 'tenant',
    maxTokens: numberValue(value.max_tokens) ?? 0, maxOutputTokens: numberValue(value.max_output_tokens) ?? 0,
    stepBudget: numberValue(value.step_budget) ?? 0, maxCostUsd: numberValue(value.max_cost_usd) ?? 0, outputSchema,
  }
}

function memberRelationshipConfiguration(value: Record<string, unknown>): EnterpriseTeamMemberRelationshipConfiguration {
  return {
    duty: typeof value.duty === 'string' ? value.duty : '', whenToUse: typeof value.when_to_use === 'string' ? value.when_to_use : '',
    contextInstruction: typeof value.context_instruction === 'string' ? value.context_instruction : '', allowedKinds: stringList(value.allowed_kinds),
    defaultKind: typeof value.default_kind === 'string' ? value.default_kind : '', resultRequirement: typeof value.result_requirement === 'string' ? value.result_requirement : '',
    enabled: value.enabled !== false,
  }
}

function teamMemberConfigDraft(value: unknown): EnterpriseTeamMemberConfigDraft {
  const source = record(value), configuration = record(source?.configuration), relationship = record(source?.relationship)
  const publishedConfiguration = record(source?.published_configuration), publishedRelationship = record(source?.published_relationship)
  const teamId = textValue(source?.team_id), agentId = textValue(source?.agent_id), agentName = textValue(source?.agent_name)
  const baseAgentVersion = numberValue(source?.base_agent_version), revision = numberValue(source?.revision), updatedAt = textValue(source?.updated_at)
  if (!source || !configuration || !relationship || !teamId || !agentId || !agentName || !baseAgentVersion || revision === undefined || !updatedAt) throw new Error('Weave 返回了无法识别的团队成员配置')
  return {
    version: '1', teamId, agentId, agentName, baseAgentVersion, revision, updatedAt,
    ...(textValue(source.updated_by) ? { updatedBy: textValue(source.updated_by) } : {}),
    ...(publishedConfiguration ? { publishedConfiguration: memberAgentConfiguration(publishedConfiguration, agentName) } : {}),
    ...(publishedRelationship ? { publishedRelationship: memberRelationshipConfiguration(publishedRelationship) } : {}),
    configuration: memberAgentConfiguration(configuration, agentName),
    relationship: memberRelationshipConfiguration(relationship),
  }
}

function member(value: unknown): EnterpriseTeamMember | undefined {
  const source = record(value)
  const id = textValue(source?.id)
  const name = textValue(source?.display_name) ?? textValue(source?.name)
  if (!source || !id || !name) return undefined
  return {
    id, name, role: textValue(source.role) ?? 'worker', enabled: source.enabled !== false,
    ...(textValue(source.configured_duty) ?? textValue(source.duty) ? { duty: textValue(source.configured_duty) ?? textValue(source.duty) } : {}),
  }
}

function workflowGraph(value: unknown): Pick<EnterpriseWorkflowObservation, 'nodes' | 'edges'> {
  const graph = record(value)
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.flatMap((item) => {
    const source = record(item)
    const config = record(source?.config)
    const id = textValue(source?.id)
    const type = textValue(source?.type)
    if (!id || !type) return []
    return [{ id, type, ...(textValue(source?.label) ? { label: textValue(source?.label) } : {}), ...(textValue(config?.agent_id) ? { workerId: textValue(config?.agent_id) } : {}) }]
  }) : []
  const edges = Array.isArray(graph?.edges) ? graph.edges.flatMap((item) => {
    const source = record(item)
    const from = textValue(source?.from) ?? textValue(source?.source) ?? textValue(source?.from_node_id)
    const to = textValue(source?.to) ?? textValue(source?.target) ?? textValue(source?.to_node_id)
    if (!from || !to) return []
    return [{ from, to, ...(textValue(source?.label) ? { label: textValue(source?.label) } : {}), ...(textValue(source?.route) ? { route: textValue(source?.route) } : {}) }]
  }) : []
  return { nodes, edges }
}

function workflowDefinition(value: unknown): EnterpriseWorkflowGraphDefinition | undefined {
  const graph = record(value)
  if (!graph || numberValue(graph.schema_version) !== 1 || !textValue(graph.entry_node_id) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return undefined
  const nodes = graph.nodes.flatMap((item) => {
    const node = record(item), id = textValue(node?.id), type = textValue(node?.type)
    return node && id && type ? [{ ...node, id, type }] : []
  })
  const edges = graph.edges.flatMap((item) => {
    const edge = record(item), from = textValue(edge?.from_node_id), to = textValue(edge?.to_node_id)
    return edge && from && to ? [{ ...edge, from_node_id: from, to_node_id: to }] : []
  })
  if (nodes.length !== graph.nodes.length || edges.length !== graph.edges.length) return undefined
  return { ...graph, schema_version: 1, entry_node_id: textValue(graph.entry_node_id)!, nodes, edges }
}

function runObservation(value: unknown): EnterpriseRunObservation | undefined {
  const source = record(value)
  const id = textValue(source?.run_id)
  const status = textValue(source?.status)
  if (!id || !status) return undefined
  return {
    id, status, durationMs: Math.max(0, numberValue(source?.duration_ms) ?? 0), tokensIn: Math.max(0, numberValue(source?.tokens_in) ?? 0),
    tokensOut: Math.max(0, numberValue(source?.tokens_out) ?? 0), costUsd: Math.max(0, numberValue(source?.cost_usd) ?? 0),
    ...(textValue(source?.agent) ? { agent: textValue(source?.agent) } : {}), ...(textValue(source?.step) ? { step: textValue(source?.step) } : {}),
    ...(textValue(source?.started_at) ? { startedAt: textValue(source?.started_at) } : {}),
  }
}

/** Read-only environment visibility. Account binding is reintroduced through the MVP1 contract. */
export class EnterpriseService {
  private readonly environment: NodeJS.ProcessEnv
  private readonly fetch: typeof fetch
  private readonly forgeUrl: URL
  private readonly weaveUrl: URL
  private readonly sessionPath?: string
  private readonly sessionCodec?: EnterpriseServiceOptions['sessionCodec']
  private loaded = false
  private session?: EnterpriseSession
  private weaveToken?: string
  private forgeToken?: string
  private expiresAt = 0

  constructor(options: EnterpriseServiceOptions = {}) {
    this.environment = options.environment ?? process.env
    this.fetch = options.fetch ?? fetch
    this.forgeUrl = environmentUrl(this.environment.WORKBENCH_FORGE_URL, DEFAULT_FORGE_URL, 'Forge')
    this.weaveUrl = environmentUrl(this.environment.WORKBENCH_WEAVE_URL, DEFAULT_WEAVE_URL, 'Weave')
    this.sessionPath = options.sessionPath
    this.sessionCodec = options.sessionCodec
  }

  private signedOut(message?: string): EnterpriseSession {
    return {
      version: '1', status: 'signed-out',
      environment: { origin: this.forgeUrl.origin, secure: this.forgeUrl.protocol === 'https:' },
      storage: 'session-only', ...(message ? { message } : {}),
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    if (!this.sessionPath || !this.sessionCodec?.available()) return
    try {
      const saved = record(JSON.parse(await readFile(this.sessionPath, 'utf8')))
      const projection = record(saved?.session) as EnterpriseSession | undefined
      if (saved?.version !== 3 || typeof saved.expiresAt !== 'number' || projection?.status !== 'signed-in' || !enterprisePermissions(projection.permissions)) return
      if (saved.expiresAt <= Date.now()) { await unlink(this.sessionPath).catch(() => undefined); return }
      const encryptedWeaveToken = saved.weaveToken
      if (typeof encryptedWeaveToken !== 'string') return
      this.weaveToken = this.sessionCodec.decrypt(Buffer.from(encryptedWeaveToken, 'base64'))
      if (typeof saved.forgeToken === 'string') this.forgeToken = this.sessionCodec.decrypt(Buffer.from(saved.forgeToken, 'base64'))
      this.expiresAt = saved.expiresAt
      this.session = { ...projection, storage: 'encrypted' }
    } catch { /* missing, malformed, or undecryptable sessions start signed out */ }
  }

  private async persist(): Promise<void> {
    if (!this.sessionPath || !this.sessionCodec?.available() || !this.session || !this.weaveToken) return
    const saved = JSON.stringify({ version: 3, expiresAt: this.expiresAt, weaveToken: this.sessionCodec.encrypt(this.weaveToken).toString('base64'), ...(this.forgeToken ? { forgeToken: this.sessionCodec.encrypt(this.forgeToken).toString('base64') } : {}), session: { ...this.session, storage: 'encrypted' } })
    await writeFile(this.sessionPath, saved, { encoding: 'utf8', mode: 0o600 })
    this.session = { ...this.session, storage: 'encrypted' }
  }

  async getSession(): Promise<EnterpriseSession> {
    await this.load()
    if (this.session && this.expiresAt <= Date.now()) await this.signOut()
    return structuredClone(this.session ?? this.signedOut())
  }

  async authorizationHeaders(): Promise<Headers> {
    await this.load()
    if (this.expiresAt <= Date.now()) await this.signOut()
    if (!this.weaveToken) throw new Error('请先登录')
    return new Headers({ Authorization: `Bearer ${this.weaveToken}` })
  }

  async signIn(email: string, password: string): Promise<EnterpriseSession> {
    const normalizedEmail = email.trim()
    if (!normalizedEmail || !password) throw new Error('请输入账号和密码')
    try {
      const signedIn = await this.fetch(new URL('/api/v1/auth/sign-in/email', this.forgeUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: this.forgeUrl.origin, Referer: `${this.forgeUrl.origin}/` },
        body: JSON.stringify({ email: normalizedEmail, password }), redirect: 'error', signal: AbortSignal.timeout(15_000),
      })
      if (!signedIn.ok) {
        await signedIn.body?.cancel()
        if (signedIn.status === 401 || signedIn.status === 403) throw new Error('账号或密码不正确')
        throw new Error('Forge 登录服务暂时不可用')
      }
      const forge = record(await signedIn.json())
      const forgeUser = record(forge?.user)
      if (typeof forge?.token !== 'string' || typeof forgeUser?.id !== 'string') throw new Error('Forge 返回了无法识别的登录结果')
      const exchanged = await this.fetch(new URL('/v1/auth/external/exchange', this.weaveUrl), {
        method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${forge.token}` },
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      })
      if (!exchanged.ok) {
        await exchanged.body?.cancel()
        if (exchanged.status === 401 || exchanged.status === 403) throw new Error('当前账号无法进入 Weave')
        throw new Error('Weave 账号绑定服务暂时不可用')
      }
      const weave = record(await exchanged.json())
      const subject = record(weave?.subject)
      const organization = record(weave?.organization)
      const permissions = enterprisePermissions(weave?.permissions)
      if (typeof weave?.token !== 'string' || typeof subject?.id !== 'string' || typeof organization?.id !== 'string' || !permissions) {
        throw new Error('Weave 返回了无法识别的账号绑定结果')
      }
      this.weaveToken = weave.token
      this.forgeToken = forge.token
      this.expiresAt = Date.now() + (typeof weave.expiresIn === 'number' && weave.expiresIn > 0 ? Math.min(weave.expiresIn, 8 * 60 * 60) : 8 * 60 * 60) * 1000
      this.session = {
        version: '1', status: 'signed-in',
        environment: { origin: this.forgeUrl.origin, secure: this.forgeUrl.protocol === 'https:' }, storage: 'session-only',
        identitySource: { kind: 'forge-account', issuer: this.forgeUrl.origin },
        user: {
          id: typeof subject.externalId === 'string' ? subject.externalId : forgeUser.id,
          weaveUserId: subject.id,
          name: typeof subject.name === 'string' && subject.name.trim() ? subject.name : typeof forgeUser.name === 'string' && forgeUser.name.trim() ? forgeUser.name : normalizedEmail,
          email: typeof subject.email === 'string' && subject.email.trim() ? subject.email : typeof forgeUser.email === 'string' && forgeUser.email.trim() ? forgeUser.email : normalizedEmail,
        },
        organization: { id: organization.id, name: typeof organization.name === 'string' && organization.name.trim() ? organization.name : organization.id },
        permissions,
      }
      await this.persist()
      return await this.getSession()
    } catch (error) {
      this.weaveToken = undefined
      this.forgeToken = undefined
      this.session = undefined
      if (error instanceof Error && !['fetch failed', 'The operation was aborted due to timeout'].includes(error.message)) throw error
      throw new Error('企业服务暂时无法连接')
    }
  }

  async signOut(): Promise<EnterpriseSession> {
    this.weaveToken = undefined
    this.forgeToken = undefined
    this.session = undefined
    this.expiresAt = 0
    if (this.sessionPath) await unlink(this.sessionPath).catch(() => undefined)
    return this.signedOut()
  }

  private async weaveJSON(path: string): Promise<unknown> {
    const response = await this.fetch(new URL(path, this.weaveUrl), {
      headers: await this.authorizationHeaders(), redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      await this.signOut()
      throw new Error('登录已失效，请重新登录')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Weave 读取失败（${response.status}）`)
    }
    return response.json()
  }

  private async forgeJSON(path: string): Promise<unknown> {
    await this.load()
    if (this.expiresAt <= Date.now()) await this.signOut()
    if (!this.forgeToken) throw new Error('请重新登录以读取员工工作事项')
    const response = await this.fetch(new URL(path, this.forgeUrl), {
      headers: { Authorization: `Bearer ${this.forgeToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      await this.signOut()
      throw new Error('登录已失效，请重新登录')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Forge 工作事项读取失败（${response.status}）`)
    }
    return response.json()
  }

  async teamWorkspace(command: TeamWorkspaceCommand): Promise<unknown> {
    const session = await this.getSession()
    if (session.status !== 'signed-in' || !session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队开发权限')
    if (!command.accountId || command.accountId !== session.user?.id) throw new Error('编辑账号已变化，请重新打开团队')
    const account = await this.accountKey()
    const assertCurrent = async () => { if (await this.accountKey() !== account) throw new Error('账号已切换，请重新打开团队') }
    const result = await teamWorkspaceRequest(command, (path) => this.weaveJSON(path), (path, method, body) => this.weaveRequest(path, method, body, assertCurrent))
    await assertCurrent()
    return result
  }

  async getDevelopmentOverview(): Promise<EnterpriseDevelopmentOverview> {
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有开发中心权限')
    const [rawTeams, rawRuntimes, rawModels] = await Promise.all([
      this.weaveJSON('/v1/teams?include=roster,summary&status=all'),
      this.weaveJSON('/v1/runtimes'),
      this.weaveJSON('/v1/development/model-catalog'),
    ])
    if (!Array.isArray(rawTeams)) throw new Error('Weave 返回了无法识别的团队列表')
    const teams = await Promise.all(rawTeams.map(async (item): Promise<EnterpriseTeamObservation> => {
      const source = record(item)
      const team = record(source?.team)
      const id = textValue(team?.id)
      const name = textValue(team?.display_name) ?? textValue(team?.name)
      const status = textValue(team?.status)
      const updatedAt = textValue(team?.updated_at)
      if (!id || !name || !status || !updatedAt) throw new Error('Weave 返回了无法识别的团队')
      const summary = record(source?.summary)
      const health = record(summary?.health)
      return {
        id, name, status, updatedAt, workflows: [],
        workers: (Array.isArray(source?.workers) ? source.workers : []).flatMap((value) => member(value) ?? []),
        runs: [],
        ...(textValue(team?.objective) ? { objective: textValue(team?.objective) } : {}), ...(textValue(team?.evaluation) ? { evaluation: textValue(team?.evaluation) } : {}),
        ...(member(source?.lead) ? { lead: member(source?.lead) } : {}),
        ...(summary ? { summary: {
          workerCount: numberValue(summary.worker_count) ?? 0, activeWorkflowCount: numberValue(summary.active_workflow_count) ?? 0,
          publishedWorkflowCount: numberValue(summary.published_workflow_count) ?? 0, ...(textValue(health?.conclusion) ? { health: textValue(health?.conclusion) } : {}),
          reasons: Array.isArray(health?.reason_codes) ? health.reason_codes.filter((value): value is string => typeof value === 'string') : [],
        } } : {}),
      }
    }))
    const runtimeSource = record(rawRuntimes)
    const runtimes = (Array.isArray(runtimeSource?.runtimes) ? runtimeSource.runtimes : []).flatMap((value) => {
      const item = record(value), id = textValue(item?.id), name = textValue(item?.name)
      if (!id || !name) return []
      return [{ id, name, engines: stringList(item?.engines), status: textValue(item?.health_status) ?? 'unknown', online: item?.online === true }]
    })
    const modelSource = record(rawModels)
    const models = stringList(modelSource?.models)
    return { version: '1', loadedAt: new Date().toISOString(), teams, runtimes, models }
  }

  async getBusinessCapabilityCatalog(): Promise<EnterpriseBusinessCapabilityCatalog> {
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有开发中心权限')
    if (!this.forgeToken) throw new Error('请重新登录以读取 Forge 业务能力')
    const response = await this.fetch(new URL('/api/v1/mcp', this.forgeUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.forgeToken}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'business-capability-catalog', method: 'tools/call', params: { name: 'list_actions', arguments: {} } }),
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    const raw = await response.text()
    if (response.status === 401) {
      await this.signOut()
      throw new Error('登录已失效，请重新登录')
    }
    if (response.status === 403) throw new Error('当前账号没有读取 Forge 业务能力的权限')
    if (!response.ok) throw new Error(`Forge 业务能力读取失败（${response.status}）`)
    const envelope = record(parseMcpResponse(raw))
    const result = record(envelope?.result)
    const content = Array.isArray(result?.content) ? result.content : []
    const text = content.map((item) => textValue(record(item)?.text)).find(Boolean)
    const payload = text ? record(JSON.parse(text)) : undefined
    const actions = Array.isArray(payload?.actions) ? payload.actions : []
    const capabilities = actions.flatMap((value): EnterpriseBusinessCapability[] => {
      const action = record(value), actionName = textValue(action?.name), objectName = textValue(action?.objectName)
      if (!actionName || !objectName) return []
      return [{
        id: `forge:action:${objectName}.${actionName}`,
        name: textValue(action?.label) ?? textValue(action?.description) ?? actionName,
        description: textValue(action?.description) ?? textValue(action?.label) ?? actionName,
        effect: 'write', resourceType: objectName, requiresEmployeeIntent: true, status: 'available',
      }]
    })
    return { version: '1', provider: { id: 'forge', name: 'Forge 业务环境', status: 'available' }, capabilities, refreshedAt: new Date().toISOString() }
  }

  async createDevelopmentTeam(input: EnterpriseCreateTeamInput): Promise<EnterpriseCreateTeamResult> {
    const name = input?.name?.trim()
    const objective = input?.objective?.trim()
    if (input?.version !== '1' || !name || name.length > 80 || !objective || objective.length > 2_000) throw new Error('请填写团队名称和目标')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有新建团队权限')

    const suffix = randomUUID()
    const leadName = `team-${suffix}-lead`
    const workerName = `team-${suffix}-worker`
    const createdAgents: string[] = []
    try {
      const lead = record((await this.weaveRequest('/v1/agents', 'POST', {
        name: leadName, display_name: '团队负责人', role: 'avatar', engine: 'loom', graph_type: 'standard',
        spec: { system_prompt: `负责理解“${name}”的目标，组织协作并汇总可核验结果。` },
      })).body)
      const leadID = textValue(lead?.id)
      if (!leadID) throw new Error('Weave 没有返回团队负责人')
      createdAgents.push(leadName)

      const worker = record((await this.weaveRequest('/v1/agents', 'POST', {
        name: workerName, display_name: '执行成员', role: 'worker', engine: 'loom', graph_type: 'standard',
        spec: { system_prompt: `围绕“${objective}”完成分配的工作，并返回可核验结果。` },
      })).body)
      const workerID = textValue(worker?.id)
      if (!workerID) throw new Error('Weave 没有返回执行成员')
      createdAgents.push(workerName)

      const result = record((await this.weaveRequest('/v1/teams', 'POST', {
        name: `team-${suffix}`, display_name: name, objective, primary_scenario: objective,
        success_criteria: '完成团队目标并提供可核验结果', lead_avatar_id: leadID,
        workers: [{
          worker_agent_id: workerID, duty: '完成负责人分配的工作', when_to_use: '负责人需要执行具体任务时',
          context_instruction: '保留任务上下文与来源，清楚说明完成内容和未完成项。',
          allowed_kinds: ['consult', 'dispatch', 'handoff'], default_kind: 'dispatch', result_requirement: '返回可核验结果',
        }],
      })).body)
      const id = textValue(result?.id)
      if (!id) throw new Error('Weave 没有返回新团队')
      return { id, name: textValue(result?.display_name) ?? name, objective: textValue(result?.objective) ?? objective }
    } catch (error) {
      await Promise.allSettled(createdAgents.map((agentName) => this.deleteWeaveResource(`/v1/agents/${encodeURIComponent(agentName)}`)))
      throw error
    }
  }

  async updateDevelopmentTeam(input: EnterpriseUpdateTeamInput): Promise<void> {
    const name = input?.name?.trim(), objective = input?.objective?.trim()
    if (input?.version !== '1' || !input.teamId || !name || name.length > 80 || !objective || objective.length > 2_000 || !input.expectedUpdatedAt) throw new Error('团队资料不完整')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    await this.weaveRequest(`/v1/teams/${encodeURIComponent(input.teamId)}/profile`, 'PUT', { display_name: name, objective, expected_updated_at: input.expectedUpdatedAt })
  }

  async createDevelopmentTeamMember(input: EnterpriseCreateTeamMemberInput): Promise<EnterpriseTeamMemberMutationResult> {
    const name = input?.name?.trim(), duty = input?.duty?.trim()
    if (input?.version !== '1' || !input.teamId || !name || name.length > 80 || !duty || duty.length > 2_000) throw new Error('请填写成员名称和职责')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    const agentName = `team-member-${randomUUID()}`
    const created = record((await this.weaveRequest('/v1/agents', 'POST', {
      name: agentName, display_name: name, role: 'worker', engine: 'loom', graph_type: 'standard',
      spec: { system_prompt: duty },
    })).body)
    const agentID = textValue(created?.id)
    if (!agentID) throw new Error('Weave 没有返回新成员')
    try {
      await this.weaveRequest(`/v1/teams/${encodeURIComponent(input.teamId)}/workers`, 'POST', {
        worker_agent_id: agentID, duty, when_to_use: '负责人分配相关工作时', context_instruction: '保留任务上下文和材料来源。',
        allowed_kinds: ['consult', 'dispatch', 'handoff'], default_kind: 'dispatch', result_requirement: '返回可核验结果',
      })
    } catch (error) {
      await this.deleteWeaveResource(`/v1/agents/${encodeURIComponent(agentName)}`)
      throw error
    }
    return { id: agentID, name }
  }

  async removeDevelopmentTeamMember(teamId: string, memberId: string): Promise<void> {
    if (!teamId || !memberId) throw new Error('请选择要移出的成员')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    await this.weaveRequest(`/v1/teams/${encodeURIComponent(teamId)}/workers/${encodeURIComponent(memberId)}`, 'DELETE')
  }

  async createDevelopmentWorkflow(input: EnterpriseCreateWorkflowInput): Promise<EnterpriseCreateWorkflowResult> {
    const name = input?.name?.trim()
    const description = input?.description?.trim()
    if (input?.version !== '1' || !input.teamId || !input.leadId || !input.workerId || !name || name.length > 80 || !description || description.length > 2_000) throw new Error('请填写流程名称和用途')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程配置权限')
    const [lead, worker] = await Promise.all([
      this.getTeamMemberConfigDraft(input.teamId, input.leadId),
      this.getTeamMemberConfigDraft(input.teamId, input.workerId),
    ])
    const result = record((await this.weaveRequest(`/v1/teams/${encodeURIComponent(input.teamId)}/workflows`, 'POST', {
      name,
      description,
      trigger_config: { schema_version: 1, type: 'conversation_explicit', config: {} },
      graph_definition: {
        schema_version: 1,
        entry_node_id: 'understand',
        input_contract: { type: 'text' },
        output_contract: { type: 'text' },
        nodes: [
          { id: 'understand', type: 'lead', label: '理解任务', config: { instruction: lead.configuration.systemPrompt || `理解任务目标并明确“${description}”的交付要求。` }, inputs: { task: { value: { source: 'run_input', path: '' }, expected_type: 'text' } }, output: { type: 'text' } },
          { id: 'execute', type: 'worker', label: worker.configuration.displayName, config: { kind: 'consult', agent_id: input.workerId, agent_version: worker.baseAgentVersion, result_requirement: worker.relationship.resultRequirement || '完成分配的工作并返回可核验结果' }, inputs: { task: { value: { source: 'node_output', node_id: 'understand', path: '' }, expected_type: 'text' } }, output: { type: 'text' } },
          { id: 'deliver', type: 'deliver', label: '交付结果', config: { result: { source: 'node_output', node_id: 'execute', path: '' } } },
        ],
        edges: [
          { id: 'understand-execute', from_node_id: 'understand', to_node_id: 'execute', route: 'success' },
          { id: 'execute-deliver', from_node_id: 'execute', to_node_id: 'deliver', route: 'success' },
        ],
      },
    })).body)
    const workflow = record(result?.workflow), draft = record(result?.draft)
    const id = textValue(workflow?.id), workflowName = textValue(workflow?.name), draftVersion = numberValue(draft?.version)
    if (!id || !workflowName || !draftVersion) throw new Error('Weave 没有返回新流程')
    return { id, name: workflowName, draftVersion }
  }

  async updateDevelopmentWorkflowDraft(input: EnterpriseUpdateWorkflowDraftInput): Promise<EnterpriseUpdateWorkflowDraftResult> {
    if (input?.version !== '1' || !input.workflowId || !Number.isInteger(input.draftVersion) || input.draftVersion < 1 || !input.expectedUpdatedAt || !record(input.triggerConfig) || !workflowDefinition(input.graphDefinition)) throw new Error('流程草稿无效')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程配置权限')
    const result = record((await this.weaveRequest(`/v1/workflows/${encodeURIComponent(input.workflowId)}/versions/${input.draftVersion}`, 'PUT', {
      expected_updated_at: input.expectedUpdatedAt,
      trigger_config: input.triggerConfig,
      graph_definition: input.graphDefinition,
    })).body)
    const updatedAt = textValue(result?.updated_at), draftVersion = numberValue(result?.version)
    if (!updatedAt || !draftVersion) throw new Error('Weave 没有返回流程草稿')
    return { draftVersion, updatedAt }
  }

  async createDevelopmentWorkflowDraft(workflowId: string): Promise<EnterpriseUpdateWorkflowDraftResult> {
    if (!workflowId) throw new Error('流程无效')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程配置权限')
    const result = record((await this.weaveRequest(`/v1/workflows/${encodeURIComponent(workflowId)}/drafts`, 'POST', {})).body)
    const updatedAt = textValue(result?.updated_at), draftVersion = numberValue(result?.version)
    if (!updatedAt || !draftVersion) throw new Error('Weave 没有返回新版本草稿')
    return { draftVersion, updatedAt }
  }

  async validateDevelopmentWorkflow(workflowId: string, version: number): Promise<EnterpriseWorkflowValidation> {
    if (!workflowId || !Number.isInteger(version) || version < 1) throw new Error('流程版本无效')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程配置权限')
    const result = record((await this.weaveRequest(`/v1/workflows/${encodeURIComponent(workflowId)}/versions/${version}/validate`, 'POST', {})).body)
    if (typeof result?.valid !== 'boolean' || !Array.isArray(result.issues)) throw new Error('Weave 返回了无法识别的检查结果')
    return { valid: result.valid, issues: result.issues.flatMap((value) => {
      const issue = record(value), code = textValue(issue?.code), message = textValue(issue?.message)
      if (!code || !message) return []
      return [{ code, message, ...(textValue(issue?.node_id) ? { nodeId: textValue(issue?.node_id) } : {}) }]
    }) }
  }

  async publishDevelopmentWorkflow(workflowId: string, version: number): Promise<void> {
    if (!workflowId || !Number.isInteger(version) || version < 1) throw new Error('流程版本无效')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程发布权限')
    await this.weaveRequest(`/v1/workflows/${encodeURIComponent(workflowId)}/versions/${version}/publish`, 'POST', {})
  }

  async archiveDevelopmentWorkflow(workflowId: string): Promise<void> {
    if (!workflowId) throw new Error('流程无效')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程归档权限')
    await this.weaveRequest(`/v1/workflows/${encodeURIComponent(workflowId)}`, 'DELETE')
  }

  async getTeamMemberConfigDraft(teamId: string, agentId: string): Promise<EnterpriseTeamMemberConfigDraft> {
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    return teamMemberConfigDraft(await this.weaveJSON(`/v1/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(agentId)}/config-draft`))
  }

  async saveTeamMemberConfigDraft(draft: EnterpriseTeamMemberConfigDraft): Promise<EnterpriseTeamMemberConfigDraft> {
    if (!draft?.teamId || !draft.agentId || !Number.isInteger(draft.revision) || !draft.configuration?.displayName?.trim()) throw new Error('团队成员配置不完整')
    let outputSchema: unknown
    if (draft.configuration.outputSchema.trim()) {
      try { outputSchema = JSON.parse(draft.configuration.outputSchema) }
      catch { throw new Error('输出格式需要填写有效的 JSON') }
    }
    const result = await this.weaveRequest(`/v1/teams/${encodeURIComponent(draft.teamId)}/members/${encodeURIComponent(draft.agentId)}/config-draft`, 'PUT', {
      revision: draft.revision,
      configuration: {
        tool_loop_control: draft.configuration.toolLoopControl ? { slice_rounds: draft.configuration.toolLoopControl.sliceRounds, initial_total_rounds: draft.configuration.toolLoopControl.initialTotalRounds } : null,
        max_tool_repeats: draft.configuration.maxToolRepeats ?? 0,
        display_name: draft.configuration.displayName.trim(), role: draft.configuration.role, engine: draft.configuration.engine,
        runtime_id: draft.configuration.runtimeId.trim(), model: draft.configuration.model.trim(), system_prompt: draft.configuration.systemPrompt,
        skill_names: draft.configuration.skillNames, skills: draft.configuration.skills.map((skill) => ({ name: skill.name, description: skill.description, body: skill.body, always_active: skill.alwaysActive })), mcp_server_ids: draft.configuration.mcpServerIds, business_capability_ids: draft.configuration.businessCapabilityIds,
        permission_allow: draft.configuration.permissionAllow, permission_ask: draft.configuration.permissionAsk, permission_deny: draft.configuration.permissionDeny,
        memory_enabled: draft.configuration.memoryEnabled, memory_scope: draft.configuration.memoryScope,
        max_tokens: draft.configuration.maxTokens, max_output_tokens: draft.configuration.maxOutputTokens,
        step_budget: draft.configuration.stepBudget, max_cost_usd: draft.configuration.maxCostUsd, ...(outputSchema === undefined ? {} : { output_schema: outputSchema }),
      },
      relationship: {
        duty: draft.relationship.duty, when_to_use: draft.relationship.whenToUse, context_instruction: draft.relationship.contextInstruction,
        allowed_kinds: draft.relationship.allowedKinds, default_kind: draft.relationship.defaultKind,
        result_requirement: draft.relationship.resultRequirement, enabled: draft.relationship.enabled,
      },
    })
    return teamMemberConfigDraft(result.body)
  }

  async applyTeamMemberConfigDraft(teamId: string, agentId: string, revision: number): Promise<EnterpriseTeamMemberConfigDraft> {
    if (!teamId || !agentId || !Number.isInteger(revision) || revision < 1) throw new Error('请选择要应用的成员草稿')
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    const result = await this.weaveRequest(`/v1/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(agentId)}/config-draft/apply`, 'POST', { revision })
    return teamMemberConfigDraft(result.body)
  }

  private async weaveRequest(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, assertCurrent?: () => Promise<void>): Promise<{ status: number; body: unknown }> {
    const headers = new Headers({ ...(Object.fromEntries(await this.authorizationHeaders())), Accept: 'application/json', 'Content-Type': 'application/json' })
    await assertCurrent?.()
    const response = await this.fetch(new URL(path, this.weaveUrl), {
      method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    const result = await response.json().catch(() => undefined)
    if (response.status === 401 || response.status === 403) {
      await this.signOut()
      throw new Error('登录已失效，请重新登录')
    }
    if (!response.ok) {
      const error = textValue(record(result)?.error) ?? textValue(record(result)?.message) ?? `Weave 请求失败（${response.status}）`
      throw new Error(error)
    }
    return { status: response.status, body: result }
  }

  private async deleteWeaveResource(path: string): Promise<void> {
    const response = await this.fetch(new URL(path, this.weaveUrl), {
      method: 'DELETE', headers: await this.authorizationHeaders(), redirect: 'error', signal: AbortSignal.timeout(8_000),
    })
    await response.body?.cancel()
  }

  private async workProjectID(): Promise<string> {
    const session = await this.getSession()
    const subject = session.user?.weaveUserId ?? session.user?.id
    if (session.status !== 'signed-in' || !subject) throw new Error('请先登录')
    return `workbench-${subject}`
  }

  async accountKey(): Promise<string> {
    const session = await this.getSession()
    if (session.status !== 'signed-in' || !session.user?.id || !session.user.weaveUserId || !session.organization?.id) throw new Error('请先登录')
    return createHash('sha256').update(JSON.stringify([this.forgeUrl.origin, this.weaveUrl.origin, session.organization.id, session.user.id, session.user.weaveUserId])).digest('hex')
  }

  async getTeamCatalog(): Promise<TeamSummary[]> { return teamCatalog(await this.weaveJSON('/v1/teams?status=active')) }
  async getTeamChoices(team: TeamSummary): Promise<EnterpriseWorkChoice[]> {
    return teamChoices(team, await this.weaveJSON(`/v1/teams/${encodeURIComponent(team.id)}/workflows`))
  }

  async getWorkOverview(): Promise<EnterpriseWorkOverview> {
    const teams = await this.getTeamCatalog()
    const choices = (await Promise.all(teams.map((team) => this.getTeamChoices(team)))).flat()
    const projectID = await this.workProjectID()
    const [rawRuns, rawTasks, rawNotifications] = await Promise.all([
      this.weaveJSON(`/v1/runs?project_id=${encodeURIComponent(projectID)}&aggregation_mode=root-subtree&limit=50`),
      this.weaveJSON('/v1/human-tasks?limit=50'),
      this.forgeJSON('/api/v1/notifications?limit=50'),
    ])
    const taskList = record(rawTasks)
    const tasks = (Array.isArray(taskList?.tasks) ? taskList.tasks : []).flatMap((value): EnterpriseHumanTask[] => {
      const task = record(value)
      const interactionId = textValue(task?.interaction_id), runId = textValue(task?.run_id), teamId = textValue(task?.team_id)
      const workflowId = textValue(task?.workflow_id), title = textValue(task?.title), instructions = textValue(task?.instructions), updatedAt = textValue(task?.updated_at)
      const workflowVersion = numberValue(task?.workflow_version)
      if (!interactionId || !runId || !teamId || !workflowId || !workflowVersion || !title || !instructions || !updatedAt) return []
      return [{ interactionId, runId, teamId, workflowId, workflowVersion, title, instructions, updatedAt, ...(textValue(task?.audience_ref) ? { audience: textValue(task?.audience_ref) } : {}) }]
    })
    const notificationList = record(rawNotifications)
    const items = (Array.isArray(notificationList?.notifications) ? notificationList.notifications : []).flatMap((value): EnterpriseWorkItem[] => {
      const notification = record(value), data = record(notification?.data), continuation = record(data?.continuation), material = record(data?.material)
      const id = textValue(notification?.id), title = textValue(notification?.title), createdAt = textValue(notification?.createdAt) ?? textValue(notification?.created_at)
      if (!id || !title || !createdAt) return []
      const requestedKind = textValue(data?.kind)
      const kind: EnterpriseWorkItem['kind'] = requestedKind === 'revision_required' || requestedKind === 'human_review' || requestedKind === 'failure' || requestedKind === 'result'
        ? requestedKind : textValue(notification?.type)?.includes('error') ? 'failure' : 'result'
      const actionable = kind === 'revision_required' || kind === 'human_review'
      const statusValue = textValue(data?.status)
      const status: EnterpriseWorkItem['status'] = statusValue === 'pending' || statusValue === 'in_progress' || statusValue === 'completed' || statusValue === 'cancelled'
        ? statusValue : notification?.read === true ? 'completed' : actionable ? 'pending' : 'unread'
      const returnTarget = textValue(continuation?.returnTarget)
      const reviewScope = textValue(continuation?.reviewScope)
      return [{
        id, kind, title, status, actionable, read: notification?.read === true,
        source: textValue(data?.source) === 'weave' ? 'weave' : 'forge', createdAt,
        ...(textValue(notification?.body) ? { summary: textValue(notification?.body) } : {}),
        ...(textValue(data?.instructions) ? { instructions: textValue(data?.instructions) } : {}),
        ...(textValue(notification?.actionUrl) ?? textValue(notification?.action_url) ? { actionUrl: textValue(notification?.actionUrl) ?? textValue(notification?.action_url) } : {}),
        ...(textValue(data?.workReference) ? { workReference: textValue(data?.workReference) } : {}),
        ...(textValue(data?.runReference) ? { runReference: textValue(data?.runReference) } : {}),
        ...(textValue(material?.label) ? { materialLabel: textValue(material?.label) } : {}),
        ...(textValue(continuation?.reason) ? { returnReason: textValue(continuation?.reason) } : {}),
        ...(returnTarget === 'origin_review' || returnTarget === 'team' || returnTarget === 'member' || returnTarget === 'human_step' ? { returnTarget } : {}),
        ...(reviewScope === 'whole_team' || reviewScope === 'affected_members' || reviewScope === 'human_step' ? { reviewScope } : {}),
      }]
    })
    const runList = record(rawRuns)
    return { loadedAt: new Date().toISOString(), choices, tasks, items, runs: (Array.isArray(runList?.runs) ? runList.runs : []).flatMap((run) => runObservation(run) ?? []) }
  }

  async submitWork(choice: EnterpriseWorkChoice, goal: string, source?: {
    idempotencySeed: string
    sessionKey: string
    sourceMessages: Array<{ messageId: string; eventSeq: number; sha256: string }>
    accountKey: string
    assertCurrent(): Promise<void>
  }): Promise<EnterpriseWorkReceipt> {
    const normalized = goal.trim()
    if (!normalized || !choice?.teamId || !choice.workflowId || !Number.isInteger(choice.version) || choice.version < 1) throw new Error('工作内容或团队流程无效')
    const assertCurrent = async () => {
      if (source) {
        if (await this.accountKey() !== source.accountKey) throw new Error('当前账号已变化，本次交接已失效')
        await source.assertCurrent()
      }
    }
    await assertCurrent()
    const projectID = await this.workProjectID()
    const workId = source
      ? submissionUUID(`${source.accountKey}:${source.idempotencySeed}`)
      : randomUUID()
    const workbenchSessionID = source ? `${projectID}-${source.sessionKey}-${workId}` : `${projectID}-${workId}`
    const registered = await this.weaveRequest('/v1/workbench/dispatch-inputs', 'POST', {
      registration_id: workId, workbench_session_id: workbenchSessionID, team_id: choice.teamId, workflow_id: choice.workflowId,
      workflow_version: choice.version, task: normalized,
      source_messages: source?.sourceMessages.map((message) => ({ message_id: message.messageId, event_seq: message.eventSeq, sha256: message.sha256 }))
        ?? [{ message_id: workId, event_seq: 0, sha256: createHash('sha256').update(normalized).digest('hex') }],
    }, assertCurrent)
    const registration = record(registered.body)
    const inputRevisionID = textValue(registration?.input_revision_id), clientRequestID = textValue(registration?.client_request_id)
    if (!inputRevisionID || !clientRequestID || registration?.task_sha256 !== createHash('sha256').update(normalized).digest('hex')) throw new Error('Weave 输入回执与本次固定材料不一致，结果待核对')
    const dispatched = await this.weaveRequest(`/v1/teams/${encodeURIComponent(choice.teamId)}/dispatch`, 'POST', { input_revision_id: inputRevisionID, client_request_id: clientRequestID }, assertCurrent)
    const result = record(dispatched.body)
    const runId = textValue(result?.run_id), taskId = textValue(result?.task_id), workflowId = textValue(result?.workflow_id)
    const workflowVersion = numberValue(result?.workflow_version)
    if (!runId || !taskId || workflowId !== choice.workflowId || workflowVersion !== choice.version) throw new Error('Weave 没有返回匹配的接单回执，结果待核对')
    return { workId, runId, taskId, workflowId, workflowVersion, inputRevisionId: inputRevisionID, clientRequestId: clientRequestID, taskSha256: registration.task_sha256 as string, repeated: dispatched.status === 200 }
  }

  async completeHumanTask(task: Pick<EnterpriseHumanTask, 'runId' | 'interactionId'>, payload: Record<string, unknown>): Promise<{ runId: string; repeated: boolean }> {
    if (!textValue(task?.runId) || !textValue(task?.interactionId) || !record(payload)) throw new Error('待办信息无效')
    const result = await this.weaveRequest(`/v1/human-tasks/${encodeURIComponent(task.runId)}/complete`, 'POST', {
      interaction_id: task.interactionId, payload, idempotency_key: `workbench-human-${task.interactionId}`,
    })
    const body = record(result.body)
    const runId = textValue(body?.run_id)
    if (!runId) throw new Error('Weave 没有返回待办处理结果')
    return { runId, repeated: body?.idempotent === true }
  }

  async getStatus(): Promise<EnterpriseEnvironmentStatus[]> {
    const targets = [
      { id: 'forge-development', name: 'Forge 业务环境', url: environmentUrl(this.environment.WORKBENCH_FORGE_URL, DEFAULT_FORGE_URL, 'Forge'), path: '/api/v1/health' },
      { id: 'weave-development', name: 'Weave 协作服务', url: environmentUrl(this.environment.WORKBENCH_WEAVE_URL, DEFAULT_WEAVE_URL, 'Weave'), path: '/v1/health' },
    ]
    return Promise.all(targets.map(async ({ id, name, url, path }) => {
      const checkedAt = new Date().toISOString()
      try {
        const response = await this.fetch(new URL(path, url), {
          headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        const body = await response.json().catch(() => undefined)
        return {
          id, name, url: url.origin, available: response.ok, secure: url.protocol === 'https:', checkedAt,
          version: versionFromHealth(body), ...(response.ok ? {} : { message: `服务返回 ${response.status}` }),
        }
      } catch {
        return { id, name, url: url.origin, available: false, secure: url.protocol === 'https:', checkedAt, message: '暂时无法连接' }
      }
    }))
  }
}
