import type { EnterpriseDevelopmentOverview, EnterpriseEnvironmentStatus, EnterpriseRole, EnterpriseRunObservation, EnterpriseSession, EnterpriseTeamMember, EnterpriseTeamObservation, EnterpriseWorkflowObservation } from '../../src/types/api'
import { readFile, unlink, writeFile } from 'node:fs/promises'

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

function role(value: unknown): EnterpriseRole | undefined {
  return value === 'member' || value === 'developer' || value === 'admin' ? value : undefined
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
    return [{ from, to, ...(textValue(source?.label) ? { label: textValue(source?.label) } : {}) }]
  }) : []
  return { nodes, edges }
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
      if (saved?.version !== 1 || typeof saved.token !== 'string' || typeof saved.expiresAt !== 'number' || projection?.status !== 'signed-in') return
      if (saved.expiresAt <= Date.now()) { await unlink(this.sessionPath).catch(() => undefined); return }
      this.weaveToken = this.sessionCodec.decrypt(Buffer.from(saved.token, 'base64'))
      this.expiresAt = saved.expiresAt
      this.session = { ...projection, storage: 'encrypted' }
    } catch { /* missing, malformed, or undecryptable sessions start signed out */ }
  }

  private async persist(): Promise<void> {
    if (!this.sessionPath || !this.sessionCodec?.available() || !this.session || !this.weaveToken) return
    const saved = JSON.stringify({ version: 1, expiresAt: this.expiresAt, token: this.sessionCodec.encrypt(this.weaveToken).toString('base64'), session: { ...this.session, storage: 'encrypted' } })
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
      const weaveRole = role(subject?.role)
      if (typeof weave?.token !== 'string' || typeof subject?.id !== 'string' || typeof organization?.id !== 'string' || !weaveRole) {
        throw new Error('Weave 返回了无法识别的账号绑定结果')
      }
      this.weaveToken = weave.token
      this.expiresAt = Date.now() + (typeof weave.expiresIn === 'number' && weave.expiresIn > 0 ? Math.min(weave.expiresIn, 8 * 60 * 60) : 8 * 60 * 60) * 1000
      this.session = {
        version: '1', status: 'signed-in',
        environment: { origin: this.forgeUrl.origin, secure: this.forgeUrl.protocol === 'https:' }, storage: 'session-only',
        identitySource: { kind: 'forge-account', issuer: this.forgeUrl.origin },
        user: {
          id: typeof subject.externalId === 'string' ? subject.externalId : forgeUser.id,
          name: typeof subject.name === 'string' && subject.name.trim() ? subject.name : typeof forgeUser.name === 'string' && forgeUser.name.trim() ? forgeUser.name : normalizedEmail,
          email: typeof subject.email === 'string' && subject.email.trim() ? subject.email : typeof forgeUser.email === 'string' && forgeUser.email.trim() ? forgeUser.email : normalizedEmail,
        },
        organization: { id: organization.id, name: typeof organization.name === 'string' && organization.name.trim() ? organization.name : organization.id },
        role: weaveRole,
      }
      await this.persist()
      return await this.getSession()
    } catch (error) {
      this.weaveToken = undefined
      this.session = undefined
      if (error instanceof Error && !['fetch failed', 'The operation was aborted due to timeout'].includes(error.message)) throw error
      throw new Error('企业服务暂时无法连接')
    }
  }

  async signOut(): Promise<EnterpriseSession> {
    this.weaveToken = undefined
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

  async getDevelopmentOverview(): Promise<EnterpriseDevelopmentOverview> {
    const session = await this.getSession()
    if (session.status !== 'signed-in') throw new Error('请先登录')
    if (session.role !== 'developer' && session.role !== 'admin') throw new Error('当前账号没有开发中心权限')
    const rawTeams = await this.weaveJSON('/v1/teams?include=roster,summary&status=all')
    if (!Array.isArray(rawTeams)) throw new Error('Weave 返回了无法识别的团队列表')
    const teams = await Promise.all(rawTeams.map(async (item): Promise<EnterpriseTeamObservation> => {
      const source = record(item)
      const team = record(source?.team)
      const id = textValue(team?.id)
      const name = textValue(team?.display_name) ?? textValue(team?.name)
      const status = textValue(team?.status)
      if (!id || !name || !status) throw new Error('Weave 返回了无法识别的团队')
      const [rawWorkflows, rawRuns] = await Promise.all([
        this.weaveJSON(`/v1/teams/${encodeURIComponent(id)}/workflows`),
        this.weaveJSON(`/v1/runs?owning_team_id=${encodeURIComponent(id)}&limit=12`),
      ])
      const workflowList = record(rawWorkflows)
      const workflows = await Promise.all((Array.isArray(workflowList?.workflows) ? workflowList.workflows : []).map(async (item): Promise<EnterpriseWorkflowObservation> => {
        const row = record(item)
        const workflowID = textValue(row?.id)
        const workflowName = textValue(row?.name)
        const workflowStatus = textValue(row?.status)
        if (!workflowID || !workflowName || !workflowStatus) throw new Error('Weave 返回了无法识别的工作流')
        const publishedVersion = numberValue(row?.published_version)
        const draftVersion = numberValue(row?.draft_version)
        const inspectedVersion = publishedVersion ?? draftVersion
        let graph = { nodes: [], edges: [] } as Pick<EnterpriseWorkflowObservation, 'nodes' | 'edges'>
        if (inspectedVersion) {
          const rawVersion = record(await this.weaveJSON(`/v1/workflows/${encodeURIComponent(workflowID)}/versions/${inspectedVersion}`))
          graph = workflowGraph(rawVersion?.graph_definition)
        }
        const trigger = record(row?.trigger_summary)
        const latest = record(row?.latest_run)
        return {
          id: workflowID, name: workflowName, status: workflowStatus, ...graph,
          ...(textValue(row?.description) ? { description: textValue(row?.description) } : {}),
          ...(publishedVersion ? { publishedVersion } : {}), ...(draftVersion ? { draftVersion } : {}), ...(inspectedVersion ? { inspectedVersion } : {}),
          ...(textValue(trigger?.type) ? { triggerType: textValue(trigger?.type) } : {}), ...(textValue(latest?.run_id) ? { latestRunId: textValue(latest?.run_id) } : {}),
        }
      }))
      const runList = record(rawRuns)
      const summary = record(source?.summary)
      const health = record(summary?.health)
      return {
        id, name, status, workflows,
        workers: (Array.isArray(source?.workers) ? source.workers : []).flatMap((value) => member(value) ?? []),
        runs: (Array.isArray(runList?.runs) ? runList.runs : []).flatMap((value) => runObservation(value) ?? []),
        ...(textValue(team?.objective) ? { objective: textValue(team?.objective) } : {}), ...(textValue(team?.evaluation) ? { evaluation: textValue(team?.evaluation) } : {}),
        ...(member(source?.lead) ? { lead: member(source?.lead) } : {}),
        ...(summary ? { summary: {
          workerCount: numberValue(summary.worker_count) ?? 0, activeWorkflowCount: numberValue(summary.active_workflow_count) ?? 0,
          publishedWorkflowCount: numberValue(summary.published_workflow_count) ?? 0, ...(textValue(health?.conclusion) ? { health: textValue(health?.conclusion) } : {}),
          reasons: Array.isArray(health?.reason_codes) ? health.reason_codes.filter((value): value is string => typeof value === 'string') : [],
        } } : {}),
      }
    }))
    return { version: '1', loadedAt: new Date().toISOString(), teams }
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
