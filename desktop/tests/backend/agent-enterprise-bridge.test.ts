import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentEnterpriseBridge } from '../../electron/main/enterprise/agent-bridge'
import { digest, submissionUUID } from '../../electron/main/enterprise/handoff-store'
import { freezeApprovalOriginalMaterial, normalizeFrozenMaterial, type FrozenMaterial } from '../../electron/main/enterprise/materials'
import type { EnterpriseApprovalContext, TranscriptMessage } from '../../src/types/api'
import { WorkRegistrationRejectedError, type EnterpriseWorkContinuationContext, type EnterpriseWorkNotificationSource } from '../../electron/main/enterprise'
import { ForgeBusinessReadError, type BusinessRecordSnapshot } from '../../electron/main/enterprise/business-records'
import { appendWorkspaceMaterialContext } from '../../src/lib/workspace-material-attachments'

const bridges: AgentEnterpriseBridge[] = [], directories: string[] = []
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
function user(id: string, text: string): TranscriptMessage { return { id, role: 'user', parts: [{ type: 'text', text }] } }
function workContinuationContext(): EnterpriseWorkContinuationContext {
  const task = '请按客户确认的技术协议继续检查交付范围。'
  const finalResult = '团队检查发现验收期限仍需确认。'
  return {
    version: '1' as const,
    source: { inputRevisionID: 'input-1', runID: 'run-1', workbenchSessionID: 'workbench-session-1' },
    input: {
      task, taskSHA256: digest(task), teamID: 'team-contract', workflowID: 'workflow-review', workflowVersion: 3,
      materials: [], sourceMessages: [{ messageID: 'employee-message', eventSeq: 1, sha256: digest('员工原始要求') }],
    },
    run: { status: 'succeeded' as const, finalResult: { id: 'deliverable-1', title: '交付检查意见', contentType: 'text/markdown', content: finalResult, sha256: digest(finalResult) } },
  }
}
async function fixture(objectName = 'forge_sales_contract', configureStorage = true) {
  const cwd = await mkdtemp(join(tmpdir(), 'handoff-')); directories.push(cwd)
  const content = '# 合同\n客户：测试客户\n金额：12345 元\n交期：2026-10-01\n'
  const sourceContent = '# 原提交合同\n客户：测试客户\n'
  const materialPath = '材料/附件/合同.md'
  await mkdir(join(cwd, '材料', '附件'), { recursive: true })
  await writeFile(join(cwd, materialPath), content)
  const materialReference = { projectId: 'project-test', harness: 'pi' as const, workspacePath: cwd, name: '合同.md', path: materialPath, sha256: digest(content), bytes: Buffer.byteLength(content), mimeType: 'text/markdown' as const }
  const materials = [{ path: materialPath, sha256: digest(content) }]
  const approvalContext = (requestId: string, returnVersion: string, recordId: string): EnterpriseApprovalContext => ({
    requestId, status: 'returned', viewer: 'original_submitter', title: '测试合同', step: '销售修改',
    businessObject: { objectName, recordId, recordName: '测试合同' }, sourceMaterialVersion: digest(`source:${requestId}`),
    returnVersion, returnReason: '请补齐验收要求', fields: [{ label: '合同名称', value: '测试合同' }],
    files: [{ fileId: `source-file-${requestId}`, name: '原合同.md', mediaType: 'text/plain; charset=utf-8', bytes: Buffer.byteLength(sourceContent), sha256: digest(sourceContent), content: sourceContent, verified: true }],
  })
  const contexts = new Map([['approval-1', approvalContext('approval-1', 'revise-1', 'contract-1')], ['approval-2', approvalContext('approval-2', 'revise-2', 'contract-2')]])
  const revisionReceipts = new Map<string, Record<string, unknown>>()
  const businessCapabilityId = `forge:action:${objectName}.submit`
  const choice = { teamId: 'team-contract', teamName: '合同团队', teamObjective: '复核合同并完成交接', workflowId: 'workflow-review', workflowName: '合同复核', workflowDescription: '接合同全文，检查金额和交期，交付复核意见', businessCapabilityIds: [businessCapabilityId], version: 3 }
  const businessCandidate = { objectName, objectLabel: objectName === 'forge_quote' ? '销售报价' : '销售合同', recordId: 'contract-1', name: 'TEST-100 设备交接验收合同', code: 'SC-TEST-001', status: '草稿', owner: '销售人员', recordVersion: 'v7' }
  const businessSnapshot: BusinessRecordSnapshot = {
    version: 1, capturedAt: '2026-09-24T00:00:00.000Z', objectLabel: businessCandidate.objectLabel,
    record: [{ label: '合同名称', value: businessCandidate.name }, { label: '合同编号', value: businessCandidate.code }, { label: '审核状态', value: businessCandidate.status }, { label: '版本', value: businessCandidate.recordVersion }],
    relations: [], completeness: 'complete', pricingDetailCompleteness: 'unknown', completenessNotes: [],
  }
  let continuationSequence = 1
  const service = {
    accountKey: vi.fn(async () => 'employee-a'),
    getApprovalContext: vi.fn(async (requestId: string) => {
      const context = contexts.get(requestId)
      if (!context) throw new Error('这项审批已无法由当前员工处理，请刷新待办')
      return structuredClone(context)
    }),
    getWorkContinuationContext: vi.fn(async (references: { workReference: string; runReference: string; sessionReference: string }) => {
      const context = workContinuationContext()
      context.source.inputRevisionID = references.workReference
      context.source.runID = references.runReference
      context.source.workbenchSessionID = references.sessionReference
      return context
    }),
    getWorkNotificationSource: vi.fn(async (notificationID: string): Promise<EnterpriseWorkNotificationSource> => ({
      version: '1', notificationID, kind: 'revision_required',
      source: { system: 'weave' as const, workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' },
    })),
    getTeamCatalog: vi.fn(async () => [{ id: choice.teamId, name: choice.teamName, objective: choice.teamObjective }, { id: 'leave', name: '休假团队', objective: '安排休假' }]),
    getTeamChoices: vi.fn(async () => [choice]),
    getBusinessCapabilities: vi.fn(async () => [{ id: businessCapabilityId, name: '提交合同', description: '把合同提交到业务流程', effect: 'write' as const, resourceType: objectName, requiresRecord: true, requiresEmployeeIntent: true, status: 'available' as const }]),
    getBusinessObjectDirectory: vi.fn(async () => ({ objects: [{ objectName, label: businessCandidate.objectLabel }], complete: true, totalCount: 1 })),
    findBusinessRecords: vi.fn(async (_objectName: string, _summary: string, offset = 0, limit = 20) => ({ records: [businessCandidate], offset, limit, hasMore: false, complete: true })),
    readBusinessRecord: vi.fn(async () => ({ candidate: businessCandidate, snapshot: structuredClone(businessSnapshot) })),
    stageWorkMaterials: vi.fn(async (items: FrozenMaterial[]) => items.map((raw, index) => {
      const item = normalizeFrozenMaterial(raw)
      return {
        type: 'forge-file' as const, ...(item.sourceKind ? { sourceKind: item.sourceKind } : {}),
        materialId: item.materialId, id: `file-${index + 1}`, name: item.name, mediaType: item.mediaType, bytes: item.bytes, sha256: item.sha256,
      }
    })),
    submitWork: vi.fn(async (_choice: unknown, _goal: string, source?: {
      assertCurrent(): Promise<void>
      continuation?: { inputRevisionID: string; runID: string }
      resources?: Array<{ sourceKind?: string; requestId?: string; name: string; bytes: number; sha256: string }>
    }) => {
      await source?.assertCurrent()
      if (source?.continuation) {
        const sequence = ++continuationSequence
        return { workId: `work-${sequence}`, runId: `run-${sequence}`, inputRevisionId: `input-${sequence}`, taskId: `task-${sequence}`, workflowId: choice.workflowId, workflowVersion: 3, repeated: false }
      }
      return { workId: 'work', runId: 'run', taskId: 'task', workflowId: choice.workflowId, workflowVersion: 3, repeated: false }
    }),
    submitApprovalRevision: vi.fn(async (requestId: string, body: { idempotencyKey: string }, assertCurrent: () => Promise<void>) => {
      await assertCurrent()
      const receipt = { requestId, bindingId: '550e8400-e29b-41d4-a716-446655440000', newVersionDigest: digest('new-revision-v1'), state: 'resumed', repeated: true }
      revisionReceipts.set(body.idempotencyKey, receipt)
      return { status: 200, body: { data: receipt } }
    }),
    getApprovalRevisionReceipt: vi.fn(async (requestId: string, idempotencyKey: string, assertCurrent: () => Promise<void>) => {
      await assertCurrent()
      const receipt = revisionReceipts.get(idempotencyKey)
      return receipt?.requestId === requestId ? { status: 200, body: { data: receipt } } : { status: 404, body: {} }
    }),
  }
  const transcript: TranscriptMessage[] = []
  const sessions = { read: vi.fn(async () => transcript) }
  const storageDirectory = join(cwd, 'secure-intents')
  const bridge = new AgentEnterpriseBridge({
    service, sessions: { prime: sessions, pi: sessions }, extensionPath: '/extensions/enterprise.ts',
    ...(configureStorage ? { storage: { directory: storageDirectory } } : {}),
  })
  await bridge.start(); bridges.push(bridge)
  let sessionPath = '/sessions/current.jsonl'
  let environment = bridge.environmentFor({ cwd, sessionPath, harness: 'pi' })
  bridge.bindSession(environment.GOOEYPI_ENTERPRISE_TOKEN, sessionPath, 'runtime')
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
  const relogin = async (options: { accountKey?: string; sessionPath?: string } = {}) => {
    bridge.invalidateAccount()
    if (options.accountKey) service.accountKey.mockResolvedValue(options.accountKey)
    sessionPath = options.sessionPath ?? sessionPath
    environment = bridge.environmentFor({ cwd, sessionPath, harness: 'pi' })
    bridge.bindSession(environment.GOOEYPI_ENTERPRISE_TOKEN, sessionPath, 'runtime')
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
  const findRecord = async (handoffKey: string, workSummary: string) => {
    const directory = await call('list_business_objects', { handoff_key: handoffKey })
    const objectRef = (directory.body.result.objects as Array<{ object_ref: string }>)[0]?.object_ref
    if (!objectRef) throw new Error('fixture did not return a business object')
    const found = await call('find_business_record', { handoff_key: handoffKey, object_ref: objectRef, work_summary: workSummary })
    const recordKey = (found.body.result.records as Array<{ record_key: string }>)[0]?.record_key
    if (!recordKey) throw new Error('fixture did not return a business record')
    return { directory, objectRef, found, recordKey }
  }
  await input(appendWorkspaceMaterialContext('这版给他们看看', [materialReference]), 'employee-turn-1')
  return { call, callWithTurn, input, relogin, discover, findRecord, openReturned, service, bridge, environment, materials, cwd, transcript, content, businessCapabilityId, contexts, storageDirectory, revisionReceipts, businessCandidate, businessSnapshot }
}

describe('employee-bound material handoff', () => {
  it('reads and binds the exact Weave work context before opening a Pi continuation', async () => {
    const f = await fixture()
    const item = { id: 'notice-1', source: 'weave' as const, notificationType: 'weave.team_run.revision_required' }
    const binding = await f.bridge.pinWorkContinuationContext(item)
    expect(f.service.getWorkNotificationSource).toHaveBeenCalledWith('notice-1')
    expect(binding.context).toMatchObject({ task: '请按客户确认的技术协议继续检查交付范围。', runStatus: 'succeeded', finalResult: { title: '交付检查意见' } })
    f.service.getWorkNotificationSource.mockResolvedValueOnce({
      version: '1', notificationID: 'notice-wrong-kind', kind: 'failure',
      source: { system: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' },
    })
    await expect(f.bridge.pinWorkContinuationContext({ ...item, id: 'notice-wrong-kind' })).rejects.toThrow('Forge 工作消息来源与当前通知不匹配')
    const prompt = `继续原工作\n${binding.context.task}`
    await f.bridge.employeeCommand('runtime', { type: 'prompt', message: prompt }, undefined, binding.handle)
    f.transcript.push(user('continued-work', prompt))
    await expect(f.call('activate', { prompt })).resolves.toMatchObject({ body: { result: { turn_key: expect.any(String) } } })
  })

  it('passes validated team disposition and missing items into the Pi continuation context', async () => {
    const f = await fixture()
    const context = workContinuationContext()
    context.run.finalResult = {
      ...context.run.finalResult!, disposition: 'needs_input', summary: '合同还缺验收日期。', missingItems: ['验收日期'],
    }
    f.service.getWorkContinuationContext.mockResolvedValueOnce(context)
    const binding = await f.bridge.pinWorkContinuationContext({
      id: 'notice-needs-input', source: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1',
    })
    expect(binding.context.finalResult).toMatchObject({ disposition: 'needs_input', summary: '合同还缺验收日期。', missingItems: ['验收日期'] })
  })

  it('passes trusted Weave action outcomes to Pi without exposing the bound record id', async () => {
    const f = await fixture()
    const context = workContinuationContext()
    context.run.actionOutcomes = [{
      nodeID: 'review', callID: 'call-1', actionName: 'contract_submit_frozen_material', objectName: 'sales_contract',
      recordID: 'contract-internal-1', status: 'succeeded', summary: '已由 Forge 确认合同材料提交成功。',
    }]
    f.service.getWorkContinuationContext.mockResolvedValueOnce(context)
    const binding = await f.bridge.pinWorkContinuationContext({ id: 'notice-action-outcome', source: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' })
    expect(binding.context.actionOutcomes).toEqual([{
      actionName: 'contract_submit_frozen_material', objectName: 'sales_contract', status: 'succeeded', summary: '已由 Forge 确认合同材料提交成功。',
    }])
    expect(JSON.stringify(binding.context.actionOutcomes)).not.toContain('contract-internal-1')

    const missing = await f.bridge.pinWorkContinuationContext({ id: 'notice-no-action-outcomes', source: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' })
    expect(missing.context).not.toHaveProperty('actionOutcomes')
  })

  it('keeps the parent work across two employee turns while refreshing the team and authorizing each new handoff', async () => {
    const f = await fixture()
    const item = { id: 'notice-two-rounds', source: 'weave' as const, workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' }
    const binding = await f.bridge.pinWorkContinuationContext(item)
    expect(f.service.getWorkNotificationSource).not.toHaveBeenCalled()
    const openedPrompt = `继续原团队工作\n${binding.context.task}`
    await f.bridge.employeeCommand('runtime', { type: 'prompt', message: openedPrompt }, undefined, binding.handle)
    f.transcript.push(user('continued-work-open', openedPrompt))
    const opened = await f.call('activate', { prompt: openedPrompt })
    expect(opened.body.result.turn_key).toBeTypeOf('string')

    const revisedMaterial = '# 合同\n已补验收期限\n'
    await writeFile(join(f.cwd, '材料', '附件', '合同.md'), revisedMaterial)
    f.bridge.invalidateHandoff('runtime')
    const oldTurn = await f.callWithTurn('activate', { prompt: openedPrompt }, opened.body.result.turn_key as string)
    expect(oldTurn.status).toBe(409)
    const revisedReference = { projectId: 'project-test', harness: 'pi' as const, workspacePath: f.cwd, name: '合同.md', path: '材料/附件/合同.md', sha256: digest(revisedMaterial), bytes: Buffer.byteLength(revisedMaterial), mimeType: 'text/markdown' as const }
    await f.input(appendWorkspaceMaterialContext('我补上验收期限了，再让原团队按这版检查。', [revisedReference]), 'continued-work-round-2')
    const round2 = await f.discover()
    const second = await f.call('submit', {
      ...round2,
      goal: '按我这次补充的验收期限，继续核对原工作。',
      materials: [{ path: '材料/附件/合同.md', sha256: digest(revisedMaterial) }],
    })
    expect(second.status).toBe(200)
    expect(second.body.result.status).toBe('accepted')
    expect(f.service.submitWork.mock.calls[0]?.[2]).toMatchObject({ continuation: {
      workbenchSessionID: 'workbench-session-1', inputRevisionID: 'input-1', runID: 'run-1', teamID: 'team-contract',
    }, authorizedBusinessCapabilityIds: [] })

    f.bridge.invalidateHandoff('runtime')
    await f.input(appendWorkspaceMaterialContext('再补一处表述，请继续检查刚才那版。', [revisedReference]), 'continued-work-round-3')
    const round3 = await f.discover()
    const third = await f.call('submit', {
      ...round3,
      goal: '继续检查刚才那版补充后的合同。',
      materials: [{ path: '材料/附件/合同.md', sha256: digest(revisedMaterial) }],
    })
    expect(third.status).toBe(200)
    expect(third.body.result.status).toBe('accepted')
    expect(f.service.submitWork.mock.calls[1]?.[2]).toMatchObject({ continuation: {
      workbenchSessionID: 'workbench-session-1', inputRevisionID: 'input-2', runID: 'run-2', teamID: 'team-contract',
    }, authorizedBusinessCapabilityIds: [] })
    expect(f.service.getTeamCatalog).toHaveBeenCalledTimes(2)
    expect(f.service.getTeamChoices).toHaveBeenCalledTimes(4)
    expect(f.service.getBusinessCapabilities).toHaveBeenCalledTimes(2)
    expect(f.service.stageWorkMaterials).toHaveBeenCalledTimes(2)
    expect(f.service.stageWorkMaterials.mock.calls.map(([materials]) => materials[0]?.extraction.content)).toEqual([revisedMaterial, revisedMaterial])
  })

  it('marks a failed read-only continuation as a fresh input in the same work session', async () => {
    const f = await fixture()
    f.service.getWorkContinuationContext.mockImplementation(async (references) => {
      const context = workContinuationContext()
      context.source.inputRevisionID = references.workReference
      context.source.runID = references.runReference
      context.source.workbenchSessionID = references.sessionReference
      context.run.status = 'failed'
      context.run.finalResult = undefined
      return context
    })
    const binding = await f.bridge.pinWorkContinuationContext({ id: 'failed-work', source: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' })
    const reference = { projectId: 'project-test', harness: 'pi' as const, workspacePath: f.cwd, name: '合同.md', path: '材料/附件/合同.md', sha256: digest(f.content), bytes: Buffer.byteLength(f.content), mimeType: 'text/markdown' as const }
    const openingPrompt = '查看上次失败的团队结果。'
    await f.bridge.employeeCommand('runtime', { type: 'prompt', message: openingPrompt }, undefined, binding.handle)
    f.transcript.push(user('failed-run-opening', openingPrompt))
    const activated = await f.call('activate', { prompt: openingPrompt })
    expect(activated.status, JSON.stringify(activated.body)).toBe(200)
    const turnKey = activated.body.result.turn_key as string
    const search = await f.callWithTurn('search', { work_summary: '复核合同' }, turnKey)
    const teamKey = (search.body.result.teams as Array<{ team_key: string }>)[0]!.team_key
    const described = await f.callWithTurn('describe', { team_key: teamKey }, turnKey)
    const handoffKey = (described.body.result.capabilities as Array<{ handoff_key: string }>)[0]!.handoff_key
    const openingSubmit = await f.callWithTurn('submit', { handoff_key: handoffKey, business_actions: [], goal: '只读检查这版合同', materials: f.materials }, turnKey)
    expect(openingSubmit.status).toBe(409)
    expect(openingSubmit.body.error).toContain('打开工作消息只授权查看')
    expect(f.service.submitWork).not.toHaveBeenCalled()

    await f.input(appendWorkspaceMaterialContext('这版合同重新交给原团队只读检查。', [reference]), 'failed-run-new-materials')
    const params = await f.discover()
    const result = await f.call('submit', params)
    expect(result.body.result.status).toBe('accepted')
    expect(f.service.submitWork.mock.calls[0]?.[2]).toMatchObject({ continuation: {
      workbenchSessionID: 'workbench-session-1', inputRevisionID: 'input-1', runID: 'run-1', restartAfterFailedRun: true,
    }, authorizedBusinessCapabilityIds: [] })
  })

  it('refuses a different team when describing a linked continuation', async () => {
    const f = await fixture()
    const binding = await f.bridge.pinWorkContinuationContext({ id: 'notice-team-change', source: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' })
    const prompt = '继续原合同工作'
    await f.bridge.employeeCommand('runtime', { type: 'prompt', message: prompt }, undefined, binding.handle)
    f.transcript.push(user('continued-work-team-check', prompt))
    const active = await f.call('activate', { prompt })
    const turnKey = active.body.result.turn_key as string
    const search = await f.callWithTurn('search', { work_summary: '安排休假' }, turnKey)
    const leave = (search.body.result.teams as Array<{ team_key: string; name: string }>).find((team) => team.name === '休假团队')
    expect(leave).toBeDefined()

    const result = await f.callWithTurn('describe', { team_key: leave!.team_key }, turnKey)
    expect(result.status).toBe(409)
    expect(result.body.error).toContain('原工作续办必须使用原团队')
    expect(f.service.getTeamChoices).not.toHaveBeenCalled()
  })

  it('rejects mismatched or changed Weave source references before Pi receives a continuation', async () => {
    const f = await fixture()
    const item = { id: 'notice-stale', source: 'weave' as const, workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' }
    const mismatched = workContinuationContext()
    mismatched.source.runID = 'another-run'
    f.service.getWorkContinuationContext.mockResolvedValueOnce(mismatched)
    await expect(f.bridge.pinWorkContinuationContext(item)).rejects.toThrow('工作消息与原团队工作不匹配')

    const opened = workContinuationContext(), statusChanged = workContinuationContext()
    statusChanged.run.status = 'running'
    f.service.getWorkContinuationContext.mockResolvedValueOnce(opened).mockResolvedValueOnce(statusChanged)
    const binding = await f.bridge.pinWorkContinuationContext(item)
    await expect(f.bridge.employeeCommand('runtime', { type: 'prompt', message: '继续原工作' }, undefined, binding.handle)).resolves.toBeUndefined()

    const current = workContinuationContext(), changedResult = workContinuationContext()
    const newerResult = '团队重新核对后的不同结论。'
    changedResult.run.finalResult = { ...changedResult.run.finalResult!, content: newerResult, sha256: digest(newerResult) }
    f.service.getWorkContinuationContext.mockResolvedValueOnce(current).mockResolvedValueOnce(changedResult)
    const resultBinding = await f.bridge.pinWorkContinuationContext(item)
    await expect(f.bridge.employeeCommand('runtime', { type: 'prompt', message: '按新结果继续' }, undefined, resultBinding.handle)).rejects.toThrow('团队工作或固定材料版本已变化')
  })

  it('invalidates a continuation if Weave action facts change after they were pinned', async () => {
    const f = await fixture(), item = { id: 'notice-action-facts', source: 'weave' as const, workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' }
    const pinned = workContinuationContext()
    pinned.run.actionOutcomes = [{ nodeID: 'review', callID: 'call-1', actionName: 'submit_contract', objectName: 'sales_contract', status: 'succeeded', summary: '提交成功。' }]
    const changed = workContinuationContext()
    changed.run.actionOutcomes = [{ nodeID: 'review', callID: 'call-1', actionName: 'submit_contract', objectName: 'sales_contract', status: 'unknown', summary: '结果未知。' }]
    f.service.getWorkContinuationContext.mockResolvedValueOnce(pinned).mockResolvedValueOnce(changed)
    const binding = await f.bridge.pinWorkContinuationContext(item)
    await expect(f.bridge.employeeCommand('runtime', { type: 'prompt', message: '继续核实原动作' }, undefined, binding.handle)).rejects.toThrow('团队工作或固定材料版本已变化')
  })

  it('fails closed when an original Forge file needs the restricted owner-only reader', async () => {
    const f = await fixture()
    const context = workContinuationContext()
    context.input.materials.push({ id: 'file-private', name: '合同.txt', bytes: 10, sha256: digest('合同内容') })
    f.service.getWorkContinuationContext.mockResolvedValueOnce(context)
    await expect(f.bridge.pinWorkContinuationContext({ id: 'notice-missing-bytes', source: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' })).rejects.toThrow('没有取得经核验的原文')
  })

  it('passes only Forge-owner-verified original file text to the Pi context', async () => {
    const f = await fixture()
    const content = '原工作固定材料正文'
    const context = workContinuationContext()
    context.input.materials.push({ id: 'file-private', name: '合同.txt', bytes: Buffer.byteLength(content), sha256: digest(content), mediaType: 'text/plain; charset=utf-8', content })
    f.service.getWorkContinuationContext.mockResolvedValueOnce(context)
    const binding = await f.bridge.pinWorkContinuationContext({ id: 'notice-original-file', source: 'weave', workReference: 'input-1', runReference: 'run-1', sessionReference: 'workbench-session-1' })
    expect(binding.context.materials).toEqual([{ name: '合同.txt', bytes: Buffer.byteLength(content), sha256: digest(content), content }])
  })

  it('keeps a new Pi turn when the reported session file has not been created yet', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-future-session-')); directories.push(cwd)
    const transcript: TranscriptMessage[] = []
    const service = {
      accountKey: vi.fn(async () => 'employee-a'), getApprovalContext: vi.fn(), getWorkNotificationSource: vi.fn(), getWorkContinuationContext: vi.fn(async () => workContinuationContext()),
      getTeamCatalog: vi.fn(async () => [{ id: 'team-lead', name: '线索分析团队', objective: '整理线索事实' }]),
      getTeamChoices: vi.fn(async () => []), getBusinessCapabilities: vi.fn(async () => []),
      getBusinessObjectDirectory: vi.fn(async () => ({ objects: [], complete: true, totalCount: 0 })),
      findBusinessRecords: vi.fn(async () => ({ records: [], offset: 0, limit: 20, hasMore: false, complete: true })),
      readBusinessRecord: vi.fn(async () => { throw new Error('not used in this fixture') }), stageWorkMaterials: vi.fn(async () => []), submitWork: vi.fn(),
      submitApprovalRevision: vi.fn(async () => ({ status: 404, body: {} })),
      getApprovalRevisionReceipt: vi.fn(async () => ({ status: 404, body: {} })),
    }
    const sessions = { read: vi.fn(async () => transcript) }
    sessions.read.mockRejectedValueOnce(Object.assign(new Error('session file not created'), { code: 'ENOENT' }))
    const bridge = new AgentEnterpriseBridge({ service, sessions: { prime: sessions, pi: sessions }, extensionPath: '/extensions/enterprise.ts' })
    await bridge.start(); bridges.push(bridge)
    const environment = bridge.environmentFor({ cwd, harness: 'pi' })
    bridge.bindSession(environment.GOOEYPI_ENTERPRISE_TOKEN, '/sessions/future.jsonl', 'new-runtime')
    const prompt = '把这版线索交给团队只做分析'
    await bridge.employeeCommand('new-runtime', { type: 'prompt', message: prompt })
    transcript.push(user('new-message', prompt))
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(environment.GOOEYPI_ENTERPRISE_URL!, {
        method: 'POST', headers: { Authorization: `Bearer ${environment.GOOEYPI_ENTERPRISE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
      return { status: response.status, body: await response.json() as { result?: Record<string, unknown>; error?: string } }
    }
    const active = await call('activate', { prompt })
    expect(active.status).toBe(200)
    const search = await call('search', { turn_key: active.body.result?.turn_key, work_summary: '线索事实分析' })
    expect(search.status).toBe(200)
    expect(search.body.result?.teams).toEqual([{ team_key: expect.any(String), name: '线索分析团队', summary: '整理线索事实' }])
  })

  it('keeps the first Pi employee turn when the runtime token is bound before its session file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-race-')); directories.push(cwd)
    const transcript: TranscriptMessage[] = []
    const service = {
      accountKey: vi.fn(async () => 'employee-a'), getApprovalContext: vi.fn(), getWorkNotificationSource: vi.fn(), getWorkContinuationContext: vi.fn(async () => workContinuationContext()), getTeamCatalog: vi.fn(async () => [{ id: 'team-lead', name: '线索分析团队', objective: '整理线索并返回依据和待确认项' }]), getTeamChoices: vi.fn(async () => []),
      getBusinessCapabilities: vi.fn(async () => []),
      getBusinessObjectDirectory: vi.fn(async () => ({ objects: [], complete: true, totalCount: 0 })),
      findBusinessRecords: vi.fn(async () => ({ records: [], offset: 0, limit: 20, hasMore: false, complete: true })),
      readBusinessRecord: vi.fn(async () => { throw new Error('not used in this fixture') }),
      stageWorkMaterials: vi.fn(async () => []), submitWork: vi.fn(),
      submitApprovalRevision: vi.fn(async () => ({ status: 404, body: {} })), getApprovalRevisionReceipt: vi.fn(async () => ({ status: 404, body: {} })),
    }
    const sessions = { read: vi.fn(async () => transcript) }
    const bridge = new AgentEnterpriseBridge({ service, sessions: { prime: sessions, pi: sessions }, extensionPath: '/extensions/enterprise.ts' })
    await bridge.start(); bridges.push(bridge)
    const environment = bridge.environmentFor({ cwd, harness: 'pi' })
    bridge.bindSession(environment.GOOEYPI_ENTERPRISE_TOKEN, undefined, 'new-runtime')
    const call = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(environment.GOOEYPI_ENTERPRISE_URL!, {
        method: 'POST', headers: { Authorization: `Bearer ${environment.GOOEYPI_ENTERPRISE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
      return { status: response.status, body: await response.json() as { result?: Record<string, unknown>; error?: string } }
    }
    const firstPrompt = '读取材料/北辰线索沟通纪要.md，先整理再查找可承接团队'

    // The desktop forwards the first prompt before Pi has reported its new
    // session file. The runtime token exists, but is still in the pending map.
    await bridge.employeeCommand('new-runtime', { type: 'prompt', message: firstPrompt })
    const firstActivation = await call('activate', { prompt: firstPrompt })
    expect(firstActivation.status).toBe(200)
    const firstTurnKey = firstActivation.body.result?.turn_key as string
    expect(firstTurnKey).toBeTruthy()
    transcript.push(user('first-turn', firstPrompt))
    transcript.push({ id: 'assistant-read-material', role: 'assistant', parts: [{ type: 'text', text: '已读取北辰线索沟通纪要.md。' }] })
    const firstSearchPromise = call('search', { turn_key: firstTurnKey, work_summary: '整理北辰设备线索的需求和待确认事项' })
    const bindingWaiters = (bridge as unknown as { sessionBindingWaiters: Map<string, Set<() => void>> }).sessionBindingWaiters
    await vi.waitFor(() => expect(bindingWaiters.size).toBe(1))
    bridge.bindRuntimeSession('new-runtime', '/sessions/new.jsonl')
    const firstSearch = await firstSearchPromise
    expect(firstSearch.status).toBe(200)
    expect(firstSearch.body.result?.teams).toEqual([{ team_key: expect.any(String), name: '线索分析团队', summary: '整理线索并返回依据和待确认项' }])

    const followUp = '按刚才的纪要继续找线索分析团队'
    // The renderer revokes the previous turn before queuing a changed employee
    // request; the following IPC command must establish a fresh turn on the
    // already-bound runtime.
    bridge.invalidateHandoff('new-runtime')
    await bridge.employeeCommand('new-runtime', { type: 'follow_up', message: followUp })
    transcript.push(user('follow-up-turn', followUp))
    const followUpActivation = await call('activate', { prompt: followUp })
    expect(followUpActivation.status).toBe(200)
    const followUpTurnKey = followUpActivation.body.result?.turn_key as string
    expect(followUpTurnKey).toBeTruthy()
    expect(followUpTurnKey).not.toBe(firstTurnKey)

    const staleTurn = await call('search', { turn_key: firstTurnKey, work_summary: '旧轮次的请求' })
    expect(staleTurn.status).toBe(409)
    expect(staleTurn.body.error).toContain('员工要求已变化')

    const followUpSearch = await call('search', { turn_key: followUpTurnKey, work_summary: '继续整理北辰线索' })
    expect(followUpSearch.status).toBe(200)
    service.accountKey.mockResolvedValue('employee-b')
    const changedAccount = await call('search', { turn_key: followUpTurnKey, work_summary: '切换账号后的旧轮次' })
    expect(changedAccount.status).toBe(409)
    expect(changedAccount.body.error).toContain('员工轮次或账号已变化')
  })

  it('clears a first-prompt authorization when its pending runtime handoff is invalidated', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-pending-invalidate-')); directories.push(cwd)
    const transcript: TranscriptMessage[] = []
    const service = {
      accountKey: vi.fn(async () => 'employee-a'), getApprovalContext: vi.fn(), getWorkNotificationSource: vi.fn(), getWorkContinuationContext: vi.fn(async () => workContinuationContext()), getTeamCatalog: vi.fn(async () => []), getTeamChoices: vi.fn(async () => []),
      getBusinessCapabilities: vi.fn(async () => []), getBusinessObjectDirectory: vi.fn(async () => ({ objects: [], complete: true, totalCount: 0 })),
      findBusinessRecords: vi.fn(async () => ({ records: [], offset: 0, limit: 20, hasMore: false, complete: true })), readBusinessRecord: vi.fn(async () => { throw new Error('not used in this fixture') }),
      stageWorkMaterials: vi.fn(async () => []), submitWork: vi.fn(),
      submitApprovalRevision: vi.fn(async () => ({ status: 404, body: {} })), getApprovalRevisionReceipt: vi.fn(async () => ({ status: 404, body: {} })),
    }
    const sessions = { read: vi.fn(async () => transcript) }
    const bridge = new AgentEnterpriseBridge({ service, sessions: { prime: sessions, pi: sessions }, extensionPath: '/extensions/enterprise.ts' })
    await bridge.start(); bridges.push(bridge)
    const environment = bridge.environmentFor({ cwd, harness: 'pi' })
    bridge.bindSession(environment.GOOEYPI_ENTERPRISE_TOKEN, undefined, 'pending-runtime')
    await bridge.employeeCommand('pending-runtime', { type: 'prompt', message: '读取北辰沟通纪要' })

    bridge.invalidateHandoff('pending-runtime')
    expect((bridge as unknown as { pendingRuntimeTokens: Map<string, string> }).pendingRuntimeTokens.has('pending-runtime')).toBe(false)
    await bridge.employeeCommand('pending-runtime', { type: 'prompt', message: '改成另一条线索' })
    transcript.push(user('changed-intent', '改成另一条线索'))
    bridge.bindRuntimeSession('pending-runtime', '/sessions/pending.jsonl')

    const response = await fetch(environment.GOOEYPI_ENTERPRISE_URL!, {
      method: 'POST', headers: { Authorization: `Bearer ${environment.GOOEYPI_ENTERPRISE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'activate', params: { prompt: '改成另一条线索' } }),
    })
    expect(response.status).toBe(409)
    expect((await response.json() as { error?: string }).error).toContain('员工轮次或账号已变化')
  })

  it('does not treat an old same-text message in a restored session as a new authorization', async () => {
    const f = await fixture()
    const sameText = '这版给他们看看'
    await f.bridge.employeeCommand('runtime', { type: 'prompt', message: sameText })
    const activation = await f.call('activate', { prompt: sameText })
    expect(activation.status).toBe(200)
    const turnKey = activation.body.result?.turn_key as string

    const result = await f.callWithTurn('search', { work_summary: '复核合同' }, turnKey)
    expect(result.status).toBe(409)
    expect(result.body.error).toContain('当前员工输入尚未进入原会话')
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })

  it('rejects a new-session first prompt if the transcript contains more than that one user message', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'handoff-new-session-ambiguous-')); directories.push(cwd)
    const transcript: TranscriptMessage[] = []
    const service = {
      accountKey: vi.fn(async () => 'employee-a'), getApprovalContext: vi.fn(), getWorkNotificationSource: vi.fn(), getWorkContinuationContext: vi.fn(async () => workContinuationContext()), getTeamCatalog: vi.fn(async () => []), getTeamChoices: vi.fn(async () => []),
      getBusinessCapabilities: vi.fn(async () => []), getBusinessObjectDirectory: vi.fn(async () => ({ objects: [], complete: true, totalCount: 0 })),
      findBusinessRecords: vi.fn(async () => ({ records: [], offset: 0, limit: 20, hasMore: false, complete: true })), readBusinessRecord: vi.fn(async () => { throw new Error('not used in this fixture') }),
      stageWorkMaterials: vi.fn(async () => []), submitWork: vi.fn(),
      submitApprovalRevision: vi.fn(async () => ({ status: 404, body: {} })), getApprovalRevisionReceipt: vi.fn(async () => ({ status: 404, body: {} })),
    }
    const sessions = { read: vi.fn(async () => transcript) }
    const bridge = new AgentEnterpriseBridge({ service, sessions: { prime: sessions, pi: sessions }, extensionPath: '/extensions/enterprise.ts' })
    await bridge.start(); bridges.push(bridge)
    const environment = bridge.environmentFor({ cwd, harness: 'pi' })
    bridge.bindSession(environment.GOOEYPI_ENTERPRISE_TOKEN, undefined, 'ambiguous-runtime')
    const prompt = '读取北辰沟通纪要'
    await bridge.employeeCommand('ambiguous-runtime', { type: 'prompt', message: prompt })
    const activateResponse = await fetch(environment.GOOEYPI_ENTERPRISE_URL!, {
      method: 'POST', headers: { Authorization: `Bearer ${environment.GOOEYPI_ENTERPRISE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'activate', params: { prompt } }),
    })
    const activated = await activateResponse.json() as { result: { turn_key: string } }
    transcript.push(user('first-prompt', prompt), user('unexpected-follow-up', '改成别的材料'))
    bridge.bindRuntimeSession('ambiguous-runtime', '/sessions/ambiguous.jsonl')

    const response = await fetch(environment.GOOEYPI_ENTERPRISE_URL!, {
      method: 'POST', headers: { Authorization: `Bearer ${environment.GOOEYPI_ENTERPRISE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'search', params: { turn_key: activated.result.turn_key, work_summary: '北辰线索' } }),
    })
    expect(response.status).toBe(409)
    expect((await response.json() as { error?: string }).error).toContain('无法核对新 Pi 会话中的员工消息顺序')
  })

  it('revokes a runtime claim when the reported session path differs from its scoped path', async () => {
    const f = await fixture()
    expect(() => f.bridge.bindSession(f.environment.GOOEYPI_ENTERPRISE_TOKEN, '/sessions/other.jsonl', 'runtime'))
      .toThrow('Pi 会话文件与桌面授权会话不匹配')
    expect((await f.call('activate', { prompt: '这版给他们看看' })).status).toBe(401)
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
    expect(task.materials[0]).toMatchObject({
      materialId: expect.stringMatching(/^[0-9a-f]{24}$/), name: '合同.md', mediaType: 'text/markdown',
      bytes: Buffer.byteLength(f.content), sha256: digest(f.content),
      extraction: { status: 'complete', sourceSha256: digest(f.content), sha256: digest(f.content), content: f.content },
    })
    expect(JSON.stringify(task)).not.toContain(Buffer.from(f.content).toString('base64'))
    expect(f.service.submitWork.mock.calls[0][2]).toMatchObject({ authorizedBusinessCapabilityIds: [] })
  })
  it('freezes employee-selected PDF as owner and carries that source binding only in the Forge resource', async () => {
    const f = await fixture()
    const source = await readFile(new URL('../fixtures/materials/sample-two-page.pdf', import.meta.url))
    const path = '材料/附件/验收附件.pdf'
    await writeFile(join(f.cwd, path), source)
    const reference = {
      projectId: 'project-test', harness: 'pi' as const, workspacePath: f.cwd,
      name: '验收附件.pdf', path, sha256: digest(source), bytes: source.length, mimeType: 'application/pdf' as const,
    }
    const prompt = appendWorkspaceMaterialContext('请只读核对这份验收附件。', [reference])
    await f.input(prompt, 'employee-pdf-turn')
    const discovered = await f.discover()
    const submitted = await f.call('submit', { ...discovered, materials: [{ path, sha256: digest(source) }] })

    expect(submitted.status).toBe(200)
    expect(f.service.stageWorkMaterials.mock.calls[0]?.[0][0]).toMatchObject({ sourceKind: 'owner', name: '验收附件.pdf', bytes: source.length, sha256: digest(source) })
    const task = JSON.parse(f.service.submitWork.mock.calls[0]![1]) as { materials: Array<Record<string, unknown>> }
    expect(task.materials[0]).not.toHaveProperty('sourceKind')
    expect(task.materials[0]).not.toHaveProperty('bytesBase64')
    const resources = f.service.submitWork.mock.calls[0]![2]!.resources
    expect(resources![0]).toMatchObject({ sourceKind: 'owner', name: '验收附件.pdf', bytes: source.length, sha256: digest(source) })
    expect(resources![0]).not.toHaveProperty('requestId')
  })
  it('authorizes only the business action selected for the current employee intent', async () => {
    const f = await fixture(), params = await f.discover()
    const actionKey = params.available_actions[0].action_key
    const { directory, found, recordKey } = await f.findRecord(params.handoff_key, 'TEST-100 设备交接验收合同')
    expect(directory.body.result).toMatchObject({ status: 'complete', directory_complete: true })
    expect(found.body.result).toMatchObject({ status: 'candidate', selection_required: true, has_more: false, complete: true })
    expect(found.body.result.records).toEqual([{ record_key: recordKey, name: 'TEST-100 设备交接验收合同', object: '销售合同', code: 'SC-TEST-001', status: '草稿', owner: '销售人员', record_version: 'v7' }])
    expect(JSON.stringify(found.body.result.records)).not.toContain('contract-1')
    const detail = await f.call('read_business_record', { handoff_key: params.handoff_key, record_key: recordKey })
    expect(detail.body.result).toMatchObject({
      status: 'read', record_key: recordKey, complete: true,
      snapshot: { record: expect.arrayContaining([expect.objectContaining({ label: '合同名称' })]), completeness: 'complete' },
    })
    expect((await f.call('submit', { ...params, business_record_key: recordKey, business_actions: [actionKey] })).status).toBe(200)
    expect(f.service.submitWork.mock.calls[0][2]).toMatchObject({
      authorizedBusinessCapabilityIds: [f.businessCapabilityId],
      businessContext: { objectName: 'forge_sales_contract', recordId: 'contract-1', recordVersion: 'v7' },
    })
    const task = JSON.parse(f.service.submitWork.mock.calls[0][1])
    expect(task.businessSnapshot).toEqual(f.businessSnapshot)
    expect(task).not.toHaveProperty('businessContext.recordId')
    expect(f.service.readBusinessRecord).toHaveBeenCalledOnce()
  })

  it('finds readable records with no team write action and does not infer data permission from the object directory', async () => {
    const f = await fixture()
    f.service.getBusinessCapabilities.mockResolvedValueOnce([])
    const params = await f.discover()
    expect(params.available_actions).toEqual([])
    const { directory, found } = await f.findRecord(params.handoff_key, 'TEST-100 设备交接验收合同')
    expect(directory.body.result.objects).toHaveLength(1)
    expect(f.service.findBusinessRecords).toHaveBeenCalledWith('forge_sales_contract', 'TEST-100 设备交接验收合同', 0, 20)
    expect(found.body.result.status).toBe('candidate')

    f.service.findBusinessRecords.mockRejectedValueOnce(new ForgeBusinessReadError('forbidden', 'permission denied'))
    const denied = await f.call('find_business_record', {
      handoff_key: params.handoff_key, object_ref: (directory.body.result.objects as Array<{ object_ref: string }>)[0]!.object_ref,
      work_summary: 'TEST-100 设备交接验收合同',
    })
    expect(denied.body.result).toMatchObject({ status: 'forbidden', records: [] })
    expect(await f.service.accountKey()).toBe('employee-a')
  })

  it('discards an object directory result that arrives after the employee changes turns', async () => {
    const f = await fixture(), params = await f.discover()
    let release!: (value: { objects: Array<{ objectName: string; label: string }>; complete: boolean; totalCount: number }) => void
    f.service.getBusinessObjectDirectory.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const pending = f.call('list_business_objects', { handoff_key: params.handoff_key })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await f.input('改查另一份业务记录', 'employee-turn-after-directory')
    release({ objects: [{ objectName: 'forge_sales_contract', label: '销售合同' }], complete: true, totalCount: 1 })
    expect(await pending).toMatchObject({ status: 409, body: { error: expect.stringContaining('员工轮次') } })
  })

  it('discards a selected-record read that arrives after the employee changes turns', async () => {
    const f = await fixture(), params = await f.discover()
    const { recordKey } = await f.findRecord(params.handoff_key, 'TEST-100 设备交接验收合同')
    let release!: (value: { candidate: typeof f.businessCandidate; snapshot: BusinessRecordSnapshot }) => void
    f.service.readBusinessRecord.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const pending = f.call('read_business_record', { handoff_key: params.handoff_key, record_key: recordKey })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await f.input('改成查另一份记录', 'employee-turn-after-record-read')
    release({ candidate: f.businessCandidate, snapshot: f.businessSnapshot })
    expect(await pending).toMatchObject({ status: 409, body: { error: expect.stringContaining('员工轮次') } })
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('freezes a returned approval revision package for the opened account, request, and employee round', async () => {
    const f = await fixture()
    const opened = await f.openReturned()
    const employeeRequest = '按退回意见补全验收要求，帮我递交这版修订材料'
    await f.input(employeeRequest, 'employee-revision-1')
    const body = '修订后的合同正文：验收包含现场联调和连续运行三天。'
    const result = await f.call('revision_submit', { employee_request: employeeRequest, body, materials: f.materials })

    expect(opened.context).toMatchObject({ title: '测试合同', step: '销售修改', returnReason: '请补齐验收要求' })
    expect(opened.context).not.toHaveProperty('requestId')
    expect(opened.context).not.toHaveProperty('businessObject')
    expect(opened.context).not.toHaveProperty('returnVersion')
    expect(opened.context).not.toHaveProperty('sourceMaterialVersion')
    expect(opened.context.files[0]).not.toHaveProperty('fileId')
    expect(opened.context.files[0]).not.toHaveProperty('sha256')
    expect(result.body.result).toMatchObject({ status: 'resumed', submitted: true, materials: [{ name: '修订正文.md' }, { name: '合同.md' }] })
    expect(result.body.result.message).toContain('已进入下一轮')
    expect(f.service.submitWork).not.toHaveBeenCalled()
    expect(f.service.stageWorkMaterials.mock.calls[0]![0]).toMatchObject([
      { name: '修订正文.md', extraction: { content: body }, bytes: Buffer.byteLength(body), sha256: digest(body) },
      { name: '合同.md', extraction: { content: f.content }, bytes: Buffer.byteLength(f.content), sha256: digest(f.content) },
    ])
    const sent = f.service.submitApprovalRevision.mock.calls[0]!
    expect(sent[0]).toBe('approval-1')
    expect(sent[1]).toMatchObject({
      returnVersion: 'revise-1', sourceMaterialVersion: f.contexts.get('approval-1')!.sourceMaterialVersion,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      primary: { fileId: 'file-1', name: '修订正文.md', sha256: digest(body) },
      attachments: [{ fileId: 'file-2', name: '合同.md', sha256: digest(f.content) }],
    })

    const files = await readdir(f.storageDirectory)
    const saved = await Promise.all(files.map(async (file) => JSON.parse((await readFile(join(f.storageDirectory, file))).toString('utf8')) as { value: Record<string, unknown> }))
    const stored = saved.find((entry) => entry.value.requestId === 'approval-1') as { value: {
      requestId: string; returnVersion: string; sourceMaterialVersion: string; businessObject: { objectName: string; recordId: string };
      employeeMessageId: string; employeeRoundId: string; employeeRequest: string; body: { content: string; bytesBase64: string; sha256: string };
      idempotencyKey: string;
      sourceMessages: Array<{ messageId: string; eventSeq: number; sha256: string }>;
      sourceFiles: Array<{ fileId: string; bytesBase64: string }>; materials: Array<{ name: string; bytesBase64: string; sha256: string }>
    } }
    expect(stored.value).toMatchObject({
      requestId: 'approval-1', returnVersion: 'revise-1', sourceMaterialVersion: f.contexts.get('approval-1')!.sourceMaterialVersion,
      businessObject: { objectName: 'forge_sales_contract', recordId: 'contract-1' }, employeeRequest,
      body: { name: '修订正文.md', content: body, bytesBase64: Buffer.from(body).toString('base64'), sha256: digest(body) },
      sourceFiles: [{ fileId: 'source-file-approval-1', bytesBase64: Buffer.from('# 原提交合同\n客户：测试客户\n').toString('base64') }],
      materials: [{ name: '合同.md', bytesBase64: Buffer.from(f.content).toString('base64'), sha256: digest(f.content) }],
    })
    expect(stored.value.employeeMessageId).toBe('employee-revision-1')
    expect(stored.value.employeeRoundId).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.value.idempotencyKey).toBe(submissionUUID(stored.value.employeeRoundId))
    expect(stored.value.sourceMessages.find((message) => message.messageId === 'employee-revision-1')?.sha256).toBe(digest(employeeRequest))
  })
  it('freezes approval PDF source identity with its exact bytes in the same returned revision intent', async () => {
    const f = await fixture()
    const source = await readFile(new URL('../fixtures/materials/sample-two-page.pdf', import.meta.url))
    const original = await freezeApprovalOriginalMaterial({
      sourceKind: 'approval', requestId: 'approval-1', fileId: 'approval-pdf-1', name: '验收附件.pdf',
      mediaType: 'application/pdf', bytes: source.length, sha256: digest(source),
    }, source, 700_000)
    const context = f.contexts.get('approval-1')!
    f.contexts.set('approval-1', { ...context, originalFiles: [original] })

    const opened = await f.openReturned()
    expect(opened.context.originalFiles).toMatchObject([{ name: '验收附件.pdf', bytes: source.length, verified: true }])
    expect(opened.context.originalFiles?.[0]).not.toHaveProperty('fileId')
    expect(opened.context.originalFiles?.[0]).not.toHaveProperty('requestId')
    expect(opened.context.originalFiles?.[0]).not.toHaveProperty('bytesBase64')
    expect(opened.context.originalFiles?.[0]).not.toHaveProperty('sha256')

    const employeeRequest = '按退回意见整理原审批附件并准备修订。'
    await f.input(employeeRequest, 'employee-approval-pdf-revision')
    await f.call('revision_submit', { employee_request: employeeRequest, body: '修订正文', materials: [] })

    const files = await readdir(f.storageDirectory)
    const saved = await Promise.all(files.map(async (file) => JSON.parse((await readFile(join(f.storageDirectory, file))).toString('utf8')) as { value: Record<string, unknown> }))
    const stored = saved.find((entry) => entry.value.requestId === 'approval-1')!.value
    expect(stored.sourceFiles).toMatchObject([{
      fileId: 'source-file-approval-1', name: '原合同.md', mediaType: 'text/plain; charset=utf-8',
      bytes: Buffer.byteLength('# 原提交合同\n客户：测试客户\n'), sha256: digest('# 原提交合同\n客户：测试客户\n'),
    }, {
      sourceKind: 'approval', requestId: 'approval-1', fileId: 'approval-pdf-1', name: '验收附件.pdf',
      mediaType: 'application/pdf', bytes: source.length, sha256: digest(source), bytesBase64: source.toString('base64'),
    }])
    expect(f.service.submitApprovalRevision).toHaveBeenCalledOnce()
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
    const first = await f.call('revision_submit', params)
    expect(first.body.result.status).toBe('resumed')
    await writeFile(join(f.cwd, '材料', '附件', '合同.md'), '被修改的本地草稿')

    const retry = await f.call('revision_submit', params)
    expect(retry.body.result).toEqual(first.body.result)
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitApprovalRevision).toHaveBeenCalledOnce()
    expect(f.service.getApprovalRevisionReceipt).toHaveBeenCalledOnce()
    const changedBody = await f.call('revision_submit', { ...params, body: '新的正文' })
    expect(changedBody.status).toBe(409)
    expect(changedBody.body.error).toContain('本轮修订材料已固定')
    const changedMaterial = await f.call('revision_submit', { ...params, materials: [{ path: '材料/附件/合同.md', sha256: digest('被修改的本地草稿') }] })
    expect(changedMaterial.status).toBe(409)
    expect(changedMaterial.body.error).toContain('本轮修订材料已固定')
  })
  it('queries the same receipt after a lost POST response and never reuploads or reposts', async () => {
    const f = await fixture()
    await f.openReturned()
    const employeeRequest = '请递交这版修订材料'
    await f.input(employeeRequest, 'employee-revision-lost-response')
    const params = { employee_request: employeeRequest, body: '修订正文', materials: f.materials }
    const receipt = {
      requestId: 'approval-1', bindingId: '550e8400-e29b-41d4-a716-446655440000',
      newVersionDigest: digest('new-revision-v1'), state: 'resume_unknown', repeated: true,
    }
    f.service.submitApprovalRevision.mockImplementationOnce(async (_requestId: string, _body: unknown, assertCurrent: () => Promise<void>) => {
      await assertCurrent()
      throw new Error('connection dropped after request')
    })
    f.service.getApprovalRevisionReceipt.mockImplementationOnce(async (_requestId: string, _key: string, assertCurrent: () => Promise<void>) => {
      await assertCurrent()
      return { status: 200, body: { data: receipt } }
    })

    const first = await f.call('revision_submit', params)
    expect(first.body.result).toMatchObject({ status: 'resume_unknown', submitted: false })
    const retry = await f.call('revision_submit', params)
    expect(retry.body.result.status).toBe('resume_unknown')
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitApprovalRevision).toHaveBeenCalledOnce()
    expect(f.service.getApprovalRevisionReceipt).toHaveBeenCalledTimes(2)
  })
  it('does not repeat an interrupted file upload when its receipt cannot be recovered', async () => {
    const f = await fixture()
    await f.openReturned()
    const employeeRequest = '请递交这版正文和附件'
    await f.input(employeeRequest, 'employee-revision-upload-interrupted')
    f.service.stageWorkMaterials.mockRejectedValueOnce(new Error('upload connection interrupted'))
    const params = { employee_request: employeeRequest, body: '正文', materials: f.materials }

    const first = await f.call('revision_submit', params)
    expect(first.body.result).toMatchObject({ status: 'upload_unknown', submitted: false })
    const retry = await f.call('revision_submit', params)
    expect(retry.body.result).toMatchObject({ status: 'upload_unknown', submitted: false })
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitApprovalRevision).not.toHaveBeenCalled()
    expect(f.service.getApprovalRevisionReceipt).toHaveBeenCalledOnce()
  })
  it('reports a Forge prepared receipt without claiming that the next approval round resumed', async () => {
    const f = await fixture()
    await f.openReturned()
    const employeeRequest = '帮我递交这版正文'
    await f.input(employeeRequest, 'employee-revision-prepared')
    f.service.submitApprovalRevision.mockImplementationOnce(async (_requestId: string, body: { idempotencyKey: string }, assertCurrent: () => Promise<void>) => {
      await assertCurrent()
      const receipt = {
        requestId: 'approval-1', bindingId: '550e8400-e29b-41d4-a716-446655440000',
        newVersionDigest: digest('new-revision-v1'), state: 'prepared', repeated: true,
      }
      f.revisionReceipts.set(body.idempotencyKey, receipt)
      return { status: 200, body: { data: receipt } }
    })
    const result = await f.call('revision_submit', { employee_request: employeeRequest, body: '修订正文', materials: [] })
    expect(result.body.result).toMatchObject({ status: 'prepared', submitted: false, receiptConfirmed: true })
    expect(result.body.result.message).toContain('尚未确认')
  })
  it('fails closed on a 404 Forge service and does not fall back to native resubmit', async () => {
    const f = await fixture()
    await f.openReturned()
    const employeeRequest = '请提交修改后的合同'
    await f.input(employeeRequest, 'employee-revision-old-server')
    f.service.submitApprovalRevision.mockImplementationOnce(async () => ({ status: 404, body: { message: 'not found' } as unknown as { data: { requestId: string; bindingId: string; newVersionDigest: string; state: string; repeated: boolean } } }))
    const params = { employee_request: employeeRequest, body: '修订正文', materials: f.materials }

    const first = await f.call('revision_submit', params)
    expect(first.body.result).toMatchObject({ status: 'unavailable', submitted: false, receiptConfirmed: false })
    expect(first.body.result.message).toContain('没有退回材料修订接口')
    const retry = await f.call('revision_submit', params)
    expect(retry.body.result).toEqual(first.body.result)
    expect(f.service.submitApprovalRevision).toHaveBeenCalledOnce()
    expect(f.service.getApprovalRevisionReceipt).not.toHaveBeenCalled()
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('blocks an old returned revision when the account, approval, or employee round changes', async () => {
    const f = await fixture()
    await f.openReturned()
    const employeeRequest = '确认把这一版修订材料递交'
    const oldTurnKey = await f.input(employeeRequest, 'employee-revision-old')
    const params = { employee_request: employeeRequest, body: '修订正文', materials: f.materials }

    await f.input('先等等，重新核对一下', 'employee-revision-new-round')
    const oldRound = await f.callWithTurn('revision_submit', params, oldTurnKey)
    expect(oldRound.status).toBe(409)
    expect(oldRound.body.error).toContain('员工要求已变化')

    const secondHandle = await f.bridge.pinReturnedApprovalContext('approval-2')
    const secondPrompt = '打开退回审批 approval-2'
    await f.bridge.employeeCommand('runtime', { type: 'prompt', message: secondPrompt }, secondHandle.handle)
    f.transcript.push(user('opened-approval-2', secondPrompt))
    const active = await f.call('activate', { prompt: secondPrompt })
    const secondTurnKey = active.body.result.turn_key as string
    const changedApproval = await f.callWithTurn('revision_submit', params, secondTurnKey)
    expect(changedApproval.status).toBe(409)
    expect(changedApproval.body.error).toContain('员工本轮要求已变化')

    f.service.accountKey.mockResolvedValue('employee-b')
    const changedAccount = await f.callWithTurn('revision_submit', { ...params, employee_request: secondPrompt }, secondTurnKey)
    expect(changedAccount.status).toBe(409)
    expect(changedAccount.body.error).toContain('账号已变化')
    expect(f.service.submitWork).not.toHaveBeenCalled()
    expect(f.service.stageWorkMaterials).not.toHaveBeenCalled()
    expect(f.service.submitApprovalRevision).not.toHaveBeenCalled()
    expect(f.service.getApprovalRevisionReceipt).not.toHaveBeenCalled()
  })
  it('stops when the latest return version or business object changed after opening', async () => {
    const f = await fixture()
    await f.openReturned()
    const employeeRequest = '请递交刚改好的材料'
    await f.input(employeeRequest, 'employee-revision-stale-context')
    const context = f.contexts.get('approval-1')!
    f.contexts.set('approval-1', { ...context, returnVersion: 'revise-2', businessObject: { ...context.businessObject, recordId: 'contract-2' } })
    const result = await f.call('revision_submit', { employee_request: employeeRequest, body: '正文', materials: [] })
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
    await writeFile(join(f.cwd, '材料', '附件', '合同.md'), 'changed')
    expect((await f.call('submit', params)).body.error).toContain('版本已变化')
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('rejects an account-workspace file that was never attached or explicitly reused in this employee turn', async () => {
    const f = await fixture()
    const oldPath = '材料/附件/青峦工业合同.md'
    const oldContent = '# 青峦工业合同\n'
    await writeFile(join(f.cwd, oldPath), oldContent)
    await f.input('请分析北辰装备线索。', 'employee-lead-turn')
    const nextTurn = await f.discover()
    const result = await f.call('submit', { ...nextTurn, materials: [{ path: oldPath, sha256: digest(oldContent) }] })
    expect(result.status).toBe(409)
    expect(result.body.error).toContain('只能交接本轮消息中实际附加的材料')
    expect(f.service.stageWorkMaterials).not.toHaveBeenCalled()
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('requires an earlier same-session attachment to be reattached in the current employee turn', async () => {
    const f = await fixture()
    await f.input('请继续检查上一轮附加的合同.md。', 'employee-explicit-reuse')
    const namedOnly = await f.discover()
    const denied = await f.call('submit', namedOnly)
    expect(denied.status).toBe(409)
    expect(denied.body.error).toContain('本轮重新附加')
    expect(f.service.stageWorkMaterials).not.toHaveBeenCalled()

    const reference = {
      projectId: 'project-test', harness: 'pi' as const, workspacePath: f.cwd,
      name: '合同.md', path: '材料/附件/合同.md', sha256: digest(f.content),
      bytes: Buffer.byteLength(f.content), mimeType: 'text/markdown' as const,
    }
    await f.input(appendWorkspaceMaterialContext('这轮我重新附加合同.md，请继续检查。', [reference]), 'employee-explicit-reattach')
    const reattached = await f.discover()
    const result = await f.call('submit', reattached)
    expect(result.status).toBe(200)
    expect(result.body.result.status).toBe('accepted')
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.stageWorkMaterials.mock.calls[0]?.[0][0]?.extraction.content).toBe(f.content)
  })
  it('retries an identical package after failure without rereading a changed file or conversation', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.submitWork.mockRejectedValueOnce(new Error('connection lost'))
    expect((await f.call('submit', params)).body.result.status).toBe('unknown')
    await writeFile(join(f.cwd, '材料', '附件', '合同.md'), 'later draft')
    f.transcript.push({ id: 'assistant-later', role: 'assistant', parts: [{ type: 'text', text: '稍后重试' }] })
    expect((await f.call('submit', params)).status).toBe(200)
    expect(f.service.submitWork.mock.calls[0][1]).toBe(f.service.submitWork.mock.calls[1][1])
    const first = f.service.submitWork.mock.calls[0][2] as unknown as { sourceMessages: unknown }
    const second = f.service.submitWork.mock.calls[1][2] as unknown as { sourceMessages: unknown }
    expect(first.sourceMessages).toEqual(second.sourceMessages)
    expect((await f.call('submit', { ...params, goal: '修改目标' })).body.error).toContain('已冻结')
  })
  it('persists a current employee intent as local JSON before material upload and team dispatch', async () => {
    const f = await fixture(), params = await f.discover()
    expect(await f.service.accountKey()).toBe('employee-a')

    const submitted = await f.call('submit', params)
    expect(submitted.body.result.status).toBe('accepted')
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitWork).toHaveBeenCalledOnce()
    const files = await readdir(f.storageDirectory)
    expect(files.length).toBeGreaterThan(0)
    expect(files.every((file) => /^[0-9a-f]{64}\.json$/.test(file))).toBe(true)
    const saved = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(f.storageDirectory, file), 'utf8')) as { fingerprint: string; value: unknown }))
    expect(saved.every((record) => typeof record.fingerprint === 'string' && 'value' in record)).toBe(true)
  })

  it('requires a configured persistence directory before fixing a returned revision package', async () => {
    const f = await fixture('forge_sales_contract', false)
    await f.openReturned()
    const employeeRequest = '按退回意见补全验收要求，帮我递交这版修订材料'
    await f.input(employeeRequest, 'employee-revision-no-storage-directory')

    const result = await f.call('revision_submit', { employee_request: employeeRequest, body: '修订正文', materials: f.materials })
    expect(result.body.error).toContain('本地交接存储目录未配置')
    expect(result.body.error).not.toContain('安全存储')
    expect(f.service.stageWorkMaterials).not.toHaveBeenCalled()
    expect(f.service.submitApprovalRevision).not.toHaveBeenCalled()
  })
  it('reports a definite Weave registration rejection without telling Pi to recover an accepted run', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.submitWork.mockRejectedValueOnce(new WorkRegistrationRejectedError('原工作输入版本已变化'))
    const rejected = await f.call('submit', params)
    expect(rejected.body.result).toMatchObject({ status: 'rejected', submitted: false, receiptConfirmed: false })
    expect(rejected.body.result).not.toHaveProperty('recovery_key')
    expect(rejected.body.result.next_step).toContain('未创建团队运行')
  })
  it('freezes material before upload and resumes an upload failure with the original bytes', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.stageWorkMaterials.mockRejectedValueOnce(new Error('upload interrupted'))
    const first = await f.call('submit', params)
    expect(first.body.result).toMatchObject({ status: 'unknown' })
    await writeFile(join(f.cwd, '材料', '附件', '合同.md'), 'later draft')
    expect((await f.call('recover', { recovery_key: first.body.result.recovery_key })).body.result.status).toBe('accepted')
    const retriedMaterials = f.service.stageWorkMaterials.mock.calls[1][0]
    expect(retriedMaterials[0].extraction.content).toBe(f.content)
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
  it('re-authorizes the same frozen request after re-login without new attachments or material reads', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.stageWorkMaterials.mockRejectedValueOnce(new Error('upload interrupted'))
    const first = await f.call('submit', params)
    expect(first.body.result.status).toBe('unknown')
    const recoveryKey = first.body.result.recovery_key as string
    await writeFile(join(f.cwd, '材料', '附件', '合同.md'), 'later draft')

    await f.relogin()
    await f.input('继续核对同一冻结合同只读请求', 'employee-relogin-round-2')
    const inspected = await f.call('inspect_recovery', { recovery_key: recoveryKey })
    expect(inspected.body.result).toMatchObject({
      status: 'inspection_only',
      target: { goal: '复核这版合同', team: '合同团队', workflow: '合同复核' },
      materials: [{ name: '合同.md', sha256: digest(f.content) }],
      action_scope: { authorized_business_capability_ids: [], requires_explicit_employee_reauthorization: false },
    })
    const resumeKey = inspected.body.result.resume_key as string
    expect(resumeKey).toMatch(/^[0-9a-f]{32}$/)
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitWork).not.toHaveBeenCalled()

    const directReplay = await f.call('recover', { recovery_key: recoveryKey })
    expect(directReplay.status).toBe(409)
    expect(directReplay.body.error).toContain('旧交接不能继续')
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()

    const resumed = await f.call('recover', { resume_key: resumeKey })
    expect(resumed.body.result.status).toBe('accepted')
    expect(f.service.stageWorkMaterials).toHaveBeenCalledTimes(2)
    expect(f.service.stageWorkMaterials.mock.calls[1]?.[0][0]?.extraction.content).toBe(f.content)
    expect(f.service.submitWork).toHaveBeenCalledOnce()
    expect(f.service.submitWork.mock.calls[0]?.[2]).toMatchObject({
      idempotencySeed: `${digest('/sessions/current.jsonl').slice(0, 24)}:employee-turn-1:${params.handoff_key}`,
      authorizedBusinessCapabilityIds: [],
    })
  })
  it('only inspects a prior non-empty action scope until the employee re-authorizes it in the new turn', async () => {
    const f = await fixture()
    const reference = {
      projectId: 'project-test', harness: 'pi' as const, workspacePath: f.cwd, name: '合同.md',
      path: '材料/附件/合同.md', sha256: digest(f.content), bytes: Buffer.byteLength(f.content), mimeType: 'text/markdown' as const,
    }
    await f.input(appendWorkspaceMaterialContext('请将这份合同提交审批。', [reference]), 'employee-write-request')
    const params = await f.discover()
    const { recordKey } = await f.findRecord(params.handoff_key, 'TEST-100 设备交接验收合同')
    f.service.stageWorkMaterials.mockRejectedValueOnce(new Error('upload interrupted'))
    const first = await f.call('submit', {
      ...params, business_record_key: recordKey, business_actions: [params.available_actions[0]!.action_key],
    })
    const recoveryKey = first.body.result.recovery_key as string
    expect(first.body.result.status).toBe('unknown')

    await f.relogin()
    await f.input('我只想核对同一冻结请求的状态', 'employee-status-only')
    const inspected = await f.call('inspect_recovery', { recovery_key: recoveryKey })
    expect(inspected.body.result.action_scope).toEqual({
      authorized_business_capability_ids: [f.businessCapabilityId],
      requires_explicit_employee_reauthorization: true,
    })
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('invalidates a current-turn resume key when the employee updates or cancels the request', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.stageWorkMaterials.mockRejectedValueOnce(new Error('upload interrupted'))
    const first = await f.call('submit', params)
    const recoveryKey = first.body.result.recovery_key as string
    await f.relogin()
    await f.input('请继续检查这条冻结请求', 'employee-recovery-round-2')
    const inspected = await f.call('inspect_recovery', { recovery_key: recoveryKey })
    const resumeKey = inspected.body.result.resume_key as string

    await f.input('取消恢复，先不要继续', 'employee-cancel-recovery')
    const staleResume = await f.call('recover', { resume_key: resumeKey })
    expect(staleResume.status).toBe(409)
    expect(staleResume.body.error).toContain('恢复授权已失效')
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('rejects cross-turn recovery when the original employee message hash changes', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.stageWorkMaterials.mockRejectedValueOnce(new Error('upload interrupted'))
    const first = await f.call('submit', params)
    const recoveryKey = first.body.result.recovery_key as string
    await f.relogin()
    await f.input('继续核对原请求', 'employee-recovery-round-2')
    f.transcript[0] = user('employee-turn-1', '改过的原始请求')

    const inspected = await f.call('inspect_recovery', { recovery_key: recoveryKey })
    expect(inspected.status).toBe(409)
    expect(inspected.body.error).toContain('原员工消息已修改或不存在')
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitWork).not.toHaveBeenCalled()
  })
  it('rejects re-authorizing a frozen handoff under a different session or account', async () => {
    const f = await fixture(), params = await f.discover()
    f.service.stageWorkMaterials.mockRejectedValueOnce(new Error('upload interrupted'))
    const first = await f.call('submit', params)
    const recoveryKey = first.body.result.recovery_key as string

    await f.relogin({ sessionPath: '/sessions/other.jsonl' })
    await f.input('继续检查原冻结请求', 'employee-other-session')
    const otherSession = await f.call('inspect_recovery', { recovery_key: recoveryKey })
    expect(otherSession.status).toBe(409)
    expect(otherSession.body.error).toContain('不属于当前员工与会话')

    await f.relogin({ accountKey: 'employee-b', sessionPath: '/sessions/current.jsonl' })
    await f.input('继续检查原冻结请求', 'employee-other-account')
    const otherAccount = await f.call('inspect_recovery', { recovery_key: recoveryKey })
    expect(otherAccount.status).toBe(409)
    expect(otherAccount.body.error).toContain('不属于当前员工与会话')
    expect(f.service.stageWorkMaterials).toHaveBeenCalledOnce()
    expect(f.service.submitWork).not.toHaveBeenCalled()
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
    const { recordKey } = await f.findRecord(params.handoff_key, 'TEST-100')
    expect((await f.call('submit', { ...params, materials: [], business_actions, business_record_key: recordKey })).body.result.status).toBe('accepted')
    expect(f.service.submitWork.mock.calls[0][2]).toMatchObject({ businessContext: { objectName: 'forge_quote', recordId: 'contract-1', recordVersion: 'v7' } })
    expect(JSON.parse(f.service.submitWork.mock.calls[0][1]).businessSnapshot).toEqual(f.businessSnapshot)
    expect(f.service.stageWorkMaterials).not.toHaveBeenCalled()
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
