import { teamWorkspaceRequest } from './enterprise/team-workspace'
import type { TeamWorkspaceCommand } from '../../src/types/team-workspace'
import type { EnterpriseApprovalContext, EnterpriseBusinessCapability, EnterpriseBusinessCapabilityBinding, EnterpriseBusinessCapabilityCatalog, EnterpriseCreateTeamInput, EnterpriseCreateTeamMemberInput, EnterpriseCreateTeamResult, EnterpriseCreateWorkflowInput, EnterpriseCreateWorkflowResult, EnterpriseDevelopmentOverview, EnterpriseEnvironmentStatus, EnterpriseHumanTask, EnterprisePermission, EnterpriseRunObservation, EnterpriseSession, EnterpriseTeamMember, EnterpriseTeamMemberAgentConfiguration, EnterpriseTeamMemberConfigDraft, EnterpriseTeamMemberMutationResult, EnterpriseTeamMemberRelationshipConfiguration, EnterpriseTeamObservation, EnterpriseUpdateTeamInput, EnterpriseUpdateWorkflowDraftInput, EnterpriseUpdateWorkflowDraftResult, EnterpriseWorkflowGraphDefinition, EnterpriseWorkflowObservation, EnterpriseWorkflowValidation, EnterpriseWorkChoice, EnterpriseWorkItem, EnterpriseWorkOverview, EnterpriseWorkReceipt, EnterpriseWorkResource } from '../../src/types/api'
import type { FrozenMaterial } from './enterprise/materials'
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

type EnterpriseAuthProvider = 'forge' | 'weave'
interface EnterpriseAuthSnapshot { generation: number; provider: EnterpriseAuthProvider; token: string }

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

async function responseErrorCode(response: Response): Promise<string | undefined> {
  try {
    const envelope = record(await response.json())
    const error = record(envelope?.error)
    const code = textValue(error?.code)
    return code && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : undefined
  } catch {
    return undefined
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function businessCapabilityParams(value: unknown): NonNullable<EnterpriseBusinessCapability['params']> {
  return Array.isArray(value) ? value.flatMap((item) => {
    const param = record(item), name = textValue(param?.name) ?? textValue(param?.field)
    if (!name) return []
    const rawType = textValue(param?.type) ?? 'string'
    const type: 'string' | 'number' | 'boolean' | 'array' | 'file' = rawType === 'file' ? 'file' : rawType === 'boolean' ? 'boolean' : rawType === 'array' ? 'array' : ['number', 'integer', 'currency'].includes(rawType) ? 'number' : 'string'
    const options = Array.isArray(param?.enum) ? param.enum : Array.isArray(param?.options) ? param.options : []
    const values = options.flatMap((option) => typeof option === 'string' ? [option] : textValue(record(option)?.value) ? [textValue(record(option)?.value)!] : [])
    return [{ name, label: textValue(param?.label) ?? textValue(param?.title), type, multiple: param?.multiple === true, required: param?.required === true, description: textValue(param?.description) ?? '', ...(values.length ? { enum: values } : {}) }]
  }) : []
}

const materialBindingSources = ['materials.single.id', 'materials.single.name', 'materials.single.sha256', 'materials.manifest_json'] as const

function businessCapabilityBindings(value: unknown): EnterpriseBusinessCapabilityBinding[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const binding = record(item), capabilityId = textValue(binding?.capability_id) ?? textValue(binding?.capabilityId)
    if (!capabilityId || !Array.isArray(binding?.parameters)) throw new Error('Weave 返回的业务字段映射无效')
    const parameters = binding.parameters.flatMap((parameter) => {
      const source = record(parameter), name = textValue(source?.name), resource = textValue(source?.source)
      if (!name || !resource || !materialBindingSources.includes(resource as typeof materialBindingSources[number])) throw new Error('Weave 返回了无法识别的业务字段来源')
      return [{ name, source: resource as EnterpriseBusinessCapabilityBinding['parameters'][number]['source'] }]
    })
    if (!parameters.length) throw new Error('Weave 返回了没有参数的业务字段映射')
    return [{ capabilityId, parameters }]
  })
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
    mcpServerIds: stringList(value.mcp_server_ids), businessCapabilityIds: stringList(value.business_capability_ids), businessCapabilityBindings: businessCapabilityBindings(value.business_capability_bindings), permissionAllow: stringList(value.permission_allow),
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
  private authGeneration = 0
  private loginAttempt = 0
  private persistenceQueue: Promise<void> = Promise.resolve()
  private session?: EnterpriseSession
  private weaveToken?: string
  private forgeToken?: string
  private expiresAt = 0
  private sessionScopeChangeHandler?: (session: EnterpriseSession, generation: number, phase: 'sign-in-start' | 'signed-in' | 'signed-out') => Promise<void>

  constructor(options: EnterpriseServiceOptions = {}) {
    this.environment = options.environment ?? process.env
    this.fetch = options.fetch ?? fetch
    this.forgeUrl = environmentUrl(this.environment.WORKBENCH_FORGE_URL, DEFAULT_FORGE_URL, 'Forge')
    this.weaveUrl = environmentUrl(this.environment.WORKBENCH_WEAVE_URL, DEFAULT_WEAVE_URL, 'Weave')
    this.sessionPath = options.sessionPath
    this.sessionCodec = options.sessionCodec
  }

  setSessionScopeChangeHandler(handler: (session: EnterpriseSession, generation: number, phase: 'sign-in-start' | 'signed-in' | 'signed-out') => Promise<void>): void {
    this.sessionScopeChangeHandler = handler
  }

  private async notifySessionScopeChanged(session: EnterpriseSession, phase: 'sign-in-start' | 'signed-in' | 'signed-out'): Promise<void> {
    await this.sessionScopeChangeHandler?.(structuredClone(session), this.authGeneration, phase)
  }

  isSessionGenerationCurrent(generation: number): boolean { return generation === this.authGeneration }

  accountKeyForSession(session: EnterpriseSession): string {
    if (session.status !== 'signed-in' || !session.user?.id || !session.user.weaveUserId || !session.organization?.id) throw new Error('请先登录')
    return createHash('sha256').update(JSON.stringify([this.forgeUrl.origin, this.weaveUrl.origin, session.organization.id, session.user.id, session.user.weaveUserId])).digest('hex')
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
    const generation = this.authGeneration
    if (!this.sessionPath || !this.sessionCodec?.available()) return
    try {
      const saved = record(JSON.parse(await readFile(this.sessionPath, 'utf8')))
      const projection = record(saved?.session) as EnterpriseSession | undefined
      if (saved?.version !== 3 || typeof saved.expiresAt !== 'number' || projection?.status !== 'signed-in' || !enterprisePermissions(projection.permissions)) return
      if (generation !== this.authGeneration) return
      if (saved.expiresAt <= Date.now()) { await this.clearPersisted(generation); return }
      const encryptedWeaveToken = saved.weaveToken
      if (typeof encryptedWeaveToken !== 'string') return
      const weaveToken = this.sessionCodec.decrypt(Buffer.from(encryptedWeaveToken, 'base64'))
      const forgeToken = typeof saved.forgeToken === 'string' ? this.sessionCodec.decrypt(Buffer.from(saved.forgeToken, 'base64')) : undefined
      if (generation !== this.authGeneration) return
      this.weaveToken = weaveToken
      this.forgeToken = forgeToken
      this.expiresAt = saved.expiresAt
      this.session = { ...projection, storage: 'encrypted' }
    } catch { /* missing, malformed, or undecryptable sessions start signed out */ }
  }

  private queuePersistence(operation: () => Promise<void>): Promise<void> {
    const next = this.persistenceQueue.then(operation, operation)
    this.persistenceQueue = next.catch(() => undefined)
    return next
  }

  private async persist(generation: number): Promise<void> {
    if (!this.sessionPath || !this.sessionCodec?.available()) return
    await this.queuePersistence(async () => {
      if (generation !== this.authGeneration || !this.session || !this.weaveToken) return
      const saved = JSON.stringify({ version: 3, expiresAt: this.expiresAt, weaveToken: this.sessionCodec!.encrypt(this.weaveToken).toString('base64'), ...(this.forgeToken ? { forgeToken: this.sessionCodec!.encrypt(this.forgeToken).toString('base64') } : {}), session: { ...this.session, storage: 'encrypted' } })
      await writeFile(this.sessionPath!, saved, { encoding: 'utf8', mode: 0o600 })
      if (generation === this.authGeneration && this.session) this.session = { ...this.session, storage: 'encrypted' }
    })
  }

  private async clearPersisted(generation: number): Promise<void> {
    if (!this.sessionPath) return
    await this.queuePersistence(async () => {
      if (generation === this.authGeneration) await unlink(this.sessionPath!).catch(() => undefined)
    })
  }

  private clearSessionState(): void {
    this.weaveToken = undefined
    this.forgeToken = undefined
    this.session = undefined
    this.expiresAt = 0
  }

  private currentToken(provider: EnterpriseAuthProvider): string | undefined {
    return provider === 'weave' ? this.weaveToken : this.forgeToken
  }

  private assertCurrentAuth(snapshot: EnterpriseAuthSnapshot): void {
    if (snapshot.generation !== this.authGeneration || this.currentToken(snapshot.provider) !== snapshot.token) {
      throw new Error('账号已切换，旧请求结果已丢弃')
    }
  }

  private assertAuthGeneration(generation: number): void {
    if (generation !== this.authGeneration) throw new Error('账号已切换，旧请求结果已丢弃')
  }

  private async authenticatedFetch(input: URL | RequestInfo, provider: EnterpriseAuthProvider, init: RequestInit = {}, expectedGeneration = this.authGeneration): Promise<{ response: Response; snapshot: EnterpriseAuthSnapshot }> {
    await this.load()
    this.assertAuthGeneration(expectedGeneration)
    if ((this.weaveToken || this.forgeToken) && this.expiresAt <= Date.now()) await this.signOut()
    const token = this.currentToken(provider)
    if (!token) throw new Error('请先登录')
    const snapshot = { generation: this.authGeneration, provider, token }
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const response = await this.fetch(input, { ...init, headers })
    try { this.assertCurrentAuth(snapshot) }
    catch (error) { await response.body?.cancel(); throw error }
    return { response, snapshot }
  }

  private async signOutIfCurrent(snapshot: EnterpriseAuthSnapshot): Promise<void> {
    try { this.assertCurrentAuth(snapshot) } catch { return }
    await this.signOut()
  }

  private assertLoginCurrent(generation: number, attempt: number): void {
    if (generation !== this.authGeneration || attempt !== this.loginAttempt) throw new Error('账号已切换，旧登录请求已取消')
  }

  async getSession(): Promise<EnterpriseSession> {
    await this.load()
    if (this.session && this.expiresAt <= Date.now()) await this.signOut()
    return structuredClone(this.session ?? this.signedOut())
  }

  private async sessionSnapshot(): Promise<{ session: EnterpriseSession; generation: number }> {
    const generation = this.authGeneration
    const session = await this.getSession()
    if (generation !== this.authGeneration && session.status === 'signed-out' && !this.weaveToken && !this.forgeToken) {
      return { session, generation: this.authGeneration }
    }
    this.assertAuthGeneration(generation)
    return { session, generation }
  }

  async authorizationHeaders(): Promise<Headers> {
    await this.load()
    if ((this.weaveToken || this.forgeToken) && this.expiresAt <= Date.now()) await this.signOut()
    if (!this.weaveToken) throw new Error('请先登录')
    return new Headers({ Authorization: `Bearer ${this.weaveToken}` })
  }

  async signIn(email: string, password: string): Promise<EnterpriseSession> {
    const normalizedEmail = email.trim()
    if (!normalizedEmail || !password) throw new Error('请输入账号和密码')
    const attempt = ++this.loginAttempt
    await this.load()
    if (attempt !== this.loginAttempt) throw new Error('账号已切换，旧登录请求已取消')
    const generation = ++this.authGeneration
    this.clearSessionState()
    await this.clearPersisted(generation)
    await this.notifySessionScopeChanged(this.signedOut(), 'sign-in-start')
    try {
      const signedIn = await this.fetch(new URL('/api/v1/auth/sign-in/email', this.forgeUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: this.forgeUrl.origin, Referer: `${this.forgeUrl.origin}/` },
        body: JSON.stringify({ email: normalizedEmail, password }), redirect: 'error', signal: AbortSignal.timeout(15_000),
      })
      this.assertLoginCurrent(generation, attempt)
      if (!signedIn.ok) {
        await signedIn.body?.cancel()
        if (signedIn.status === 401 || signedIn.status === 403) throw new Error('账号或密码不正确')
        throw new Error('Forge 登录服务暂时不可用')
      }
      const forge = record(await signedIn.json())
      this.assertLoginCurrent(generation, attempt)
      const forgeUser = record(forge?.user)
      if (typeof forge?.token !== 'string' || typeof forgeUser?.id !== 'string') throw new Error('Forge 返回了无法识别的登录结果')
      const exchanged = await this.fetch(new URL('/v1/auth/external/exchange', this.weaveUrl), {
        method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${forge.token}` },
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      })
      this.assertLoginCurrent(generation, attempt)
      if (!exchanged.ok) {
        await exchanged.body?.cancel()
        if (exchanged.status === 401 || exchanged.status === 403) throw new Error('当前账号无法进入 Weave')
        throw new Error('Weave 账号绑定服务暂时不可用')
      }
      const weave = record(await exchanged.json())
      this.assertLoginCurrent(generation, attempt)
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
      await this.persist(generation)
      this.assertLoginCurrent(generation, attempt)
      await this.notifySessionScopeChanged(this.session, 'signed-in')
      this.assertLoginCurrent(generation, attempt)
      const session = await this.getSession()
      this.assertLoginCurrent(generation, attempt)
      return session
    } catch (error) {
      if (generation !== this.authGeneration || attempt !== this.loginAttempt) throw new Error('账号已切换，旧登录请求已取消')
      this.clearSessionState()
      await this.clearPersisted(generation).catch(() => undefined)
      await this.notifySessionScopeChanged(this.signedOut(), 'signed-out').catch(() => undefined)
      if (error instanceof Error && !['fetch failed', 'The operation was aborted due to timeout'].includes(error.message)) throw error
      throw new Error('企业服务暂时无法连接')
    }
  }

  async signOut(): Promise<EnterpriseSession> {
    this.loginAttempt++
    const generation = ++this.authGeneration
    this.clearSessionState()
    await this.clearPersisted(generation).catch(() => undefined)
    await this.notifySessionScopeChanged(this.signedOut(), 'signed-out')
    return this.signedOut()
  }

  private async weaveJSON(path: string, expectedGeneration = this.authGeneration): Promise<unknown> {
    const { response, snapshot } = await this.authenticatedFetch(new URL(path, this.weaveUrl), 'weave', { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, expectedGeneration)
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      await this.signOutIfCurrent(snapshot)
      throw new Error('登录已失效，请重新登录')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Weave 读取失败（${response.status}）`)
    }
    const result = await response.json()
    this.assertCurrentAuth(snapshot)
    return result
  }

  private async forgeJSON(path: string, expectedGeneration = this.authGeneration): Promise<unknown> {
    const { response, snapshot } = await this.authenticatedFetch(new URL(path, this.forgeUrl), 'forge', { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, expectedGeneration)
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      await this.signOutIfCurrent(snapshot)
      throw new Error('登录已失效，请重新登录')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Forge 工作事项读取失败（${response.status}）`)
    }
    const result = await response.json()
    this.assertCurrentAuth(snapshot)
    return result
  }

  private async forgeOptionalJSON(path: string, expectedGeneration = this.authGeneration): Promise<unknown> {
    const { response, snapshot } = await this.authenticatedFetch(new URL(path, this.forgeUrl), 'forge', { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, expectedGeneration)
    if (response.status === 404) { await response.body?.cancel(); return undefined }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel(); await this.signOutIfCurrent(snapshot); throw new Error('登录已失效，请重新登录')
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Forge 工作事项读取失败（${response.status}）`) }
    const result = await response.json()
    this.assertCurrentAuth(snapshot)
    return result
  }

  private async forgeRequest(path: string, body: unknown, expectedGeneration = this.authGeneration): Promise<{ status: number; body: unknown }> {
    const { response, snapshot } = await this.authenticatedFetch(new URL(path, this.forgeUrl), 'forge', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15_000),
    }, expectedGeneration)
    const result = await response.json().catch(() => undefined)
    this.assertCurrentAuth(snapshot)
    if (response.status === 401 || response.status === 403) { await this.signOutIfCurrent(snapshot); throw new Error('登录已失效，请重新登录') }
    if (!response.ok) throw new Error(textValue(record(result)?.message) ?? textValue(record(result)?.error) ?? `Forge 工作事项处理失败（${response.status}）`)
    return { status: response.status, body: result }
  }

  async stageWorkMaterials(materials: FrozenMaterial[], assertCurrent: () => Promise<void>): Promise<EnterpriseWorkResource[]> {
    if (!materials.length) throw new Error('请指定本次交接的工作材料')
    const generation = this.authGeneration
    await this.load()
    this.assertAuthGeneration(generation)
    if ((this.weaveToken || this.forgeToken) && this.expiresAt <= Date.now()) await this.signOut()
    if (!this.forgeToken) throw new Error('请重新登录以上传工作材料')
    const resources: EnterpriseWorkResource[] = []
    for (const material of materials) {
      await assertCurrent()
      this.assertAuthGeneration(generation)
      const prepared = await this.forgeRequest('/api/v1/storage/upload/presigned', {
        filename: material.name, mimeType: 'text/plain; charset=utf-8', size: material.bytes, scope: 'user',
      }, generation)
      const envelope = record(prepared.body), descriptor = record(envelope?.data) ?? envelope
      const fileId = textValue(descriptor?.fileId), uploadUrl = textValue(descriptor?.uploadUrl), method = textValue(descriptor?.method) ?? 'PUT'
      if (!fileId || !uploadUrl) throw new Error('Forge 没有返回材料上传地址')
      const uploaded = await this.fetch(new URL(uploadUrl, this.forgeUrl), {
        method, headers: record(descriptor?.headers) as Record<string, string> | undefined,
        body: Buffer.from(material.content, 'utf8'), redirect: 'error', signal: AbortSignal.timeout(30_000),
      })
      if (!uploaded.ok) { await uploaded.body?.cancel(); throw new Error(`材料“${material.name}”上传失败（${uploaded.status}）`) }
      await uploaded.body?.cancel()
      await assertCurrent()
      this.assertAuthGeneration(generation)
      const completed = await this.forgeRequest('/api/v1/storage/upload/complete', { fileId }, generation)
      const completedEnvelope = record(completed.body), completedData = record(completedEnvelope?.data) ?? completedEnvelope
      if ((textValue(completedData?.fileId) ?? fileId) !== fileId) throw new Error('Forge 返回的材料版本与本次上传不一致')
      resources.push({ type: 'forge-file', id: fileId, name: material.name, bytes: material.bytes, sha256: material.sha256 })
    }
    await assertCurrent()
    this.assertAuthGeneration(generation)
    return resources
  }

  async teamWorkspace(command: TeamWorkspaceCommand): Promise<unknown> {
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in' || !session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队开发权限')
    if (!command.accountId || command.accountId !== session.user?.id) throw new Error('编辑账号已变化，请重新打开团队')
    const account = await this.accountKey()
    const assertCurrent = async () => { this.assertAuthGeneration(generation); if (await this.accountKey() !== account) throw new Error('账号已切换，请重新打开团队') }
    const result = await teamWorkspaceRequest(command, (path) => this.weaveJSON(path, generation), (path, method, body) => this.weaveRequest(path, method, body, assertCurrent, undefined, generation))
    await assertCurrent()
    return result
  }

  async getDevelopmentOverview(): Promise<EnterpriseDevelopmentOverview> {
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有开发中心权限')
    const [rawTeams, rawRuntimes, rawModels] = await Promise.all([
      this.weaveJSON('/v1/teams?include=roster,summary&status=all', generation),
      this.weaveJSON('/v1/runtimes', generation),
      this.weaveJSON('/v1/development/model-catalog', generation),
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
    this.assertAuthGeneration(generation)
    return { version: '1', loadedAt: new Date().toISOString(), teams, runtimes, models }
  }

  async getBusinessCapabilityCatalog(): Promise<EnterpriseBusinessCapabilityCatalog> {
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有开发中心权限')
    if (!this.forgeToken) throw new Error('请重新登录以读取 Forge 业务能力')
    const { response, snapshot } = await this.authenticatedFetch(new URL('/api/v1/meta/actions', this.forgeUrl), 'forge', {
      headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000),
    }, generation)
    if (response.status === 401) { await response.body?.cancel(); await this.signOutIfCurrent(snapshot); throw new Error('登录已失效，请重新登录') }
    if (response.status === 403) {
      const denied = record(await response.json().catch(() => undefined)), detail = record(denied?.error)
      this.assertCurrentAuth(snapshot)
      if (textValue(detail?.code) === 'PASSWORD_EXPIRED') throw new Error('Forge 账号密码已过期，请更新密码后重新登录')
      throw new Error('当前账号没有读取 Forge 业务能力的权限')
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Forge 业务能力读取失败（${response.status}）`) }
    const raw = await response.json()
    this.assertCurrentAuth(snapshot)
    const envelope = record(raw)
    const data = record(envelope?.data) ?? envelope
    const actions = Array.isArray(raw) ? raw : Array.isArray(data?.items) ? data.items : []
    const capabilities = actions.flatMap((value): EnterpriseBusinessCapability[] => {
      const action = record(value), ai = record(action?.ai)
      const actionName = textValue(action?.name), objectName = textValue(action?.objectName) ?? textValue(action?.object)
      if (ai?.exposed !== true || !actionName || !objectName || objectName.startsWith('sys_')) return []
      const params = businessCapabilityParams(action?.params)
      return [{
        id: `forge:action:${objectName}.${actionName}`,
        name: textValue(action?.label) ?? textValue(ai?.description) ?? actionName,
        description: textValue(ai?.description) ?? textValue(action?.label) ?? actionName,
        effect: 'write', resourceType: objectName, requiresEmployeeIntent: true, status: 'available',
        actionName, objectName, requiresRecord: action?.requiresRecord !== false,
        requiresConfirmation: ai?.requiresConfirmation === true, params,
      }]
    })
    this.assertCurrentAuth(snapshot)
    return { version: '1', provider: { id: 'forge', name: 'Forge 业务环境', status: 'available' }, capabilities, refreshedAt: new Date().toISOString() }
  }

  async getBusinessCapabilities(allowedIds?: string[]): Promise<EnterpriseBusinessCapability[]> {
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!this.forgeToken) throw new Error('请重新登录以读取 Forge 业务能力')
    const { response, snapshot } = await this.authenticatedFetch(new URL('/api/v1/mcp', this.forgeUrl), 'forge', {
      method: 'POST',
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'business-capability-catalog', method: 'tools/call', params: { name: 'list_actions', arguments: {} } }),
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    }, generation)
    const raw = await response.text()
    this.assertCurrentAuth(snapshot)
    if (response.status === 401) {
      await this.signOutIfCurrent(snapshot)
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
    const allow = allowedIds ? new Set(allowedIds) : undefined
    const capabilities = actions.flatMap((value): EnterpriseBusinessCapability[] => {
      const action = record(value), actionName = textValue(action?.name), objectName = textValue(action?.objectName)
      if (!actionName || !objectName) return []
      const id = `forge:action:${objectName}.${actionName}`
      if (allow && !allow.has(id)) return []
      return [{
        id,
        name: textValue(action?.label) ?? textValue(action?.description) ?? actionName,
        description: textValue(action?.description) ?? textValue(action?.label) ?? actionName,
        effect: 'write', resourceType: objectName, requiresEmployeeIntent: true, status: 'available', requiresRecord: action?.requiresRecord !== false,
        actionName, objectName, requiresConfirmation: action?.requiresConfirmation === true, params: businessCapabilityParams(action?.params),
      }]
    })
    this.assertCurrentAuth(snapshot)
    return capabilities
  }

  async findBusinessRecords(objectNames: string[], workSummary: string): Promise<Array<{ objectName: string; recordId: string; name: string; code?: string }>> {
    const requested = [...new Set(objectNames)].filter((name) => /^[a-z][a-z0-9_]{1,127}$/.test(name) && !name.startsWith('sys_'))
    if (!requested.length) return []
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    const terms = [...new Set(workSummary.toLowerCase().split(/[\s，。；、：,.!?！？（）()《》“”"'\-_/]+/).map((value) => value.trim()).filter((value) => value.length >= 2))]
    const matches: Array<{ objectName: string; recordId: string; name: string; code?: string; score: number; updatedAt: string }> = []
    for (const objectName of requested) {
      const payload = record(await this.forgeJSON(`/api/v1/data/${encodeURIComponent(objectName)}?$top=100`, generation))
      const rows = Array.isArray(payload?.records) ? payload.records : Array.isArray(record(payload?.data)?.records) ? record(payload?.data)?.records as unknown[] : []
      for (const value of rows) {
        const row = record(value), recordId = textValue(row?.id), name = textValue(row?.name) ?? textValue(row?.title), code = textValue(row?.code)
        if (!row || !recordId || !name) continue
        const haystack = [name, code, textValue(row.customer_po_number), textValue(row.remarks)].filter(Boolean).join(' ').toLowerCase()
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? Math.max(2, term.length) : 0), 0)
        matches.push({ objectName, recordId, name, ...(code ? { code } : {}), score, updatedAt: textValue(row.updated_at) ?? textValue(row.created_at) ?? '' })
      }
    }
    const ranked = matches.sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    const positive = ranked.filter((item) => item.score > 0)
    this.assertAuthGeneration(generation)
    return positive.slice(0, 10).map(({ score: _score, updatedAt: _updatedAt, ...item }) => item)
  }

  async createDevelopmentTeam(input: EnterpriseCreateTeamInput): Promise<EnterpriseCreateTeamResult> {
    const name = input?.name?.trim()
    const objective = input?.objective?.trim()
    if (input?.version !== '1' || !name || name.length > 80 || !objective || objective.length > 2_000) throw new Error('请填写团队名称和目标')
    const { session, generation } = await this.sessionSnapshot()
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
      }, undefined, undefined, generation)).body)
      const leadID = textValue(lead?.id)
      if (!leadID) throw new Error('Weave 没有返回团队负责人')
      createdAgents.push(leadName)

      const worker = record((await this.weaveRequest('/v1/agents', 'POST', {
        name: workerName, display_name: '执行成员', role: 'worker', engine: 'loom', graph_type: 'standard',
        spec: { system_prompt: `围绕“${objective}”完成分配的工作，并返回可核验结果。` },
      }, undefined, undefined, generation)).body)
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
      }, undefined, undefined, generation)).body)
      const id = textValue(result?.id)
      if (!id) throw new Error('Weave 没有返回新团队')
      return { id, name: textValue(result?.display_name) ?? name, objective: textValue(result?.objective) ?? objective }
    } catch (error) {
      await Promise.allSettled(createdAgents.map((agentName) => this.deleteWeaveResource(`/v1/agents/${encodeURIComponent(agentName)}`, generation)))
      throw error
    }
  }

  async updateDevelopmentTeam(input: EnterpriseUpdateTeamInput): Promise<void> {
    const name = input?.name?.trim(), objective = input?.objective?.trim()
    if (input?.version !== '1' || !input.teamId || !name || name.length > 80 || !objective || objective.length > 2_000 || !input.expectedUpdatedAt) throw new Error('团队资料不完整')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    await this.weaveRequest(`/v1/teams/${encodeURIComponent(input.teamId)}/profile`, 'PUT', { display_name: name, objective, expected_updated_at: input.expectedUpdatedAt }, undefined, undefined, generation)
  }

  async createDevelopmentTeamMember(input: EnterpriseCreateTeamMemberInput): Promise<EnterpriseTeamMemberMutationResult> {
    const name = input?.name?.trim(), duty = input?.duty?.trim()
    if (input?.version !== '1' || !input.teamId || !name || name.length > 80 || !duty || duty.length > 2_000) throw new Error('请填写成员名称和职责')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    const agentName = `team-member-${randomUUID()}`
    const created = record((await this.weaveRequest('/v1/agents', 'POST', {
      name: agentName, display_name: name, role: 'worker', engine: 'loom', graph_type: 'standard',
      spec: { system_prompt: duty },
    }, undefined, undefined, generation)).body)
    const agentID = textValue(created?.id)
    if (!agentID) throw new Error('Weave 没有返回新成员')
    try {
      await this.weaveRequest(`/v1/teams/${encodeURIComponent(input.teamId)}/workers`, 'POST', {
        worker_agent_id: agentID, duty, when_to_use: '负责人分配相关工作时', context_instruction: '保留任务上下文和材料来源。',
        allowed_kinds: ['consult', 'dispatch', 'handoff'], default_kind: 'dispatch', result_requirement: '返回可核验结果',
      }, undefined, undefined, generation)
    } catch (error) {
      await this.deleteWeaveResource(`/v1/agents/${encodeURIComponent(agentName)}`, generation)
      throw error
    }
    return { id: agentID, name }
  }

  async removeDevelopmentTeamMember(teamId: string, memberId: string): Promise<void> {
    if (!teamId || !memberId) throw new Error('请选择要移出的成员')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    await this.weaveRequest(`/v1/teams/${encodeURIComponent(teamId)}/workers/${encodeURIComponent(memberId)}`, 'DELETE', undefined, undefined, undefined, generation)
  }

  async createDevelopmentWorkflow(input: EnterpriseCreateWorkflowInput): Promise<EnterpriseCreateWorkflowResult> {
    const name = input?.name?.trim()
    const description = input?.description?.trim()
    if (input?.version !== '1' || !input.teamId || !input.leadId || !input.workerId || !name || name.length > 80 || !description || description.length > 2_000) throw new Error('请填写流程名称和用途')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程配置权限')
    const [lead, worker] = await Promise.all([
      this.getTeamMemberConfigDraft(input.teamId, input.leadId, generation),
      this.getTeamMemberConfigDraft(input.teamId, input.workerId, generation),
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
    }, undefined, undefined, generation)).body)
    const workflow = record(result?.workflow), draft = record(result?.draft)
    const id = textValue(workflow?.id), workflowName = textValue(workflow?.name), draftVersion = numberValue(draft?.version)
    if (!id || !workflowName || !draftVersion) throw new Error('Weave 没有返回新流程')
    return { id, name: workflowName, draftVersion }
  }

  async updateDevelopmentWorkflowDraft(input: EnterpriseUpdateWorkflowDraftInput): Promise<EnterpriseUpdateWorkflowDraftResult> {
    if (input?.version !== '1' || !input.workflowId || !Number.isInteger(input.draftVersion) || input.draftVersion < 1 || !input.expectedUpdatedAt || !record(input.triggerConfig) || !workflowDefinition(input.graphDefinition)) throw new Error('流程草稿无效')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程配置权限')
    const result = record((await this.weaveRequest(`/v1/workflows/${encodeURIComponent(input.workflowId)}/versions/${input.draftVersion}`, 'PUT', {
      expected_updated_at: input.expectedUpdatedAt,
      trigger_config: input.triggerConfig,
      graph_definition: input.graphDefinition,
    }, undefined, undefined, generation)).body)
    const updatedAt = textValue(result?.updated_at), draftVersion = numberValue(result?.version)
    if (!updatedAt || !draftVersion) throw new Error('Weave 没有返回流程草稿')
    return { draftVersion, updatedAt }
  }

  async createDevelopmentWorkflowDraft(workflowId: string): Promise<EnterpriseUpdateWorkflowDraftResult> {
    if (!workflowId) throw new Error('流程无效')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程配置权限')
    const result = record((await this.weaveRequest(`/v1/workflows/${encodeURIComponent(workflowId)}/drafts`, 'POST', {}, undefined, undefined, generation)).body)
    const updatedAt = textValue(result?.updated_at), draftVersion = numberValue(result?.version)
    if (!updatedAt || !draftVersion) throw new Error('Weave 没有返回新版本草稿')
    return { draftVersion, updatedAt }
  }

  async validateDevelopmentWorkflow(workflowId: string, version: number): Promise<EnterpriseWorkflowValidation> {
    if (!workflowId || !Number.isInteger(version) || version < 1) throw new Error('流程版本无效')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程配置权限')
    const result = record((await this.weaveRequest(`/v1/workflows/${encodeURIComponent(workflowId)}/versions/${version}/validate`, 'POST', {}, undefined, undefined, generation)).body)
    if (typeof result?.valid !== 'boolean' || !Array.isArray(result.issues)) throw new Error('Weave 返回了无法识别的检查结果')
    return { valid: result.valid, issues: result.issues.flatMap((value) => {
      const issue = record(value), code = textValue(issue?.code), message = textValue(issue?.message)
      if (!code || !message) return []
      return [{ code, message, ...(textValue(issue?.node_id) ? { nodeId: textValue(issue?.node_id) } : {}) }]
    }) }
  }

  async publishDevelopmentWorkflow(workflowId: string, version: number): Promise<void> {
    if (!workflowId || !Number.isInteger(version) || version < 1) throw new Error('流程版本无效')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程发布权限')
    await this.weaveRequest(`/v1/workflows/${encodeURIComponent(workflowId)}/versions/${version}/publish`, 'POST', {}, undefined, undefined, generation)
  }

  async archiveDevelopmentWorkflow(workflowId: string): Promise<void> {
    if (!workflowId) throw new Error('流程无效')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有流程归档权限')
    await this.weaveRequest(`/v1/workflows/${encodeURIComponent(workflowId)}`, 'DELETE', undefined, undefined, undefined, generation)
  }

  async getTeamMemberConfigDraft(teamId: string, agentId: string, expectedGeneration = this.authGeneration): Promise<EnterpriseTeamMemberConfigDraft> {
    this.assertAuthGeneration(expectedGeneration)
    const session = await this.getSession()
    this.assertAuthGeneration(expectedGeneration)
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    return teamMemberConfigDraft(await this.weaveJSON(`/v1/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(agentId)}/config-draft`, expectedGeneration))
  }

  async saveTeamMemberConfigDraft(draft: EnterpriseTeamMemberConfigDraft): Promise<EnterpriseTeamMemberConfigDraft> {
    if (!draft?.teamId || !draft.agentId || !Number.isInteger(draft.revision) || !draft.configuration?.displayName?.trim()) throw new Error('团队成员配置不完整')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in' || !session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
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
        business_capability_bindings: draft.configuration.businessCapabilityBindings.map((binding) => ({ capability_id: binding.capabilityId, parameters: binding.parameters })),
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
    }, undefined, undefined, generation)
    return teamMemberConfigDraft(result.body)
  }

  async applyTeamMemberConfigDraft(teamId: string, agentId: string, revision: number): Promise<EnterpriseTeamMemberConfigDraft> {
    if (!teamId || !agentId || !Number.isInteger(revision) || revision < 1) throw new Error('请选择要应用的成员草稿')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (!session.permissions?.includes('teams:develop')) throw new Error('当前账号没有团队配置权限')
    const result = await this.weaveRequest(`/v1/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(agentId)}/config-draft/apply`, 'POST', { revision }, undefined, undefined, generation)
    return teamMemberConfigDraft(result.body)
  }

  private async weaveRequest(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, assertCurrent?: () => Promise<void>, extraHeaders?: HeadersInit, expectedGeneration = this.authGeneration): Promise<{ status: number; body: unknown }> {
    const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' })
    if (extraHeaders) for (const [name, value] of new Headers(extraHeaders)) headers.set(name, value)
    this.assertAuthGeneration(expectedGeneration)
    await assertCurrent?.()
    const { response, snapshot } = await this.authenticatedFetch(new URL(path, this.weaveUrl), 'weave', {
      method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15_000),
    }, expectedGeneration)
    const result = await response.json().catch(() => undefined)
    this.assertCurrentAuth(snapshot)
    if (response.status === 401 || response.status === 403) {
      await this.signOutIfCurrent(snapshot)
      throw new Error('登录已失效，请重新登录')
    }
    if (!response.ok) {
      const error = textValue(record(result)?.error) ?? textValue(record(result)?.message) ?? `Weave 请求失败（${response.status}）`
      throw new Error(error)
    }
    return { status: response.status, body: result }
  }

  private async deleteWeaveResource(path: string, expectedGeneration = this.authGeneration): Promise<void> {
    const { response, snapshot } = await this.authenticatedFetch(new URL(path, this.weaveUrl), 'weave', { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(8_000) }, expectedGeneration)
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      await this.signOutIfCurrent(snapshot)
      throw new Error('登录已失效，请重新登录')
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Weave 删除失败（${response.status}）`) }
    await response.body?.cancel()
    this.assertCurrentAuth(snapshot)
  }

  private async workProjectID(expectedGeneration = this.authGeneration): Promise<string> {
    this.assertAuthGeneration(expectedGeneration)
    const session = await this.getSession()
    this.assertAuthGeneration(expectedGeneration)
    const subject = session.user?.weaveUserId ?? session.user?.id
    if (session.status !== 'signed-in' || !subject) throw new Error('请先登录')
    return `workbench-${subject}`
  }

  async accountKey(expectedGeneration = this.authGeneration): Promise<string> {
    this.assertAuthGeneration(expectedGeneration)
    const session = await this.getSession()
    this.assertAuthGeneration(expectedGeneration)
    return this.accountKeyForSession(session)
  }

  async getTeamCatalog(expectedGeneration = this.authGeneration): Promise<TeamSummary[]> { return teamCatalog(await this.weaveJSON('/v1/teams?status=active', expectedGeneration)) }
  async getTeamChoices(team: TeamSummary, expectedGeneration = this.authGeneration): Promise<EnterpriseWorkChoice[]> {
    return teamChoices(team, await this.weaveJSON(`/v1/teams/${encodeURIComponent(team.id)}/workflows`, expectedGeneration))
  }

  async getWorkOverview(): Promise<EnterpriseWorkOverview> {
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    const teams = await this.getTeamCatalog(generation)
    const choices = (await Promise.all(teams.map((team) => this.getTeamChoices(team, generation)))).flat()
    const projectID = await this.workProjectID(generation)
    const [rawRuns, rawTasks, rawNotifications, rawApprovals] = await Promise.all([
      this.weaveJSON(`/v1/runs?project_id=${encodeURIComponent(projectID)}&limit=50`, generation),
      this.weaveJSON('/v1/human-tasks?limit=50', generation),
      this.forgeJSON('/api/v1/notifications?limit=200', generation),
      this.forgeOptionalJSON('/api/v1/approvals/requests?limit=50', generation),
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
    const approvalEnvelope = record(rawApprovals)
    const approvalValues = Array.isArray(rawApprovals) ? rawApprovals
      : Array.isArray(approvalEnvelope?.requests) ? approvalEnvelope.requests
        : Array.isArray(approvalEnvelope?.data) ? approvalEnvelope.data : []
    for (const value of approvalValues) {
      const approval = record(value), viewer = record(approval?.viewer), payload = record(approval?.payload)
      const id = textValue(approval?.id), status = textValue(approval?.status), updatedAt = textValue(approval?.updated_at) ?? textValue(approval?.created_at)
      const canDecide = status === 'pending' && viewer?.can_act === true
      const canResubmit = status === 'returned' && viewer?.is_submitter === true
      if (!id || !updatedAt || (!canDecide && !canResubmit)) continue
      let returnReason: string | undefined
      if (canResubmit) {
        const actionEnvelope = record(await this.forgeJSON(`/api/v1/approvals/requests/${encodeURIComponent(id)}/actions`, generation))
        const actions = Array.isArray(actionEnvelope?.data) ? actionEnvelope.data : []
        const latestRevision = [...actions].reverse().map(record).find((action) => action?.action === 'revise')
        returnReason = textValue(latestRevision?.comment)
      }
      const processName = textValue(approval?.process_label) ?? textValue(approval?.process_name) ?? '业务审批'
      const stepName = textValue(approval?.step_label) ?? textValue(approval?.current_step)
      const recordTitle = textValue(approval?.record_title)
      tasks.push({
        interactionId: id, runId: `forge:${canResubmit ? 'revision' : 'approval'}:${id}`,
        teamId: 'forge', workflowId: 'business-approval', workflowVersion: 1,
        title: canResubmit ? `${recordTitle ?? processName}需要修改` : (recordTitle ? `${recordTitle} · ${stepName ?? processName}` : stepName ?? processName),
        instructions: canResubmit ? returnReason ? `退回原因：${returnReason}` : '请根据审批意见修改业务材料，完成后重新提交。' : '请核对业务材料并给出审批意见。',
        updatedAt, source: 'forge', mode: canResubmit ? 'revision' : 'approval',
        ...(textValue(payload?.submitted_material_name) ?? textValue(approval?.object_label) ? { materialLabel: textValue(payload?.submitted_material_name) ?? textValue(approval?.object_label) } : {}),
      })
    }
    const notificationEnvelope = record(rawNotifications)
    const notificationList = record(notificationEnvelope?.data) ?? notificationEnvelope
    const items = (Array.isArray(notificationList?.notifications) ? notificationList.notifications : []).flatMap((value): EnterpriseWorkItem[] => {
      const notification = record(value), data = record(notification?.data), continuation = record(data?.continuation), material = record(data?.material)
      const id = textValue(notification?.id), title = textValue(notification?.title), createdAt = textValue(notification?.createdAt) ?? textValue(notification?.created_at)
      if (!id || !title || !createdAt) return []
      const requestedKind = textValue(data?.kind)
      const notificationType = textValue(notification?.type) ?? ''
      const kind: EnterpriseWorkItem['kind'] = requestedKind === 'revision_required' || requestedKind === 'human_review' || requestedKind === 'failure' || requestedKind === 'result'
        ? requestedKind : notificationType.includes('revision_required') ? 'revision_required' : notificationType.includes('failure') || notificationType.includes('error') ? 'failure' : 'result'
      const actionable = kind === 'revision_required' || kind === 'human_review'
      const displayTitle = /[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(title)
        ? kind === 'failure' ? '团队处理失败' : kind === 'revision_required' ? '团队工作需要修改' : kind === 'human_review' ? '需要人工处理' : '团队工作已完成'
        : title
      const statusValue = textValue(data?.status)
      const status: EnterpriseWorkItem['status'] = statusValue === 'pending' || statusValue === 'in_progress' || statusValue === 'completed' || statusValue === 'cancelled'
        ? statusValue : notification?.read === true ? 'completed' : actionable ? 'pending' : 'unread'
      const returnTarget = textValue(continuation?.returnTarget)
      const reviewScope = textValue(continuation?.reviewScope)
      return [{
        id, kind, title: displayTitle, status, actionable, read: notification?.read === true,
        source: textValue(data?.source) === 'weave' || notificationType.startsWith('weave.') ? 'weave' : 'forge', createdAt,
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
    }).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    const runList = record(rawRuns)
    this.assertAuthGeneration(generation)
    return { loadedAt: new Date().toISOString(), choices, tasks, items, runs: (Array.isArray(runList?.runs) ? runList.runs : []).flatMap((run) => runObservation(run) ?? []) }
  }

  async getApprovalContext(approvalId: string): Promise<EnterpriseApprovalContext> {
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in' || !this.forgeToken) throw new Error('请先登录')
    const { response, snapshot } = await this.authenticatedFetch(
      new URL(`/api/v1/approvals/requests/${encodeURIComponent(approvalId)}/workbench-context`, this.forgeUrl),
      'forge', { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, generation,
    )
    try { this.assertCurrentAuth(snapshot) }
    catch (error) { await response.body?.cancel(); throw error }
    if (response.status === 401) {
      await response.body?.cancel()
      await this.signOutIfCurrent(snapshot)
      throw new Error('登录已失效，请重新登录')
    }
    if (response.status === 403 || response.status === 404) {
      await response.body?.cancel()
      throw new Error('这项审批已无法由当前员工处理，请刷新待办')
    }
    if (response.status === 409) {
      await response.body?.cancel()
      throw new Error('审批状态已变化，请刷新待办')
    }
    if (response.status === 413) {
      await response.body?.cancel()
      throw new Error('审批材料过大，请在 Forge 中查看')
    }
    if (response.status === 415) {
      const code = await responseErrorCode(response)
      this.assertCurrentAuth(snapshot)
      throw new Error(code === 'APPROVAL_MATERIAL_UNSUPPORTED_TYPE'
        ? '此审批材料格式暂不支持桌面预览，请在 Forge 中查看'
        : '审批材料暂时无法读取，请刷新待办')
    }
    if (response.status === 422) {
      const code = await responseErrorCode(response)
      this.assertCurrentAuth(snapshot)
      const message = code === 'APPROVAL_MATERIAL_HASH_MISMATCH'
        ? '审批材料与本次提交版本不一致，请暂停处理并刷新待办'
        : code === 'APPROVAL_MATERIAL_HASH_UNAVAILABLE'
          ? '审批记录没有可核验的材料摘要，请在 Forge 中查看'
          : code === 'APPROVAL_MATERIAL_INVALID'
            ? '审批材料无法安全校验，请在 Forge 中查看'
            : code === 'APPROVAL_MATERIAL_UNAVAILABLE'
              ? '审批材料当前不可用，请在 Forge 中查看'
              : code === 'APPROVAL_CONTEXT_TOO_LARGE'
                ? '审批内容过大，暂不能在桌面中预览，请在 Forge 中查看'
                : '审批材料暂时无法安全读取，请刷新待办'
      throw new Error(message)
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('Forge 审批上下文暂时无法读取')
    }
    let rawContext: unknown
    try { rawContext = await response.json() }
    catch {
      this.assertCurrentAuth(snapshot)
      throw new Error('Forge 审批上下文格式无效')
    }
    this.assertCurrentAuth(snapshot)
    const approval = record(rawContext)
    const isReviewer = approval?.status === 'pending' && approval.viewer === 'current_approver'
    const isSubmitter = approval?.status === 'returned' && approval.viewer === 'original_submitter'
    const title = textValue(approval?.title), step = textValue(approval?.step)
    if (approval?.version !== '1' || approval.requestId !== approvalId || (!isReviewer && !isSubmitter)
      || !title || title.length > 300 || !step || step.length > 160) {
      throw new Error('这项审批已无法由当前员工处理，请刷新待办')
    }
    if (!Array.isArray(approval.fields) || approval.fields.length > 64 || !Array.isArray(approval.files) || approval.files.length > 11) {
      throw new Error('Forge 审批上下文格式无效')
    }
    const fields = approval.fields.flatMap((value) => {
      const field = record(value), label = textValue(field?.label), fieldValue = field?.value
      if (!label || label.length > 160 || typeof fieldValue !== 'string' || fieldValue.length > 4000) {
        throw new Error('Forge 审批上下文格式无效')
      }
      return fieldValue.trim() ? [{ label, value: fieldValue }] : []
    })
    const files = approval.files.map((value) => {
      const file = record(value), name = textValue(file?.name), content = file?.content
      if (!name || name.length > 255 || file?.mediaType !== 'text/plain; charset=utf-8'
        || typeof content !== 'string' || content.length > 2 * 1024 * 1024
        || !Number.isInteger(file.bytes) || (file.bytes as number) < 0 || (file.bytes as number) > 2 * 1024 * 1024
        || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) {
        throw new Error('审批文件校验信息无效')
      }
      const bytes = Buffer.from(content, 'utf8')
      if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
        throw new Error('审批文件与提交版本不一致，请暂停处理')
      }
      return { name, content, verified: true }
    })
    const returnReason = approval.returnReason
    if (returnReason !== undefined && (typeof returnReason !== 'string' || returnReason.length > 4000)) {
      throw new Error('Forge 审批上下文格式无效')
    }
    return {
      title, step,
      ...(isSubmitter && returnReason ? { returnReason } : {}),
      fields, files,
    }
  }

  async submitWork(choice: EnterpriseWorkChoice, goal: string, source?: {
    idempotencySeed: string
    sessionKey: string
    sourceMessages: Array<{ messageId: string; eventSeq: number; sha256: string }>
    accountKey: string
    resources: EnterpriseWorkResource[]
    businessContext?: { objectName: string; recordId: string }
    authorizedBusinessCapabilityIds: string[]
    assertCurrent(): Promise<void>
  }): Promise<EnterpriseWorkReceipt> {
    const normalized = goal.trim()
    if (!normalized || !choice?.teamId || !choice.workflowId || !Number.isInteger(choice.version) || choice.version < 1) throw new Error('工作内容或团队流程无效')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    const assertCurrent = async () => {
      this.assertAuthGeneration(generation)
      if (source) {
        if (await this.accountKey(generation) !== source.accountKey) throw new Error('当前账号已变化，本次交接已失效')
        await source.assertCurrent()
      }
    }
    await assertCurrent()
    const projectID = await this.workProjectID(generation)
    const workId = source
      ? submissionUUID(`${source.accountKey}:${source.idempotencySeed}`)
      : randomUUID()
    const workbenchSessionID = source ? `${projectID}-${source.sessionKey}-${workId}` : `${projectID}-${workId}`
    const registered = await this.weaveRequest('/v1/workbench/dispatch-inputs', 'POST', {
      registration_id: workId, workbench_session_id: workbenchSessionID, team_id: choice.teamId, workflow_id: choice.workflowId,
      workflow_version: choice.version, project_id: projectID, task: normalized,
      resources: source?.resources,
      ...(source?.businessContext ? { business_record: { object_name: source.businessContext.objectName, record_id: source.businessContext.recordId } } : {}),
      authorized_business_capability_ids: source?.authorizedBusinessCapabilityIds ?? [],
      source_messages: source?.sourceMessages.map((message) => ({ message_id: message.messageId, event_seq: message.eventSeq, sha256: message.sha256 }))
        ?? [{ message_id: workId, event_seq: 0, sha256: createHash('sha256').update(normalized).digest('hex') }],
    }, assertCurrent, this.forgeToken ? { 'X-Weave-Forge-Authorization': `Bearer ${this.forgeToken}` } : undefined, generation)
    const registration = record(registered.body)
    const inputRevisionID = textValue(registration?.input_revision_id), clientRequestID = textValue(registration?.client_request_id)
    if (!inputRevisionID || !clientRequestID || registration?.task_sha256 !== createHash('sha256').update(normalized).digest('hex')) throw new Error('Weave 输入回执与本次固定材料不一致，结果待核对')
    const dispatched = await this.weaveRequest(`/v1/teams/${encodeURIComponent(choice.teamId)}/dispatch`, 'POST', { input_revision_id: inputRevisionID, client_request_id: clientRequestID }, assertCurrent, undefined, generation)
    const result = record(dispatched.body)
    const runId = textValue(result?.run_id), taskId = textValue(result?.task_id), workflowId = textValue(result?.workflow_id)
    const workflowVersion = numberValue(result?.workflow_version)
    if (!runId || !taskId || workflowId !== choice.workflowId || workflowVersion !== choice.version) throw new Error('Weave 没有返回匹配的接单回执，结果待核对')
    return { workId, runId, taskId, workflowId, workflowVersion, inputRevisionId: inputRevisionID, clientRequestId: clientRequestID, taskSha256: registration.task_sha256 as string, repeated: dispatched.status === 200 }
  }

  async completeHumanTask(task: Pick<EnterpriseHumanTask, 'runId' | 'interactionId'>, payload: Record<string, unknown>): Promise<{ runId: string; repeated: boolean }> {
    if (!textValue(task?.runId) || !textValue(task?.interactionId) || !record(payload)) throw new Error('待办信息无效')
    const { session, generation } = await this.sessionSnapshot()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    const forgeMatch = /^forge:(approval|revision):(.+)$/.exec(task.runId)
    if (forgeMatch) {
      if (forgeMatch[2] !== task.interactionId) throw new Error('审批事项已变化，请刷新后重试')
      const decision = textValue(payload.decision)
      const operation = forgeMatch[1] === 'revision' ? 'resubmit' : decision === 'rejected' ? 'revise' : decision === 'approved' ? 'approve' : ''
      if (!operation) throw new Error('请选择审批处理方式')
      await this.forgeRequest(`/api/v1/approvals/requests/${encodeURIComponent(task.interactionId)}/${operation}`, { comment: textValue(payload.comment) ?? '' }, generation)
      return { runId: task.runId, repeated: false }
    }
    const result = await this.weaveRequest(`/v1/human-tasks/${encodeURIComponent(task.runId)}/complete`, 'POST', {
      interaction_id: task.interactionId, payload, idempotency_key: `workbench-human-${task.interactionId}`,
    }, undefined, undefined, generation)
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
