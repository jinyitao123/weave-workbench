import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TeamDevelopmentAgentBridge } from '../../electron/main/development/agent-bridge'
import { teamWorkspaceRequest } from '../../electron/main/enterprise/team-workspace'
import { newMember } from '../../src/pages/team-workspace/member'
import { configureWorkflowResultProtocol, initialGraph } from '../../src/pages/team-workspace/graph'
import type { EnterpriseBusinessCapabilityCatalog } from '../../src/types/api'
import type { TeamDefinition, TeamWorkspace, TeamWorkspaceCommand } from '../../src/types/team-workspace'
import { trialWireActivity, trialWireCases } from '../fixtures/trial-activity'

let bridge: TeamDevelopmentAgentBridge | undefined
const tempDirectories: string[] = []
afterEach(async () => { await bridge?.stop(); bridge = undefined; for (const path of tempDirectories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function workspace(document: TeamDefinition, revision = 4): TeamWorkspace {
  return { revision, published_revision: revision - 1, publishing_revision: 0, prepared_revision: 0, document: structuredClone(document), updated_at: '', trials: [] }
}

async function savedWireWorkspace(document: TeamDefinition, revision: number): Promise<TeamWorkspace> {
  return await teamWorkspaceRequest({ action: 'save', teamId: 'team', revision: revision - 1, document }, async () => undefined, async (_path, _method, body) => {
    const wire = structuredClone((body as { document: { members: Array<{ configuration: Record<string, unknown> }> } }).document)
    // The real Go response materializes omitted optional fields and the omitted
    // empty binding slice. Exercise the actual desktop wire decoder, not an echo.
    for (const member of wire.members) {
      member.configuration.tool_loop_control ??= null
      member.configuration.max_tool_repeats ??= 0
      member.configuration.business_capability_bindings ??= null
    }
    return { body: { ...workspace(document, revision), document: wire } }
  }) as TeamWorkspace
}

async function normalizedSaveFixture(loseResponse = false) {
  const directory = mkdtempSync(join(tmpdir(), 'team-normalized-save-')); tempDirectories.push(directory)
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '审核员'
  for (const member of [lead, worker]) { delete member.configuration.toolLoopControl; delete member.configuration.maxToolRepeats }
  const document: TeamDefinition = { name: '合同团队', objective: '复核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '复核流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  let remote = await savedWireWorkspace(document, 4), readUnavailable = false, writes = 0
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [], refreshedAt: '' }
  const options = {
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }), teams: async () => [{ id: 'team', name: '合同团队' }],
    team: async () => { if (readUnavailable) throw new Error('readback unavailable'); return structuredClone(remote) },
    workspace: async (command: TeamWorkspaceCommand) => {
      if (command.action !== 'save') throw new Error('unexpected command')
      expect(command.revision).toBe(remote.revision)
      writes++
      remote = { ...await savedWireWorkspace(command.document, remote.revision + 1), published_revision: remote.published_revision, prepared_revision: remote.prepared_revision }
      if (loseResponse) { readUnavailable = true; throw new Error('save response unavailable') }
      return structuredClone(remote)
    },
    catalog: async () => catalog, extensionPath: '/app/team-development.ts', storage: { directory },
  }
  let env: NodeJS.ProcessEnv
  const start = async () => {
    bridge = new TeamDevelopmentAgentBridge(options); await bridge.start()
    env = bridge.environmentFor({ cwd: '/work', harness: 'pi', sessionPath: '/sessions/developer-1.jsonl' })
    bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime', '/sessions/developer-1.jsonl')
  }
  await start()
  await bridge!.bindContext('runtime', { teamId: 'team', revision: 4, document, catalog }, 'developer-1')
  const operations = [{ kind: 'member_add', ref: 'coordinator', name: '材料协调员', duty: '核对材料原文' }, { kind: 'step', flow: '复核流程', step: '理解任务', member: 'coordinator' }]
  const save = async () => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, { method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'save', params: { operations } }) })
    return response.json() as Promise<{ ok: boolean; error?: string }>
  }
  return { document, save, remote: () => remote, writes: () => writes, async restartWithLegacyPendingSave() {
    await bridge!.stop()
    const file = join(directory, readdirSync(directory).find((name) => name.endsWith('.json'))!)
    const checkpoint = JSON.parse(readFileSync(file, 'utf8'))
    // Reproduce a pending save produced by the previous desktop release.
    for (const doc of [checkpoint.value.context.document, checkpoint.value.context.proposal.document, checkpoint.value.context.pendingSave.baseDocument, checkpoint.value.context.pendingSave.proposal.document]) {
      for (const member of doc.members) { delete member.configuration.toolLoopControl; delete member.configuration.maxToolRepeats }
    }
    writeFileSync(file, JSON.stringify(checkpoint))
    readUnavailable = false
    await start()
  } }
}

it('accepts a real normalized save receipt with null empty bindings and retains graph structure', async () => {
  const fixture = await normalizedSaveFixture()
  expect((await fixture.save()).ok).toBe(true)
  const saved = fixture.remote(), added = saved.document.members[2]!
  expect(added.configuration).toMatchObject({ displayName: '材料协调员', role: 'worker', engine: 'loom', model: 'deepseek-flash', toolLoopControl: null, maxToolRepeats: 0, businessCapabilityBindings: [] })
  expect(saved.revision).toBe(5)
  expect(saved.published_revision).toBe(3)
  expect(fixture.writes()).toBe(1)
  expect(saved.document.workflows[0].graph_definition.nodes[0]).toMatchObject({ ...fixture.document.workflows[0].graph_definition.nodes[0], type: 'worker', config: { kind: 'consult', agent_id: added.id, agent_version: 1 } })
  expect(saved.document.workflows[0].graph_definition.edges).toEqual(fixture.document.workflows[0].graph_definition.edges)
  expect((await bridge!.getState('runtime')).proposal).toBeUndefined()
})

it.each(['none', 'business', 'node-version', 'loop-control', 'max-repeats'] as const)('recovers a legacy pending normalized save without another write, unless %s changed', async (change) => {
  const fixture = await normalizedSaveFixture(true)
  expect((await fixture.save()).ok).toBe(false)
  await fixture.restartWithLegacyPendingSave()
  const remote = fixture.remote()
  if (change === 'business') remote.document.members[2]!.relationship.duty = '另一位开发者的业务要求'
  if (change === 'node-version') remote.document.workflows[0].graph_definition.nodes[0].config!.agent_version = 2
  if (change === 'loop-control') remote.document.members[2]!.configuration.toolLoopControl = { sliceRounds: 3, initialTotalRounds: 12 }
  if (change === 'max-repeats') remote.document.members[2]!.configuration.maxToolRepeats = 2
  const result = await fixture.save()
  expect(result.ok).toBe(change === 'none')
  expect(fixture.writes()).toBe(1)
  expect(remote.document.members).toHaveLength(3)
  if (change === 'none') {
    expect((await bridge!.getState('runtime')).proposal).toBeUndefined()
    expect((await bridge!.getState('runtime')).revision).toBe(5)
  } else {
    expect(result.error).toContain('团队草稿已变化')
    expect((await bridge!.getState('runtime')).proposal).toBeDefined()
  }
})

it('resolves bound completion actions by name and confirms a serialized wire save without exposing identifiers in context', async () => {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '审核员'
  const capabilityID = 'forge:action:contracts.submit'
  worker.configuration.businessCapabilityIds = [capabilityID]
  const document: TeamDefinition = { name: '合同团队', objective: '复核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '复核流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  document.workflows[0] = configureWorkflowResultProtocol(document.workflows[0], true)
  const originalContract = { version: 1, coverage: 'incomplete', output: structuredClone(document.workflows[0].graph_definition.output_contract), required_artifacts: [{ id: 'report', path: 'report.txt' }], limitations: ['审批结果独立核对'] }
  document.workflows[0].graph_definition.delivery_contract = originalContract
  const action = { id: capabilityID, name: '提交指定版本', description: '提交材料', effect: 'write' as const, resourceType: 'contract', requiresEmployeeIntent: true, status: 'available' as const }
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [action, { ...action, id: 'forge:action:contracts.archive', name: '归档合同' }] }
  let remote = await savedWireWorkspace(document, 4), writes = 0
  bridge = new TeamDevelopmentAgentBridge({
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }), teams: async () => [{ id: 'team', name: '合同团队' }],
    team: async () => structuredClone(remote),
    workspace: async (command) => {
      if (command.action !== 'save') throw new Error('unexpected write')
      expect(command.revision).toBe(4)
      writes++
      remote = { ...await savedWireWorkspace(command.document, 5), published_revision: 3 }
      // GraphDefinition is json.RawMessage in Weave's development draft;
      // ordinary JSON storage preserves DeliveryContract keys and schemas.
      return JSON.parse(JSON.stringify(remote))
    },
    catalog: async () => catalog, extensionPath: '/app/team-development.ts',
  })
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime')
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, { method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
    return response.json() as Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }>
  }
  await call('open', { team_name: '合同团队' })
  const operation = { kind: 'business_completion', flow: '复核流程', capabilities: ['提交指定版本'], allowNeedsInput: true }
  for (const capabilities of [['不存在的动作'], [capabilityID], ['归档合同'], ['提交指定版本', '提交指定版本']]) {
    expect((await call('save', { operations: [{ ...operation, capabilities }] })).ok).toBe(false)
  }
  expect(writes).toBe(0)
  expect((await call('save', { operations: [operation] })).ok).toBe(true)
  expect(writes).toBe(1)
  expect(remote.published_revision).toBe(3)
  expect(remote.document.workflows[0].graph_definition.delivery_contract).toMatchObject({ ...originalContract, external_effects_check_id: 'business-action-receipts', required_checks: [{ parameters: { required_capability_ids: [capabilityID], when_authorized: true, allow_needs_input: true } }] })
  expect((await bridge.getState('runtime')).proposal).toBeUndefined()
  const context = (await call('context')).result
  expect(context).toMatchObject({ team: { workflows: [{ businessCompletion: { actions: ['提交指定版本'], whenAuthorized: true, allowNeedsInput: true } }] } })
  expect(JSON.stringify(context)).not.toContain(capabilityID)
})

it('binds Pi to one developer draft and returns a proposal without saving it', async () => {
  let account = 'developer-1'
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '审核员'
  const document: TeamDefinition = { name: '合同团队', objective: '复核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '复核', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [] }
  bridge = new TeamDevelopmentAgentBridge({
    accountKey: async () => account,
    developer: async () => ({ accountId: account }),
    teams: async () => [{ id: 'team', name: '合同团队' }],
    team: async () => ({ revision: 4, published_revision: 3, publishing_revision: 0, prepared_revision: 0, document, updated_at: '', trials: [] }),
    workspace: async (_command: TeamWorkspaceCommand) => { throw new Error('unexpected workspace call') },
    catalog: async () => catalog,
    extensionPath: '/app/team-development.ts',
  })
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/personal-workspace', harness: 'pi' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime')
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, { method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
    return response.json() as Promise<{ ok: boolean; result?: Record<string, unknown> }>
  }
  expect((await call('context')).ok).toBe(false)
  expect((await call('list')).result?.teams).toEqual([{ name: '合同团队' }])
  expect((await call('propose_new_team', { name: '反馈团队', objective: '分类反馈' })).ok).toBe(true)
  expect((await bridge.getState('runtime')).createProposal).toEqual({ name: '反馈团队', objective: '分类反馈' })
  expect((await call('open', { team_name: '合同团队' })).ok).toBe(true)
  expect((await bridge.getState('runtime')).createProposal).toBeUndefined()
  const context = (await call('context')).result
  expect((context?.team as { name: string } | undefined)?.name).toBe('合同团队')
  expect(((context?.team as { workflows: Array<{ resultProtocol: string }> } | undefined)?.workflows[0]?.resultProtocol)).toBe('普通结果')
  expect(JSON.stringify(context)).not.toContain(worker.id)
  expect(JSON.stringify(context)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  const proposed = await call('propose', { operations: [
    { kind: 'member', member: '审核员', duty: '核对付款条件' },
    { kind: 'result_protocol', flow: '复核', enabled: true, from: '审核员' },
  ] })
  expect(proposed.ok).toBe(true)
  expect(document.members[1]?.relationship.duty).toBe('')
  expect((await bridge.getProposal('runtime'))?.document.members[1]?.relationship.duty).toBe('核对付款条件')
  expect((await bridge.getProposal('runtime'))?.document.workflows[0]?.graph_definition.result_protocol).toBe('workbench_result_v1')
  account = 'developer-2'
  expect((await call('context')).ok).toBe(false)
  expect((await call('save', { operations: [{ kind: 'member', member: '审核员', duty: '不应保存' }] })).ok).toBe(false)
})

it('restores a pending proposal for the same account and Pi session after a desktop restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'team-dev-proposal-')); tempDirectories.push(directory)
  const storage = { directory }
  const worker = newMember('deepseek-flash'); worker.configuration.displayName = '审核员'
  const document: TeamDefinition = { name: '反馈团队', objective: '整理反馈', members: [worker], workflows: [] }
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [], refreshedAt: '' }
  const options = { accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }), teams: async () => [{ id: 'team', name: '反馈团队' }], team: async () => ({ revision: 7, published_revision: 6, publishing_revision: 0, prepared_revision: 0, document, updated_at: '', trials: [] }), workspace: async (_command: TeamWorkspaceCommand) => { throw new Error('unexpected workspace call') }, catalog: async () => catalog, extensionPath: '/app/team-development.ts', storage }
  bridge = new TeamDevelopmentAgentBridge(options)
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi', sessionPath: '/sessions/developer-1.jsonl' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'old-runtime', '/sessions/developer-1.jsonl')
  await bridge.bindContext('old-runtime', { teamId: 'team', revision: 7, document, catalog }, 'developer-1')
  const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, { method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'propose', params: { operations: [{ kind: 'member', member: '审核员', duty: '按产品模块整理反馈' }] } }) })
  expect((await response.json() as { ok: boolean }).ok).toBe(true)
  await bridge.stop()
  bridge = new TeamDevelopmentAgentBridge(options)
  await bridge.start()
  const state = await bridge.getStateForSession('/sessions/developer-1.jsonl')
  expect(state.teamId).toBe('team')
  expect(state.proposal?.document.members[0]?.relationship.duty).toBe('按产品模块整理反馈')
})

it('saves a controlled draft, reconciles an uncertain write, runs an idempotent isolated trial, and publishes by request', async () => {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '审核员'
  const document: TeamDefinition = { name: '合同团队', objective: '复核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '复核流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  let remote = workspace(document)
  let loseSaveResponse = true
  const calls: TeamWorkspaceCommand[] = []
  const trials = new Map<string, { runId: string; input: string }>()
  const activityCalls: string[] = []
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [] }
  const options = {
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }),
    teams: async () => [{ id: 'team', name: '合同团队' }],
    team: async (teamId: string, accountId: string) => {
      expect(teamId).toBe('team'); expect(accountId).toBe('developer-1')
      return structuredClone(remote)
    },
    workspace: async (command: TeamWorkspaceCommand): Promise<unknown> => {
      calls.push(structuredClone(command))
      expect(command.accountId).toBe('developer-1')
      if (command.action === 'save') {
        expect(command.revision).toBe(remote.revision)
        remote = { ...remote, revision: remote.revision + 1, document: structuredClone(command.document), updated_at: 'saved' }
        const saved = structuredClone(remote)
        if (loseSaveResponse) { loseSaveResponse = false; throw new Error('保存回执丢失') }
        return saved
      }
      if (command.action === 'trial') {
        let trial = trials.get(command.requestId)
        if (!trial) { trial = { runId: 'private-run-id', input: command.input }; trials.set(command.requestId, trial) }
        remote = { ...remote, trials: [...remote.trials.filter((item) => item.request_id !== command.requestId), { request_id: command.requestId, run_id: trial.runId, revision: command.revision, workflow_id: command.workflowId, status: 'succeeded', created_at: '' }] }
        return { request_id: command.requestId, run_id: trial.runId }
      }
      if (command.action === 'input') return { input: trials.get(command.requestId)?.input ?? '固定输入', status: 'succeeded', output: '最终结果' }
      if (command.action === 'activity') {
        activityCalls.push(command.runId)
        return {
          status: 'succeeded',
          completeness: { stages: 'partial', member_inputs: 'partial', member_outputs: 'partial', member_tool_activity: 'complete', deliverables: 'complete' },
          members: [{ name: '审核员', status: 'finished', stages: [{
            name: '费用核对', status: 'completed', inputs: [{ source: 'run_input', summary: '输入摘要' }],
            outputs: [{ kind: 'result', content: '逐项核对完成', content_type: 'text/markdown', content_bytes: 21, truncated: false }],
            tools: [{ name: '计算工具', status: 'tool_completed', input: '{"amount":10}', output: '{"total":10}' }],
          }] }],
          outputs: [{ id: 'private-deliverable-id', node_id: worker.id, title: '核对结论', content: '金额一致' }],
        }
      }
      if (command.action === 'publish') {
        expect(command.revision).toBe(remote.revision)
        remote = { ...remote, published_revision: command.revision }
        return structuredClone(remote)
      }
      throw new Error(`unexpected action: ${command.action}`)
    },
    catalog: async () => catalog,
    extensionPath: '/app/team-development.ts',
  }
  bridge = new TeamDevelopmentAgentBridge(options)
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi', sessionPath: '/sessions/developer-1.jsonl' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime', '/sessions/developer-1.jsonl')
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, {
      method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })
    return response.json() as Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }>
  }

  await call('list')
  await call('open', { team_name: '合同团队' })
  const operations = [{ kind: 'member', member: '审核员', duty: '核对费用' }]
  const saved = await call('save', { operations })
  expect(saved.ok).toBe(true)
  expect(saved.result?.message).toContain('当前生效版本没有改变')
  expect(remote.revision).toBe(5)
  expect(remote.published_revision).toBe(3)
  expect(remote.document.members[1]?.relationship.duty).toBe('核对费用')
  expect(calls.filter((command) => command.action === 'save')).toHaveLength(1)

  const trial1 = await call('trial', { workflow_name: '复核流程', input: '核对这条测试材料' })
  const trial2 = await call('trial', { workflow_name: '复核流程', input: '核对这条测试材料' })
  expect(trial1.ok && trial2.ok).toBe(true)
  const trialCommands = calls.filter((command) => command.action === 'trial')
  expect(trialCommands).toHaveLength(2)
  expect(new Set(trialCommands.flatMap((command) => command.action === 'trial' ? [command.requestId] : [])).size).toBe(1)
  const status = await call('trial_status')
  const text = JSON.stringify(status.result)
  expect(text).toContain('固定输入')
  expect(text).toContain('输入摘要')
  expect(text).toContain('逐项核对完成')
  expect(text).toContain('Weave 实际保存的该步骤输出')
  expect(text).toContain('actual_input')
  expect(text).toContain('金额一致')
  expect(text).toContain('活动记录不完整')
  expect(text).not.toContain('private-run-id')
  expect(text).not.toContain('private-deliverable-id')
  expect(activityCalls).toEqual(['private-run-id'])

  const updated = await call('update_team')
  expect(updated.ok).toBe(true)
  expect(remote.published_revision).toBe(5)
  expect(calls.filter((command) => command.action === 'publish')).toHaveLength(1)
})

it('freezes only workflow actions and keeps each Pi simulation selection in its own fixed request scope', async () => {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash'), unrelated = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '转化员'; unrelated.configuration.displayName = '其他成员'
  const action = { id: 'forge:action:crm_lead.convert', name: '转化线索', description: '将线索转换为商机', effect: 'write' as const, executionMode: 'team_delegable' as const, resourceType: 'crm_lead', requiresEmployeeIntent: true, status: 'available' as const, actionName: 'convert', objectName: 'crm_lead' }
  const unrelatedAction = { ...action, id: 'forge:action:crm_quote.create', name: '创建报价', resourceType: 'crm_quote', actionName: 'create', objectName: 'crm_quote' }
  worker.configuration.businessCapabilityIds = [action.id]
  unrelated.configuration.businessCapabilityIds = [unrelatedAction.id]
  const document: TeamDefinition = { name: '线索团队', objective: '转化线索', members: [lead, worker, unrelated], workflows: [{ id: 'flow', name: '转化流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  let remote = workspace(document, 6)
  const calls: TeamWorkspaceCommand[] = []
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [action, unrelatedAction] }
  bridge = new TeamDevelopmentAgentBridge({
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }),
    teams: async () => [{ id: 'team', name: document.name }], team: async () => structuredClone(remote),
    catalog: async () => catalog, extensionPath: '/app/team-development.ts',
    workspace: async (command: TeamWorkspaceCommand) => {
      calls.push(structuredClone(command))
      if (command.action !== 'trial') throw new Error(`unexpected workspace action: ${command.action}`)
      remote = { ...remote, trials: [...remote.trials, { request_id: command.requestId, run_id: `run-${remote.trials.length}`, revision: command.revision, workflow_id: command.workflowId, status: 'running', created_at: '' }] }
      return { request_id: command.requestId, run_id: `run-${remote.trials.length - 1}` }
    },
  })
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi', sessionPath: '/sessions/developer-1.jsonl' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime', '/sessions/developer-1.jsonl')
  await bridge.bindContext('runtime', { teamId: 'team', revision: 6, document, catalog }, 'developer-1')
  const call = async (params: Record<string, unknown>) => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, { method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'trial', params }) })
    return response.json() as Promise<{ ok: boolean; error?: string }>
  }
  const input = '核对开发者提供的线索材料'
  expect((await call({ workflow_name: '转化流程', input })).ok).toBe(true)
  expect((await call({ workflow_name: '转化流程', input })).ok).toBe(true)
  const defaultScope = calls.filter((command) => command.action === 'trial')
  expect(defaultScope).toHaveLength(2)
  expect(defaultScope[0]!.requestId).toBe(defaultScope[1]!.requestId)
  expect(defaultScope[0]!.businessActions).toMatchObject([{ id: action.id, simulationAuthorized: false }])
  expect(defaultScope[0]!.businessActions.map((item) => item.id)).not.toContain(unrelatedAction.id)

  const selected = await call({ workflow_name: '转化流程', input, simulation_actions: ['转化线索'] })
  expect(selected.ok).toBe(true)
  const selectedRequest = calls.filter((command) => command.action === 'trial').at(-1)!
  expect(selectedRequest.requestId).not.toBe(defaultScope[0]!.requestId)
  expect(selectedRequest.businessActions).toMatchObject([{ id: action.id, simulationAuthorized: true }])
  catalog.capabilities[0]!.description = '目录刚刷新后的新说明'
  expect((await call({ workflow_name: '转化流程', input, simulation_actions: ['转化线索'] })).ok).toBe(true)
  const retry = calls.filter((command) => command.action === 'trial').at(-1)!
  expect(retry.requestId).toBe(selectedRequest.requestId)
  expect(retry.businessActions).toEqual(selectedRequest.businessActions)

  const invalid = await call({ workflow_name: '转化流程', input, simulation_actions: ['创建报价'] })
  expect(invalid.ok).toBe(false)
  expect(invalid.error).toContain('不属于当前流程候选范围')
  expect(calls.filter((command) => command.action === 'trial')).toHaveLength(4)
})

it('restores the original fixed action definition after an uncertain Pi trial response', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'team-trial-scope-')); tempDirectories.push(directory)
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '转化员'
  const action = { id: 'forge:action:crm_lead.convert', name: '转化线索', description: '原始动作定义', effect: 'write' as const, executionMode: 'team_delegable' as const, resourceType: 'crm_lead', requiresEmployeeIntent: true, status: 'available' as const, actionName: 'convert', objectName: 'crm_lead' }
  worker.configuration.businessCapabilityIds = [action.id]
  const document: TeamDefinition = { name: '线索团队', objective: '转化线索', members: [lead, worker], workflows: [{ id: 'flow', name: '转化流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  const remote = workspace(document, 6)
  const firstCalls: TeamWorkspaceCommand[] = [], retryCalls: TeamWorkspaceCommand[] = []
  const base = {
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }),
    teams: async () => [{ id: 'team', name: document.name }], team: async () => structuredClone(remote),
    extensionPath: '/app/team-development.ts', storage: { directory },
  }
  const firstCatalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [action] }
  bridge = new TeamDevelopmentAgentBridge({
    ...base, catalog: async () => firstCatalog,
    workspace: async (command) => { firstCalls.push(structuredClone(command)); throw new Error('试跑响应暂未收到') },
  })
  await bridge.start()
  const firstEnv = bridge.environmentFor({ cwd: '/work', harness: 'pi', sessionPath: '/sessions/developer-1.jsonl' })
  bridge.bindRuntime(firstEnv.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime', '/sessions/developer-1.jsonl')
  await bridge.bindContext('runtime', { teamId: 'team', revision: 6, document, catalog: firstCatalog }, 'developer-1')
  const call = async (env: NodeJS.ProcessEnv) => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, { method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'trial', params: { workflow_name: '转化流程', input: '核对这条材料', simulation_actions: ['转化线索'] } }) })
    return response.json() as Promise<{ ok: boolean }>
  }
  expect((await call(firstEnv)).ok).toBe(false)
  const original = firstCalls.find((command) => command.action === 'trial')!
  await bridge.stop(); bridge = undefined

  const refreshedCatalog: EnterpriseBusinessCapabilityCatalog = { ...firstCatalog, capabilities: [{ ...action, description: '刷新后的动作定义' }] }
  bridge = new TeamDevelopmentAgentBridge({
    ...base, catalog: async () => refreshedCatalog,
    workspace: async (command) => { retryCalls.push(structuredClone(command)); if (command.action !== 'trial') throw new Error('unexpected workspace action'); return { request_id: command.requestId, run_id: 'run-1' } },
  })
  await bridge.start()
  const retryEnv = bridge.environmentFor({ cwd: '/work', harness: 'pi', sessionPath: '/sessions/developer-1.jsonl' })
  bridge.bindRuntime(retryEnv.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime', '/sessions/developer-1.jsonl')
  expect((await call(retryEnv)).ok).toBe(true)
  const retried = retryCalls.find((command) => command.action === 'trial')!
  expect(retried.requestId).toBe(original.requestId)
  expect(retried.input).toBe(original.input)
  expect(retried.businessActions).toEqual(original.businessActions)
  expect(retried.businessActions).toMatchObject([{ id: action.id, simulationAuthorized: true, description: '原始动作定义' }])
})

it.each(trialWireCases)('interprets the same $name wire record as the trial panel without inventing payload evidence', async (tool) => {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'
  const document: TeamDefinition = { name: '线索团队', objective: '', members: [lead, worker], workflows: [{ id: 'flow', name: '线索流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  const remote = workspace(document)
  const directory = mkdtempSync(join(tmpdir(), 'trial-evidence-')); tempDirectories.push(directory)
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [], refreshedAt: '' }
  bridge = new TeamDevelopmentAgentBridge({
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }), teams: async () => [{ id: 'team', name: document.name }],
    team: async () => structuredClone(remote), catalog: async () => catalog, extensionPath: '/app/team-development.ts', storage: { directory },
    workspace: async (command) => {
      if (command.action === 'trial') return { request_id: command.requestId, run_id: 'private-run' }
      if (command.action === 'input') return { input: '合成固定输入', status: 'succeeded', output: '模型自述：已经转化。' }
      if (command.action === 'activity') return trialWireActivity(tool)
      throw new Error('unexpected mutation')
    },
  })
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime')
  await bridge.bindContext('runtime', { teamId: 'team', revision: remote.revision, document, catalog }, 'developer-1')
  const call = async (method: string, params = {}) => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, { method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
    return response.json() as Promise<{ ok: boolean; result: { trace: { completeness: { tool_input_output: string }; trajectory: string; members: Array<{ steps: Array<{ tools: Array<{ status: string; evidence: string; actual_input?: string; actual_output?: string }> }> }> } } }>
  }
  expect((await call('trial', { workflow_name: '线索流程', input: '合成固定输入' })).ok).toBe(true)
  const result = await call('trial_status')
  expect(result.ok).toBe(true)
  expect(result.result.trace.members[0]!.steps[0]!.tools).toEqual([])
  const actual = result.result.trace.members[0]!.steps[1]!.tools[0]!
  expect(actual.status).toBe(tool.label)
  expect(actual.actual_input).toBe(tool.hiddenInput ? undefined : tool.input)
  expect(actual.actual_output).toBe(tool.hiddenOutput ? undefined : tool.output)
  expect(result.result.trace.completeness.tool_input_output).toBe(tool.completeness)
  if (!tool.input && !tool.output && tool.completeness === '不可用') {
    expect(actual.evidence).toBe('此调试记录未保存调用参数和模拟回执')
    expect(result.result.trace.trajectory).not.toBe('完整活动记录')
  }
  if (tool.input_state === 'truncated') {
    expect(actual.evidence).toContain('调用参数已截断')
    expect(result.result.trace.trajectory).not.toBe('完整活动记录')
  }
  const text = JSON.stringify(result.result)
  expect(text).not.toContain('private-node-')
  expect(text).not.toContain('private-call')
})

it('preserves Pi edits but refuses to overwrite a different unsaved sidebar draft', async () => {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '审核员'
  const remoteDocument: TeamDefinition = { name: '合同团队', objective: '复核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '复核', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  const sidebarDocument = structuredClone(remoteDocument)
  sidebarDocument.objective = '侧栏尚未保存的目标'
  let saved = false
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [] }
  bridge = new TeamDevelopmentAgentBridge({
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }),
    teams: async () => [{ id: 'team', name: '合同团队' }], team: async () => workspace(remoteDocument),
    workspace: async (command) => { if (command.action === 'save') saved = true; throw new Error('unexpected write') },
    catalog: async () => catalog, extensionPath: '/app/team-development.ts',
  })
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime')
  await bridge.bindContext('runtime', { teamId: 'team', revision: 4, document: sidebarDocument, catalog }, 'developer-1')
  const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, {
    method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'save', params: { operations: [{ kind: 'member', member: '审核员', duty: 'Pi 修改' }] } }),
  })
  const result = await response.json() as { ok: boolean; error?: string }
  expect(result.ok).toBe(false)
  expect(result.error).toContain('原修改已保留')
  expect(saved).toBe(false)
  expect((await bridge.getProposal('runtime'))?.document.objective).toBe('侧栏尚未保存的目标')
  expect((await bridge.getProposal('runtime'))?.document.members[1]?.relationship.duty).toBe('Pi 修改')
})

it('retains a saved candidate and refuses a concurrent Weave revision change', async () => {
  const worker = newMember('deepseek-flash'); worker.configuration.displayName = '审核员'
  const document: TeamDefinition = { name: '反馈团队', objective: '整理反馈', members: [worker], workflows: [] }
  let remote = workspace(document, 7)
  let saveCalled = false
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [], refreshedAt: '' }
  bridge = new TeamDevelopmentAgentBridge({
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }),
    teams: async () => [{ id: 'team', name: '反馈团队' }], team: async () => structuredClone(remote),
    workspace: async (command) => { if (command.action === 'save') saveCalled = true; throw new Error('unexpected write') },
    catalog: async () => catalog, extensionPath: '/app/team-development.ts',
  })
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime')
  const call = async () => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, {
      method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'save', params: { operations: [{ kind: 'member', member: '审核员', duty: '按模块分类' }] } }),
    })
    return response.json() as Promise<{ ok: boolean; error?: string }>
  }
  await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, {
    method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'open', params: { team_name: '反馈团队' } }),
  })
  remote = { ...remote, revision: 8, document: { ...remote.document, objective: '另一位开发者的新目标' } }
  const result = await call()
  expect(result.ok).toBe(false)
  expect(result.error).toContain('团队草稿已变化')
  expect(saveCalled).toBe(false)
  expect((await bridge.getProposal('runtime'))?.document.members[0]?.relationship.duty).toBe('按模块分类')
  const retry = await call()
  expect(retry.ok).toBe(false)
  expect(retry.error).toContain('团队草稿已变化')
  expect(saveCalled).toBe(false)
})

it('refuses to update a team whose action-bound flow lacks the receipt completion check', async () => {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '转化员'
  worker.configuration.businessCapabilityIds = ['forge:action:crm_lead.convert']
  const document: TeamDefinition = { name: '线索团队', objective: '转化线索', members: [lead, worker], workflows: [{ id: 'flow', name: '转化流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  const calls: TeamWorkspaceCommand[] = []
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [
    { id: 'forge:action:crm_lead.convert', name: '转化线索', description: '把线索转为商机', effect: 'write', executionMode: 'team_delegable', resourceType: 'crm_lead', requiresEmployeeIntent: true, status: 'available' },
  ] }
  bridge = new TeamDevelopmentAgentBridge({
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }), teams: async () => [{ id: 'team', name: '线索团队' }],
    team: async () => workspace(document), catalog: async () => catalog, extensionPath: '/app/team-development.ts',
    workspace: async (command: TeamWorkspaceCommand) => { calls.push(command); throw new Error(`unexpected workspace call: ${command.action}`) },
  })
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi', sessionPath: '/sessions/developer-1.jsonl' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime', '/sessions/developer-1.jsonl')
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, {
      method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })
    return response.json() as Promise<{ ok: boolean; error?: string }>
  }
  await call('list')
  await call('open', { team_name: '线索团队' })
  const updated = await call('update_team')
  expect(updated.ok).toBe(false)
  expect(updated.error).toContain('转化流程')
  expect(updated.error).toContain('完成检查')
  expect(calls).toHaveLength(0)
})

it('requires current server readiness for Pi publication of a write-action flow', async () => {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '转化员'
  const action = { id: 'forge:action:crm_lead.convert', name: '转化线索', description: '把线索转为商机', effect: 'write' as const, executionMode: 'team_delegable' as const, resourceType: 'crm_lead', requiresEmployeeIntent: true, status: 'available' as const, actionName: 'convert', objectName: 'crm_lead' }
  worker.configuration.businessCapabilityIds = [action.id]
  const flow: TeamDefinition['workflows'][number] = { id: 'flow', name: '转化流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }
  flow.graph_definition.delivery_contract = {
    version: 1, coverage: 'incomplete', output: { type: 'text' }, external_effects: 'required', external_effects_check_id: 'business-action-receipts',
    required_checks: [{ id: 'business-action-receipts', title: '已授权业务动作具备成功回执', verifier_id: 'weave.business-action-receipts', verifier_version: 'v1', parameters: { required_capability_ids: [action.id], when_authorized: true, allow_needs_input: false } }],
  }
  const document: TeamDefinition = { name: '线索团队', objective: '转化线索', members: [lead, worker], workflows: [flow] }
  let remote = { ...workspace(document, 6), trials: [{ request_id: 'trial', revision: 6, workflow_id: flow.id, run_id: 'run', status: 'succeeded', created_at: '' }] }
  const publishCalls: TeamWorkspaceCommand[] = []
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [action] }
  bridge = new TeamDevelopmentAgentBridge({
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }),
    teams: async () => [{ id: 'team', name: document.name }], team: async () => structuredClone(remote),
    catalog: async () => catalog, extensionPath: '/app/team-development.ts',
    workspace: async (command: TeamWorkspaceCommand) => {
      publishCalls.push(command)
      if (command.action !== 'publish') throw new Error(`unexpected workspace action: ${command.action}`)
      remote = { ...remote, published_revision: command.revision }
      return structuredClone(remote)
    },
  })
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime')
  await bridge.bindContext('runtime', { teamId: 'team', revision: 6, document, catalog }, 'developer-1')
  const call = async () => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, { method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'update_team', params: {} }) })
    return response.json() as Promise<{ ok: boolean; error?: string }>
  }

  const legacy = await call()
  expect(legacy.ok).toBe(false)
  expect(legacy.error).toContain('无法确认当前草稿的模拟回执覆盖')
  expect(legacy.error).not.toContain(action.id)
  expect(publishCalls).toHaveLength(0)

  remote.publication_readiness = { ready: true, workflows: [{ workflow_id: flow.id, required_capability_ids: [action.id], covered_capability_ids: [action.id], missing_capability_ids: [], passed: true }] }
  const ready = await call()
  expect(ready.ok).toBe(true)
  expect(publishCalls.map((command) => command.action)).toEqual(['publish'])
  expect(remote.published_revision).toBe(6)
})

it('fails closed on a legacy write-flow response without readiness and publishes only after server coverage passes', async () => {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; worker.configuration.displayName = '转化员'
  const action = { id: 'forge:action:crm_lead.convert', name: '转化线索', description: '把线索转为商机', effect: 'write' as const, executionMode: 'team_delegable' as const, resourceType: 'crm_lead', requiresEmployeeIntent: true, status: 'available' as const, actionName: 'convert', objectName: 'crm_lead' }
  worker.configuration.businessCapabilityIds = [action.id]
  const flow = { id: 'flow', name: '转化流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }
  flow.graph_definition.delivery_contract = {
    version: 1, coverage: 'incomplete', output: { type: 'text' }, external_effects: 'required', external_effects_check_id: 'business-action-receipts',
    required_checks: [{ id: 'business-action-receipts', title: '已授权业务动作具备成功回执', verifier_id: 'weave.business-action-receipts', verifier_version: 'v1', parameters: { required_capability_ids: [action.id], when_authorized: true, allow_needs_input: false } }],
  }
  const document: TeamDefinition = { name: '线索团队', objective: '转化线索', members: [lead, worker], workflows: [flow] }
  let remote = { ...workspace(document, 6), trials: [{ request_id: 'trial', revision: 6, workflow_id: flow.id, run_id: 'run', status: 'succeeded', created_at: '' }] }
  const publishCalls: TeamWorkspaceCommand[] = []
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [action] }
  bridge = new TeamDevelopmentAgentBridge({
    accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }),
    teams: async () => [{ id: 'team', name: document.name }], team: async () => structuredClone(remote),
    catalog: async () => catalog, extensionPath: '/app/team-development.ts',
    workspace: async (command: TeamWorkspaceCommand) => {
      publishCalls.push(command)
      if (command.action !== 'publish') throw new Error(`unexpected workspace action: ${command.action}`)
      remote = { ...remote, published_revision: command.revision }
      return structuredClone(remote)
    },
  })
  await bridge.start()
  const env = bridge.environmentFor({ cwd: '/work', harness: 'pi' })
  bridge.bindRuntime(env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN, 'runtime')
  await bridge.bindContext('runtime', { teamId: 'team', revision: 6, document, catalog }, 'developer-1')
  const call = async () => {
    const response = await fetch(env.GOOEYPI_TEAM_DEVELOPMENT_URL!, { method: 'POST', headers: { authorization: `Bearer ${env.GOOEYPI_TEAM_DEVELOPMENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'update_team', params: {} }) })
    return response.json() as Promise<{ ok: boolean; error?: string }>
  }

  const oldResponse = await call()
  expect(oldResponse.ok).toBe(false)
  expect(oldResponse.error).toContain('无法确认当前草稿的模拟回执覆盖')
  expect(publishCalls).toHaveLength(0)

  remote.publication_readiness = { ready: true, workflows: [{ workflow_id: flow.id, required_capability_ids: [action.id], covered_capability_ids: [action.id], missing_capability_ids: [], passed: true }] }
  const covered = await call()
  expect(covered.ok).toBe(true)
  expect(publishCalls.map((command) => command.action)).toEqual(['publish'])
  expect(remote.published_revision).toBe(6)
})
