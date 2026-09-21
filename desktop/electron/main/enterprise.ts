import type { EnterpriseEnvironmentStatus, EnterpriseRole, EnterpriseSession } from '../../src/types/api'
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
