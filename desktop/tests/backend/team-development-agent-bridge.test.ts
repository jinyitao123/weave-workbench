import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TeamDevelopmentAgentBridge } from '../../electron/main/development/agent-bridge'
import { newMember } from '../../src/pages/team-workspace/member'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import type { EnterpriseBusinessCapabilityCatalog } from '../../src/types/api'
import type { TeamDefinition, TeamWorkspace, TeamWorkspaceCommand } from '../../src/types/team-workspace'

let bridge: TeamDevelopmentAgentBridge | undefined
const tempDirectories: string[] = []
afterEach(async () => { await bridge?.stop(); bridge = undefined; for (const path of tempDirectories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function workspace(document: TeamDefinition, revision = 4): TeamWorkspace {
  return { revision, published_revision: revision - 1, publishing_revision: 0, prepared_revision: 0, document: structuredClone(document), updated_at: '', trials: [] }
}

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
