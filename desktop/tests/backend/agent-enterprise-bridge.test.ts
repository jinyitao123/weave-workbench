import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentEnterpriseBridge } from '../../electron/main/enterprise/agent-bridge'
import { digest } from '../../electron/main/enterprise/handoff-store'
import type { EnterpriseApprovalContext, TranscriptMessage } from '../../src/types/api'

const bridges: AgentEnterpriseBridge[] = [], directories: string[] = []
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
function user(id: string, text: string): TranscriptMessage { return { id, role: 'user', parts: [{ type: 'text', text }] } }
async function fixture(objectName = 'forge_sales_contract') {
  const cwd = await mkdtemp(join(tmpdir(), 'handoff-')); directories.push(cwd)
  const content = '# 合同\n客户：测试客户\n金额：12345 元\n交期：2026-10-01\n'
  const sourceContent = '# 原提交合同\n客户：测试客户\n'
  await writeFile(join(cwd, '合同.md'), content)
  const materials = [{ path: '合同.md', sha256: digest(content) }]
  const approvalContext = (requestId: string, returnVersion: string, recordId: string): EnterpriseApprovalContext => ({
    requestId, status: 'returned', viewer: 'original_submitter', title: '测试合同', step: '销售修改',
    businessObject: { objectName, recordId, recordName: '测试合同' }, sourceMaterialVersion: digest(`source:${requestId}`),
    returnVersion, returnReason: '请补齐验收要求', fields: [{ label: '合同名称', value: '测试合同' }],
    files: [{ fileId: `source-file-${requestId}`, name: '原合同.md', mediaType: 'text/plain; charset=utf-8', bytes: Buffer.byteLength(sourceContent), sha256: digest(sourceContent), content: sourceContent, verified: true }],
  })
  const contexts = new Map([['approval-1', approvalContext('approval-1', 'revise-1', 'contract-1')], ['approval-2', approvalContext('approval-2', 'revise-2', 'contract-2')]])
  const businessCapabilityId = `forge:action:${objectName}.submit`
  const choice = { teamId: 'team-contract', teamName: '合同团队', teamObjective: '复核合同并完成交接', workflowId: 'workflow-review', workflowName: '合同复核', workflowDescription: '接合同全文，检查金额和交期，交付复核意见', businessCapabilityIds: [businessCapabilityId], version: 3 }
  const service = {
    accountKey: vi.fn(async () => 'employee-a'),
    getApprovalContext: vi.fn(async (requestId: string) => {
      const context = contexts.get(requestId)
      if (!context) throw new Error('这项审批已无法由当前员工处理，请刷新待办')
      return structuredClone(context)
    }),
    getTeamCatalog: vi.fn(async () => [{ id: choice.teamId, name: choice.teamName, objective: choice.teamObjective }, { id: 'leave', name: '休假团队', objective: '安排休假' }]),
    getTeamChoices: vi.fn(async () => [choice]),
    getBusinessCapabilities: vi.fn(async () => [{ id: businessCapabilityId, name: '提交合同', description: '把合同提交到业务流程', effect: 'write' as const, resourceType: objectName, requiresRecord: true, requiresEmployeeIntent: true, status: 'available' as const }]),
    findBusinessRecords: vi.fn(async () => [{ objectName, recordId: 'contract-1', name: 'TEST-100 设备交接验收合同', code: 'SC-TEST-001' }]),
    stageWorkMaterials: vi.fn(async (items: Array<{ name: string; content: string; bytes: number; sha256: string }>) => items.map((item, index) => ({ type: 'forge-file' as const, id: `file-${index + 1}`, name: item.name, bytes: item.bytes, sha256: item.sha256 }))),
    submitWork: vi.fn(async (_choice: unknown, _goal: string, source?: { assertCurrent(): Promise<void> }) => {
      await source?.assertCurrent()
      return { workId: 'work', runId: 'run', taskId: 'task', workflowId: choice.workflowId, workflowVersion: 3, repeated: false }
    }),
  }
  const transcript: TranscriptMessage[] = []
  const sessions = { read: vi.fn(async () => transcript) }
  const storageDirectory = join(cwd, 'secure-intents')
  const bridge = new AgentEnterpriseBridge({
    service, sessions: { prime: sessions, omp: sessions, pi: sessions }, extensionPath: '/extensions/enterprise.ts',
    storage: { directory: storageDirectory, codec: { available: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString('utf8') } },
  })
  await bridge.start(); bridges.push(bridge)
  const environment = bridge.environmentFor({ cwd, sessionPath: '/sessions/current.jsonl', harness: 'pi' })
  bridge.bindSession(environment.GOOEYPI_ENTERPRISE_TOKEN, '/sessions/current.jsonl', 'runtime')
  let turnKey = ''
  const callWithTurn = async (method: string, params: Record<string, unknown> = {}, requestTurnKey = turnKey) => {
    const response = await fetch(environment.GOOEYPI_ENTERPRISE_URL!, { method: 'POST', headers: { Authorization: `Bearer ${environment.GOOEYPI_ENTERPRISE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params: { turn_key: requestTurnKey, ...params } }) })
    return { status: response.status, body: await response.json() as { ok: boolean; result: Record<string, unknown>; error?: string } }
  }
  const call = (method: string, params: Record<string, unknown> = {}) => callWithTurn(method, params)
  const input = async (text: string, id: string) => {
    await bridge.employeeCommand('runtime', { type: 'prompt', message: text })
    transcript.push(user(id, text))
    const active = await call('activate', { prompt: text }); turnKey = active.body.result?.turn_key as string
    return turnKey
  }
  const openReturned = async (requestId = 'approval-1') => {
    const context = contexts.get(requestId)
    if (!context?.returnVersion) throw new Error('test fixture has no returned context')
    const binding = await bridge.pinReturnedApprovalContext(requestId)
    const text = `打开退回审批 ${requestId}`
    await bridge.employeeCommand('runtime', { type: 'prompt', message: text }, binding.handle)
    transcript.push(user(`opened-${requestId}`, text))
    const active = await call('activate', { prompt: text })
    turnKey = active.body.result?.turn_key as string
    return { context: binding.context, turnKey }
  }
  const discover = async () => {
    const search = await call('search', { work_summary: '复核合同' })
    const teams = search.body.result.teams as Array<{ team_key: string }>
    const describe = await call('describe', { team_key: teams[0].team_key })
    const capabilities = describe.body.result.capabilities as Array<{ handoff_key: string; business_actions: Array<{ action_key: string }> }>
    return { handoff_key: capabilities[0].handoff_key, business_actions: [], goal: '复核这版合同', materials, available_actions: capabilities[0].business_actions }
  }
  await input('这版给他们看看', 'employee-turn-1')
  return { call, callWithTurn, input, discover, openReturned, service, bridge, materials, cwd, transcript, content, businessCapabilityId, contexts, storageDirectory }
}

describe('employee-bound material handoff', () => {
  it('binds a runtime created before its session file and accepts the first employee turn', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-race-')); directories.push(cwd)
    const transcript: TranscriptMessage[] = []
    const service = {
      accountKey: vi.fn(async () => 'employee-a'), getApprovalContext: vi.fn(), getTeamCatalog: vi.fn(async () => []), getTeamChoices: vi.fn(async () => []),
      getBusinessCapabilities: vi.fn(async () => []),
      findBusinessRecords: vi.fn(async () => []),
      stageWorkMaterials: vi.fn(async () => []), submitWork: vi.fn(),
    }
    const sessions = { read: vi.fn(async () => transcript) }
    const bridge = new AgentEnterpriseBridge({ service, sessions: { prime: sessions, omp: sessions, pi: sessions }, extensionPath: '/extensions/enterprise.ts' })
    await bridge.start(); bridges.push(bridge)
    const environment = bridge.environmentFor({ cwd, harness: 'pi' })
    bridge.bindSession(environment.GOOEYPI_ENTERPRISE_TOKEN, undefined, 'new-runtime')
    bridge.bindRuntimeSession('new-runtime', '/sessions/new.jsonl')
    await bridge.employeeCommand('new-runtime', { type: 'prompt', message: '把这份材料交给团队' })
    transcript.push(user('first-turn', '把这份材料交给团队'))
    const response = await fetch(environment.GOOEYPI_ENTERPRISE_URL!, {
      method: 'POST', headers: { Authorization: `Bearer ${environment.GOOEYPI_ENTERPRISE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'activate', params: { prompt: '把这份材料交给团队' } }),
    })
    expect(response.status).toBe(200)
    expect((await response.json() as { result: { turn_key: string } }).result.turn_key).toBeTruthy()
  })

  it('filters summaries, expands only one team, and hands off actual frozen contract content', async () => {
    const f = await fixture()
    const search = await f.call('search', { work_summary: '检查合同' })
    expect(search.body.result.teams).toHaveLength(1)
    expect(f.service.getTeamChoices).not.toHaveBeenCalled()
    const params = await f.discover()
    const submitted = await f.call('submit', params)
    expect(submitted.status).toBe(200)
    expect(submitted.body.result.status).toBe('accepted')
    const task = JSON.parse(f.service.submitWork.mock.calls[0][1])
    expect(task.materials[0]).toEqual({ name: '合同.md', content: f.content, bytes: Buffer.byteLength(f.content), sha256: digest(f.content) })
    expect(f.service.submitWork.mock.calls[0][2]).toMatchObject({ authorizedBusinessCapabilityIds: [] })
  })
  it('authorizes only the business action selected for the current employee intent', async () => {
    const f = await fixture(), params = await f.discover()
    const actionKey = params.available_actions[0].action_key
    const found = await f.call('find_business_record', { handoff_key: params.handoff_key, work_summary: 'TEST-100 设备交接验收合同' })
    const recordKey = (found.body.result.records as Array<{ record_key: string }>)[0].record_key
    expect(found.body.result.records).toEqual([{ record_key: recordKey, name: 'TEST-100 设备交接验收合同', code: 'SC-TEST-001', object: '业务记录' }])
    expect(JSON.stringify(found.body.result.records)).not.toContain('contract-1')
    expect((await f.call('submit', { ...params, business_record_key: recordKey, business_actions: [actionKey] })).status).toBe(200)
    expect(f.service.submitWork.mock.calls[0][2]).toMatchObject({ authorizedBusinessCapabilityIds: [f.businessCapabilityId], businessContext: { objectName: 'forge_sales_contract', recordId: 'contract-1' } })
    expect(JSON.parse(f.service.submitWork.mock.calls[0][1])).toMatchObject({ businessContext: { objectName: 'forge_sales_contract', recordId: 'contract-1', name: 'TEST-100 设备交接验收合同', code: 'SC-TEST-001' } })
  })
  it('freezes a returned approval revision package for the opened account, request, and employee round', async () => {
    const f = await fixture()
    const opened = await f.openReturned()
    const employeeRequest = '按退回意见补全验收要求，帮我递交这版修订材料'
    await f.input(employeeRequest, 'employee-revision-1')
    const body = '修订后的合同正文：验收包含现场联调和连续运行三天。'
    const result = await f.call('revision_prepare', { employee_request: employeeRequest, body, materials: f.materials })

    expect(opened.context).toMatchObject({ title: '测试合同', step: '销售修改', returnReason: '请补齐验收要求' })
    expect(opened.context).not.toHaveProperty('requestId')
    expect(opened.context).not.toHaveProperty('businessObject')
    expect(opened.context).not.toHaveProperty('returnVersion')
    expect(opened.context).not.toHaveProperty('sourceMaterialVersion')
    expect(opened.context.files[0]).not.toHaveProperty('fileId')
    expect(opened.context.files[0]).not.toHaveProperty('sha256')
    expect(result.body.result).toMatchObject({ status: 'prepared_only', submitted: false, materials: [{ name: '合同.md', bytes: Buffer.byteLength(f.content) }] })
    expect(result.body.result.message).toContain('审批未递交、流程未继续')
    expect(f.service.submitWork).not.toHaveBeenCalled()

    const files = await readdir(f.storageDirectory)
    expect(files).toHaveLength(1)
    const stored = JSON.parse((await readFile(join(f.storageDirectory, files[0]!))).toString('utf8')) as { value: {
      requestId: string; returnVersion: string; sourceMaterialVersion: string; businessObject: { objectName: string; recordId: string };
      employeeMessageId: string; employeeRoundId: string; employeeRequest: string; body: { content: string; bytesBase64: string; sha256: string };
      sourceMessages: Array<{ messageId: string; eventSeq: number; sha256: string }>;
      sourceFiles: Array<{ fileId: string; bytesBase64: string }>; materials: Array<{ name: string; bytesBase64: string; sha256: string }>
    } }
    expect(stored.value).toMatchObject({
      requestId: 'approval-1', returnVersion: 'revise-1', sourceMaterialVersion: f.contexts.get('approval-1')!.sourceMaterialVersion,
      businessObject: { objectName: 'forge_sales_contract', recordId: 'contract-1' }, employeeRequest,
      body: { content: body, bytesBase64: Buffer.from(body).toString('base64'), sha256: digest(body) },
      sourceFiles: [{ fileId: 'source-file-approval-1', bytesBase64: Buffer.from('# 原提交合同\n客户：测试客户\n').toString('base64') }],
      materials: [{ name: '合同.md', bytesBase64: Buffer.from(f.content).toString('base64'), sha256: digest(f.content) }],
    })
    expect(stored.value.employeeMessageId).toBe('employee-revision-1')
    expect(stored.value.employeeRoundId).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.value.sourceMessages.find((message) => message.messageId === 'employee-revision-1')?.sha256).toBe(digest(employeeRequest))
  })
  it('rejects a pinned context if the account or return version changes before the Pi prompt starts', async () => {
    const f = await fixture()
    const opened = f.contexts.get('approval-1')!
    const binding = await f.bridge.pinReturnedApprovalContext('approval-1')
    f.contexts.set('approval-1', { ...opened, returnVersion: 'revise-2' })
    await expect(f.bridge.employeeCommand('runtime', { type: 'prompt', message: '打开退回审批 approval-1' }, binding.handle))
      .rejects.toThrow('退回意见或材料版本已变化')

    const other = await fixture()
    const otherBinding = await other.bridge.pinReturnedApprovalContext('approval-1')
    other.service.accountKey.mockResolvedValue('employee-b')
    await expect(other.bridge.employeeCommand('runtime', { type: 'prompt', message: '打开退回审批 approval-1' }, otherBinding.handle))
      .rejects.toThrow('当前账号已变化')
  })
  it('retries an identical frozen revision package without rereading changed local bytes and rejects changed material', async () => {
    const f = await fixture()
    await f.openReturned()
    const employeeRequest = '请把当前修订版递交上去'
    await f.input(employeeRequest, 'employee-revision-retry')
    const params = { employee_request: employeeRequest, body: '当前最终正文', materials: f.materials }
    const first = await f.call('revision_prepare', params)
    expect(first.body.result.status).toBe('prepared_only')
    await writeFile(join(f.cwd, '合同.md'), '被修改的本地草稿')

    const retry = await f.call('revision_prepare', params)
    expect(retry.body.result).toEqual(first.body.result)
    const changedBody = await f.call('revision_prepare', { ...params, body: '新的正文' })
    expect(changedBody.status).toBe(409)
    expect(changedBody.body.error).toContain('本轮修订材料已固定')
    const changedMaterial = await f.call('revision_prepare', { ...params, materials: [{ path: '合同.md', sha256: digest('被修改的本地草稿') }] })
    expect(changedMaterial.status).toBe(409)
    expect(changedMaterial.body.error).toContain('本轮修订材料已固定')
  })
  it('blocks an old returned revision when the account, approval, or employee round changes', async () => {
    const f = await fixture()
    await f.openReturned()
    const employeeRequest = '确认把这一版修订材料递交'
    const oldTurnKey = await f.input(employeeRequest, 'employee-revision-old')
    const params = { employee_request: employeeRequest, body: '修订正文', materials: f.materials }

    await f.input('先等等，重新核对一下', 'employee-revision-new-round')
    const oldRound = await f.callWithTurn('revision_prepare', params, oldTurnKey)
    expect(oldRound.status).toBe(409)
    expect(oldRound.body.error).toContain('员工要求已变化')

    const secondHandle = await f.bridge.pinReturnedApprovalContext('approval-2')
    const secondPrompt = '打开退回审批 approval-2'
    await f.bridge.employeeCommand('runtime', { type: 'prompt', message: secondPrompt }, secondHandle.handle)
    f.transcript.push(user('opened-approval-2', secondPrompt))
    const active = await f.call('activate', { prompt: secondPrompt })
    const secondTurnKey = active.body.result.turn_key as string
    const changedApproval = await f.callWithTurn('revision_prepare', params, secondTurnKey)
    expect(changedApproval.status).toBe(409)
    expect(changedApproval.body.error).toContain('员工本轮要求已变化')

    f.service.accountKey.mockResolvedValue('employee-b')
    const changedAccount = await f.callWithTurn('revision_prepare', { ...params, employee_request: secondPrompt }, secondTurnKey)
    expect(changedAccount.status).toBe(409)
    expect(changedAccount.body.error).toContain('账号已变化')
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('stops when the latest return version or business object changed after opening', async () => {
    const f = await fixture()
    await f.openReturned()
    const employeeRequest = '请递交刚改好的材料'
    await f.input(employeeRequest, 'employee-revision-stale-context')
    const context = f.contexts.get('approval-1')!
    f.contexts.set('approval-1', { ...context, returnVersion: 'revise-2', businessObject: { ...context.businessObject, recordId: 'contract-2' } })
    const result = await f.call('revision_prepare', { employee_request: employeeRequest, body: '正文', materials: [] })
    expect(result.status).toBe(409)
    expect(result.body.error).toContain('退回意见、业务对象或原材料版本已变化')
    await expect(readdir(f.storageDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects a business action that was not returned for this team view', async () => {
    const f = await fixture(), params = await f.discover()
    expect((await f.call('submit', { ...params, business_actions: ['invented-action'] })).status).toBe(409)
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('invalidates the old turn before a later employee steer is written to the transcript', async () => {
    const f = await fixture(), params = await f.discover()
    await f.bridge.employeeCommand('runtime', { type: 'steer', message: '先等等' })
    expect((await f.call('submit', params)).status).toBe(409)
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('revokes a renderer-queued employee change before the runtime sees it', async () => {
    const f = await fixture(), params = await f.discover()
    f.bridge.invalidateHandoff('runtime')
    expect((await f.call('submit', params)).status).toBe(409)
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('does not replace authorization with the last user message', async () => {
    const f = await fixture(), params = await f.discover()
    f.transcript.push(user('employee-later', '先别发'))
    expect((await f.call('submit', params)).status).toBe(409)
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('rejects another account and revokes runtime credentials when the account session changes', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.accountKey.mockResolvedValue('employee-b')
    expect((await f.call('submit', params)).status).toBe(409)
    f.service.accountKey.mockResolvedValue('employee-a')
    f.bridge.invalidateAccount()
    expect((await f.call('submit', params)).status).toBe(401)
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('rejects missing materials, changed versions and paths outside the working directory', async () => {
    const f = await fixture(), params = await f.discover()
    expect((await f.call('submit', { ...params, materials: [] })).status).toBe(409)
    expect((await f.call('submit', { ...params, materials: [{ path: 'absent.md', sha256: digest('x') }] })).status).toBe(409)
    await writeFile(join(f.cwd, '合同.md'), 'changed')
    expect((await f.call('submit', params)).body.error).toContain('版本已变化')
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('retries an identical package after failure without rereading a changed file or conversation', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.submitWork.mockRejectedValueOnce(new Error('connection lost'))
    expect((await f.call('submit', params)).body.result.status).toBe('unknown')
    await writeFile(join(f.cwd, '合同.md'), 'later draft')
    f.transcript.push({ id: 'assistant-later', role: 'assistant', parts: [{ type: 'text', text: '稍后重试' }] })
    expect((await f.call('submit', params)).status).toBe(200)
    expect(f.service.submitWork.mock.calls[0][1]).toBe(f.service.submitWork.mock.calls[1][1])
    const first = f.service.submitWork.mock.calls[0][2] as unknown as { sourceMessages: unknown }
    const second = f.service.submitWork.mock.calls[1][2] as unknown as { sourceMessages: unknown }
    expect(first.sourceMessages).toEqual(second.sourceMessages)
    expect((await f.call('submit', { ...params, goal: '修改目标' })).body.error).toContain('已冻结')
  })
  it('freezes material before upload and resumes an upload failure with the original bytes', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.stageWorkMaterials.mockRejectedValueOnce(new Error('upload interrupted'))
    const first = await f.call('submit', params)
    expect(first.body.result).toMatchObject({ status: 'unknown' })
    await writeFile(join(f.cwd, '合同.md'), 'later draft')
    expect((await f.call('recover', { recovery_key: first.body.result.recovery_key })).body.result.status).toBe('accepted')
    const retriedMaterials = f.service.stageWorkMaterials.mock.calls[1][0]
    expect(retriedMaterials[0].content).toBe(f.content)
  })
  it('rejects an old recovery key after the employee changes the request without uploading or submitting', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.stageWorkMaterials.mockRejectedValueOnce(new Error('upload interrupted'))
    const first = await f.call('submit', params)
    const recoveryKey = first.body.result.recovery_key as string
    await f.input('先等等，暂时不要提交', 'employee-turn-2')
    const recovered = await f.call('recover', { recovery_key: recoveryKey })
    expect(recovered.status).toBe(409)
    expect(recovered.body.error).toContain('员工要求已变化')
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('recovers the original request within its authorized employee turn and rejects a different account', async () => {
    const f = await fixture(), params = await f.discover()
    const first = await f.call('submit', params)
    const recoveryKey = first.body.result.recovery_key
    expect((await f.call('recover', { recovery_key: recoveryKey })).body.result.status).toBe('accepted')
    expect(f.service.submitWork.mock.calls[0][1]).toBe(f.service.submitWork.mock.calls[1][1])
    f.service.accountKey.mockResolvedValue('employee-b')
    await f.input('恢复原交接', 'other-account-turn')
    expect((await f.call('recover', { recovery_key: recoveryKey })).body.error).toContain('不属于当前员工')
    expect(f.service.submitWork).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent identical submissions', async () => {
    const f = await fixture(), params = await f.discover()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    f.service.submitWork.mockImplementation(async () => { await barrier; return { workId: 'work', runId: 'run', taskId: 'task', workflowId: 'workflow-review', workflowVersion: 3, repeated: false } })
    const first = f.call('submit', params), second = f.call('submit', params)
    await vi.waitFor(() => expect(f.service.submitWork).toHaveBeenCalledOnce())
    release()
    expect((await Promise.all([first, second])).map((result) => result.status)).toEqual([200, 200])
    expect(f.service.submitWork).toHaveBeenCalledOnce()
  })
  it('rejects a removed published version before preparing material delivery', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.getTeamChoices.mockResolvedValue([])
    expect((await f.call('submit', params)).body.error).toContain('版本已经变化')
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('requires the declared business record for a non-contract action as well', async () => {
    const f = await fixture('forge_quote'), params = await f.discover()
    const business_actions = [params.available_actions[0].action_key]
    expect((await f.call('submit', { ...params, business_actions })).body.error).toContain('绑定该动作所需的业务记录')
    expect(f.service.stageWorkMaterials).not.toHaveBeenCalled()
    const found = await f.call('find_business_record', { handoff_key: params.handoff_key, work_summary: 'TEST-100' })
    const recordKey = (found.body.result.records as Array<{ record_key: string }>)[0].record_key
    expect((await f.call('submit', { ...params, business_actions, business_record_key: recordKey })).body.result.status).toBe('accepted')
    expect(f.service.submitWork.mock.calls[0][2]).toMatchObject({ businessContext: { objectName: 'forge_quote', recordId: 'contract-1' } })
  })
  it('rejects a late capability response after the employee changes the request', async () => {
    const f = await fixture()
    const search = await f.call('search', { work_summary: '合同' })
    const teamKey = (search.body.result.teams as Array<{ team_key: string }>)[0].team_key
    const result = await f.service.getBusinessCapabilities()
    let release!: (value: typeof result) => void
    f.service.getBusinessCapabilities.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const pending = f.call('describe', { team_key: teamKey })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    f.bridge.invalidateAccount()
    release(result)
    expect((await pending).status).toBe(409)
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })

})
