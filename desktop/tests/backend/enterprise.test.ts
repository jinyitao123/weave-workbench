import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseService } from '../../electron/main/enterprise'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

afterEach(() => { vi.unstubAllGlobals() })

describe('EnterpriseService', () => {
  it('uses one Forge login to create a session-only Weave binding', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://forge.example.test/api/v1/auth/sign-in/email') {
        expect(JSON.parse(String(init?.body))).toEqual({ email: 'developer@example.test', password: 'secret' })
        return Response.json({ token: 'forge-secret-token', user: { id: 'forge-1', email: 'developer@example.test', name: 'Developer' } })
      }
      if (url === 'http://weave.example.test/v1/auth/external/exchange') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer forge-secret-token')
        return Response.json({ token: 'weave-secret-token', subject: { id: 'weave-1', externalId: 'forge-1', email: 'developer@example.test', name: 'Developer', role: 'developer' }, organization: { id: 'default' } })
      }
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock,
    })

    const session = await service.signIn(' developer@example.test ', 'secret')
    expect(session).toMatchObject({ status: 'signed-in', storage: 'session-only', user: { id: 'forge-1', email: 'developer@example.test' }, organization: { id: 'default' }, role: 'developer' })
    expect(JSON.stringify(session)).not.toContain('secret-token')
    expect((await service.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-secret-token')
    await expect(service.signOut()).resolves.toMatchObject({ status: 'signed-out' })
    await expect(service.authorizationHeaders()).rejects.toThrow('请先登录')
  })

  it('does not keep a partial session when Forge credentials are rejected', async () => {
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' },
      fetch: (async () => Response.json({}, { status: 401 })) as typeof fetch,
    })
    await expect(service.signIn('member@example.test', 'wrong')).rejects.toThrow('账号或密码不正确')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-out' })
  })

  it('restores only an encrypted Weave session and removes it on logout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gooeypi-enterprise-'))
    const sessionPath = join(directory, 'session.json')
    const codec = {
      available: () => true,
      encrypt: (value: string) => Buffer.from(`encrypted:${value}`),
      decrypt: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
    }
    const fetcher = (async (input: URL | RequestInfo) => String(input).includes('sign-in')
      ? Response.json({ token: 'forge-secret', user: { id: 'forge-1', email: 'member@example.test', name: 'Member' } })
      : Response.json({ token: 'weave-secret', expiresIn: 3600, subject: { id: 'weave-1', externalId: 'forge-1', email: 'member@example.test', name: 'Member', role: 'member' }, organization: { id: 'default' } })) as typeof fetch
    try {
      const first = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetcher, sessionPath, sessionCodec: codec })
      await expect(first.signIn('member@example.test', 'secret')).resolves.toMatchObject({ status: 'signed-in', storage: 'encrypted' })
      const persisted = await readFile(sessionPath, 'utf8')
      expect(persisted).not.toContain('weave-secret')
      expect(persisted).not.toContain('secret\"')
      const restarted = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetcher, sessionPath, sessionCodec: codec })
      await expect(restarted.getSession()).resolves.toMatchObject({ status: 'signed-in', role: 'member', storage: 'encrypted' })
      expect((await restarted.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-secret')
      await restarted.signOut()
      await expect(readFile(sessionPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('reports Forge and Weave health without forwarding credentials', async () => {
    const fetchMock = vi.fn(async (input: URL, _init?: RequestInit) => new Response(JSON.stringify(
      input.hostname === 'forge.example.test' ? { data: { version: '17.4.0' } } : { status: 'ready' },
    ), { status: 200, headers: { 'content-type': 'application/json' } }))
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'https://forge.example.test', WORKBENCH_WEAVE_URL: 'https://weave.example.test' },
      fetch: fetchMock as typeof fetch,
    })

    await expect(service.getStatus()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'forge-development', available: true, secure: true, version: '17.4.0' }),
      expect.objectContaining({ id: 'weave-development', available: true, secure: true }),
    ]))
    expect(fetchMock.mock.calls.every((call) => !new Headers(call[1]?.headers).has('Authorization'))).toBe(true)
  })

  it('returns bounded unavailable states when the environments cannot be reached', async () => {
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' },
      fetch: (async () => { throw new Error('connection failed') }) as typeof fetch,
    })

    await expect(service.getStatus()).resolves.toEqual([
      expect.objectContaining({ available: false, secure: false, message: '暂时无法连接' }),
      expect.objectContaining({ available: false, secure: false, message: '暂时无法连接' }),
    ])
  })
})
