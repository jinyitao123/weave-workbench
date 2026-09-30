import { createHash } from 'node:crypto'
import { freezeMaterials, makeFrozenTextMaterial } from '../../electron/main/enterprise/materials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { approvalContextView, EnterpriseService, WorkRegistrationRejectedError } from '../../electron/main/enterprise'
import type { BusinessRecordRead } from '../../electron/main/enterprise/business-records'
import { digest } from '../../electron/main/enterprise/handoff-store'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

function teamRunMetadata(
  source: { workReference: string; runReference: string; sessionReference: string },
  options: { actionOutcomes?: Array<Record<string, unknown>>; omitActionOutcomes?: boolean } = {},
) {
  const task = '按员工授权提交合同材料。'
  const result = '团队意见：验收日期待确认。'
  return {
    version: '1',
    source: { input_revision_id: source.workReference, run_id: source.runReference, workbench_session_id: source.sessionReference },
    input: {
      task, task_sha256: digest(task), team_id: 'team-contract', workflow_id: 'workflow-review', workflow_version: 1,
      materials: [{
        type: 'forge-file', id: 'original-contract', name: '合同原件.pdf', bytes: 12, sha256: digest('pdf-original'),
        materialId: '0123456789abcdef01234567', mediaType: 'application/pdf', sourceKind: 'owner',
      }],
      source_messages: [{ message_id: 'employee-message', event_seq: 1, sha256: digest('员工原始要求') }],
    },
    run: {
      status: 'succeeded',
      final_result: {
        id: 'deliverable-contract-review', title: '合同检查意见', content_type: 'text/markdown', content: result,
        sha256: digest(result), disposition: 'needs_input', summary: '验收日期待确认。', missing_items: ['验收日期'],
      },
      ...(!options.omitActionOutcomes ? { action_outcomes: options.actionOutcomes ?? [] } : {}),
    },
  }
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
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' }, fetch: fetchMock })
    const earlierLogin = service.signIn('a@example.test', 'secret')
    await started.promise
    await service.signIn('b@example.test', 'secret')
    delayedExchange.resolve(Response.json({ token: 'weave-token-a@example.test', subject: { id: 'weave-a', externalId: 'a@example.test', email: 'a@example.test', name: 'A' }, organization: { id: 'default' }, permissions: ['teams:use'] }))

    await expect(earlierLogin).rejects.toThrow('账号已切换')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-in', user: { id: 'b@example.test' } })
    expect((await service.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-token-b@example.test')
  })

  it('does not keep a partial session when Forge credentials are rejected', async () => {
    const service = new EnterpriseService({
      environment: { WORKBENCH_FORGE_URL: 'http://forge.example.test', WORKBENCH_WEAVE_URL: 'http://weave.example.test' },
      fetch: (async () => Response.json({}, { status: 401 })) as typeof fetch,
    })
    await expect(service.signIn('member@example.test', 'wrong')).rejects.toThrow('账号或密码不正确')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-out' })
  })

  it('keeps Forge and Weave tokens in memory and leaves legacy encrypted session files untouched', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gooeypi-enterprise-session-only-'))
    const sessionPath = join(directory, 'enterprise-session.json')
    const legacyContents = JSON.stringify({
      version: 3,
      expiresAt: Date.now() + 60 * 60 * 1000,
      weaveToken: 'legacy-encrypted-weave-token',
      forgeToken: 'legacy-encrypted-forge-token',
      session: { version: '1', status: 'signed-in', permissions: ['teams:use'] },
    })
    await writeFile(sessionPath, legacyContents, { encoding: 'utf8', mode: 0o600 })
    const codec = {
      available: vi.fn(() => true),
      encrypt: vi.fn(() => { throw new Error('legacy session encryption must not be used') }),
      decrypt: vi.fn(() => { throw new Error('legacy session decryption must not be used') }),
    }
    const fetcher = (async (input: URL | RequestInfo) => String(input).includes('sign-in')
      ? Response.json({ token: 'forge-secret', user: { id: 'forge-1', email: 'member@example.test', name: 'Member' } })
      : Response.json({ token: 'weave-secret', expiresIn: 3600, subject: { id: 'weave-1', externalId: 'forge-1', email: 'member@example.test', name: 'Member' }, organization: { id: 'default' }, permissions: ['teams:use'] })) as typeof fetch
    const legacyOptions = Object.assign(
      { environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetcher },
      { sessionPath, sessionCodec: codec },
    )
    try {
      const service = new EnterpriseService(legacyOptions)
      const session = await service.signIn('member@example.test', 'secret')
      expect(session).toMatchObject({ status: 'signed-in', storage: 'session-only', user: { id: 'forge-1' } })
      expect(JSON.stringify(session)).not.toContain('secret')
      expect((await service.authorizationHeaders()).get('Authorization')).toBe('Bearer weave-secret')

      await service.signOut()
      const reopened = new EnterpriseService(legacyOptions)
      await expect(reopened.getSession()).resolves.toMatchObject({ status: 'signed-out' })
      await expect(reopened.authorizationHeaders()).rejects.toThrow('请先登录')
      expect(codec.available).not.toHaveBeenCalled()
      expect(codec.encrypt).not.toHaveBeenCalled()
      expect(codec.decrypt).not.toHaveBeenCalled()
      expect(await readFile(sessionPath, 'utf8')).toBe(legacyContents)
      expect(await readdir(directory)).toEqual(['enterprise-session.json'])
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

  it('fails closed when employee action metadata contains unsupported array or object parameters', async () => {
    const actions = [
      { name: 'UpdateQuoteLines', objectName: 'forge_quote', label: '调整报价明细', description: '按要求调整报价明细', params: [{ name: 'lines', type: 'array', required: true }] },
      { name: 'UpdateQuoteObject', objectName: 'forge_quote', label: '更新报价结构', description: '按要求更新报价结构', params: [{ name: 'value', type: 'string', required: true }] },
      { name: 'ReadQuote', objectName: 'forge_quote', label: '读取报价', description: '读取报价', params: [{ name: 'quote_id', type: 'string', required: true }] },
    ]
    const metadata = {
      type: 'object', name: 'forge_quote', sortability: {},
      item: { name: 'forge_quote', fields: {}, actions: [
        { name: 'UpdateQuoteLines', params: [{ name: 'lines', type: 'multiselect', multiple: true, required: true }] },
        { name: 'UpdateQuoteObject', params: [{ name: 'value', type: 'object', required: true }] },
        { name: 'ReadQuote', params: [{ name: 'quote_id', type: 'text', required: true }] },
      ] },
    }
    const fetchMock = workOverviewFetch((url) => {
      if (url.endsWith('/api/v1/mcp')) return Response.json({ jsonrpc: '2.0', id: 'business-capability-catalog', result: { content: [{ type: 'text', text: JSON.stringify({ actions }) }] } })
      if (url.endsWith('/api/v1/meta/objects/forge_quote')) return Response.json(metadata)
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    await expect(service.getBusinessCapabilities([
      'forge:action:forge_quote.UpdateQuoteLines',
      'forge:action:forge_quote.UpdateQuoteObject',
      'forge:action:forge_quote.ReadQuote',
    ])).rejects.toThrow('参数暂不可安全绑定')
  })

  it('restores file cardinality and objectOverride types only for employee-visible actions', async () => {
    const actions = [
      { name: 'contract_submit_material_package', objectName: 'forge_sales_contract', description: '提交材料集合', requiresRecord: true, params: [
        { name: 'primary_file_id', type: 'string', required: true },
        { name: 'material_file_ids', type: 'string', required: true },
      ] },
      { name: 'sales_lead_convert_to_opportunity', objectName: 'forge_sales_lead', description: '转为商机', requiresRecord: true, params: [
        { name: 'amount', type: 'string', required: false },
        { name: 'expected_close_on', type: 'string', required: false },
        { name: 'account_ref', type: 'string', required: false },
      ] },
      { name: 'unselected_contract_action', objectName: 'forge_sales_contract', description: '未选择动作', requiresRecord: true, params: [{ name: 'id', type: 'string', required: true }] },
    ]
    const objectMetadata = (name: string, objectActions: unknown[], fields: Record<string, unknown> = {}) => ({
      type: 'object', name, sortability: {}, item: { name, actions: objectActions, fields },
    })
    const calls: Array<{ url: string; method?: string; auth?: string }> = []
    const fetchMock = workOverviewFetch((url, init) => {
      calls.push({ url, method: init?.method, auth: new Headers(init?.headers).get('Authorization') ?? undefined })
      if (url.endsWith('/api/v1/mcp')) return Response.json({ jsonrpc: '2.0', id: 'business-capability-catalog', result: { content: [{ type: 'text', text: JSON.stringify({ actions }) }] } })
      if (url.endsWith('/api/v1/meta/objects/forge_sales_contract')) return Response.json(objectMetadata('forge_sales_contract', [
        { name: 'contract_submit_material_package', params: [
          { name: 'primary_file_id', type: 'file', multiple: false, required: true },
          { name: 'material_file_ids', type: 'file', multiple: true, required: true },
        ] },
        { name: 'unselected_contract_action', params: [{ name: 'id', type: 'text', required: true }] },
      ]))
      if (url.endsWith('/api/v1/meta/objects/forge_sales_lead')) return Response.json(objectMetadata('forge_sales_lead', [
        { name: 'sales_lead_convert_to_opportunity', params: [
          { field: 'amount', objectOverride: 'forge_sales_opportunity', required: false },
          { field: 'expected_close_on', objectOverride: 'forge_sales_opportunity', required: false },
          { name: 'account_ref', type: 'reference', required: false },
        ] },
      ]))
      if (url.endsWith('/api/v1/meta/objects/forge_sales_opportunity')) return Response.json(objectMetadata('forge_sales_opportunity', [], {
        amount: { type: 'currency' }, expected_close_on: { type: 'date' },
      }))
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    const catalog = await service.getBusinessCapabilities([
      'forge:action:forge_sales_contract.contract_submit_material_package',
      'forge:action:forge_sales_lead.sales_lead_convert_to_opportunity',
    ])
    expect(catalog).toMatchObject([
      { id: 'forge:action:forge_sales_contract.contract_submit_material_package', params: [
        { name: 'primary_file_id', type: 'file', multiple: false, required: true },
        { name: 'material_file_ids', type: 'file', multiple: true, required: true },
      ] },
      { id: 'forge:action:forge_sales_lead.sales_lead_convert_to_opportunity', params: [
        { name: 'amount', type: 'number', required: false },
        { name: 'expected_close_on', type: 'string', required: false },
        { name: 'account_ref', type: 'string', required: false },
      ] },
    ])
    expect(catalog.map((action) => action.id)).not.toContain('forge:action:forge_sales_contract.unselected_contract_action')
    expect(calls.filter((call) => call.url.includes('/api/v1/meta/objects/'))).toEqual([
      expect.objectContaining({ url: 'http://forge/api/v1/meta/objects/forge_sales_contract', auth: 'Bearer forge-token-employee@example.test' }),
      expect.objectContaining({ url: 'http://forge/api/v1/meta/objects/forge_sales_lead', auth: 'Bearer forge-token-employee@example.test' }),
      expect.objectContaining({ url: 'http://forge/api/v1/meta/objects/forge_sales_opportunity', auth: 'Bearer forge-token-employee@example.test' }),
    ])
    expect(calls.some((call) => call.url.endsWith('/api/v1/meta/actions'))).toBe(false)
  })

  it('does not degrade denied native employee metadata to the string summary or sign out', async () => {
    const actions = [{ name: 'contract_submit_material_package', objectName: 'forge_sales_contract', params: [{ name: 'material_file_ids', type: 'string', required: true }] }]
    const fetchMock = workOverviewFetch((url) => {
      if (url.endsWith('/api/v1/mcp')) return Response.json({ jsonrpc: '2.0', id: 'business-capability-catalog', result: { content: [{ type: 'text', text: JSON.stringify({ actions }) }] } })
      if (url.endsWith('/api/v1/meta/objects/forge_sales_contract')) return Response.json({ error: 'forbidden' }, { status: 403 })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    await expect(service.getBusinessCapabilities(['forge:action:forge_sales_contract.contract_submit_material_package']))
      .rejects.toThrow('没有读取 Forge 对象 forge_sales_contract 原生动作声明的权限')
    await expect(service.getSession()).resolves.toMatchObject({ status: 'signed-in' })
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
        business_capability_ids: ['forge:action:sales_contract.ContractSubmit'], business_capability_bindings: [{ capability_id: 'forge:action:sales_contract.ContractSubmit', parameters: [{ name: 'material_file_ids', source: 'materials.ids' }] }],
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
    expect(draft).toMatchObject({ agentName: 'reviewer', revision: 0, configuration: { engine: 'pi', outputSchema: expect.stringContaining('object'), businessCapabilityBindings: [{ capabilityId: 'forge:action:sales_contract.ContractSubmit', parameters: [{ name: 'material_file_ids', source: 'materials.ids' }] }] }, relationship: { duty: '复核合同' } })
    draft.configuration.displayName = '合同复核员'
    const saved = await service.saveTeamMemberConfigDraft(draft)
    expect(saved).toMatchObject({ revision: 1, configuration: { displayName: '合同复核员' } })
    expect(requests.at(-1)).toMatchObject({ method: 'PUT', body: { revision: 0, configuration: { display_name: '合同复核员', business_capability_bindings: [{ capability_id: 'forge:action:sales_contract.ContractSubmit', parameters: [{ name: 'material_file_ids', source: 'materials.ids' }] }] } } })
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

  it('removes a superseded team request from pending work while keeping its historical message', async () => {
    const notice = (id: string, kind: string, createdAt: string) => ({
      id, type: `weave.team_run.${kind}`, title: `合同检查${kind}`, body: '团队结果', createdAt, read: false,
    })
    const sourceById: Record<string, { kind: string; workReference: string; sessionReference: string }> = {
      old: { kind: 'revision_required', workReference: 'revision-1', sessionReference: 'contract-work' },
      new: { kind: 'result', workReference: 'revision-2', sessionReference: 'contract-work' },
      other: { kind: 'revision_required', workReference: 'revision-3', sessionReference: 'another-work' },
    }
    const fetchMock = workOverviewFetch((url) => {
      if (url.includes('/v1/teams?status=active')) return Response.json([])
      if (url.includes('/v1/runs?')) return Response.json({ runs: [] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [] })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({ data: { notifications: [
        notice('old', 'revision_required', '2026-09-29T02:18:00Z'),
        notice('new', 'result', '2026-09-29T05:09:00Z'),
        notice('other', 'revision_required', '2026-09-29T02:18:00Z'),
      ] } })
      const sourceId = /^http:\/\/forge\/api\/v1\/workbench\/notifications\/([^/]+)\/source$/.exec(url)?.[1]
      if (sourceId && sourceById[sourceId]) {
        const { kind, ...references } = sourceById[sourceId]
        return Response.json({
          version: '1', notificationId: sourceId, kind,
          source: { system: 'weave', ...references, runReference: `run-${sourceId}` },
        })
      }
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('sales@example.test', 'secret')
    const overview = await service.getWorkOverview()
    expect(overview.items.find((item) => item.id === 'old')).toMatchObject({ actionable: false, status: 'completed', read: false })
    expect(overview.items.find((item) => item.id === 'new')).toMatchObject({ kind: 'result', sessionReference: 'contract-work' })
    expect(overview.items.find((item) => item.id === 'other')).toMatchObject({ actionable: true, status: 'pending' })
  })

  it('moves needs-input notices to messages only for a current-account, exact Weave success receipt', async () => {
    const entries = [
      { id: 'succeeded', workReference: '550e8400-e29b-41d4-a716-446655440101', runReference: 'run-succeeded', sessionReference: 'work-session-succeeded', outcomes: [{ node_id: 'submit', call_id: 'call-succeeded', action_name: 'contract_submit', object_name: 'sales_contract', status: 'succeeded', summary: 'Forge 确认提交成功。' }] },
      { id: 'no-action', workReference: '550e8400-e29b-41d4-a716-446655440102', runReference: 'run-no-action', sessionReference: 'work-session-no-action', outcomes: [] },
      { id: 'unknown', workReference: '550e8400-e29b-41d4-a716-446655440103', runReference: 'run-unknown', sessionReference: 'work-session-unknown', outcomes: [{ node_id: 'submit', call_id: 'call-unknown', action_name: 'contract_submit', object_name: 'sales_contract', status: 'unknown', summary: 'Forge 结果待核对。' }] },
      { id: 'missing-receipt', workReference: '550e8400-e29b-41d4-a716-446655440104', runReference: 'run-missing', sessionReference: 'work-session-missing', omitActionOutcomes: true },
      { id: 'unreadable', workReference: '550e8400-e29b-41d4-a716-446655440105', runReference: 'run-unreadable', sessionReference: 'work-session-unreadable', readFails: true },
      { id: 'mismatched-source', workReference: '550e8400-e29b-41d4-a716-446655440106', runReference: 'run-source-match', sessionReference: 'work-session-mismatch', outcomes: [{ node_id: 'submit', call_id: 'call-mismatch', action_name: 'contract_submit', object_name: 'sales_contract', status: 'succeeded', summary: 'Forge 确认提交成功。' }], inlineSource: { system: 'weave', workReference: '550e8400-e29b-41d4-a716-446655440199', runReference: 'run-unrelated', sessionReference: 'work-session-mismatch' } },
    ]
    const forgeSourceAuth: Array<string | null> = []
    const weaveContextAuth: Array<string | null> = []
    const calls: string[] = []
    const fetchMock = workOverviewFetch((url, init) => {
      calls.push(url)
      if (url.includes('/v1/teams?status=active')) return Response.json([])
      if (url.includes('/v1/runs?')) return Response.json({ runs: [] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [] })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({ notifications: entries.map((entry) => ({
        id: entry.id, type: 'weave.team_run.revision_required', title: '合同检查', body: '补充事项供参考', read: false, createdAt: '2026-09-30T02:00:00Z',
        ...(entry.inlineSource ? { data: { source: entry.inlineSource } } : {}),
      })) })
      const sourceID = /^http:\/\/forge\/api\/v1\/workbench\/notifications\/([^/]+)\/source$/.exec(url)?.[1]
      if (sourceID) {
        forgeSourceAuth.push(new Headers(init?.headers).get('Authorization'))
        const entry = entries.find(({ id }) => id === sourceID)
        if (!entry) return Response.json({}, { status: 404 })
        return Response.json({ version: '1', notificationId: entry.id, kind: 'revision_required', source: {
          system: 'weave', workReference: entry.workReference, runReference: entry.runReference, sessionReference: entry.sessionReference,
        } })
      }
      const runID = /^http:\/\/weave\/v1\/runs\/([^/]+)\/workbench-context$/.exec(url)?.[1]
      if (runID) {
        weaveContextAuth.push(new Headers(init?.headers).get('Authorization'))
        const entry = entries.find(({ runReference }) => runReference === runID)
        if (entry?.readFails) return Response.json({}, { status: 503 })
        if (entry) return Response.json(teamRunMetadata(entry, {
          ...(entry.outcomes ? { actionOutcomes: entry.outcomes } : {}),
          ...(entry.omitActionOutcomes ? { omitActionOutcomes: true } : {}),
        }))
      }
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('sales@example.test', 'secret')

    const overview = await service.getWorkOverview()
    expect(overview.items.find((item) => item.id === 'succeeded')).toMatchObject({
      actionable: false, status: 'completed', read: false, runReference: 'run-succeeded', title: '团队结果与业务回执',
      summary: expect.stringContaining('后续办理事项以 Forge 当前正式事项为准'),
    })
    for (const id of ['no-action', 'unknown', 'missing-receipt', 'unreadable', 'mismatched-source']) {
      expect(overview.items.find((item) => item.id === id)).toMatchObject({ actionable: true, status: 'pending' })
    }
    expect(overview.items.find((item) => item.id === 'succeeded')).toMatchObject({ kind: 'revision_required', notificationType: 'weave.team_run.revision_required' })
    expect(forgeSourceAuth.every((authorization) => authorization === 'Bearer forge-token-sales@example.test')).toBe(true)
    expect(weaveContextAuth.every((authorization) => authorization === 'Bearer weave-token-sales@example.test')).toBe(true)
    expect(calls.some((url) => url.includes('/original') || url.includes('/workbench/materials/'))).toBe(false)
    expect(calls).not.toContain('http://weave/v1/runs/run-unrelated/workbench-context')
  })

  it('does not reuse a successful action receipt across employee accounts', async () => {
    const source = { workReference: '550e8400-e29b-41d4-a716-446655440201', runReference: 'run-shared-notice', sessionReference: 'work-session-shared' }
    const contextAuthors: string[] = []
    const fetchMock = workOverviewFetch((url, init) => {
      if (url.includes('/v1/teams?status=active')) return Response.json([])
      if (url.includes('/v1/runs?')) return Response.json({ runs: [] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [] })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({ notifications: [
        { id: 'same-notice', type: 'weave.team_run.revision_required', title: '合同检查', body: '团队意见', read: false, createdAt: '2026-09-30T02:00:00Z' },
      ] })
      if (url.endsWith('/api/v1/workbench/notifications/same-notice/source')) return Response.json({
        version: '1', notificationId: 'same-notice', kind: 'revision_required', source: { system: 'weave', ...source },
      })
      if (url.endsWith(`/v1/runs/${source.runReference}/workbench-context`)) {
        const authorization = new Headers(init?.headers).get('Authorization') ?? ''
        contextAuthors.push(authorization)
        return Response.json(teamRunMetadata(source, authorization === 'Bearer weave-token-alice@example.test' ? {
          actionOutcomes: [{ node_id: 'submit', call_id: 'call-alice', action_name: 'contract_submit', object_name: 'sales_contract', status: 'succeeded', summary: 'Forge 确认提交成功。' }],
        } : { actionOutcomes: [] }))
      }
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })

    await service.signIn('alice@example.test', 'secret')
    const alice = await service.getWorkOverview()
    expect(alice.items[0]).toMatchObject({ actionable: false, status: 'completed' })
    await service.signIn('bob@example.test', 'secret')
    const bob = await service.getWorkOverview()
    expect(bob.items[0]).toMatchObject({ actionable: true, status: 'pending' })
    expect(contextAuthors).toEqual(['Bearer weave-token-alice@example.test', 'Bearer weave-token-bob@example.test'])
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
        { id: 'notice-native', type: 'weave.team_run.result', title: '合同检查结果', body: '已有团队结果', read: false, createdAt: '2026-09-21T02:00:00Z' },
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
    expect(overview.items).toHaveLength(2)
    expect(overview).toMatchObject({ choices: [{ teamId: 'team-1', workflowId: 'flow-1', version: 1 }], tasks: [{ interactionId: 'human-1' }], items: [
      { id: 'notice-1', kind: 'revision_required', actionable: true, source: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1', returnTarget: 'origin_review', reviewScope: 'affected_members' },
      { id: 'notice-native', kind: 'result', source: 'weave', notificationType: 'weave.team_run.result', status: 'unknown' },
    ], runs: [{ id: 'run-1' }], reads: { runs: { status: 'loaded' }, teamChoices: { status: 'loaded' }, weaveTasks: { status: 'loaded' }, forgeApprovals: { status: 'loaded' }, notifications: { status: 'loaded' } } })
    await expect(service.submitWork(overview.choices[0], '提交合同')).resolves.toMatchObject({ runId: 'run-2', workflowVersion: 1 })
    await expect(service.completeHumanTask(overview.tasks[0], { decision: 'approved' })).resolves.toEqual({ runId: 'run-1', repeated: false })
    const registration = calls.find((call) => call.url.endsWith('/v1/workbench/dispatch-inputs'))?.body
    expect(registration).toMatchObject({ team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 1, project_id: 'workbench-weave-1', task: '提交合同' })
    expect(String(registration?.workbench_session_id)).toMatch(/^workbench-weave-1-/)
    expect(JSON.stringify(calls)).not.toContain('weave-token')
  })

  it('restarts a failed read-only team run in the same work session without inventing a prior deliverable', async () => {
    const registrations: Record<string, unknown>[] = []
    const fetchMock = workOverviewFetch((url, init) => {
      if (url.endsWith('/v1/workbench/dispatch-inputs')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        registrations.push(body)
        return Response.json({ input_revision_id: 'new-input', client_request_id: 'new-client', task_sha256: createHash('sha256').update(String(body.task)).digest('hex') }, { status: 201 })
      }
      if (url.endsWith('/v1/teams/team-1/dispatch')) return Response.json({ run_id: 'new-run', task_id: 'new-task', workflow_id: 'flow-1', workflow_version: 1 }, { status: 201 })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('sales@example.test', 'secret')
    const accountKey = await service.accountKey()
    const choice = { teamId: 'team-1', teamName: '团队', workflowId: 'flow-1', workflowName: '流程', businessCapabilityIds: [], version: 1 }
    const base = {
      sessionKey: 'session', sourceMessages: [{ messageId: 'message-1', eventSeq: 1, sha256: 'a'.repeat(64) }], accountKey,
      resources: [], authorizedBusinessCapabilityIds: [], assertCurrent: async () => {},
    }
    const continuation = { workbenchSessionID: 'original-session', inputRevisionID: '550e8400-e29b-41d4-a716-446655440000', runID: 'failed-run', teamID: 'team-1' }
    await service.submitWork(choice, '重新检查当前材料', { ...base, idempotencySeed: 'retry-1', continuation: { ...continuation, restartAfterFailedRun: true } })
    expect(registrations[0]).toMatchObject({ workbench_session_id: 'original-session', expected_revision_id: continuation.inputRevisionID })
    expect(registrations[0]).not.toHaveProperty('revision_context')
    await service.submitWork(choice, '修订已有结论', { ...base, idempotencySeed: 'revision-1', continuation })
    expect(registrations[1]).toMatchObject({ revision_context: { parent_input_revision_id: continuation.inputRevisionID, parent_run_id: continuation.runID } })
    await expect(service.submitWork(choice, '再次检查', { ...base, idempotencySeed: 'unsafe-1', authorizedBusinessCapabilityIds: ['write'], continuation: { ...continuation, restartAfterFailedRun: true } })).rejects.toThrow('先核对 Forge 结果')
    expect(registrations).toHaveLength(2)
  })

  it('treats a registration version conflict as a definite rejection without dispatching', async () => {
    let dispatched = false
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: workOverviewFetch((url) => {
      if (url.endsWith('/v1/workbench/dispatch-inputs')) return Response.json({ code: 'input_revision_conflict', error: 'current dispatch input revision changed' }, { status: 409 })
      if (url.endsWith('/v1/teams/team-1/dispatch')) dispatched = true
      return undefined
    }) })
    await service.signIn('sales@example.test', 'secret')
    const source = {
      idempotencySeed: 'same-intent', sessionKey: 'session', accountKey: await service.accountKey(),
      sourceMessages: [{ messageId: 'message-1', eventSeq: 1, sha256: 'a'.repeat(64) }], resources: [], authorizedBusinessCapabilityIds: [],
      continuation: { workbenchSessionID: 'original-session', inputRevisionID: '550e8400-e29b-41d4-a716-446655440000', runID: 'failed-run', teamID: 'team-1' },
      assertCurrent: async () => {},
    }
    await expect(service.submitWork({ teamId: 'team-1', teamName: '团队', workflowId: 'flow-1', workflowName: '流程', businessCapabilityIds: [], version: 1 }, '重新检查', source)).rejects.toBeInstanceOf(WorkRegistrationRejectedError)
    expect(dispatched).toBe(false)
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

  it('hides a returned approval task after its native resubmission, but keeps a later return actionable', async () => {
    let actions: Array<{ action: string; comment?: string }> = [
      { action: 'submit' },
      { action: 'revise', comment: '第一轮请补充附件' },
      { action: 'resubmit' },
    ]
    const fetchMock = workOverviewFetch((url) => {
      if (url.endsWith('/v1/teams?status=active')) return Response.json({ teams: [] })
      if (url.includes('/v1/runs?project_id=')) return Response.json({ runs: [] })
      if (url.endsWith('/v1/human-tasks?limit=50')) return Response.json({ tasks: [] })
      if (url.endsWith('/api/v1/notifications?limit=200')) return Response.json({ notifications: [] })
      if (url.endsWith('/api/v1/approvals/requests?limit=50')) return Response.json({ requests: [
        { id: 'approval-returned', process_name: '销售合同复核', record_title: '测试合同', object_name: 'forge_sales_contract', status: 'returned', updated_at: '2026-09-26T09:00:00Z', viewer: { is_submitter: true } },
      ] })
      if (url.endsWith('/api/v1/approvals/requests/approval-returned/actions')) return Response.json({ data: actions })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('sales@example.test', 'secret')

    await expect(service.getWorkOverview()).resolves.toMatchObject({ tasks: [] })

    actions = [...actions, { action: 'submit' }, { action: 'revise', comment: '第二轮仍需补材料' }]
    await expect(service.getWorkOverview()).resolves.toMatchObject({
      tasks: [{ interactionId: 'approval-returned', mode: 'revision', instructions: '退回原因：第二轮仍需补材料' }],
    })
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
      run: { status: 'succeeded', final_result: { id: 'deliverable-1', title: '团队检查结果', content_type: 'text/markdown', content: result, sha256: sha256(result), disposition: 'needs_input', summary: '已核对🧭', missing_items: ['验收日期'] } },
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
      run: { status: 'succeeded', finalResult: { title: '团队检查结果', content: result, disposition: 'needs_input', summary: '已核对🧭', missingItems: ['验收日期'] } },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://weave/v1/runs/run-1/workbench-context')
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer weave-token-employee@example.test')

    const originalFinalResult = structuredClone(payload.run.final_result)
    payload.run.final_result.summary = '🧭'.repeat(1000)
    await expect(service.getWorkContinuationContext(references)).resolves.toMatchObject({ run: { finalResult: { summary: '🧭'.repeat(1000) } } })
    payload.run.final_result.summary = '🧭'.repeat(1001)
    await expect(service.getWorkContinuationContext(references)).rejects.toThrow('团队结果分类格式无效')
    payload.run.final_result = { ...originalFinalResult, missing_items: [] }
    await expect(service.getWorkContinuationContext(references)).rejects.toThrow('团队结果分类格式无效')
    payload.run.final_result = { ...originalFinalResult, disposition: undefined as unknown as 'needs_input' }
    await expect(service.getWorkContinuationContext(references)).rejects.toThrow('团队结果分类格式无效')
    payload.run.final_result = { ...originalFinalResult, disposition: 'complete', missing_items: ['验收日期'] }
    await expect(service.getWorkContinuationContext(references)).rejects.toThrow('团队结果分类格式无效')
    payload.run.final_result = { ...originalFinalResult, disposition: 'complete', missing_items: [] }
    await expect(service.getWorkContinuationContext(references)).resolves.toMatchObject({ run: { finalResult: { disposition: 'complete', missingItems: [] } } })
    payload.run.final_result = originalFinalResult

    await expect(service.getWorkContinuationContext({ ...references, workReference: '10000000-0000-4000-8000-000000000002' })).rejects.toThrow('工作消息与原团队工作不匹配')
    await expect(service.getWorkContinuationContext({ ...references, runReference: 'run-other' })).rejects.toThrow('工作消息与原团队工作不匹配')
    await expect(service.getWorkContinuationContext({ ...references, sessionReference: 'another-session' })).rejects.toThrow('工作消息与原团队工作不匹配')
  })

  it('reads more than eight small frozen material references within the byte budgets', async () => {
    const task = '按固定输入继续核对。'
    const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
    const files = Array.from({ length: 9 }, (_, index) => {
      const content = `第 ${index + 1} 份小材料`
      const name = `附件-${index + 1}.txt`
      const id = `forge-text-${index + 1}`
      return {
        id, name, mediaType: 'text/plain', bytes: Buffer.byteLength(content), sha256: sha256(content),
        materialId: digest(JSON.stringify([name, 'text/plain', sha256(content)])).slice(0, 24), content,
      }
    })
    const payload = {
      version: '1',
      source: { input_revision_id: '10000000-0000-4000-8000-000000000001', run_id: 'run-nine-files', workbench_session_id: 'workbench-session-nine-files' },
      input: {
        task, task_sha256: sha256(task), team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 2,
        materials: files.map(({ id, name, mediaType, bytes, sha256: hash, materialId }) => ({
          type: 'forge-file', id, name, mediaType, bytes, sha256: hash, materialId,
        })),
        source_messages: [{ message_id: 'employee-message', event_seq: 1, sha256: sha256('员工要求') }],
      },
      run: { status: 'succeeded' },
    }
    const fetchMock = workOverviewFetch((url) => {
      if (url.endsWith('/workbench-context')) return Response.json(payload)
      const file = files.find((item) => url.endsWith(`/api/v1/workbench/materials/${item.id}`))
      if (file) return Response.json({
        version: '1', fileId: file.id, name: file.name, mediaType: 'text/plain; charset=utf-8',
        bytes: file.bytes, sha256: file.sha256, content: file.content,
      })
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    const continuation = await service.getWorkContinuationContext({
      workReference: payload.source.input_revision_id, runReference: payload.source.run_id,
      sessionReference: payload.source.workbench_session_id,
    })
    expect(continuation.input.materials).toHaveLength(9)
    expect(continuation.input.materials.map(({ name }) => name)).toEqual(files.map(({ name }) => name))
  })

  it('reads a missing Weave source only through the current Forge-owned notification endpoint', async () => {
    let body: Record<string, unknown> = {
      version: '1', notificationId: 'native-notice-1', kind: 'revision_required',
      source: { system: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' },
    }
    const calls: Array<{ url: string; auth?: string }> = []
    const fetchMock = workOverviewFetch((url, init) => {
      if (url.endsWith('/api/v1/workbench/notifications/native-notice-1/source')) {
        calls.push({ url, auth: new Headers(init?.headers).get('Authorization') ?? undefined })
        return Response.json(body)
      }
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')

    await expect(service.getWorkNotificationSource('native-notice-1')).resolves.toMatchObject({
      notificationID: 'native-notice-1', kind: 'revision_required', source: { workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' },
    })
    expect(calls[0]).toMatchObject({ url: 'http://forge/api/v1/workbench/notifications/native-notice-1/source', auth: 'Bearer forge-token-employee@example.test' })
    body = { ...body, notificationId: 'another-notice' }
    await expect(service.getWorkNotificationSource('native-notice-1')).rejects.toThrow('工作消息来源与当前消息不匹配')
  })

  it('reads a Forge business result by native source, current record, and its authorized historical originals', async () => {
    const sourceBytes = await readFile(new URL('../fixtures/materials/sample-two-page.pdf', import.meta.url))
    const sha256 = createHash('sha256').update(sourceBytes).digest('hex')
    let materialStatus: 'available' | 'none' | 'unavailable' = 'available'
    const calls: string[] = []
    const sourceResponse = () => Response.json({
      version: '1', notificationId: 'business-notice', kind: 'business',
      source: { system: 'forge', objectName: 'forge_sales_contract', recordId: 'contract-current' },
      materialStatus,
      originalFiles: materialStatus === 'available' ? [{
        sourceKind: 'approval', requestId: 'approval-history-1', fileId: 'history-file-1', name: '当前批准合同.pdf',
        mediaType: 'application/pdf', bytes: sourceBytes.length, sha256,
      }] : [],
    })
    const fetchMock = workOverviewFetch((url, init) => {
      calls.push(url)
      if (url.endsWith('/api/v1/workbench/notifications/business-notice/source')) return sourceResponse()
      if (url.endsWith('/api/v1/approvals/requests/approval-history-1/workbench-history/files/history-file-1/original')) {
        expect(new Headers(init?.headers).get('if-match')).toBe(`"${sha256}"`)
        return new Response(Uint8Array.from(sourceBytes), { status: 200, headers: {
          'Content-Type': 'application/pdf', 'Content-Length': String(sourceBytes.length), ETag: `"${sha256}"`,
          'X-Content-SHA256': sha256, 'Cache-Control': 'private, no-store',
        } })
      }
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')
    const record: BusinessRecordRead = {
      candidate: { objectName: 'forge_sales_contract', objectLabel: '销售合同', recordId: 'contract-current', name: '设备验收合同', code: 'C-100', status: '内部复核通过' },
      snapshot: {
        version: 1, capturedAt: '2026-09-30T01:00:00Z', objectLabel: '销售合同',
        record: [{ label: '合同名称', value: '设备验收合同' }, { label: '状态', value: '内部复核通过' }],
        relations: [], completeness: 'complete', pricingDetailCompleteness: 'unknown', completenessNotes: [],
      },
    }
    const readCurrentRecord = vi.spyOn(service, 'readBusinessRecord').mockResolvedValue(record)

    const context = await service.getBusinessNotificationContext('business-notice')
    expect(context).toMatchObject({
      kind: 'business', notificationID: 'business-notice', source: { system: 'forge', objectName: 'forge_sales_contract', recordId: 'contract-current' },
      materialStatus: 'available', record: { candidate: { status: '内部复核通过' } },
      materials: [{ sourceKind: 'approval', requestId: 'approval-history-1', name: '当前批准合同.pdf', extraction: { sourceSha256: sha256 } }],
    })
    expect(readCurrentRecord).toHaveBeenCalledWith('forge_sales_contract', 'contract-current')
    expect(calls.filter((url) => url.includes('/workbench-history/files/'))).toHaveLength(1)
    expect(calls.some((url) => url.includes('/workbench-context/files/'))).toBe(false)

    materialStatus = 'unavailable'
    calls.length = 0
    const unavailable = await service.getBusinessNotificationContext('business-notice')
    expect(unavailable).toMatchObject({ materialStatus: 'unavailable', materials: [] })
    expect(calls.some((url) => url.includes('/files/'))).toBe(false)
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

  it('continues PDF and DOCX using only their frozen owner or approval source route', async () => {
    const task = '复核原工作中冻结的二进制材料。'
    const ownerBytes = await readFile(new URL('../fixtures/materials/sample-two-page.pdf', import.meta.url))
    const approvalBytes = await readFile(new URL('../fixtures/materials/sample-paragraphs-table.docx', import.meta.url))
    const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
    const ownerMaterial = {
      type: 'forge-file', materialId: digest('owner-material').slice(0, 24), sourceKind: 'owner',
      id: 'owner-pdf', name: 'owner.pdf', mediaType: 'application/pdf', bytes: ownerBytes.length, sha256: sha256(ownerBytes),
    }
    const approvalMaterials = Array.from({ length: 11 }, (_, index) => ({
      type: 'forge-file', materialId: digest(`approval-material-${index}`).slice(0, 24), sourceKind: 'approval', requestId: 'approval-source-1',
      id: `approval-docx-${index + 1}`, name: `approval-${index + 1}.docx`, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: approvalBytes.length, sha256: sha256(approvalBytes),
    }))
    const shaOfTask = sha256(task)
    const payload = {
      version: '1',
      source: { input_revision_id: '10000000-0000-4000-8000-000000000001', run_id: 'run-originals', workbench_session_id: 'workbench-session-originals' },
      input: {
        task, task_sha256: shaOfTask, team_id: 'team-1', workflow_id: 'flow-1', workflow_version: 2,
        materials: [ownerMaterial, ...approvalMaterials],
        source_messages: [{ message_id: 'employee-message', event_seq: 1, sha256: sha256('员工要求') }],
      },
      run: { status: 'succeeded' },
    }
    const calls: Array<{ url: string; headers: Headers }> = []
    let denyOwner = false
    const response = (bytes: Buffer, mediaType: string, digest: string) => new Response(Uint8Array.from(bytes), { status: 200, headers: {
      'Content-Type': mediaType, 'Content-Length': String(bytes.length), ETag: `"${digest}"`,
      'X-Content-SHA256': digest, 'Cache-Control': 'private, no-store',
    } })
    const fetchMock = workOverviewFetch((url, init) => {
      calls.push({ url, headers: new Headers(init?.headers) })
      if (url.endsWith('/workbench-context')) return Response.json(payload)
      if (url.endsWith('/api/v1/workbench/materials/owner-pdf/original')) return denyOwner
        ? Response.json({ error: { code: 'WORKBENCH_MATERIAL_NOT_FOUND' } }, { status: 404 })
        : response(ownerBytes, 'application/pdf', ownerMaterial.sha256)
      if (url.startsWith('http://forge/api/v1/approvals/requests/approval-source-1/workbench-history/files/')) {
        const material = approvalMaterials.find((item) => url.endsWith(`/workbench-history/files/${item.id}/original`))
        if (material) return response(approvalBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', material.sha256)
      }
      return undefined
    })
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('employee@example.test', 'secret')
    const references = { workReference: payload.source.input_revision_id, runReference: 'run-originals', sessionReference: 'workbench-session-originals' }

    const context = await service.getWorkContinuationContext(references)
    expect(context.input.materials).toHaveLength(12)
    expect(context.input.materials[0]).toMatchObject({ materialId: ownerMaterial.materialId, sourceKind: 'owner', mediaType: 'application/pdf', sha256: ownerMaterial.sha256, extraction: { sourceSha256: ownerMaterial.sha256, status: 'partial' } })
    expect(context.input.materials.slice(1)).toHaveLength(11)
    expect(context.input.materials.slice(1).every((material, index) => material.materialId === approvalMaterials[index]?.materialId
      && material.sourceKind === 'approval' && material.requestId === 'approval-source-1'
      && material.extraction?.sourceSha256 === approvalMaterials[index]?.sha256 && material.extraction.status === 'complete')).toBe(true)
    expect(context.input.materials[0]?.content).toContain('PDF PAGE 1: byte exact original.')
    expect(context.input.materials[1]?.content).toContain('DOCX 第一段：原件字节保持不变。')
    expect(calls.find((call) => call.url.endsWith('/owner-pdf/original'))?.headers.get('if-match')).toBe(`"${ownerMaterial.sha256}"`)
    for (const material of approvalMaterials) {
      const call = calls.find((item) => item.url.endsWith(`/workbench-history/files/${material.id}/original`))
      expect(call?.headers.get('if-match')).toBe(`"${material.sha256}"`)
    }
    expect(calls.filter((call) => call.url.includes('/workbench-history/files/'))).toHaveLength(11)
    expect(calls.some((call) => call.url.includes('/workbench-context/files/') && call.url.endsWith('/original'))).toBe(false)
    expect(calls.some((call) => call.url === 'http://forge/api/v1/workbench/materials/owner-pdf')).toBe(false)
    expect(calls.some((call) => call.url === 'http://forge/api/v1/workbench/materials/approval-docx')).toBe(false)

    denyOwner = true
    const originalRouteCount = calls.filter((call) => call.url.endsWith('/owner-pdf/original')).length
    await expect(service.getWorkContinuationContext(references)).rejects.toThrow('原工作原件不属于当前员工')
    expect(calls.filter((call) => call.url.endsWith('/owner-pdf/original'))).toHaveLength(originalRouteCount + 1)
    expect(calls.some((call) => call.url === 'http://forge/api/v1/workbench/materials/owner-pdf')).toBe(false)
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

  it('reads more than 11 approval originals only through the current request-bound route', async () => {
    const source = await readFile(new URL('../fixtures/materials/sample-two-page.pdf', import.meta.url))
    const sha256 = createHash('sha256').update(source).digest('hex')
    const originalMaterials = Array.from({ length: 12 }, (_, index) => ({
      sourceKind: 'approval', requestId: 'approval-pdf', fileId: `approval-file-pdf-${index + 1}`,
      name: `验收附件${index + 1}.pdf`, mediaType: 'application/pdf', bytes: source.length, sha256,
    }))
    const calls: Array<{ url: string; headers: Headers }> = []
    let originalResponseStatus = 200
    const originalResponse = () => originalResponseStatus === 200 ? new Response(source, { status: 200, headers: {
      'Content-Type': 'application/pdf', 'Content-Length': String(source.length),
      'X-Content-SHA256': sha256, ETag: `"${sha256}"`, 'Cache-Control': 'private, no-store',
    } }) : new Response(null, { status: originalResponseStatus })
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input), headers = new Headers(init?.headers)
      calls.push({ url, headers })
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'approver-1' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-approver-1', externalId: 'approver-1' }, organization: { id: 'default' }, permissions: ['teams:use'] })
      if (url.endsWith('/api/v1/approvals/requests/approval-pdf/workbench-context')) return Response.json({
        version: '1', requestId: 'approval-pdf', status: 'pending', viewer: 'current_approver',
        title: '验收合同', step: '复核', fields: [], files: [],
        businessObject: { objectName: 'forge_sales_contract', recordId: 'contract-pdf' },
        sourceMaterialVersion: createHash('sha256').update('source-pdf-v1').digest('hex'),
        originalFiles: originalMaterials,
      })
      if (originalMaterials.some((file) => url.endsWith(`/api/v1/approvals/requests/approval-pdf/workbench-context/files/${file.fileId}/original`))) return originalResponse()
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('approver@example.test', 'secret')

    const context = await service.getApprovalContext('approval-pdf')
    expect(context.originalFiles).toHaveLength(12)
    expect(context.originalFiles?.[0]).toMatchObject({
      sourceKind: 'approval', requestId: 'approval-pdf', fileId: 'approval-file-pdf-1',
      name: '验收附件1.pdf', mediaType: 'application/pdf', bytes: source.length, sha256,
      extraction: { sourceSha256: sha256, status: 'partial' },
    })
    expect(Buffer.from(context.originalFiles![0]!.bytesBase64, 'base64')).toEqual(source)
    const originalCall = calls.find((call) => call.url.endsWith('/files/approval-file-pdf-1/original'))!
    expect(originalCall.headers.get('if-match')).toBe(`"${sha256}"`)
    const view = approvalContextView(context)
    expect(view.originalFiles?.[0]).toMatchObject({ name: '验收附件1.pdf', bytes: source.length, verified: true })
    expect(view.originalFiles?.[0]).not.toHaveProperty('fileId')
    expect(view.originalFiles?.[0]).not.toHaveProperty('requestId')
    expect(view.originalFiles?.[0]).not.toHaveProperty('bytesBase64')

    originalResponseStatus = 404
    await expect(service.getApprovalContext('approval-pdf')).rejects.toThrow('审批原件不属于当前员工或冻结材料')
    expect(calls.filter((call) => call.url.includes('/api/v1/workbench/materials/'))).toEqual([])
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
    const content = '# 合同\n固定版本\n', uploaded: Buffer[] = [], uploads: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'sales-1' } })
      if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'sales-1' }, organization: { id: 'default' }, permissions: ['teams:use'] })
      if (url.endsWith('/api/v1/storage/upload/presigned')) {
        uploads.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return Response.json({ data: { fileId: 'file-1', uploadUrl: '/upload/file-1', method: 'PUT', headers: { 'Content-Type': 'text/markdown' } } })
      }
      if (url.endsWith('/upload/file-1')) { uploaded.push(Buffer.from(init?.body as Uint8Array)); return new Response(null, { status: 200 }) }
      if (url.endsWith('/api/v1/storage/upload/complete')) return Response.json({ data: { fileId: 'file-1' } })
      return Response.json({}, { status: 404 })
    }) as typeof fetch
    const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
    await service.signIn('sales@example.test', 'secret')
    const material = makeFrozenTextMaterial('合同.md', Buffer.from(content))
    const resources = await service.stageWorkMaterials([material], async () => undefined)
    expect(uploaded).toEqual([Buffer.from(content)])
    expect(uploads).toEqual([{ filename: '合同.md', mimeType: 'text/markdown', size: Buffer.byteLength(content), scope: 'attachments' }])
    expect(resources).toEqual([{ type: 'forge-file', materialId: material.materialId, id: 'file-1', name: '合同.md', mediaType: 'text/markdown', bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }])
  })

  it('uploads the byte-exact PDF original with its PDF MIME type and frozen material binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forge-pdf-upload-'))
    try {
      const source = await readFile(new URL('../fixtures/materials/sample-two-page.pdf', import.meta.url))
      const sourcePath = join(root, '合同.pdf')
      await writeFile(sourcePath, source)
      const material = (await freezeMaterials(root, [{ path: '合同.pdf', sha256: createHash('sha256').update(source).digest('hex') }]))[0]!
      const uploadBodies: Buffer[] = [], uploads: Array<Record<string, unknown>> = []
      const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/v1/auth/sign-in/email')) return Response.json({ token: 'forge-token', user: { id: 'sales-1' } })
        if (url.endsWith('/v1/auth/external/exchange')) return Response.json({ token: 'weave-token', subject: { id: 'weave-1', externalId: 'sales-1' }, organization: { id: 'default' }, permissions: ['teams:use'] })
        if (url.endsWith('/api/v1/storage/upload/presigned')) {
          uploads.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
          return Response.json({ data: { fileId: 'pdf-file-1', uploadUrl: '/upload/pdf-file-1', method: 'PUT', headers: { 'Content-Type': 'application/pdf' } } })
        }
        if (url.endsWith('/upload/pdf-file-1')) { uploadBodies.push(Buffer.from(init?.body as Uint8Array)); return new Response(null, { status: 200 }) }
        if (url.endsWith('/api/v1/storage/upload/complete')) return Response.json({ data: { fileId: 'pdf-file-1' } })
        return Response.json({}, { status: 404 })
      }) as typeof fetch
      const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge', WORKBENCH_WEAVE_URL: 'http://weave' }, fetch: fetchMock })
      await service.signIn('sales@example.test', 'secret')
      const resources = await service.stageWorkMaterials([material], async () => undefined)
      expect(uploadBodies).toEqual([source])
      expect(uploads).toEqual([{ filename: '合同.pdf', mimeType: 'application/pdf', size: source.length, scope: 'attachments' }])
      expect(resources).toEqual([{ type: 'forge-file', sourceKind: 'owner', materialId: material.materialId, id: 'pdf-file-1', name: '合同.pdf', mediaType: 'application/pdf', bytes: source.length, sha256: material.sha256 }])
    } finally { await rm(root, { recursive: true, force: true }) }
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
