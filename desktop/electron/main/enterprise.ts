import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { PRODUCT_CAPABILITY_IDS } from '../../src/types/api'
import type { EnterpriseAccountState, EnterpriseEnvironmentStatus, ProductAccessState, ProductCapabilityDecision } from '../../src/types/api'

const DEFAULT_FORGE_URL = 'http://124.223.189.112'
const DEFAULT_WEAVE_URL = 'http://124.223.189.112:8080'
const REQUEST_TIMEOUT_MS = 8_000

interface EnterpriseSecretCodec {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

interface EnterpriseSessionFile { version: 1; origin: string; token: string }

interface EnterpriseServiceOptions {
  sessionPath?: string
  secretCodec?: EnterpriseSecretCodec
  fetch?: typeof fetch
  environment?: NodeJS.ProcessEnv
  oauthLogin?: (forge: URL) => Promise<string>
}

interface EnterpriseOAuthLoginOptions {
  openExternal(url: string): Promise<void>
  fetch?: typeof fetch
  timeoutMs?: number
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
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

function nestedRecord(value: unknown, ...keys: string[]): Record<string, unknown> | undefined {
  let current = record(value)
  for (const key of keys) current = record(current?.[key])
  return current
}

function collectRoles(value: unknown): string[] {
  const result = new Set<string>()
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128) result.add(candidate)
    else if (Array.isArray(candidate)) for (const item of candidate.slice(0, 100)) visit(item)
    else {
      const item = record(candidate)
      if (item) {
        const named = item.name ?? item.role ?? item.id
        if (named) visit(named)
        else for (const [key, allowed] of Object.entries(item).slice(0, 100)) if (allowed === true) visit(key)
      }
    }
  }
  const source = record(value)
  visit(source?.roles)
  visit(source?.permissions)
  visit(nestedRecord(value, 'data')?.roles)
  visit(nestedRecord(value, 'data')?.permissions)
  return [...result].slice(0, 100)
}

function responseMessage(value: unknown, fallback: string): string {
  const source = record(value)
  return boundedString(source?.message, 500) ?? boundedString(source?.error, 500) ?? fallback
}

function oauthEndpoint(value: unknown, label: string, forge: URL): URL {
  const raw = boundedString(value, 2048)
  if (!raw) throw new Error(`Forge 登录发现文档缺少 ${label}`)
  const endpoint = new URL(raw)
  if (endpoint.origin !== forge.origin) throw new Error(`Forge ${label} 不是受信任的同源地址`)
  return endpoint
}

async function listenForOAuthCallback(timeoutMs: number): Promise<{
  redirectUri: string
  wait(state: string): Promise<string>
  close(): Promise<void>
}> {
  let settle: ((value: string) => void) | undefined
  let reject: ((reason: Error) => void) | undefined
  let expectedState = ''
  const callback = new Promise<string>((resolve, rejectCallback) => { settle = resolve; reject = rejectCallback })
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (requested.pathname !== '/oauth/callback') { response.writeHead(404).end('Not found'); return }
    const error = requested.searchParams.get('error')
    const code = requested.searchParams.get('code')
    const state = requested.searchParams.get('state')
    response.writeHead(error || !code || state !== expectedState ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(error || !code || state !== expectedState
      ? '<!doctype html><meta charset="utf-8"><title>登录未完成</title><p>登录未完成，请返回 Weave Workbench 重试。</p>'
      : '<!doctype html><meta charset="utf-8"><title>登录完成</title><p>登录完成，可以关闭此页面并返回 Weave Workbench。</p>')
    if (error) reject?.(new Error('Forge 登录未完成'))
    else if (!code) reject?.(new Error('Forge 登录没有返回授权码'))
    else if (state !== expectedState) reject?.(new Error('Forge 登录状态校验失败'))
    else settle?.(code)
  })
  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => { server.off('error', rejectListen); resolve() })
  })
  const address = server.address() as AddressInfo
  const timer = setTimeout(() => reject?.(new Error('浏览器登录超时，请重试')), timeoutMs)
  timer.unref()
  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`,
    wait: async (state) => {
      expectedState = state
      try { return await callback } finally { clearTimeout(timer) }
    },
    close: async () => { clearTimeout(timer); await new Promise<void>((resolve) => server.close(() => resolve())) },
  }
}

export function createEnterpriseOAuthLogin(options: EnterpriseOAuthLoginOptions): (forge: URL) => Promise<string> {
  const request = options.fetch ?? fetch
  return async (forge) => {
    const discoveryResponse = await request(new URL('/.well-known/oauth-authorization-server', forge), {
      headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const discovery = record(await discoveryResponse.json().catch(() => undefined))
    if (!discoveryResponse.ok || !discovery) throw new Error('Forge 尚未启用统一浏览器登录')
    const registrationEndpoint = oauthEndpoint(discovery.registration_endpoint, '客户端注册地址', forge)
    const authorizationEndpoint = oauthEndpoint(discovery.authorization_endpoint, '授权地址', forge)
    const tokenEndpoint = oauthEndpoint(discovery.token_endpoint, '令牌地址', forge)
    const listener = await listenForOAuthCallback(options.timeoutMs ?? 5 * 60_000)
    try {
      const registrationResponse = await request(registrationEndpoint, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, redirect: 'error',
        body: JSON.stringify({
          client_name: 'Weave Workbench', redirect_uris: [listener.redirectUri], token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code'], response_types: ['code'], application_type: 'native',
        }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const registration = record(await registrationResponse.json().catch(() => undefined))
      const clientId = boundedString(registration?.client_id, 512)
      if (!registrationResponse.ok || !clientId) throw new Error(responseMessage(registration, 'Forge 未允许 Workbench 登录'))
      const verifier = randomBytes(48).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const state = randomBytes(24).toString('base64url')
      const authorizationUrl = new URL(authorizationEndpoint)
      for (const [key, value] of Object.entries({
        response_type: 'code', client_id: clientId, redirect_uri: listener.redirectUri, scope: 'openid profile email offline_access',
        state, code_challenge: challenge, code_challenge_method: 'S256',
      })) authorizationUrl.searchParams.set(key, value)
      const codePromise = listener.wait(state)
      await options.openExternal(authorizationUrl.toString())
      const code = await codePromise
      const tokenResponse = await request(tokenEndpoint, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'error',
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: listener.redirectUri, client_id: clientId, code_verifier: verifier }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const tokenBody = record(await tokenResponse.json().catch(() => undefined))
      const accessToken = boundedString(tokenBody?.access_token, 16 * 1024)
      if (!tokenResponse.ok || !accessToken) throw new Error(responseMessage(tokenBody, 'Forge 登录令牌交换失败'))
      return accessToken
    } finally { await listener.close() }
  }
}

export class EnterpriseService {
  private readonly environment: NodeJS.ProcessEnv
  private readonly fetch: typeof fetch
  private readonly sessionPath?: string
  private readonly secretCodec?: EnterpriseSecretCodec
  private readonly oauthLogin?: (forge: URL) => Promise<string>
  private memoryToken = ''
  private memoryProductToken = ''
  private loaded = false

  constructor(options: EnterpriseServiceOptions = {}) {
    this.environment = options.environment ?? process.env
    this.fetch = options.fetch ?? fetch
    this.sessionPath = options.sessionPath
    this.secretCodec = options.secretCodec
    this.oauthLogin = options.oauthLogin
  }

  private forgeUrl(): URL { return environmentUrl(this.environment.WORKBENCH_FORGE_URL, DEFAULT_FORGE_URL, 'Forge') }
  private accessUrl(): URL { return environmentUrl(this.environment.WORKBENCH_ACCESS_URL ?? this.environment.WORKBENCH_WEAVE_URL, DEFAULT_WEAVE_URL, 'Access') }
  private storage(): EnterpriseAccountState['storage'] { return this.sessionPath && this.secretCodec?.available() ? 'encrypted' : 'session-only' }

  private unavailableAccess(subjectId: string, message: string): ProductAccessState {
    return {
      version: '1', status: 'unavailable', subject: { id: subjectId }, source: { kind: 'weave' }, evaluatedAt: new Date().toISOString(), message,
      capabilities: PRODUCT_CAPABILITY_IDS.map((id) => ({ id, decision: 'unavailable', reason: message })),
    }
  }

  private async accessForToken(token: string, subjectId: string): Promise<ProductAccessState> {
    const accessUrl = this.accessUrl()
    try {
      const response = await this.fetch(new URL('/v1/authorization/capabilities', accessUrl), {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const body = record(await response.json().catch(() => undefined))
      if (!response.ok) return this.unavailableAccess(subjectId, response.status === 401 || response.status === 403 ? '产品权限身份尚未接通' : '产品权限服务尚未接通')
      const capabilities = new Map<string, ProductCapabilityDecision>()
      for (const candidate of Array.isArray(body?.capabilities) ? body.capabilities.slice(0, 20) : []) {
        const item = record(candidate)
        const id = boundedString(item?.id, 128)
        const decision = item?.decision
        const reason = boundedString(item?.reason, 500)
        if (!id || !PRODUCT_CAPABILITY_IDS.includes(id as ProductCapabilityDecision['id']) || (decision !== 'allow' && decision !== 'deny' && decision !== 'unavailable') || !reason) continue
        capabilities.set(id, { id: id as ProductCapabilityDecision['id'], decision, reason, decisionId: boundedString(item?.decisionId, 128) })
      }
      const ordered = PRODUCT_CAPABILITY_IDS.map((id) => capabilities.get(id) ?? { id, decision: 'unavailable' as const, reason: '权限服务没有返回此项能力' })
      const organizationBody = record(body?.organization)
      const organizationId = boundedString(organizationBody?.id, 128)
      const organizationName = boundedString(organizationBody?.name, 160)
      const sourceBody = record(body?.source)
      const sourceKind = sourceBody?.kind
      const source: ProductAccessState['source'] = {
        kind: sourceKind === 'cerbos' || sourceKind === 'openfga' || sourceKind === 'other' ? sourceKind : 'weave',
        policyVersion: boundedString(sourceBody?.policyVersion, 128),
      }
      const projected: ProductAccessState = {
        version: '1', status: body?.status === 'unavailable' ? 'unavailable' : 'ready', subject: { id: subjectId }, source,
        evaluatedAt: boundedString(body?.evaluatedAt, 128) ?? new Date().toISOString(), capabilities: ordered,
        message: boundedString(body?.message, 500),
      }
      if (organizationId && organizationName) projected.organization = { id: organizationId, name: organizationName }
      const subjectBody = record(body?.subject)
      const subjectOrganizationId = boundedString(subjectBody?.organizationId, 128)
      if (subjectOrganizationId) projected.subject.organizationId = subjectOrganizationId
      return projected
    } catch {
      return this.unavailableAccess(subjectId, '产品权限服务暂时不可用')
    }
  }

  private async exchangeProductToken(identityToken: string): Promise<string> {
    const response = await this.fetch(new URL('/v1/auth/external/exchange', this.accessUrl()), {
      method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${identityToken}` },
      redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = record(await response.json().catch(() => undefined))
    const token = boundedString(body?.token, 16 * 1024)
    if (!response.ok || !token) throw new Error('产品权限身份尚未接通')
    this.memoryProductToken = token
    return token
  }

  private async loadToken(origin: string): Promise<string> {
    if (this.loaded) return this.memoryToken
    this.loaded = true
    if (!this.sessionPath || !this.secretCodec?.available()) return ''
    try {
      const parsed = JSON.parse(await readFile(this.sessionPath, 'utf8')) as Partial<EnterpriseSessionFile>
      if (parsed.version !== 1 || parsed.origin !== origin || typeof parsed.token !== 'string') return ''
      this.memoryToken = this.secretCodec.decrypt(Buffer.from(parsed.token, 'base64'))
    } catch { /* missing, stale, or unreadable sessions are signed out */ }
    return this.memoryToken
  }

  private async saveToken(origin: string, token: string): Promise<void> {
    this.loaded = true
    this.memoryToken = token
    if (!this.sessionPath || !this.secretCodec?.available()) return
    await mkdir(dirname(this.sessionPath), { recursive: true, mode: 0o700 })
    const payload: EnterpriseSessionFile = { version: 1, origin, token: this.secretCodec.encrypt(token).toString('base64') }
    const temporary = `${this.sessionPath}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.sessionPath)
  }

  private async clearToken(): Promise<void> {
    this.loaded = true
    this.memoryToken = ''
    this.memoryProductToken = ''
    if (this.sessionPath) await rm(this.sessionPath, { force: true }).catch(() => undefined)
  }

  private async request(path: string, init: RequestInit = {}): Promise<{ response: Response; body: unknown }> {
    const response = await this.fetch(new URL(path, this.forgeUrl()), {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return { response, body: await response.json().catch(() => undefined) }
  }

  private signedOut(message?: string): EnterpriseAccountState {
    const forge = this.forgeUrl()
    return {
      version: '1',
      status: 'signed-out',
      environment: { origin: forge.origin, secure: forge.protocol === 'https:' },
      storage: this.storage(),
      message: message ?? (forge.protocol === 'http:' ? '当前通过 HTTP 连接' : undefined),
    }
  }

  private async accountForToken(token: string): Promise<EnterpriseAccountState> {
    const forge = this.forgeUrl()
    const headers = { Authorization: `Bearer ${token}` }
    let identityResult = await this.request('/api/v1/auth/oauth2/userinfo', { headers })
    if (identityResult.response.status === 404 || identityResult.response.status === 405) {
      identityResult = await this.request('/api/v1/auth/get-session', { headers })
    }
    if (identityResult.response.status === 401 || identityResult.response.status === 403) {
      await this.clearToken()
      return this.signedOut('登录已失效，请重新登录')
    }
    if (!identityResult.response.ok) throw new Error(responseMessage(identityResult.body, `读取账号失败（${identityResult.response.status}）`))
    const identity = record(identityResult.body)
    const user = record(identity?.user) ?? nestedRecord(identityResult.body, 'data', 'user') ?? identity
    const identityOrganization = record(identity?.organization) ?? nestedRecord(identityResult.body, 'data', 'organization')
    const identityRoles = collectRoles(identityResult.body)
    const id = boundedString(user?.id, 128) ?? boundedString(user?.sub, 128)
    const email = boundedString(user?.email, 320)
    if (!id || !email) throw new Error('Forge 返回的账号信息不完整')
    let access = this.unavailableAccess(id, '产品权限身份尚未接通')
    try {
      const productToken = await this.exchangeProductToken(token)
      access = await this.accessForToken(productToken, id)
    } catch { /* identity remains signed in while product access fails closed */ }
    const state: EnterpriseAccountState = {
      version: '1', status: 'signed-in', environment: { origin: forge.origin, secure: forge.protocol === 'https:' }, storage: this.storage(),
      identitySource: { kind: 'forge-oauth', issuer: forge.origin }, user: { id, email, name: boundedString(user?.name, 160) ?? email }, roles: identityRoles, access,
    }
    const organization = access.organization ?? identityOrganization
    const organizationId = boundedString(organization?.id, 128)
    const organizationName = boundedString(organization?.name, 160)
    if (organizationId && organizationName) state.organization = { id: organizationId, name: organizationName }
    if (!state.organization) state.message = '账号登录已完成；组织映射等待身份适配器提供'
    return state
  }

  async getAccount(): Promise<EnterpriseAccountState> {
    const forge = this.forgeUrl()
    const token = await this.loadToken(forge.origin)
    if (!token) return this.signedOut()
    try { return await this.accountForToken(token) } catch {
      return { version: '1', status: 'unavailable', environment: { origin: forge.origin, secure: forge.protocol === 'https:' }, storage: this.storage(), message: '暂时无法读取账号状态' }
    }
  }

  async signIn(): Promise<EnterpriseAccountState> {
    const forge = this.forgeUrl()
    if (!this.oauthLogin) throw new Error('企业浏览器登录尚未配置')
    const token = await this.oauthLogin(forge)
    await this.saveToken(forge.origin, token)
    try { return await this.accountForToken(token) } catch (error) { await this.clearToken(); throw error }
  }

  async signOut(): Promise<EnterpriseAccountState> {
    const forge = this.forgeUrl()
    const token = await this.loadToken(forge.origin)
    if (token) await this.request('/api/v1/auth/sign-out', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: forge.origin } }).catch(() => undefined)
    await this.clearToken()
    return this.signedOut()
  }

  private async check(id: string, name: string, url: URL, healthPath: string): Promise<EnterpriseEnvironmentStatus> {
    const checkedAt = new Date().toISOString()
    try {
      const response = await this.fetch(new URL(healthPath, url), { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(4_000) })
      const health = response.ok ? await response.json().catch(() => undefined) : undefined
      return { id, name, url: url.origin, available: response.ok, secure: url.protocol === 'https:', version: versionFromHealth(health), checkedAt, message: response.ok ? undefined : `环境返回 ${response.status}` }
    } catch {
      return { id, name, url: url.origin, available: false, secure: url.protocol === 'https:', checkedAt, message: '暂时无法连接' }
    }
  }

  async getStatus(): Promise<EnterpriseEnvironmentStatus[]> {
    const forge = this.forgeUrl()
    const weave = environmentUrl(this.environment.WORKBENCH_WEAVE_URL, DEFAULT_WEAVE_URL, 'Weave')
    return Promise.all([
      this.check('forge-development', 'Forge 业务环境', forge, '/api/v1/health'),
      this.check('weave-development', 'Weave 协作服务', weave, '/v1/ready'),
    ])
  }
}
