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
      : Response.json({ token: 'weave-secret', expiresIn: 3600, subject: { id: 'weave-1', externalId: 'forge-1', email: 'member@example.test', name: 'Member', role: 'member' }, organization: { id: 'default' } })) as typeof fetch
    try {
      const first = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetcher, sessionPath, sessionCodec: codec })
      await expect(first.signIn('member@example.test', 'secret')).resolves.toMatchObject({ status: 'signed-in', storage: 'encrypted' })
      const persisted = await readFile(sessionPath, 'utf8')
      expect(persisted).not.toContain('weave-secret')
      expect(persisted).not.toContain('forge-secret')
      expect(persisted).not.toContain('secret"')
      const restarted = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetcher, sessionPath, sessionCodec: codec })
      await expect(restarted.getSession()).resolves.toMatchObject({ status: 'signed-in', role: 'member', storage: 'encrypted' })
      expect((await restarted.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-secret')
      await restarted.signOut()
      await expect(readFile(sessionPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('projects Forge actions into developer-facing business capabilities', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'developer@example.test' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1', role: 'developer' }, organization: { id: 'default' } })
      if (url.endsWith('/api/v1/mcp')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer forge-token')
        expect(JSON.parse(String(init?.body))).toMatchObject({ method: 'tools/call', params: { name: 'list_actions' } })
        return Response.json({ jsonrpc: '2.0', id: 'business-capability-catalog', result: { content: [{ type: 'text', text: JSON.stringify({ actions: [{ name: 'ContractSubmit', objectName: 'sales_contract', label: '提交销售合同', description: '校验后提交合同' }] }) }] } })
      }
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('developer@example.test', 'secret')

    await expect(service.getBusinessCapabilityCatalog()).resolves.toMatchObject({
      provider: { name: 'Forge 业务环境', status: 'available' },
      capabilities: [{ id: 'forge:action:sales_contract.ContractSubmit', name: '提交销售合同', effect: 'write', requiresEmployeeIntent: true }],
    })
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

  it('projects authenticated Weave teams, exact workflow graphs, and attributed runs', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'admin@example.test', name: 'Admin' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1', role: 'admin' }, organization: { id: 'default' } })
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer weave-token')
      if (url.endsWith('/v1/runtimes')) return Response.json({ runtimes: [{ id: 'runtime-local', name: '本机运行时', engines: ['codex'], health_status: 'healthy', online: true }] })
      if (url.includes('/v1/teams?')) return Response.json([{ team: { id: 'team-1', display_name: '合同交接团队', objective: '完成合同交接', status: 'active', updated_at: '2026-09-21T00:00:00Z' }, lead: { id: 'lead-1', display_name: '负责人', role: 'avatar', enabled: true }, workers: [{ id: 'worker-1', display_name: '审核员', role: 'worker', configured_duty: '审核合同', enabled: true }], summary: { worker_count: 1, active_workflow_count: 1, published_workflow_count: 1, health: { conclusion: 'healthy', reason_codes: [] } } }])
      if (url.endsWith('/v1/teams/team-1/workflows')) return Response.json({ workflows: [{ id: 'flow-1', name: '合同处理', status: 'active', published_version: 2, trigger_summary: { type: 'manual' } }] })
      if (url.endsWith('/v1/workflows/flow-1/versions/2')) return Response.json({ graph_definition: { nodes: [{ id: 'review', type: 'agent', label: '审核', config: { agent_id: 'worker-1' } }], edges: [] } })
      if (url.includes('/v1/runs?view=team&team_id=team-1')) return Response.json({ runs: [{ run_id: 'run-1', status: 'succeeded', step: 'review', duration_ms: 1200, tokens_in: 10, tokens_out: 20, cost_usd: 0.01 }] })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('admin@example.test', 'secret')

    await expect(service.getDevelopmentOverview()).resolves.toMatchObject({
      version: '1', runtimes: [{ name: '本机运行时', online: true }], teams: [{ id: 'team-1', name: '合同交接团队', lead: { name: '负责人' }, workers: [{ name: '审核员', duty: '审核合同' }], workflows: [{ id: 'flow-1', inspectedVersion: 2, nodes: [{ id: 'review', workerId: 'worker-1' }] }], runs: [{ id: 'run-1', status: 'succeeded' }] }],
    })
  })

  it('reads and saves a server-backed team member configuration draft', async () => {
    const requests: Array<{ method: string; body?: Record<string, unknown> }> = []
    const response = (revision: number) => ({
      version: '1', team_id: 'team-1', agent_id: 'worker-1', agent_name: 'reviewer', base_agent_version: 3, revision,
      updated_at: '2026-09-21T10:00:00Z', configuration: {
        display_name: revision ? '合同复核员' : '审核员', role: 'worker', engine: 'pi', runtime_id: 'local-pi', model: 'default',
        system_prompt: '检查合同', skill_names: ['contract-review'], mcp_server_ids: ['forge'], permission_allow: ['contract.read'],
        memory_enabled: true, memory_scope: 'tenant', max_tokens: 12000, output_schema: { type: 'object' },
      }, relationship: { duty: '复核合同', when_to_use: '合同提交后', allowed_kinds: ['handoff'], default_kind: 'handoff', enabled: true },
    })
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'forge-1', email: 'admin@example.test', name: 'Admin' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1', role: 'developer' }, organization: { id: 'default' } })
      requests.push({ method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) })
      return Response.json(response(init?.method === 'PUT' ? 1 : 0))
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('admin@example.test', 'secret')
    const draft = await service.getTeamMemberConfigDraft('team-1', 'worker-1')
    expect(draft).toMatchObject({ agentName: 'reviewer', revision: 0, configuration: { engine: 'pi', outputSchema: expect.stringContaining('object') }, relationship: { duty: '复核合同' } })
    draft.configuration.displayName = '合同复核员'
    const saved = await service.saveTeamMemberConfigDraft(draft)
    expect(saved).toMatchObject({ revision: 1, configuration: { displayName: '合同复核员' } })
    expect(requests.at(-1)).toMatchObject({ method: 'PUT', body: { revision: 0, configuration: { display_name: '合同复核员' } } })
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
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1', role: 'developer' }, organization: { id: 'default' } })
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
      if (url.pathname.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1', role: 'developer' }, organization: { id: 'default' } })
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
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1', role: 'developer' }, organization: { id: 'default' } })
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
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1', role: 'developer' }, organization: { id: 'default' } })
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
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'forge-1', role: 'member' }, organization: { id: 'default' } })
      if (url.includes('/v1/teams?status=active')) return Response.json([{ id: 'team-1', display_name: '合同团队' }])
      if (url.endsWith('/v1/teams/team-1/workflows')) return Response.json({ workflows: [{ id: 'flow-1', name: '合同复核', published_version: 1 }] })
      if (url.includes('/v1/runs?view=team')) return Response.json({ runs: [{ run_id: 'run-1', status: 'running' }] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [{ interaction_id: 'human-1', run_id: 'run-1', team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 1, title: '复核', instructions: '确认', updated_at: '2026-09-21T00:00:00Z' }] })
      if (url.endsWith('/v1/workbench/dispatch-inputs')) return Response.json({ input_revision_id: 'input-1', client_request_id: 'client-1' }, { status: 201 })
      if (url.endsWith('/v1/teams/team-1/dispatch')) return Response.json({ run_id: 'run-2', task_id: 'task-2', workflow_id: 'flow-1', workflow_version: 1 }, { status: 201 })
      if (url.endsWith('/v1/human-tasks/run-1/complete')) return Response.json({ run_id: 'run-1', idempotent: false }, { status: 202 })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    const session = await service.signIn('member@example.test', 'secret')
    expect(session.user?.weaveUserId).toBe('weave-1')
    const overview = await service.getWorkOverview()
    expect(overview).toMatchObject({ choices: [{ teamId: 'team-1', workflowId: 'flow-1', version: 1 }], tasks: [{ interactionId: 'human-1' }], runs: [{ id: 'run-1' }] })
    await expect(service.submitWork(overview.choices[0], '提交合同')).resolves.toMatchObject({ runId: 'run-2', workflowVersion: 1 })
    await expect(service.completeHumanTask(overview.tasks[0], { decision: 'approved' })).resolves.toEqual({ runId: 'run-1', repeated: false })
    const registration = calls.find((call) => call.url.endsWith('/v1/workbench/dispatch-inputs'))?.body
    expect(registration).toMatchObject({ team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 1, task: '提交合同' })
    expect(String(registration?.workbench_session_id)).toMatch(/^workbench-weave-1-/)
    expect(JSON.stringify(calls)).not.toContain('weave-token')
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
