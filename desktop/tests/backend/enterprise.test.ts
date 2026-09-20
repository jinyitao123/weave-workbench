import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEnterpriseOAuthLogin, EnterpriseService } from '../../electron/main/enterprise'

const originalForgeUrl = process.env.WORKBENCH_FORGE_URL
const originalWeaveUrl = process.env.WORKBENCH_WEAVE_URL

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalForgeUrl === undefined) delete process.env.WORKBENCH_FORGE_URL
  else process.env.WORKBENCH_FORGE_URL = originalForgeUrl
  if (originalWeaveUrl === undefined) delete process.env.WORKBENCH_WEAVE_URL
  else process.env.WORKBENCH_WEAVE_URL = originalWeaveUrl
})

describe('EnterpriseService', () => {
  it('reports Forge health without forwarding credentials', async () => {
    process.env.WORKBENCH_FORGE_URL = 'https://forge.example.test'
    process.env.WORKBENCH_WEAVE_URL = 'https://weave.example.test'
    const fetchMock = vi.fn(async (input: URL, _init?: RequestInit) => new Response(JSON.stringify(input.hostname === 'forge.example.test' ? { data: { version: '17.4.0' } } : { status: 'ready' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const statuses = await new EnterpriseService().getStatus()

    expect(statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'forge-development', available: true, secure: true, version: '17.4.0', url: 'https://forge.example.test' }),
      expect.objectContaining({ id: 'weave-development', available: true, secure: true, url: 'https://weave.example.test' }),
    ]))
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://forge.example.test/api/v1/health'), expect.objectContaining({
      headers: { Accept: 'application/json' },
      redirect: 'error',
    }))
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization')
    expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty('Authorization')
  })

  it('returns a bounded unavailable state when the environment cannot be reached', async () => {
    process.env.WORKBENCH_FORGE_URL = 'http://forge.example.test'
    process.env.WORKBENCH_WEAVE_URL = 'http://weave.example.test'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection failed') }))

    await expect(new EnterpriseService().getStatus()).resolves.toEqual([
      expect.objectContaining({ available: false, secure: false, message: '暂时无法连接' }),
      expect.objectContaining({ available: false, secure: false, message: '暂时无法连接' }),
    ])
  })

  it('allows browser login against a configured remote HTTP environment', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(input.toString()).pathname
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer intranet-token' }))
      if (path.endsWith('/oauth2/userinfo')) return new Response(JSON.stringify({ sub: 'user-1', name: '内网开发者', email: 'developer@example.test' }), { status: 200 })
      if (path.endsWith('/get-full-organization')) return new Response(JSON.stringify({ id: 'org-1', name: '客户组织' }), { status: 200 })
      if (path.endsWith('/me/permissions')) return new Response(JSON.stringify({ roles: ['developer'] }), { status: 200 })
      return new Response(null, { status: 404 })
    })
    const oauthLogin = vi.fn(async () => 'intranet-token')
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test' },
      fetch: fetchMock as typeof fetch,
      oauthLogin,
    })

    await expect(service.getAccount()).resolves.toEqual(expect.objectContaining({ status: 'signed-out', environment: { origin: 'http://forge.example.test', secure: false }, message: '当前通过 HTTP 连接' }))
    await expect(service.signIn()).resolves.toEqual(expect.objectContaining({ status: 'signed-in', environment: { origin: 'http://forge.example.test', secure: false }, user: expect.objectContaining({ name: '内网开发者' }) }))
    expect(oauthLogin).toHaveBeenCalledWith(new URL('http://forge.example.test'))
  })

  it('keeps the verified OAuth identity visible when Forge has not exposed organization claims', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(input.toString()).pathname
      if (path.endsWith('/oauth2/userinfo')) return new Response(JSON.stringify({ sub: 'user-1', name: '开发者', email: 'developer@example.test' }), { status: 200 })
      if (path.endsWith('/get-full-organization')) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })
      if (path.endsWith('/me/permissions')) return new Response(JSON.stringify({ authenticated: false }), { status: 200 })
      return new Response(null, { status: 404 })
    })
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test' },
      fetch: fetchMock as typeof fetch,
      oauthLogin: async () => 'identity-only-token',
    })

    await expect(service.signIn()).resolves.toEqual(expect.objectContaining({
      status: 'signed-in',
      user: { id: 'user-1', name: '开发者', email: 'developer@example.test' },
      roles: [],
      access: expect.objectContaining({ status: 'unavailable', capabilities: expect.arrayContaining([expect.objectContaining({ id: 'release.publish', decision: 'unavailable' })]) }),
      message: '账号登录已完成；组织映射等待身份适配器提供',
    }))
  })

  it('uses organization and roles supplied by the Forge OAuth identity projection', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(input.toString()).pathname
      if (path.endsWith('/oauth2/userinfo')) return new Response(JSON.stringify({
        sub: 'user-1', name: '开发者', email: 'developer@example.test',
        organization: { id: 'org-1', name: '客户组织' }, roles: ['developer', 'workflow.read'],
      }), { status: 200 })
      if (path.endsWith('/get-full-organization')) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })
      if (path.endsWith('/me/permissions')) return new Response(JSON.stringify({ authenticated: false }), { status: 200 })
      return new Response(null, { status: 404 })
    })
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test' },
      fetch: fetchMock as typeof fetch,
      oauthLogin: async () => 'identity-token',
    })

    const account = await service.signIn()
    expect(account).toEqual(expect.objectContaining({
      status: 'signed-in',
      organization: { id: 'org-1', name: '客户组织' },
      roles: ['developer', 'workflow.read'],
    }))
    expect(account).not.toHaveProperty('message')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows only server decisions and never turns identity roles into product access', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input.toString())
      if (url.pathname.endsWith('/oauth2/userinfo')) return new Response(JSON.stringify({
        sub: 'user-1', name: '开发者', email: 'developer@example.test', roles: ['developer', 'admin'],
      }), { status: 200 })
      if (url.pathname === '/v1/auth/external/exchange') {
        expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer identity-token' }))
        return new Response(JSON.stringify({ token: 'weave-product-token', tokenType: 'Bearer', expiresIn: 600 }), { status: 200 })
      }
      if (url.pathname === '/v1/authorization/capabilities') return new Response(JSON.stringify({
        version: '1', status: 'ready', subject: { id: 'user-1', organizationId: 'org-1' }, organization: { id: 'org-1', name: '客户组织' },
        source: { kind: 'cerbos', policyVersion: 'default' }, evaluatedAt: '2026-09-20T08:00:00.000Z',
        capabilities: [
          { id: 'team.read', decision: 'allow', reason: '组织成员可以查看团队' },
          { id: 'run.read', decision: 'allow', reason: '已授予运行查看范围' },
          { id: 'debug.simulate', decision: 'allow', reason: '已授予开发调试范围' },
          { id: 'debug.sandbox_write', decision: 'deny', reason: '当前组织没有沙箱环境' },
          { id: 'release.publish', decision: 'deny', reason: '发布需要独立授权' },
        ],
      }), { status: 200 })
      return new Response(null, { status: 404 })
    })
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'https://forge.example.test', WORKBENCH_ACCESS_URL: 'https://access.example.test' },
      fetch: fetchMock as typeof fetch,
      oauthLogin: async () => 'identity-token',
    })

    const account = await service.signIn()
    expect(account).toEqual(expect.objectContaining({
      organization: { id: 'org-1', name: '客户组织' },
      roles: ['developer', 'admin'],
      access: expect.objectContaining({
        status: 'ready', source: { kind: 'cerbos', policyVersion: 'default' },
        capabilities: expect.arrayContaining([
          expect.objectContaining({ id: 'debug.simulate', decision: 'allow' }),
          expect.objectContaining({ id: 'release.publish', decision: 'deny', reason: '发布需要独立授权' }),
        ]),
      }),
    }))
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://access.example.test/v1/authorization/capabilities'), expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer weave-product-token' },
    }))
  })

  it('stores only an encrypted device token and restores the projected account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workbench-enterprise-'))
    const sessionPath = join(directory, 'session.json')
    const environment = { WORKBENCH_FORGE_URL: 'https://forge.example.test' }
    const secretCodec = {
      available: () => true,
      encrypt: (value: string) => Buffer.from(`sealed:${value}`, 'utf8'),
      decrypt: (value: Buffer) => value.toString('utf8').replace(/^sealed:/, ''),
    }
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(input.toString()).pathname
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer device-token' }))
      if (path.endsWith('/oauth2/userinfo')) return new Response(JSON.stringify({
        sub: 'user-1', name: '开发者', email: 'developer@example.test', organization: { id: 'org-1', name: '示例组织' }, roles: ['developer', 'workflow.read'],
      }), { status: 200 })
      return new Response(null, { status: 404 })
    })
    try {
      const service = new EnterpriseService({ environment, fetch: fetchMock as typeof fetch, sessionPath, secretCodec, oauthLogin: async () => 'device-token' })
      await expect(service.signIn()).resolves.toEqual(expect.objectContaining({
        status: 'signed-in', storage: 'encrypted', user: { id: 'user-1', name: '开发者', email: 'developer@example.test' },
        organization: { id: 'org-1', name: '示例组织' }, roles: ['developer', 'workflow.read'],
      }))
      const saved = await readFile(sessionPath, 'utf8')
      expect(saved).not.toContain('device-token')

      const restored = new EnterpriseService({ environment, fetch: fetchMock as typeof fetch, sessionPath, secretCodec })
      await expect(restored.getAccount()).resolves.toEqual(expect.objectContaining({ status: 'signed-in', storage: 'encrypted' }))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('uses a browser OAuth flow with PKCE and a loopback callback', async () => {
    let redirectUri = ''
    let tokenBody = ''
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input.toString())
      if (url.pathname === '/.well-known/oauth-authorization-server') return new Response(JSON.stringify({
        registration_endpoint: 'http://forge.example.test/api/v1/auth/oauth2/register',
        authorization_endpoint: 'http://forge.example.test/api/v1/auth/oauth2/authorize',
        token_endpoint: 'http://forge.example.test/api/v1/auth/oauth2/token',
      }), { status: 200 })
      if (url.pathname.endsWith('/register')) {
        redirectUri = JSON.parse(String(init?.body)).redirect_uris[0]
        return new Response(JSON.stringify({ client_id: 'workbench-client' }), { status: 201 })
      }
      if (url.pathname.endsWith('/token')) {
        tokenBody = String(init?.body)
        return new Response(JSON.stringify({ access_token: 'oauth-access-token', token_type: 'Bearer' }), { status: 200 })
      }
      return new Response(null, { status: 404 })
    })
    const login = createEnterpriseOAuthLogin({
      fetch: fetchMock as typeof fetch,
      openExternal: async (value) => {
        const authorization = new URL(value)
        expect(authorization.origin).toBe('http://forge.example.test')
        expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
        expect(authorization.searchParams.get('scope')).toBe('openid profile email offline_access')
        expect(authorization.searchParams.get('redirect_uri')).toBe(redirectUri)
        const callback = new URL(redirectUri)
        callback.searchParams.set('code', 'authorization-code')
        callback.searchParams.set('state', authorization.searchParams.get('state') ?? '')
        await fetch(callback)
      },
      timeoutMs: 5_000,
    })

    await expect(login(new URL('http://forge.example.test'))).resolves.toBe('oauth-access-token')
    const posted = new URLSearchParams(tokenBody)
    expect(posted.get('grant_type')).toBe('authorization_code')
    expect(posted.get('code')).toBe('authorization-code')
    expect(posted.get('code_verifier')).toBeTruthy()
  })
})
