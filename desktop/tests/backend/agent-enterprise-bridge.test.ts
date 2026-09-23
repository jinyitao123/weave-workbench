import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentEnterpriseBridge } from '../../electron/main/enterprise/agent-bridge'
import { digest } from '../../electron/main/enterprise/handoff-store'
import type { TranscriptMessage } from '../../src/types/api'

const bridges: AgentEnterpriseBridge[] = [], directories: string[] = []
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
function user(id: string, text: string): TranscriptMessage { return { id, role: 'user', parts: [{ type: 'text', text }] } }
async function fixture(objectName = 'forge_sales_contract') {
  const cwd = await mkdtemp(join(tmpdir(), 'handoff-')); directories.push(cwd)
  const content = '# 合同\n客户：测试客户\n金额：12345 元\n交期：2026-10-01\n'
  await writeFile(join(cwd, '合同.md'), content)
  const materials = [{ path: '合同.md', sha256: digest(content) }]
  const businessCapabilityId = `forge:action:${objectName}.submit`
  const choice = { teamId: 'team-contract', teamName: '合同团队', teamObjective: '复核合同并完成交接', workflowId: 'workflow-review', workflowName: '合同复核', workflowDescription: '接合同全文，检查金额和交期，交付复核意见', businessCapabilityIds: [businessCapabilityId], version: 3 }
  const service = {
    accountKey: vi.fn(async () => 'employee-a'),
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
  const bridge = new AgentEnterpriseBridge({ service, sessions: { prime: sessions, omp: sessions, pi: sessions }, extensionPath: '/extensions/enterprise.ts' })
  await bridge.start(); bridges.push(bridge)
  const environment = bridge.environmentFor({ cwd, sessionPath: '/sessions/current.jsonl', harness: 'pi' })
  bridge.bindSession(environment.GOOEYPI_ENTERPRISE_TOKEN, '/sessions/current.jsonl', 'runtime')
  let turnKey = ''
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await fetch(environment.GOOEYPI_ENTERPRISE_URL!, { method: 'POST', headers: { Authorization: `Bearer ${environment.GOOEYPI_ENTERPRISE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params: { turn_key: turnKey, ...params } }) })
    return { status: response.status, body: await response.json() as { ok: boolean; result: Record<string, unknown>; error?: string } }
  }
  const input = async (text: string, id: string) => {
    await bridge.employeeCommand('runtime', { type: 'prompt', message: text })
    transcript.push(user(id, text))
    const active = await call('activate', { prompt: text }); turnKey = active.body.result?.turn_key as string
  }
  const discover = async () => {
    const search = await call('search', { work_summary: '复核合同' })
    const teams = search.body.result.teams as Array<{ team_key: string }>
    const describe = await call('describe', { team_key: teams[0].team_key })
    const capabilities = describe.body.result.capabilities as Array<{ handoff_key: string; business_actions: Array<{ action_key: string }> }>
    return { handoff_key: capabilities[0].handoff_key, business_actions: [], goal: '复核这版合同', materials, available_actions: capabilities[0].business_actions }
  }
  await input('这版给他们看看', 'employee-turn-1')
  return { call, input, discover, service, bridge, materials, cwd, transcript, content, businessCapabilityId }
}

describe('employee-bound material handoff', () => {
  it('binds a runtime created before its session file and accepts the first employee turn', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-race-')); directories.push(cwd)
    const transcript: TranscriptMessage[] = []
    const service = {
      accountKey: vi.fn(async () => 'employee-a'), getTeamCatalog: vi.fn(async () => []), getTeamChoices: vi.fn(async () => []),
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
