import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseService } from '../../electron/main/enterprise'

function mcpToolResult(value: unknown) {
  return Response.json({ jsonrpc: '2.0', id: 'test', result: { content: [{ type: 'text', text: JSON.stringify(value) }] } })
}

async function serviceFixture(queryStatus = 200) {
  const calls: Array<{ path: string; authorization?: string; body?: Record<string, unknown> }> = []
  const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input)), path = url.pathname
    let body: Record<string, unknown> | undefined
    if (typeof init?.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>
    calls.push({ path, authorization: new Headers(init?.headers).get('Authorization') ?? undefined, body })
    if (path === '/api/v1/auth/sign-in/email') return Response.json({ token: 'forge-token', user: { id: 'employee' } })
    if (path === '/v1/auth/external/exchange') return Response.json({ token: 'weave-token', subject: { id: 'employee' }, organization: { id: 'org' }, permissions: ['teams:use'] })
    if (path === '/api/v1/meta/object/sales_quote') return Response.json({
      type: 'object', name: 'sales_quote', item: { name: 'sales_quote', label: '销售报价', fields: [
        { name: 'id', type: 'text', label: 'ID' }, { name: 'name', type: 'text', label: '报价名称' },
        { name: 'code', type: 'text', label: '报价编号' }, { name: 'item_count', type: 'number', label: '明细行数' },
        { name: 'version', type: 'number', label: '版本' },
      ] },
    })
    if (path === '/api/v1/mcp') {
      const tool = String((body?.params as Record<string, unknown> | undefined)?.name)
      if (tool === 'list_objects') return mcpToolResult({ objects: [{ name: 'sales_quote', label: '销售报价', fieldCount: 12 }], totalCount: 1 })
      if (tool === 'describe_object') return mcpToolResult({ name: 'sales_quote', label: '销售报价', fields: [{ name: 'id', type: 'text', label: 'ID' }, { name: 'name', type: 'text', label: '报价名称' }, { name: 'code', type: 'text', label: '报价编号' }], enableFeatures: [] })
      if (tool === 'get_record') return mcpToolResult({ id: 'internal-id', name: '设备交接报价', code: 'Q-240', item_count: 0, version: 3 })
      if (tool === 'query_records' && queryStatus === 403) return Response.json({ error: 'forbidden' }, { status: 403 })
      if (tool === 'query_records') return mcpToolResult({ object: 'sales_quote', records: [{ id: 'internal-id', name: '设备交接报价', code: 'Q-240' }], total: 1, hasMore: false })
    }
    throw new Error(`unexpected request ${path}`)
  }) as typeof globalThis.fetch
  const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.test', WORKBENCH_WEAVE_URL: 'http://weave.test' }, fetch })
  await service.signIn('employee@example.test', 'test-password')
  return { service, calls }
}

async function continuationFixture(actionOutcomes?: unknown) {
  const task = '按固定工作继续检查。'
  const run = { status: 'succeeded', ...(actionOutcomes !== undefined ? { action_outcomes: actionOutcomes } : {}) }
  const workContext = {
    version: '1',
    source: { input_revision_id: '10000000-0000-4000-8000-000000000001', run_id: 'run-1', workbench_session_id: 'workbench-1' },
    input: {
      task, task_sha256: createHash('sha256').update(task).digest('hex'), team_id: 'team-1', workflow_id: 'workflow-1', workflow_version: 2,
      materials: [], source_messages: [{ message_id: 'employee-message', event_seq: 1, sha256: createHash('sha256').update('继续').digest('hex') }],
    },
    run,
  }
  const fetch = vi.fn(async (input: URL | RequestInfo) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/v1/auth/sign-in/email') return Response.json({ token: 'forge-token', user: { id: 'employee' } })
    if (path === '/v1/auth/external/exchange') return Response.json({ token: 'weave-token', subject: { id: 'weave-user', externalId: 'employee' }, organization: { id: 'org' }, permissions: ['teams:use'] })
    if (path === '/v1/runs/run-1/workbench-context') return Response.json(workContext)
    throw new Error(`unexpected request ${path}`)
  }) as typeof globalThis.fetch
  const service = new EnterpriseService({ environment: { WORKBENCH_FORGE_URL: 'http://forge.test', WORKBENCH_WEAVE_URL: 'http://weave.test' }, fetch })
  await service.signIn('employee@example.test', 'test-password')
  return service
}

describe('Forge native MCP object reads', () => {
  it('reads list_objects through the current Forge session and keeps system objects excluded', async () => {
    const f = await serviceFixture()
    const directory = await f.service.getBusinessObjectDirectory()
    expect(directory).toEqual({ objects: [{ objectName: 'sales_quote', label: '销售报价' }], complete: true, totalCount: 1 })
    const request = f.calls.find((call) => call.path === '/api/v1/mcp')!
    expect(request.authorization).toBe('Bearer forge-token')
    expect(request.body).toMatchObject({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'list_objects', arguments: {} } })
  })

  it('keeps a query permission denial distinct from no matches and does not end the login session', async () => {
    const f = await serviceFixture(403)
    await expect(f.service.findBusinessRecords('sales_quote', 'Q-240', 0, 20)).rejects.toMatchObject({ kind: 'forbidden' })
    expect((await f.service.getSession()).status).toBe('signed-in')
    const calls = f.calls.filter((call) => call.path === '/api/v1/mcp')
    expect(calls.map((call) => (call.body?.params as Record<string, unknown>).name)).toEqual(['list_objects', 'describe_object', 'query_records'])
    expect(calls[2]?.body).toMatchObject({ params: { arguments: { objectName: 'sales_quote', limit: 20, offset: 0 } } })
  })

  it('uses the authorized native metadata endpoint for the selected object relation declaration and get_record for data', async () => {
    const f = await serviceFixture()
    const read = await f.service.readBusinessRecord('sales_quote', 'internal-id')
    expect(read.candidate).toMatchObject({ objectName: 'sales_quote', recordId: 'internal-id', name: '设备交接报价', code: 'Q-240', recordVersion: '3' })
    expect(read.snapshot).toMatchObject({ completeness: 'complete', pricingDetailCompleteness: 'complete', expectedDetailCount: 0 })
    expect(f.calls.some((call) => call.path === '/api/v1/meta/object/sales_quote' && call.authorization === 'Bearer forge-token')).toBe(true)
    expect(f.calls.filter((call) => call.path === '/api/v1/mcp').map((call) => (call.body?.params as Record<string, unknown>).name)).toEqual(['list_objects', 'get_record'])
    expect(f.calls.every((call) => !JSON.stringify(call.body ?? {}).includes('run_action'))).toBe(true)
  })

  it('preserves Weave action outcomes while leaving an absent field explicitly absent', async () => {
    const service = await continuationFixture([{
      node_id: 'review', call_id: 'call-1', action_name: 'quotation_adjust_line_price', object_name: 'sales_quote',
      record_id: 'record-internal-1', status: 'unknown', summary: 'Forge 动作结果未知，须按当前业务状态核对。',
    }])
    const context = await service.getWorkContinuationContext({ workReference: '10000000-0000-4000-8000-000000000001', runReference: 'run-1', sessionReference: 'workbench-1' })
    expect(context.run.actionOutcomes).toEqual([{
      nodeID: 'review', callID: 'call-1', actionName: 'quotation_adjust_line_price', objectName: 'sales_quote',
      recordID: 'record-internal-1', status: 'unknown', summary: 'Forge 动作结果未知，须按当前业务状态核对。',
    }])

    const missing = await continuationFixture()
    const withoutFacts = await missing.getWorkContinuationContext({ workReference: '10000000-0000-4000-8000-000000000001', runReference: 'run-1', sessionReference: 'workbench-1' })
    expect(withoutFacts.run).not.toHaveProperty('actionOutcomes')
  })

  it('rejects an incomplete action outcome instead of turning it into an empty outcome list', async () => {
    const service = await continuationFixture([{ node_id: 'review', call_id: 'call-1', status: 'succeeded' }])
    await expect(service.getWorkContinuationContext({
      workReference: '10000000-0000-4000-8000-000000000001', runReference: 'run-1', sessionReference: 'workbench-1',
    })).rejects.toThrow('团队业务动作事实不完整')
  })
})
