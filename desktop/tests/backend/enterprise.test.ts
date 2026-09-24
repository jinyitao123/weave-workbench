import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseService } from '../../electron/main/enterprise'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

afterEach(() => { vi.unstubAllGlobals() })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function workOverviewFetch(route: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/v1/auth/sign-in/email')) {
      const { email } = JSON.parse(String(init?.body)) as { email: string }
      return Response.json({ token: `forge-token-${email}`, user: { id: email, email, name: email } })
    }
    if (url.endsWith('/v1/auth/external/exchange')) {
      const email = new Headers(init?.headers).get('Authorization')?.replace('Bearer forge-token-', '') ?? 'unknown'
      return Response.json({ token: `weave-token-${email}`, subject: { id: `weave-${email}`, externalId: email, email, name: email }, organization: { id: 'default' }, permissions: ['teams:use'] })
    }
    return await route(url, init) ?? Response.json({}, { status: 404 })
  }) as typeof fetch
}

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
        return Response.json({ token: 'weave-secret-token', subject: { id: 'weave-1', externalId: 'forge-1', email: 'developer@example.test', name: 'Developer' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
      }
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock,
    })
    const scopeChanges: Array<{ status: string; generation: number; phase: string }> = []
    service.setSessionScopeChangeHandler(async (changed, generation, phase) => { scopeChanges.push({ status: changed.status, generation, phase }) })

    const session = await service.signIn(' developer@example.test ', 'secret')
    expect(session).toMatchObject({ status: 'signed-in', storage: 'session-only', user: { id: 'forge-1', email: 'developer@example.test' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
    expect(JSON.stringify(session)).not.toContain('secret-token')
    expect(service.accountKeyForSession(session)).toBe(await service.accountKey())
    expect(scopeChanges.map(({ status, phase }) => [status, phase])).toEqual([['signed-out', 'sign-in-start'], ['signed-in', 'signed-in']])
    expect(scopeChanges[0]?.generation).toBe(scopeChanges[1]?.generation)
    const activeGeneration = scopeChanges[1]?.generation
    expect(activeGeneration).toBeDefined()
    expect(service.isSessionGenerationCurrent(activeGeneration ?? -1)).toBe(true)
    expect((await service.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-secret-token')
    await expect(service.signOut()).resolves.toMatchObject({ status: 'signed-out' })
    expect(scopeChanges.at(-1)).toMatchObject({ status: 'signed-out', phase: 'signed-out' })
    await expect(service.authorizationHeaders()).rejects.toThrow('请先登录')
  })

  it('discards an old account 401 without signing out the account that replaced it', async () => {
    const oldUnauthorized = deferred<Response>(), oldSuccess = deferred<Response>()
    const unauthorizedStarted = deferred<void>(), successStarted = deferred<void>()
    let oldReadCount = 0
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) {
        const email = (JSON.parse(String(init?.body)) as { email: string }).email
        return Response.json({ token: `forge-token-${email}`, user: { id: email, email, name: email } })
      }
      if (url.endsWith('/v1/auth/external/exchange')) {
        const email = new Headers(init?.headers).get('Authorization')?.replace('Bearer forge-token-', '') ?? 'unknown'
        return Response.json({ token: `weave-token-${email}`, subject: { id: `weave-${email}`, externalId: email, email, name: email }, organization: { id: 'default' }, permissions: ['teams:use'] })
      }
      if (url.endsWith('/v1/teams?status=active') && new Headers(init?.headers).get('Authorization') === 'Bearer weave-token-a@example.test') {
        oldReadCount++
        if (oldReadCount === 1) { unauthorizedStarted.resolve(); return oldUnauthorized.promise }
        successStarted.resolve()
        return oldSuccess.promise
      }
      if (url.endsWith('/v1/teams?status=active')) return Response.json({ teams: [] })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock })
    await service.signIn('a@example.test', 'secret')
    const previousUnauthorizedRead = service.getTeamCatalog()
    const previousSuccessfulRead = service.getTeamCatalog()
    await Promise.all([unauthorizedStarted.promise, successStarted.promise])
    await service.signIn('b@example.test', 'secret')
    oldUnauthorized.resolve(Response.json({}, { status: 401 }))
    oldSuccess.resolve(Response.json({ teams: [{ id: 'team-a', name: 'A', objective: 'A', status: 'active' }] }))

    await expect(previousUnauthorizedRead).rejects.toThrow('账号已切换')
    await expect(previousSuccessfulRead).rejects.toThrow('账号已切换')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-in', user: { id: 'b@example.test' } })
    expect((await service.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-token-b@example.test')
  })

  it('does not let a delayed earlier sign-in overwrite the account that logged in later', async () => {
    const delayedExchange = deferred<Response>(), started = deferred<void>()
    const directory = await mkdtemp(join(tmpdir(), 'gooeypi-enterprise-switch-'))
    const sessionPath = join(directory, 'session.json')
    const codec = {
      available: () => true,
      encrypt: (value: string) => Buffer.from(`encrypted:${value}`),
      decrypt: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
    }
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) {
        const email = (JSON.parse(String(init?.body)) as { email: string }).email
        return Response.json({ token: `forge-token-${email}`, user: { id: email, email, name: email } })
      }
      if (url.endsWith('/v1/auth/external/exchange')) {
        const email = new Headers(init?.headers).get('Authorization')?.replace('Bearer forge-token-', '') ?? 'unknown'
        if (email === 'a@example.test') { started.resolve(); return delayedExchange.promise }
        return Response.json({ token: `weave-token-${email}`, subject: { id: `weave-${email}`, externalId: email, email, name: email }, organization: { id: 'default' }, permissions: ['teams:use'] })
      }
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock, sessionPath, sessionCodec: codec })
    try {
      const earlierLogin = service.signIn('a@example.test', 'secret')
      await started.promise
      await service.signIn('b@example.test', 'secret')
      delayedExchange.resolve(Response.json({ token: 'weave-token-a@example.test', subject: { id: 'weave-a', externalId: 'a@example.test', email: 'a@example.test', name: 'A' }, organization: { id: 'default' }, permissions: ['teams:use'] }))

      await expect(earlierLogin).rejects.toThrow('账号已切换')
      await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-in', user: { id: 'b@example.test' } })
      expect((await service.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-token-b@example.test')
      const persisted = await readFile(sessionPath, 'utf8')
      expect(JSON.parse(persisted).session.user.id).toBe('b@example.test')
      const restarted = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock, sessionPath, sessionCodec: codec })
      await expect(restarted.getSession()).resolves.toMatchObject({ status: 'signed-in', user: { id: 'b@example.test' } })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('does not keep a partial session when Forge credentials are rejected', async () => {
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' },
      fetch: (async () => Response.json({}, { status: 401 })) as typeof fetch,
    })
    await expect(service.signIn('member@example.test', 'wrong')).rejects.toThrow('账号或密码不正确')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-out' })
  })

  it('restores encrypted Forge and Weave sessions and removes them on logout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gooeypi-enterprise-'))
    const sessionPath = join(directory, 'session.json')
    const codec = {
      available: () => true,
      encrypt: (value: string) => Buffer.from(`encrypted:${value}`),
      decrypt: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
    }
    const fetcher = (async (input: URL | RequestInfo) => String(input).includes('sign-in')
      ? Response.json({ token: 'forge-secret', user: { id: 'forge-1', email: 'member@example.test', name: 'Member' } })
      : Response.json({ token: 'weave-secret', expiresIn: 3600, subject: { id: 'weave-1', externalId: 'forge-1', email: 'member@example.test', name: 'Member' }, organization: { id: 'default' }, permissions: ['teams:use'] })) as typeof fetch
    try {
      const first = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetcher, sessionPath, sessionCodec: codec })
      await expect(first.signIn('member@example.test', 'secret')).resolves.toMatchObject({ status: 'signed-in', storage: 'encrypted' })
      const persisted = await readFile(sessionPath, 'utf8')
      expect(persisted).not.toContain('weave-secret')
      expect(persisted).not.toContain('forge-secret')
      expect(persisted).not.toContain('secret"')
      const restarted = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetcher, sessionPath, sessionCodec: codec })
      await expect(restarted.getSession()).resolves.toMatchObject({ status: 'signed-in', permissions: ['teams:use'], storage: 'encrypted' })
      expect((await restarted.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-secret')
      await restarted.signOut()
      await expect(readFile(sessionPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('projects Forge actions into developer-facing business capabilities', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'developer@example.test' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
      if (url.endsWith('/api/v1/meta/actions')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer forge-token')
        expect(init?.method).toBeUndefined()
        return Response.json({ data: { items: [
          { name: 'ContractSubmit', objectName: 'sales_contract', label: '提交销售合同', ai: { exposed: true, description: '校验后提交合同' }, params: [{ name: 'material_file_id', label: '合同文件', type: 'text', required: true }, { name: 'attachments', label: '附件', type: 'file', multiple: true }], requiredPermissions: ['sales_contract_operator'] },
          { name: 'UpdateQuoteLines', objectName: 'forge_quote', label: '调整报价明细', ai: { exposed: true, description: '按要求调整报价明细' }, params: [{ name: 'lines', label: '明细', type: 'array', required: true }] },
          { name: 'UpdateQuoteObject', objectName: 'forge_quote', label: '更新报价结构', ai: { exposed: true, description: '按要求更新报价结构' }, params: [{ name: 'value', label: '结构', type: 'object', required: true }] },
          { name: 'InternalOnly', objectName: 'sales_contract', label: '内部动作', ai: { exposed: false } },
        ] } })
      }
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('developer@example.test', 'secret')

    await expect(service.getBusinessCapabilityCatalog()).resolves.toMatchObject({
      provider: { name: 'Forge 业务环境', status: 'available' },
      capabilities: [
        { id: 'forge:action:sales_contract.ContractSubmit', name: '提交销售合同', effect: 'write', requiresEmployeeIntent: true, status: 'available', actionName: 'ContractSubmit', objectName: 'sales_contract', requiresRecord: true, params: [{ name: 'material_file_id', label: '合同文件', type: 'string', required: true }, { name: 'attachments', label: '附件', type: 'file', multiple: true }] },
        { id: 'forge:action:forge_quote.UpdateQuoteLines', status: 'unavailable', unavailableReason: '数组缺少条目结构，当前不能绑定/执行', params: [{ name: 'lines', label: '明细', type: 'array', required: true }] },
        { id: 'forge:action:forge_quote.UpdateQuoteObject', status: 'unavailable', unavailableReason: '业务参数结构暂不支持，当前不能绑定/执行', params: [{ name: 'value', label: '结构', type: 'unsupported', required: true }] },
      ],
    })
  })

  it('does not return array or unknown-structure actions in the employee-authorizable Forge directory', async () => {
    const actions = [
      { name: 'UpdateQuoteLines', objectName: 'forge_quote', label: '调整报价明细', description: '按要求调整报价明细', params: [{ name: 'lines', type: 'array' }] },
      { name: 'UpdateQuoteObject', objectName: 'forge_quote', label: '更新报价结构', description: '按要求更新报价结构', params: [{ name: 'value', type: 'object' }] },
      { name: 'ReadQuote', objectName: 'forge_quote', label: '读取报价', description: '读取报价', params: [{ name: 'quote_id', type: 'text' }] },
    ]
    const fetchMock = workOverviewFetch((url) => {
      if (url.endsWith('/api/v1/mcp')) return Response.json({ jsonrpc: '2.0', id: 'business-capability-catalog', result: { content: [{ type: 'text', text: JSON.stringify({ actions }) }] } })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    await expect(service.getBusinessCapabilities([
      'forge:action:forge_quote.UpdateQuoteLines',
      'forge:action:forge_quote.UpdateQuoteObject',
      'forge:action:forge_quote.ReadQuote',
    ])).resolves.toMatchObject([{ id: 'forge:action:forge_quote.ReadQuote', status: 'available' }])
  })

  it('keeps the enterprise session when Forge denies one capability catalog', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'developer@example.test' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
      if (url.endsWith('/api/v1/meta/actions')) return Response.json({}, { status: 403 })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('developer@example.test', 'secret')

    await expect(service.getBusinessCapabilityCatalog()).rejects.toThrow('当前账号没有读取 Forge 业务能力的权限')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-in' })
    expect((await service.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-token')
  })

  it('explains an expired Forge password without discarding the Weave session', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'developer@example.test' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
      if (url.endsWith('/api/v1/meta/actions')) return Response.json({ error: { code: 'PASSWORD_EXPIRED', message: 'expired' } }, { status: 403 })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('developer@example.test', 'secret')

    await expect(service.getBusinessCapabilityCatalog()).rejects.toThrow('Forge 账号密码已过期，请更新密码后重新登录')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-in' })
    expect((await service.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-token')
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

  it('loads only the remote team catalog before selecting a draft', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'admin@example.test', name: 'Admin' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop', 'teams:admin'] })
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer weave-token')
      if (url.endsWith('/v1/runtimes')) return Response.json({ runtimes: [{ id: 'runtime-local', name: '本机运行时', engines: ['codex'], health_status: 'healthy', online: true }] })
      if (url.endsWith('/v1/development/model-catalog')) return Response.json({ models: ['qwen3:0.6b'] })
      if (url.includes('/v1/teams?')) return Response.json([{ team: { id: 'team-1', display_name: '合同交接团队', objective: '完成合同交接', status: 'active', updated_at: '2026-09-21T00:00:00Z' }, lead: { id: 'lead-1', display_name: '负责人', role: 'avatar', enabled: true }, workers: [{ id: 'worker-1', display_name: '审核员', role: 'worker', configured_duty: '审核合同', enabled: true }], summary: { worker_count: 1, active_workflow_count: 1, published_workflow_count: 1, health: { conclusion: 'healthy', reason_codes: [] } } }])
      if (url.endsWith('/v1/teams/team-1/workflows')) return Response.json({ workflows: [{ id: 'flow-1', name: '合同处理', status: 'active', published_version: 2, trigger_summary: { type: 'manual' } }] })
      if (url.endsWith('/v1/workflows/flow-1/versions/2')) return Response.json({ graph_definition: { nodes: [{ id: 'review', type: 'agent', label: '审核', config: { agent_id: 'worker-1' } }], edges: [] } })
      if (url.includes('/v1/runs?view=team&team_id=team-1')) return Response.json({ runs: [{ run_id: 'run-1', status: 'succeeded', step: 'review', duration_ms: 1200, tokens_in: 10, tokens_out: 20, cost_usd: 0.01 }] })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('admin@example.test', 'secret')

    await expect(service.getDevelopmentOverview()).resolves.toMatchObject({
      version: '1', runtimes: [{ name: '本机运行时', online: true }], teams: [{ id: 'team-1', name: '合同交接团队', lead: { name: '负责人' }, workers: [{ name: '审核员', duty: '审核合同' }], workflows: [], runs: [] }],
    })
  })

  it('reads and saves a server-backed team member configuration draft', async () => {
    const requests: Array<{ method: string; body?: Record<string, unknown> }> = []
    const response = (revision: number) => ({
      version: '1', team_id: 'team-1', agent_id: 'worker-1', agent_name: 'reviewer', base_agent_version: 3, revision,
      updated_at: '2026-09-21T10:00:00Z', configuration: {
        display_name: revision ? '合同复核员' : '审核员', role: 'worker', engine: 'pi', runtime_id: 'local-pi', model: 'default',
        system_prompt: '检查合同', skill_names: ['contract-review'], mcp_server_ids: ['forge'], permission_allow: ['contract.read'],
        business_capability_ids: ['forge:action:sales_contract.ContractSubmit'], business_capability_bindings: [{ capability_id: 'forge:action:sales_contract.ContractSubmit', parameters: [{ name: 'material_file_id', source: 'materials.single.id' }] }],
        memory_enabled: true, memory_scope: 'tenant', max_tokens: 12000, output_schema: { type: 'object' },
      }, relationship: { duty: '复核合同', when_to_use: '合同提交后', allowed_kinds: ['handoff'], default_kind: 'handoff', enabled: true },
    })
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'admin@example.test', name: 'Admin' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
      requests.push({ method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) })
      return Response.json(response(init?.method === 'PUT' ? 1 : 0))
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('admin@example.test', 'secret')
    const draft = await service.getTeamMemberConfigDraft('team-1', 'worker-1')
    expect(draft).toMatchObject({ agentName: 'reviewer', revision: 0, configuration: { engine: 'pi', outputSchema: expect.stringContaining('object'), businessCapabilityBindings: [{ capabilityId: 'forge:action:sales_contract.ContractSubmit', parameters: [{ name: 'material_file_id', source: 'materials.single.id' }] }] }, relationship: { duty: '复核合同' } })
    draft.configuration.displayName = '合同复核员'
    const saved = await service.saveTeamMemberConfigDraft(draft)
    expect(saved).toMatchObject({ revision: 1, configuration: { displayName: '合同复核员' } })
    expect(requests.at(-1)).toMatchObject({ method: 'PUT', body: { revision: 0, configuration: { display_name: '合同复核员', business_capability_bindings: [{ capability_id: 'forge:action:sales_contract.ContractSubmit', parameters: [{ name: 'material_file_id', source: 'materials.single.id' }] }] } } })
    const applied = await service.applyTeamMemberConfigDraft('team-1', 'worker-1', 1)
    expect(applied.revision).toBe(0)
    expect(requests.at(-1)).toEqual({ method: 'POST', body: { revision: 1 } })
  })

  it('creates an editable team with a lead and an execution member', async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'developer@example.test', name: 'Developer' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
      calls.push({ url, method, body })
      if (url.endsWith('/v1/agents') && body?.role === 'avatar') return Response.json({ id: 'lead-1', ...body }, { status: 201 })
      if (url.endsWith('/v1/agents') && body?.role === 'worker') return Response.json({ id: 'worker-1', ...body }, { status: 201 })
      if (url.endsWith('/v1/teams')) return Response.json({ id: 'team-1', display_name: '采购团队', objective: '处理采购工作' }, { status: 201 })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('developer@example.test', 'secret')

    await expect(service.createDevelopmentTeam({ version: '1', name: '采购团队', objective: '处理采购工作' })).resolves.toEqual({ id: 'team-1', name: '采购团队', objective: '处理采购工作' })
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual(['POST /v1/agents', 'POST /v1/agents', 'POST /v1/teams'])
    expect(calls[2].body).toMatchObject({ display_name: '采购团队', lead_avatar_id: 'lead-1', workers: [{ worker_agent_id: 'worker-1' }] })
  })

  it('updates team details and adds and removes a team member', async () => {
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input)), method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      if (url.pathname.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'developer@example.test' } })
      if (url.pathname.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
      calls.push({ path: url.pathname, method, body })
      if (url.pathname === '/v1/agents') return Response.json({ id: 'worker-2', name: body?.name }, { status: 201 })
      if (method === 'DELETE') return new Response(null, { status: 204 })
      return Response.json({}, { status: method === 'POST' ? 201 : 200 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('developer@example.test', 'secret')

    await service.updateDevelopmentTeam({ version: '1', teamId: 'team-1', name: '合同交接组', objective: '完成合同复核', expectedUpdatedAt: '2026-09-21T00:00:00Z' })
    await expect(service.createDevelopmentTeamMember({ version: '1', teamId: 'team-1', name: '法务复核员', duty: '复核法律条款' })).resolves.toEqual({ id: 'worker-2', name: '法务复核员' })
    await service.removeDevelopmentTeamMember('team-1', 'worker-2')

    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/v1/teams/team-1/profile', method: 'PUT', body: { display_name: '合同交接组', objective: '完成合同复核', expected_updated_at: '2026-09-21T00:00:00Z' } }),
      expect.objectContaining({ path: '/v1/teams/team-1/workers', method: 'POST', body: expect.objectContaining({ worker_agent_id: 'worker-2', duty: '复核法律条款' }) }),
      expect.objectContaining({ path: '/v1/teams/team-1/workers/worker-2', method: 'DELETE' }),
    ]))
  })

  it('creates a readable three-step workflow from the selected team members', async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'developer@example.test', name: 'Developer' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
      calls.push({ url, method, body })
      if (url.endsWith('/members/lead-1/config-draft')) return Response.json({ version: '1', team_id: 'team-1', agent_id: 'lead-1', agent_name: 'lead', base_agent_version: 2, revision: 0, updated_at: '2026-09-21T00:00:00Z', configuration: { display_name: '负责人', role: 'avatar', engine: 'loom', system_prompt: '理解任务' }, relationship: {} })
      if (url.endsWith('/members/worker-1/config-draft')) return Response.json({ version: '1', team_id: 'team-1', agent_id: 'worker-1', agent_name: 'worker', base_agent_version: 3, revision: 0, updated_at: '2026-09-21T00:00:00Z', configuration: { display_name: '执行成员', role: 'worker', engine: 'loom' }, relationship: { result_requirement: '返回成果', enabled: true } })
      if (url.endsWith('/v1/teams/team-1/workflows')) return Response.json({ workflow: { id: 'flow-1', name: '合同流程' }, draft: { version: 1 } }, { status: 201 })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('developer@example.test', 'secret')

    await expect(service.createDevelopmentWorkflow({ version: '1', teamId: 'team-1', name: '合同流程', description: '完成合同交接', leadId: 'lead-1', workerId: 'worker-1' })).resolves.toEqual({ id: 'flow-1', name: '合同流程', draftVersion: 1 })
    const request = calls.find((call) => call.url.endsWith('/v1/teams/team-1/workflows') && call.method === 'POST')?.body
    expect(request).toMatchObject({ name: '合同流程', trigger_config: { schema_version: 1 }, graph_definition: { entry_node_id: 'understand', nodes: [{ type: 'lead' }, { type: 'worker', config: { agent_id: 'worker-1', agent_version: 3 } }, { type: 'deliver' }] } })
  })

  it('validates a workflow draft without publishing it', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'developer@example.test', name: 'Developer' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use', 'teams:develop'] })
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({})
      return Response.json({ valid: false, issues: [{ phase: 4, path: '/nodes/0', node_id: 'review', code: 'workflow_route_missing', message: 'route missing', occurrence: 1 }] })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('developer@example.test', 'secret')

    await expect(service.validateDevelopmentWorkflow('flow-1', 2)).resolves.toEqual({ valid: false, issues: [{ code: 'workflow_route_missing', message: 'route missing', nodeId: 'review' }] })
  })

  it('submits a bound work request and completes a human task without exposing the token', async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      calls.push({ url, body })
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'member@example.test', name: 'Member' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1' }, organization: { id: 'default' }, permissions: ['teams:use'] })
      if (url.includes('/v1/teams?status=active')) return Response.json([{ id: 'team-1', display_name: '合同团队' }])
      if (url.endsWith('/v1/teams/team-1/workflows')) return Response.json({ workflows: [{ id: 'flow-1', name: '合同复核', published_version: 1 }] })
      if (url.includes('/v1/runs?project_id=workbench-weave-1&limit=50')) return Response.json({ runs: [{ run_id: 'run-1', status: 'running' }] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [{ interaction_id: 'human-1', run_id: 'run-1', team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 1, title: '复核', instructions: '确认', updated_at: '2026-09-21T00:00:00Z' }] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({ success: true, data: { notifications: [
        { id: 'notice-1', type: 'work.revision', title: '材料需要修改', body: '请补充交付日期', read: false, createdAt: '2026-09-21T01:00:00Z', data: { kind: 'revision_required', source: { system: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' }, status: 'pending', instructions: '补充交付日期后重新提交', material: { label: '当前材料' }, continuation: { reason: '缺少交付日期', returnTarget: 'origin_review', reviewScope: 'affected_members' } } },
        { id: 'notice-1', type: 'work.revision', title: '材料需要修改', body: '重复投递不应重复显示', read: false, createdAt: '2026-09-21T01:01:00Z' },
      ] } })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [] })
      if (url.endsWith('/v1/workbench/dispatch-inputs')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer weave-token')
        expect(new Headers(init?.headers).get('X-Weave-Forge-Authorization')).toBe('Bearer forge-token')
        expect(JSON.stringify(body)).not.toContain('forge-token')
        return Response.json({ input_revision_id: 'input-1', client_request_id: 'client-1', task_sha256: createHash('sha256').update(String(body?.task)).digest('hex') }, { status: 201 })
      }
      if (url.endsWith('/v1/teams/team-1/dispatch')) return Response.json({ run_id: 'run-2', task_id: 'task-2', workflow_id: 'flow-1', workflow_version: 1 }, { status: 201 })
      if (url.endsWith('/v1/human-tasks/run-1/complete')) return Response.json({ run_id: 'run-1', idempotent: false }, { status: 202 })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    const session = await service.signIn('member@example.test', 'secret')
    expect(session.user?.weaveUserId).toBe('weave-1')
    const overview = await service.getWorkOverview()
    expect(overview.items).toHaveLength(1)
    expect(overview).toMatchObject({ choices: [{ teamId: 'team-1', workflowId: 'flow-1', version: 1 }], tasks: [{ interactionId: 'human-1' }], items: [{ id: 'notice-1', kind: 'revision_required', actionable: true, source: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1', returnTarget: 'origin_review', reviewScope: 'affected_members' }], runs: [{ id: 'run-1' }], reads: { runs: { status: 'loaded' }, teamChoices: { status: 'loaded' }, weaveTasks: { status: 'loaded' }, forgeApprovals: { status: 'loaded' }, notifications: { status: 'loaded' } } })
    await expect(service.submitWork(overview.choices[0], '提交合同')).resolves.toMatchObject({ runId: 'run-2', workflowVersion: 1 })
    await expect(service.completeHumanTask(overview.tasks[0], { decision: 'approved' })).resolves.toEqual({ runId: 'run-1', repeated: false })
    const registration = calls.find((call) => call.url.endsWith('/v1/workbench/dispatch-inputs'))?.body
    expect(registration).toMatchObject({ team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 1, project_id: 'workbench-weave-1', task: '提交合同' })
    expect(String(registration?.workbench_session_id)).toMatch(/^workbench-weave-1-/)
    expect(JSON.stringify(calls)).not.toContain('weave-token')
  })

  it('loads native Forge approvals, routes reviewer decisions, and blocks native resubmit', async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      calls.push({ url, method, body })
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'sales-1', email: 'sales@example.test', name: 'Sales' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-sales-1', externalId: 'sales-1' }, organization: { id: 'default' }, permissions: ['teams:use'] })
      if (url.includes('/v1/teams?status=active')) return Response.json([])
      if (url.includes('/v1/runs?project_id=')) return Response.json({ runs: [] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({ notifications: [] })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [
        { id: 'approval-1', process_name: '销售合同复核', current_step: '财务复核', object_name: '销售合同', status: 'pending', updated_at: '2026-09-22T08:00:00Z', viewer: { can_act: true } },
        { id: 'approval-2', process_name: '销售合同复核', object_name: '销售合同', status: 'returned', updated_at: '2026-09-22T09:00:00Z', viewer: { is_submitter: true } },
      ] })
      if (url.endsWith('/api/v1/approvals/requests/approval-2/actions')) return Response.json({ data: [{ action: 'submit' }, { action: 'revise', comment: '请补齐附件' }] })
      if (url.endsWith('/api/v1/approvals/requests/approval-1/revise')) return Response.json({ status: 'returned' })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('sales@example.test', 'secret')

    const overview = await service.getWorkOverview()
    expect(overview.tasks).toMatchObject([
      { interactionId: 'approval-1', runId: 'forge:approval:approval-1', source: 'forge', mode: 'approval' },
      { interactionId: 'approval-2', runId: 'forge:revision:approval-2', source: 'forge', mode: 'revision', instructions: '退回原因：请补齐附件' },
    ])
    await service.completeHumanTask(overview.tasks[0], { decision: 'rejected', comment: '请补充付款条件' })
    await expect(service.completeHumanTask(overview.tasks[1], { decision: 'approved', comment: '已补充' })).rejects.toThrow('Forge 修订材料递交业务动作尚未接通')
    expect(calls.find((call) => call.url.endsWith('/approval-1/revise'))).toMatchObject({ method: 'POST', body: { comment: '请补充付款条件' } })
    expect(calls.some((call) => call.url.endsWith('/approval-2/resubmit'))).toBe(false)
  })

  it('keeps Weave runs and tasks visible when Forge approvals and notifications fail', async () => {
    const fetchMock = workOverviewFetch((url) => {
      if (url.endsWith('/v1/teams?status=active')) return Response.json({ teams: [] })
      if (url.includes('/v1/runs?project_id=')) return Response.json({ runs: [{ run_id: 'run-weave', status: 'running' }] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [{ interaction_id: 'task-weave', run_id: 'run-weave', team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 1, title: '团队检查', instructions: '补充产品范围', updated_at: '2026-09-23T01:00:00Z' }] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({}, { status: 503 })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({}, { status: 404 })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    const overview = await service.getWorkOverview()
    expect(overview.runs).toMatchObject([{ id: 'run-weave' }])
    expect(overview.tasks).toMatchObject([{ interactionId: 'task-weave' }])
    expect(overview.reads).toMatchObject({ runs: { status: 'loaded' }, weaveTasks: { status: 'loaded' }, forgeApprovals: { status: 'failed', error: expect.stringContaining('404') }, notifications: { status: 'failed', error: expect.stringContaining('503') } })
  })

  it('keeps the signed-in employee’s Forge approval visible when Weave reads fail', async () => {
    const fetchMock = workOverviewFetch((url) => {
      if (url.startsWith('http://weave/')) return Response.json({}, { status: 503 })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({ notifications: [{ id: 'notice-forge', type: 'business.result', title: '业务结果', read: false, createdAt: '2026-09-23T01:00:00Z' }] })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [
        { id: 'approval-own', process_name: '合同复核', current_step: '交付复核', record_title: '当前员工合同', status: 'pending', updated_at: '2026-09-23T01:00:00Z', viewer: { can_act: true } },
        { id: 'approval-other', process_name: '合同复核', status: 'pending', updated_at: '2026-09-23T01:00:00Z', viewer: { can_act: false } },
      ] })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    const overview = await service.getWorkOverview()
    expect(overview.tasks).toMatchObject([{ interactionId: 'approval-own', title: '当前员工合同 · 交付复核', source: 'forge', mode: 'approval' }])
    expect(overview.tasks.some((task) => task.interactionId === 'approval-other')).toBe(false)
    expect(overview.items).toMatchObject([{ id: 'notice-forge' }])
    expect(overview.reads).toMatchObject({ runs: { status: 'failed' }, teamChoices: { status: 'failed' }, weaveTasks: { status: 'failed' }, forgeApprovals: { status: 'loaded' }, notifications: { status: 'loaded' } })
  })

  it('clears a source error after a refresh reads that source successfully', async () => {
    let forgeAvailable = false
    const fetchMock = workOverviewFetch((url) => {
      if (url.endsWith('/v1/teams?status=active')) return Response.json({ teams: [] })
      if (url.includes('/v1/runs?project_id=')) return Response.json({ runs: [] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return forgeAvailable ? Response.json({ notifications: [{ id: 'notice-recovered', type: 'business.result', title: '恢复后的消息', read: false, createdAt: '2026-09-23T01:00:00Z' }] }) : Response.json({}, { status: 503 })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [] })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    const failed = await service.getWorkOverview()
    expect(failed.reads.notifications).toMatchObject({ status: 'failed' })
    expect(failed.items).toEqual([])
    forgeAvailable = true
    const recovered = await service.getWorkOverview()
    expect(recovered.reads.notifications).toEqual({ status: 'loaded' })
    expect(recovered.items).toMatchObject([{ id: 'notice-recovered' }])
  })

  it('does not treat reading a work message as completing the underlying item', async () => {
    const fetchMock = workOverviewFetch((url) => {
      if (url.endsWith('/v1/teams?status=active')) return Response.json({ teams: [] })
      if (url.includes('/v1/runs?project_id=')) return Response.json({ runs: [] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({ notifications: [
        { id: 'notice-read', type: 'business.result', title: '合同状态更新', read: true, createdAt: '2026-09-24T01:00:00Z' },
      ] })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [] })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    await expect(service.getWorkOverview()).resolves.toMatchObject({ items: [{ id: 'notice-read', read: true, status: 'unknown' }] })
  })

  it('fetches an exact Weave continuation and compares all notification references', async () => {
    const task = '请对照已固定的技术协议检查合同。'
    const result = '团队建议补充验收日期。'
    const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
    const payload = {
      version: '1',
      source: { input_revision_id: '10000000-0000-4000-8000-000000000001', run_id: 'run-1', workbench_session_id: 'workbench-session-1' },
      input: {
        task, task_sha256: sha256(task), team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 2,
        materials: [], source_messages: [{ message_id: 'employee-message', event_seq: 1, sha256: sha256('员工要求').toUpperCase() }],
      },
      run: { status: 'succeeded', final_result: { id: 'deliverable-1', title: '团队检查结果', content_type: 'text/markdown', content: result, sha256: sha256(result) } },
    }
    const calls: Array<{ url: string; headers: Headers }> = []
    const fetchMock = workOverviewFetch((url, init) => {
      if (url.endsWith('/workbench-context')) {
        calls.push({ url, headers: new Headers(init?.headers) })
        return Response.json(payload)
      }
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')
    const references = { workReference: payload.source.input_revision_id, runReference: 'run-1', sessionReference: 'workbench-session-1' }

    await expect(service.getWorkContinuationContext(references)).resolves.toMatchObject({
      source: { inputRevisionID: references.workReference, runID: references.runReference, workbenchSessionID: references.sessionReference },
      input: { task, teamID: 'team-1', workflowID: 'flow-1', workflowVersion: 2, sourceMessages: [{ sha256: sha256('员工要求').toUpperCase() }] },
      run: { status: 'succeeded', finalResult: { title: '团队检查结果', content: result } },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://weave/v1/runs/run-1/workbench-context')
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer weave-token-employee@example.test')

    await expect(service.getWorkContinuationContext({ ...references, workReference: '10000000-0000-4000-8000-000000000002' })).rejects.toThrow('工作消息与原团队工作不匹配')
    await expect(service.getWorkContinuationContext({ ...references, runReference: 'run-other' })).rejects.toThrow('工作消息与原团队工作不匹配')
    await expect(service.getWorkContinuationContext({ ...references, sessionReference: 'another-session' })).rejects.toThrow('工作消息与原团队工作不匹配')
  })

  it('reads original work files through the owner-only Forge route and verifies the Weave material tuple', async () => {
    const task = '检查这份原工作材料。', content = '原工作材料正文\n'
    const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
    const material = { type: 'forge-file', id: '10000000-0000-4000-8000-000000000002', name: '技术协议.txt', bytes: Buffer.byteLength(content), sha256: sha256(content) }
    const payload = {
      version: '1',
      source: { input_revision_id: '10000000-0000-4000-8000-000000000001', run_id: 'run-1', workbench_session_id: 'workbench-session-1' },
      input: {
        task, task_sha256: sha256(task), team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 2,
        materials: [material], source_messages: [{ message_id: 'employee-message', event_seq: 1, sha256: sha256('员工要求') }],
      },
      run: { status: 'succeeded' },
    }
    const calls: Array<{ url: string; auth?: string }> = []
    let forgeDigest = material.sha256
    let fileReadStatus = 200
    const fetchMock = workOverviewFetch((url, init) => {
      calls.push({ url, auth: new Headers(init?.headers).get('Authorization') ?? undefined })
      if (url.endsWith('/workbench-context')) return Response.json(payload)
      if (url.endsWith(`/api/v1/workbench/materials/${material.id}`)) return fileReadStatus === 200 ? Response.json({
          version: '1', fileId: material.id, name: material.name, mediaType: 'text/plain; charset=utf-8',
          bytes: Buffer.byteLength(content), sha256: forgeDigest, content,
        }) : Response.json({ error: { code: 'WORKBENCH_MATERIAL_NOT_FOUND' } }, { status: fileReadStatus })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')
    const references = { workReference: payload.source.input_revision_id, runReference: 'run-1', sessionReference: 'workbench-session-1' }

    await expect(service.getWorkContinuationContext(references)).resolves.toMatchObject({ input: { materials: [{ id: material.id, content }] } })
    expect(calls).toMatchObject([
      { url: 'http://weave/v1/runs/run-1/workbench-context', auth: 'Bearer weave-token-employee@example.test' },
      { url: `http://forge/api/v1/workbench/materials/${material.id}`, auth: 'Bearer forge-token-employee@example.test' },
    ])
    forgeDigest = sha256('different bytes')
    await expect(service.getWorkContinuationContext(references)).rejects.toThrow('原工作材料与固定输入不一致')
    forgeDigest = material.sha256
    fileReadStatus = 404
    await expect(service.getWorkContinuationContext(references)).rejects.toThrow('原工作材料读取失败（404）')
  })

  it('discards an in-flight overview when the signed-in account changes', async () => {
    const oldRun = deferred<Response>(), oldRunStarted = deferred<void>()
    const fetchMock = workOverviewFetch((url, init) => {
      const auth = new Headers(init?.headers).get('Authorization')
      if (url.includes('/v1/runs?project_id=') && auth === 'Bearer weave-token-a@example.test') { oldRunStarted.resolve(); return oldRun.promise }
      if (url.endsWith('/v1/teams?status=active')) return Response.json({ teams: [] })
      if (url.includes('/v1/runs?project_id=')) return Response.json({ runs: [] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({ notifications: [] })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [] })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('a@example.test', 'secret')
    const oldOverview = service.getWorkOverview()
    await oldRunStarted.promise
    await service.signIn('b@example.test', 'secret')
    oldRun.resolve(Response.json({ runs: [{ run_id: 'run-from-a', status: 'running' }] }))

    await expect(oldOverview).rejects.toThrow('账号已切换')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-in', user: { id: 'b@example.test' } })
  })

  it('maps only the bounded Forge approval context and rejects changed file bytes', async () => {
    const original = '# 合同\n仅供验收\n'
    const digest = createHash('sha256').update(original).digest('hex')
    const attachment = '# 技术协议\n验收标准\n'
    const attachmentDigest = createHash('sha256').update(attachment).digest('hex')
    let fileContent = original
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input); calls.push(url)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'reviewer-1' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-reviewer-1', externalId: 'reviewer-1' }, organization: { id: 'default' }, permissions: ['teams:use'] })
      if (url.endsWith('/api/v1/approvals/requests/approval-1/workbench-context')) return Response.json({
        version: '1', requestId: 'approval-1', status: 'pending', viewer: 'current_approver',
        title: '设备验收合同', step: '交付复核', fields: [{ label: '合同名称', value: '设备验收合同' }],
        businessObject: { objectName: 'forge_sales_contract', recordId: 'contract-1', recordName: '设备验收合同' }, sourceMaterialVersion: createHash('sha256').update('source-v1').digest('hex'),
        files: [
          { fileId: 'approval-file-1', name: '合同.md', mediaType: 'text/plain; charset=utf-8', bytes: Buffer.byteLength(fileContent), sha256: digest, content: fileContent },
          { fileId: 'approval-file-2', name: '技术协议.md', mediaType: 'text/plain; charset=utf-8', bytes: Buffer.byteLength(attachment), sha256: attachmentDigest, content: attachment },
        ],
      })
      if (url.endsWith('/api/v1/approvals/requests/approval-2/workbench-context')) return Response.json({
        version: '1', requestId: 'approval-2', status: 'returned', viewer: 'original_submitter',
        title: '设备验收合同', step: '销售修改', returnReason: '请补齐附件', returnVersion: 'revise-1',
        businessObject: { objectName: 'forge_sales_contract', recordId: 'contract-1', recordName: '设备验收合同' }, sourceMaterialVersion: createHash('sha256').update('source-v1').digest('hex'),
        fields: [{ label: '合同名称', value: '设备验收合同' }], files: [],
      })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock })
    await service.signIn('reviewer@example.test', 'secret')

    const context = await service.getApprovalContext('approval-1')
    expect(context).toMatchObject({ requestId: 'approval-1', status: 'pending', viewer: 'current_approver', title: '设备验收合同', step: '交付复核', businessObject: { objectName: 'forge_sales_contract', recordId: 'contract-1' }, sourceMaterialVersion: createHash('sha256').update('source-v1').digest('hex'), fields: [{ label: '合同名称', value: '设备验收合同' }], files: [{ fileId: 'approval-file-1', name: '合同.md', content: original, sha256: digest, verified: true }, { fileId: 'approval-file-2', name: '技术协议.md', content: attachment, sha256: attachmentDigest, verified: true }] })
    const returnedContext = await service.getApprovalContext('approval-2')
    expect(returnedContext).toMatchObject({ requestId: 'approval-2', status: 'returned', viewer: 'original_submitter', title: '设备验收合同', step: '销售修改', returnReason: '请补齐附件', returnVersion: 'revise-1', businessObject: { objectName: 'forge_sales_contract', recordId: 'contract-1' }, sourceMaterialVersion: createHash('sha256').update('source-v1').digest('hex'), files: [] })
    expect(returnedContext).not.toHaveProperty('revisionReady')
    expect(calls.filter((url) => url.includes('/api/v1/data/') || /\/api\/v1\/storage\/files\/[^/]+\/url/.test(url))).toEqual([])
    expect(calls.filter((url) => url.includes('/workbench-context'))).toHaveLength(2)
    fileContent = '# 另一份合同\n'
    await expect(service.getApprovalContext('approval-1')).rejects.toThrow('审批文件与提交版本不一致')
  })

  it.each([
    [401, undefined, '登录已失效，请重新登录'],
    [404, 'APPROVAL_CONTEXT_NOT_FOUND', '这项审批已无法由当前员工处理，请刷新待办'],
    [409, 'APPROVAL_CONTEXT_STALE', '审批状态已变化，请刷新待办'],
    [413, 'APPROVAL_MATERIAL_TOO_LARGE', '审批材料过大，请在 Forge 中查看'],
    [415, 'APPROVAL_MATERIAL_UNSUPPORTED_TYPE', '此审批材料格式暂不支持桌面预览，请在 Forge 中查看'],
    [422, 'APPROVAL_MATERIAL_HASH_MISMATCH', '审批材料与本次提交版本不一致，请暂停处理并刷新待办'],
    [422, 'APPROVAL_MATERIAL_HASH_UNAVAILABLE', '审批记录没有可核验的材料摘要，请在 Forge 中查看'],
  ])('handles approval context HTTP %i safely', async (status, code, message) => {
    const secret = 'PRIVATE_APPROVAL_RESPONSE_BODY'
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input); calls.push(url)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'reviewer-1' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-reviewer-1', externalId: 'reviewer-1' }, organization: { id: 'default' }, permissions: ['teams:use'] })
      if (url.endsWith('/api/v1/approvals/requests/approval-1/workbench-context')) return Response.json({ error: { code, detail: secret } }, { status })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock })
    await service.signIn('reviewer@example.test', 'secret')

    const error = await service.getApprovalContext('approval-1').then(() => undefined, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(message)
    expect((error as Error).message).not.toContain(secret)
    expect(calls.filter((url) => url.includes('/api/v1/data/') || /\/api\/v1\/storage\/files\/[^/]+\/url/.test(url))).toEqual([])
  })

  it('discards an approval context response after the account changes', async () => {
    const contextRequest = deferred<void>(), lateContext = deferred<Response>()
    const fetchMock = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) {
        const email = (JSON.parse(String(init?.body)) as { email: string }).email
        return Promise.resolve(Response.json({ token: `forge-token-${email}`, user: { id: email } }))
      }
      if (url.endsWith('/v1/auth/external/exchange')) {
        const account = new Headers(init?.headers).get('Authorization')?.replace('Bearer forge-token-', '') ?? 'unknown'
        return Promise.resolve(Response.json({ token: `weave-token-${account}`, subject: { id: `weave-${account}`, externalId: account }, organization: { id: 'default' }, permissions: ['teams:use'] }))
      }
      if (url.endsWith('/api/v1/approvals/requests/approval-1/workbench-context')) {
        contextRequest.resolve(undefined)
        return lateContext.promise
      }
      return Promise.resolve(Response.json({}, { status: 404 }))
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock })
    await service.signIn('a@example.test', 'secret')
    const pending = service.getApprovalContext('approval-1')
    await contextRequest.promise
    await service.signIn('b@example.test', 'secret')
    lateContext.resolve(Response.json({ version: '1', requestId: 'approval-1', status: 'pending', viewer: 'current_approver', title: '旧账号合同正文', step: '交付复核', fields: [], files: [] }))

    await expect(pending).rejects.toThrow('账号已切换，旧请求结果已丢弃')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-in', user: { id: 'b@example.test' } })
  })

  it('discards an approval context error after the account changes', async () => {
    const contextRequest = deferred<void>(), lateContext = deferred<Response>()
    const fetchMock = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) {
        const email = (JSON.parse(String(init?.body)) as { email: string }).email
        return Promise.resolve(Response.json({ token: `forge-token-${email}`, user: { id: email } }))
      }
      if (url.endsWith('/v1/auth/external/exchange')) {
        const account = new Headers(init?.headers).get('Authorization')?.replace('Bearer forge-token-', '') ?? 'unknown'
        return Promise.resolve(Response.json({ token: `weave-token-${account}`, subject: { id: `weave-${account}`, externalId: account }, organization: { id: 'default' }, permissions: ['teams:use'] }))
      }
      if (url.endsWith('/api/v1/approvals/requests/approval-1/workbench-context')) {
        contextRequest.resolve(undefined)
        return lateContext.promise
      }
      return Promise.resolve(Response.json({}, { status: 404 }))
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock })
    await service.signIn('a@example.test', 'secret')
    const pending = service.getApprovalContext('approval-1')
    await contextRequest.promise
    await service.signIn('b@example.test', 'secret')
    lateContext.resolve(Response.json({ error: { code: 'APPROVAL_MATERIAL_HASH_MISMATCH', detail: '旧账号响应' } }, { status: 422 }))

    await expect(pending).rejects.toThrow('账号已切换，旧请求结果已丢弃')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-in', user: { id: 'b@example.test' } })
  })

  it('uploads the exact frozen bytes to Forge before dispatch', async () => {
    const content = '# 合同\n固定版本\n', uploaded: string[] = [], uploads: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'sales-1' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'sales-1' }, organization: { id: 'default' }, permissions: ['teams:use'] })
      if (url.endsWith('/api/v1/storage/upload/presigned')) {
        uploads.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return Response.json({ data: { fileId: 'file-1', uploadUrl: '/upload/file-1', method: 'PUT', headers: { 'Content-Type': 'text/plain' } } })
      }
      if (url.endsWith('/upload/file-1')) { uploaded.push(Buffer.from(init?.body as Uint8Array).toString('utf8')); return new Response(null, { status: 200 }) }
      if (url.endsWith('/api/v1/storage/upload/complete')) return Response.json({ data: { fileId: 'file-1' } })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('sales@example.test', 'secret')
    const resources = await service.stageWorkMaterials([{ name: '合同.md', content, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }], async () => undefined)
    expect(uploaded).toEqual([content])
    expect(uploads).toEqual([{ filename: '合同.md', mimeType: 'text/plain; charset=utf-8', size: Buffer.byteLength(content), scope: 'attachments' }])
    expect(resources).toEqual([{ type: 'forge-file', id: 'file-1', name: '合同.md', bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }])
  })

  it('posts only frozen Forge file references and reads the same revision receipt', async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = []
    const idempotencyKey = '550e8400-e29b-41d4-a716-446655440000'
    const receipt = {
      requestId: 'approval-2', bindingId: '550e8400-e29b-41d4-a716-446655440001',
      newVersionDigest: createHash('sha256').update('new-contract').digest('hex'), state: 'resumed', repeated: true,
    }
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      calls.push({ url, method, body })
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'sales-1' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-sales-1', externalId: 'sales-1' }, organization: { id: 'default' }, permissions: ['teams:use'] })
      if (url.endsWith('/api/v1/approvals/requests/approval-2/workbench-revision')) return Response.json({ data: receipt })
      if (url.endsWith(`/api/v1/approvals/requests/approval-2/workbench-revision/${idempotencyKey}`)) return Response.json({ data: receipt })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('sales@example.test', 'secret')
    const body = {
      returnVersion: 'revise-1', sourceMaterialVersion: createHash('sha256').update('source').digest('hex'), idempotencyKey,
      primary: { fileId: 'primary-file', name: '修订正文.md', sha256: createHash('sha256').update('primary').digest('hex') },
      attachments: [{ fileId: 'attachment-file', name: '报价附件.txt', sha256: createHash('sha256').update('attachment').digest('hex') }],
    }
    const post = await service.submitApprovalRevision('approval-2', body, async () => undefined)
    const readback = await service.getApprovalRevisionReceipt('approval-2', idempotencyKey, async () => undefined)
    expect(post).toEqual({ status: 200, body: { data: receipt } })
    expect(readback).toEqual({ status: 200, body: { data: receipt } })
    expect(calls.filter((call) => call.url.endsWith('/approval-2/workbench-revision'))).toEqual([expect.objectContaining({
      url: 'http://forge/api/v1/approvals/requests/approval-2/workbench-revision', method: 'POST', body,
    })])
    expect(calls.find((call) => call.method === 'GET' && call.url.includes('/workbench-revision/'))?.url)
      .toBe(`http://forge/api/v1/approvals/requests/approval-2/workbench-revision/${idempotencyKey}`)
    expect(JSON.stringify(calls)).not.toContain('recordId')
    expect(calls.some((call) => call.url.endsWith('/approval-2/resubmit'))).toBe(false)
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
