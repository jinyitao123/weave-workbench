import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EmployeeBusinessActions, type EmployeeBusinessTurn } from '../../electron/main/enterprise/employee-business-actions'
import { HandoffStore, digest } from '../../electron/main/enterprise/handoff-store'
import { employeeBusinessRequestDigest, parseEmployeeBusinessContext, parseEmployeeBusinessOperation, validateEmployeeBusinessValues } from '../../electron/main/enterprise/employee-business-contract'
import type { EmployeeBusinessContext, EmployeeBusinessOperation, EmployeeBusinessRequest } from '../../src/types/employee-business'
import { readBusinessWork } from '../../electron/main/enterprise/business-work'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const id = '10000000-0000-4000-8000-000000000001'
function context(): EmployeeBusinessContext {
  return { version: '1', contextId: id, contextVersion: 'a'.repeat(64), recordVersion: 'revision-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), readOnly: true,
    record: { objectName: 'forge_sales_contract', recordId: 'contract-1', label: '合同甲' }, source: { kind: 'record' },
    actions: [{ action_ref: 1, capabilityId: 'forge:action:forge_sales_contract.Sign', declarationVersion: 'b'.repeat(64), label: '登记签署', description: '本人登记签署日期', effect: 'write', executionMode: 'employee_only',
      parameters: [{ name: 'signed_on', label: '签署日期', type: 'date', required: true }, { name: 'note', label: '说明', type: 'string', required: true }] }],
  }
}
function receipt(request: EmployeeBusinessRequest): EmployeeBusinessOperation {
  return { version: '1', operationId: request.opKey, contextId: request.contextId, requestDigest: employeeBusinessRequestDigest(request), status: 'succeeded', repeated: false, updatedAt: new Date().toISOString() }
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'employee-action-')); directories.push(directory)
  const current = context()
  const service = {
    getEmployeeBusinessContext: vi.fn(async () => structuredClone(current)),
    executeEmployeeBusinessAction: vi.fn(async (request: EmployeeBusinessRequest) => receipt(request)),
    getEmployeeBusinessOperation: vi.fn(async (_key: string): Promise<EmployeeBusinessOperation> => { throw new Error('404') }),
    stageWorkMaterials: vi.fn(async (materials: Array<{ name: string; bytes: number; sha256: string }>) => materials.map((m) => ({ type: 'forge-file' as const, id: 'owned-file', ...m }))),
  }
  const store = new HandoffStore({ directory })
  const bridge = new EmployeeBusinessActions(service, store)
  const turn: EmployeeBusinessTurn = { accountKey: 'employee-a', sessionPath: '/employee-a/session.jsonl', messageId: 'message-1', cwd: directory,
    employeePrompt: '请登记签署，日期2026-10-03，说明内部合成。', materials: [], readOnly: false, assertCurrent: vi.fn(async () => undefined) }
  await bridge.bind(turn.accountKey, turn.sessionPath, { record: current.record, source: current.source })
  const values = { signed_on: '2026-10-03', note: '内部合成' }
  return { directory, current, service, store, bridge, turn, values, run: () => bridge.run(turn, { action_ref: 1, values }) }
}

describe('employee-only business action contract', () => {
  it('preserves native date/file declarations and rejects malformed privilege or structured input', () => {
    const current = context()
    expect(parseEmployeeBusinessContext(current)).toEqual(current)
    current.actions[0].parameters.push({ name: 'evidence', type: 'file', label: '签署凭证', required: true })
    expect(parseEmployeeBusinessContext(current).actions[0].parameters[2].type).toBe('file')
    for (const values of [ { signed_on: '2026-02-30', note: '说明' }, { signed_on: '2026-10-03', note: [] }, { signed_on: '2026-10-03', note: '说明', evidence: 'other-file' }, { signed_on: '2026-10-03', note: '说明', recordId: 'other' } ]) {
      expect(() => validateEmployeeBusinessValues(current.actions[0].parameters, values)).toThrow()
    }
    expect(() => parseEmployeeBusinessContext({ ...current, actions: [{ ...current.actions[0], executionMode: 'team_delegable' }] })).toThrow()
    expect(() => parseEmployeeBusinessOperation({ ...receipt({ version: '1', contextId: id, contextVersion: 'a'.repeat(64), opKey: id, employeeMessage: { sessionId: 's', messageId: 'm', sha256: 'a'.repeat(64) }, action_ref: 1, values: {} }), status: 'unknown', noEffect: true })).toThrow()
  })
  it('enforces scalar enum and numeric bounds without coercion', () => {
    const parameters = [{ name: 'amount', label: '金额', type: 'number' as const, required: true, minimum: 1, maximum: 20 }, { name: 'method', label: '方式', type: 'string' as const, required: true, enum: ['cash'] }]
    expect(validateEmployeeBusinessValues(parameters, { amount: 20, method: 'cash' })).toEqual({ amount: 20, method: 'cash' })
    for (const value of [{ amount: '20', method: 'cash' }, { amount: 21, method: 'cash' }, { amount: NaN, method: 'cash' }, { amount: 2, method: 'guess' }]) expect(() => validateEmployeeBusinessValues(parameters, value)).toThrow()
  })
  it('accepts only a type-preserving complete enum label mapping, retaining ambiguous labels for display', () => {
    const current = context()
    const parameter = { name: 'method', label: '方式', type: 'string' as const, required: true, enum: ['bank_transfer', 'cash'], enumLabels: [{ value: 'bank_transfer', label: '银行转账' }, { value: 'cash', label: '现金' }] }
    current.actions[0].parameters = [parameter]
    expect(parseEmployeeBusinessContext(current).actions[0].parameters[0]).toEqual(parameter)
    for (const enumLabels of [
      [{ value: 'bank_transfer', label: '银行转账' }],
      [{ value: 'bank_transfer', label: '银行转账' }, { value: 'bank_transfer', label: '转账' }],
      [{ value: 'bank_transfer', label: '银行转账' }, { value: 'other', label: '其它' }],
      [{ value: 'bank_transfer', label: '' }, { value: 'cash', label: '现金' }],
      [{ value: 'bank_transfer', label: '银行转账', alias: '汇款' }, { value: 'cash', label: '现金' }],
    ]) expect(() => parseEmployeeBusinessContext({ ...current, actions: [{ ...current.actions[0], parameters: [{ ...parameter, enumLabels }] }] })).toThrow()
    expect(() => parseEmployeeBusinessContext({ ...current, actions: [{ ...current.actions[0], parameters: [{ ...parameter, enum: undefined }] }] })).toThrow()
    expect(() => parseEmployeeBusinessContext({ ...current, actions: [{ ...current.actions[0], parameters: [{ ...parameter, type: 'number', enum: [1, 2], enumLabels: [{ value: '1', label: '一' }, { value: 2, label: '二' }] }] }] })).toThrow()
    const ambiguous = { ...parameter, enumLabels: [{ value: 'bank_transfer', label: '付款' }, { value: 'cash', label: '付款' }] }
    expect(parseEmployeeBusinessContext({ ...current, actions: [{ ...current.actions[0], parameters: [ambiguous] }] }).actions[0].parameters[0]).toEqual(ambiguous)
  })
})

describe('employee action durable authorization and receipts', () => {
  it('preserves the opened item across related record reads and process restart without leaking the anchor', async () => {
    const f = await fixture()
    await f.bridge.bind(f.turn.accountKey, f.turn.sessionPath, { record: f.current.record, source: f.current.source }, true)
    await f.bridge.bind(f.turn.accountKey, f.turn.sessionPath, { record: { objectName: 'forge_fund_account', recordId: 'account-related', label: '测试银行台账' }, source: { kind: 'record' } })
    const reopened = new EmployeeBusinessActions(f.service, new HandoffStore({ directory: f.directory }))
    expect(await reopened.selection(f.turn.accountKey, f.turn.sessionPath)).toEqual({ record: f.current.record, source: f.current.source })
    await reopened.list(f.turn)
    expect(f.service.getEmployeeBusinessContext).toHaveBeenLastCalledWith({ record: f.current.record, source: f.current.source })
    expect(await reopened.run(f.turn, { action_ref: 1, values: f.values })).toMatchObject({ status: 'succeeded' })
    expect(f.service.executeEmployeeBusinessAction).toHaveBeenCalledOnce()
  })
  it('allows a newly verified item to replace the anchor while isolating account and session sources', async () => {
    const f = await fixture()
    await f.bridge.bind(f.turn.accountKey, f.turn.sessionPath, { record: f.current.record, source: f.current.source }, true)
    const next = { record: { objectName: 'forge_customer_prepayment', recordId: 'prepayment-next', label: '云岚预收' }, source: { kind: 'record' as const } }
    await f.bridge.bind(f.turn.accountKey, f.turn.sessionPath, next, true)
    expect(await f.bridge.selection(f.turn.accountKey, f.turn.sessionPath)).toEqual(next)
    expect(await f.bridge.selection('another-employee', f.turn.sessionPath)).toBeUndefined()
    expect(await f.bridge.selection(f.turn.accountKey, '/another-session')).toBeUndefined()
  })
  it('accepts an explicit project start while rejecting a negated start intent', async () => {
    const f = await fixture()
    f.current.record = { objectName: 'forge_project', recordId: 'project-current', label: '云岚交付项目' }
    f.current.actions[0].label = '启动项目'
    f.current.actions[0].parameters = []
    await f.bridge.bind(f.turn.accountKey, f.turn.sessionPath, { record: f.current.record, source: f.current.source })
    await f.bridge.list(f.turn)
    for (const employeePrompt of ['不要启动当前项目。', '暂不启动当前项目。', '禁止启动当前项目。']) {
      await expect(f.bridge.run({ ...f.turn, employeePrompt }, { action_ref: 1, values: {} })).rejects.toThrow('明确要求')
    }
    expect(f.service.executeEmployeeBusinessAction).not.toHaveBeenCalled()
    expect(await f.bridge.run({ ...f.turn, employeePrompt: '启动当前项目。' }, { action_ref: 1, values: {} })).toMatchObject({ status: 'succeeded', action_label: '启动项目' })
    expect(f.service.executeEmployeeBusinessAction).toHaveBeenCalledOnce()
  })
  it('keeps the preceding approval receipt distinct from a newly available send action after restart', async () => {
    const f = await fixture()
    f.current.actions[0].label = '提交报价审批'
    await f.bridge.list(f.turn); await f.run()
    f.current.recordVersion = 'revision-2'
    f.current.actions[0].label = '登记报价已发送'
    f.current.actions[0].capabilityId = 'forge:action:forge_quotation.Send'
    const reopened = new EmployeeBusinessActions(f.service, new HandoffStore({ directory: f.directory }))
    const next = { ...f.turn, messageId: 'message-2' }
    const listed = await reopened.list(next)
    if (!('previous_operation' in listed)) throw new Error('Expected the preceding completed operation')
    expect(listed).toMatchObject({
      previous_operation: { status: 'succeeded', action_label: '提交报价审批', message: expect.stringContaining('此前「提交报价审批」') },
      actions: [{ action_ref: 1, label: '登记报价已发送' }],
    })
    expect(listed.previous_operation?.message).toContain('不代表当前目录中的其他动作已办理')
    expect(await reopened.run(next, { action_ref: 1, values: f.values })).toMatchObject({ status: 'succeeded', action_label: '登记报价已发送' })
    expect(f.service.executeEmployeeBusinessAction).toHaveBeenCalledTimes(2)
  })
  it('does not infer a legacy receipt action from a reused current directory reference', async () => {
    const f = await fixture(); await f.bridge.list(f.turn); await f.run()
    for (const name of (await readdir(f.directory)).filter((name) => name.endsWith('.json'))) {
      const path = join(f.directory, name), saved = JSON.parse(await readFile(path, 'utf8'))
      if (saved.value.request) { delete saved.value.actionLabel; await writeFile(path, JSON.stringify(saved)) }
    }
    f.current.actions[0].label = '登记报价已发送'
    const reopened = new EmployeeBusinessActions(f.service, new HandoffStore({ directory: f.directory }))
    const listed = await reopened.list({ ...f.turn, messageId: 'message-2' })
    if (!('previous_operation' in listed)) throw new Error('Expected the preceding legacy operation')
    expect(listed.previous_operation).toMatchObject({ status: 'succeeded', message: expect.stringContaining('旧记录未保存动作名称') })
    expect(listed.previous_operation).not.toHaveProperty('action_label')
    expect(listed.previous_operation?.message).not.toContain('登记报价已发送')
  })
  it('retains the record-wide unknown-result fence when the current action has changed', async () => {
    const f = await fixture()
    f.current.actions[0].label = '提交报价审批'
    f.service.executeEmployeeBusinessAction.mockRejectedValue(new Error('connection lost'))
    await f.bridge.list(f.turn); await f.run()
    f.current.actions[0].label = '登记报价已发送'
    const reopened = new EmployeeBusinessActions(f.service, new HandoffStore({ directory: f.directory }))
    const next = { ...f.turn, messageId: 'message-2' }
    expect(await reopened.list(next)).toMatchObject({ actions: [], operation: { status: 'unknown' } })
    expect(await reopened.run(next, { action_ref: 1, values: f.values })).toMatchObject({ status: 'unknown' })
    expect(f.service.executeEmployeeBusinessAction).toHaveBeenCalledOnce()
  })
  it('accepts the unique native business label while sending its exact declared value', async () => {
    const f = await fixture()
    f.current.actions[0].parameters = [{ name: 'payment_method', label: '付款方式', type: 'string', required: true, enum: ['bank_transfer', 'cash'], enumLabels: [{ value: 'bank_transfer', label: '银行转账' }, { value: 'cash', label: '现金' }] }]
    f.turn.employeePrompt = '请创建订单，付款方式选择银行转账。'
    await f.bridge.list(f.turn)
    expect(await f.bridge.run(f.turn, { action_ref: 1, values: { payment_method: 'bank_transfer' } })).toMatchObject({ status: 'succeeded' })
    expect(f.service.executeEmployeeBusinessAction.mock.calls[0][0].values).toEqual({ payment_method: 'bank_transfer' })
  })
  it.each(['请创建订单，付款方式银行汇款。', '请创建订单，不用银行转账。', '如果交期可以，请创建订单并用银行转账。'])('rejects guessed, negated or conditional option evidence: %s', async (prompt) => {
    const f = await fixture()
    f.current.actions[0].parameters = [{ name: 'payment_method', label: '付款方式', type: 'string', required: true, enum: ['bank_transfer'], enumLabels: [{ value: 'bank_transfer', label: '银行转账' }] }]
    f.turn.employeePrompt = prompt; await f.bridge.list(f.turn)
    await expect(f.bridge.run(f.turn, { action_ref: 1, values: { payment_method: 'bank_transfer' } })).rejects.toThrow('业务选项')
    expect(f.service.executeEmployeeBusinessAction).not.toHaveBeenCalled()
  })
  it('does not authorize either value by an ambiguous label but accepts an exact explicitly stated value', async () => {
    const f = await fixture()
    f.current.actions[0].parameters = [{ name: 'payment_method', label: '付款方式', type: 'string', required: true, enum: ['bank_transfer', 'cash'], enumLabels: [{ value: 'bank_transfer', label: '付款' }, { value: 'cash', label: '付款' }] }]
    f.turn.employeePrompt = '请创建订单，方式选择付款。'; await f.bridge.list(f.turn)
    for (const value of ['bank_transfer', 'cash']) await expect(f.bridge.run(f.turn, { action_ref: 1, values: { payment_method: value } })).rejects.toThrow('业务选项')
    expect(f.service.executeEmployeeBusinessAction).not.toHaveBeenCalled()
    f.turn.employeePrompt = '请创建订单，付款方式bank_transfer。'
    expect(await f.bridge.run(f.turn, { action_ref: 1, values: { payment_method: 'bank_transfer' } })).toMatchObject({ status: 'succeeded' })
  })
  it('rejects a changed enum label declaration after discovery', async () => {
    const f = await fixture()
    const parameter = { name: 'payment_method', label: '付款方式', type: 'string' as const, required: true, enum: ['bank_transfer'], enumLabels: [{ value: 'bank_transfer', label: '银行转账' }] }
    f.current.actions[0].parameters = [parameter]
    f.turn.employeePrompt = '请创建订单，付款方式银行转账。'; await f.bridge.list(f.turn)
    parameter.enumLabels[0].label = '其它方式'
    await expect(f.bridge.run(f.turn, { action_ref: 1, values: { payment_method: 'bank_transfer' } })).rejects.toThrow('参数声明已变化')
    expect(f.service.executeEmployeeBusinessAction).not.toHaveBeenCalled()
  })
  it('requires a new employee intent, current directory and literal employee values', async () => {
    const f = await fixture()
    await expect(f.run()).rejects.toThrow('先读取')
    await f.bridge.list(f.turn)
    f.turn.readOnly = true; await expect(f.run()).rejects.toThrow('只授权查看')
    f.turn.readOnly = false; f.turn.employeePrompt = '只读查看2026-10-03内部合成'; await expect(f.run()).rejects.toThrow('明确要求')
    f.turn.employeePrompt = '请不要登记签署2026-10-03内部合成'; await expect(f.run()).rejects.toThrow('明确要求')
    f.turn.employeePrompt = '请登记签署2026-10-04内部合成'; await expect(f.run()).rejects.toThrow('本轮员工明确原文')
    expect(f.service.executeEmployeeBusinessAction).not.toHaveBeenCalled()
  })
  it('persists the fixed operation before POST and executes once under repeated/concurrent calls', async () => {
    const f = await fixture(); await f.bridge.list(f.turn)
    f.service.executeEmployeeBusinessAction.mockImplementation(async (request) => {
      const saved = await Promise.all((await readdir(f.directory)).filter((name) => name.endsWith('.json')).map(async (name) => JSON.parse(await readFile(join(f.directory, name), 'utf8'))))
      expect(saved.some((record) => record.value.phase === 'sent' && record.value.request.opKey === request.opKey)).toBe(true)
      return receipt(request)
    })
    const results = await Promise.all([f.run(), f.run()])
    expect(results).toEqual([expect.objectContaining({ status: 'succeeded' }), expect.objectContaining({ status: 'succeeded' })])
    expect(f.service.executeEmployeeBusinessAction).toHaveBeenCalledOnce()
    await expect(f.bridge.run(f.turn, { action_ref: 1, values: { ...f.values, note: '替换' } })).rejects.toThrow('内容已固定')
  })
  it('keeps a lost result unknown across messages and process restart; 404 never permits a new key', async () => {
    const f = await fixture(); await f.bridge.list(f.turn)
    f.service.executeEmployeeBusinessAction.mockRejectedValue(new Error('connection lost'))
    expect(await f.run()).toMatchObject({ status: 'unknown' })
    const key = f.service.executeEmployeeBusinessAction.mock.calls[0][0].opKey
    const reopened = new EmployeeBusinessActions(f.service, new HandoffStore({ directory: f.directory }))
    const next = { ...f.turn, messageId: 'message-2' }
    expect(await reopened.list(next)).toMatchObject({ actions: [], operation: { status: 'unknown' } })
    expect(await reopened.run(next, { action_ref: 1, values: f.values })).toMatchObject({ status: 'unknown' })
    expect(f.service.getEmployeeBusinessOperation).toHaveBeenCalledWith(key)
    expect(f.service.executeEmployeeBusinessAction).toHaveBeenCalledOnce()
  })
  it('does not accept a success receipt for another request', async () => {
    const f = await fixture(); await f.bridge.list(f.turn)
    f.service.executeEmployeeBusinessAction.mockImplementation(async (request) => ({ ...receipt(request), requestDigest: 'c'.repeat(64) }))
    expect(await f.run()).toMatchObject({ status: 'unknown' })
    expect(f.service.executeEmployeeBusinessAction).toHaveBeenCalledOnce()
  })
  it('rejects changed record/parameter declarations and changed employee evidence before dispatch', async () => {
    const f = await fixture(); await f.bridge.list(f.turn)
    f.current.recordVersion = 'revision-2'; await expect(f.run()).rejects.toThrow('已变化')
    expect(f.service.executeEmployeeBusinessAction).not.toHaveBeenCalled()
    f.current.recordVersion = 'revision-1'; f.current.actions[0].parameters[1].type = 'number'; await expect(f.run()).rejects.toThrow('已变化')
    f.turn.assertCurrent = vi.fn(async () => { throw new Error('账号已切换') }); await expect(f.run()).rejects.toThrow('账号已切换')
  })
  it('does not expose another account or session source', async () => {
    const f = await fixture()
    await expect(f.bridge.list({ ...f.turn, accountKey: 'employee-b' })).rejects.toThrow('先从本人')
    await expect(f.bridge.list({ ...f.turn, sessionPath: '/another-session' })).rejects.toThrow('先从本人')
  })
  it('freezes only the actual attached file and refuses replacement bytes', async () => {
    const f = await fixture(); const path = join(f.directory, 'evidence.txt'); await writeFile(path, '原件')
    f.current.actions[0].parameters.push({ name: 'evidence', label: '凭证', type: 'file', required: true })
    f.turn.materials = [{ name: 'evidence.txt', path, sha256: digest('原件'), bytes: Buffer.byteLength('原件'), mimeType: 'text/plain' }]
    await f.bridge.list(f.turn); await writeFile(path, '被替换')
    await expect(f.run()).rejects.toThrow(); expect(f.service.stageWorkMaterials).not.toHaveBeenCalled(); expect(f.service.executeEmployeeBusinessAction).not.toHaveBeenCalled()
  })
  it('injects the one newly selected file through Host upload without accepting model file identifiers', async () => {
    const f = await fixture(); const path = join(f.directory, 'evidence.txt'); await writeFile(path, '签署凭证')
    f.current.actions[0].parameters.push({ name: 'evidence', label: '凭证', type: 'file', required: true })
    f.turn.materials = [{ name: 'evidence.txt', path, sha256: digest('签署凭证'), bytes: Buffer.byteLength('签署凭证'), mimeType: 'text/plain' }]
    await f.bridge.list(f.turn)
    expect(await f.run()).toMatchObject({ status: 'succeeded' })
    expect(f.service.executeEmployeeBusinessAction.mock.calls[0][0]).toMatchObject({ values: f.values, file: { parameter: 'evidence', fileId: 'owned-file', name: 'evidence.txt', sha256: digest('签署凭证') } })
  })
})

describe('native business work projection', () => {
  it.each([513, 8192])('preserves a signed cursor of %i characters when following the next page', async (length) => {
    const cursor = 'a'.repeat(length)
    const page = { version: '1', items: [], readStatus: 'complete', observedAt: new Date().toISOString() }
    const read = vi.fn().mockResolvedValueOnce({ ...page, nextCursor: cursor }).mockResolvedValueOnce(page)
    expect(await readBusinessWork(read)).toEqual({ items: [] })
    expect(read.mock.calls[1][0]).toBe(`/api/v1/workbench/business-work?limit=100&cursor=${cursor}`)
  })
  it.each(['', 'a'.repeat(8193)])('rejects empty or oversized signed cursors', async (nextCursor) => {
    await expect(readBusinessWork(async () => ({ version: '1', items: [], readStatus: 'complete', observedAt: new Date().toISOString(), nextCursor }))).rejects.toThrow()
  })
  it('accepts authoritative order-condition work and all eight distinct source failures without claiming a complete list', async () => {
    const kinds = ['quotation_follow_up', 'contract_signature', 'contract_order_conditions', 'contract_prepayment', 'prepayment_confirmation', 'sales_order_creation', 'sales_order_submission', 'project_start']
    const item = { workKey: 'a'.repeat(64), kind: 'contract_order_conditions', title: '确认合同下单条件', record: context().record, recordVersion: '1', updatedAt: new Date().toISOString(), assignment: 'assigned' }
    const page = { version: '1', items: [item], readStatus: 'partial', observedAt: item.updatedAt, sourceErrors: kinds.map((kind) => ({ kind, code: 'READ_FAILED' })) }
    expect(await readBusinessWork(async () => page)).toMatchObject({ items: [item], error: expect.any(String) })
    await expect(readBusinessWork(async () => ({ ...page, sourceErrors: [...page.sourceErrors, page.sourceErrors[0]] }))).rejects.toThrow('完整性无效')
    await expect(readBusinessWork(async () => ({ ...page, sourceErrors: [page.sourceErrors[0], page.sourceErrors[0]] }))).rejects.toThrow('完整性无效')
    await expect(readBusinessWork(async () => ({ ...page, sourceErrors: [{ kind: 'unknown', code: 'READ_FAILED' }] }))).rejects.toThrow('完整性无效')
    await expect(readBusinessWork(async () => ({ ...page, items: [{ ...item, kind: 'unknown' }] }))).rejects.toThrow('来源无效')
  })
  it('reads a manager project-start item as a record source without granting a write or inferring a manager', async () => {
    const item = { workKey: 'd'.repeat(64), kind: 'project_start', title: '启动云岚交付项目',
      record: { objectName: 'forge_project', recordId: 'project-current', label: '云岚交付项目' },
      recordVersion: 'linked-order-1', updatedAt: new Date().toISOString(), assignment: 'assigned' }
    const page = { version: '1', items: [item], readStatus: 'complete', observedAt: item.updatedAt }
    expect(await readBusinessWork(async () => page)).toEqual({ items: [item] })
    await expect(readBusinessWork(async () => ({ ...page, items: [{ ...item, assignment: undefined }] }))).rejects.toThrow()
    await expect(readBusinessWork(async () => ({ ...page, items: [{ ...item, record: { ...item.record, objectName: 'sys_user' } }] }))).rejects.toThrow()
  })
  it.each(['提交报价审批', '登记报价发送', '登记客户接受', '转销售合同'])('reads a current quotation follow-up for %s without changing its record source', async (title) => {
    const item = { workKey: 'c'.repeat(64), kind: 'quotation_follow_up', title,
      record: { objectName: 'forge_quotation', recordId: 'quotation-current', label: '设备及服务报价' },
      recordVersion: 'pricing-1', updatedAt: new Date().toISOString(), assignment: 'assigned' }
    expect(await readBusinessWork(async () => ({ version: '1', items: [item], readStatus: 'complete', observedAt: item.updatedAt }))).toEqual({ items: [item] })
  })
  it('follows all pages, preserving assignment without inventing actionable owners', async () => {
    const item = { workKey: 'a'.repeat(64), kind: 'contract_signature', title: '登记签署', record: context().record, recordVersion: '1', updatedAt: new Date().toISOString(), assignment: 'assigned' }
    const read = vi.fn().mockResolvedValueOnce({ version: '1', items: [item], readStatus: 'complete', observedAt: item.updatedAt, nextCursor: 'next' })
      .mockResolvedValueOnce({ version: '1', items: [{ ...item, workKey: 'b'.repeat(64), assignment: 'needs_assignment', assignmentReason: 'multiple_eligible_employees' }], readStatus: 'complete', observedAt: item.updatedAt })
    const result = await readBusinessWork(read)
    expect(result.items.map((item) => item.assignment)).toEqual(['assigned', 'needs_assignment'])
    expect(read.mock.calls[1][0]).toContain('cursor=next')
  })
  it('keeps partial-source errors and rejects missing assignment evidence', async () => {
    const page = { version: '1', items: [], readStatus: 'partial', sourceErrors: [{ kind: 'contract_signature', code: 'READ_FAILED' }], observedAt: new Date().toISOString() }
    expect(await readBusinessWork(async () => page)).toHaveProperty('error')
    await expect(readBusinessWork(async () => ({ ...page, sourceErrors: undefined }))).rejects.toThrow()
  })
})
