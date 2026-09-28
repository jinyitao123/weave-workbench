import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TeamDevelopmentAgentBridge } from '../../electron/main/development/agent-bridge'
import { newMember } from '../../src/pages/team-workspace/member'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import type { EnterpriseBusinessCapabilityCatalog } from '../../src/types/api'
import type { TeamDefinition } from '../../src/types/team-workspace'

let bridge: TeamDevelopmentAgentBridge | undefined
const tempDirectories: string[] = []
afterEach(async () => { await bridge?.stop(); bridge = undefined; for (const path of tempDirectories.splice(0)) rmSync(path, { recursive: true, force: true }) })

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
})

it('restores a pending proposal for the same account and Pi session after a desktop restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'team-dev-proposal-')); tempDirectories.push(directory)
  const storage = { directory, codec: { available: () => true, encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() } }
  const worker = newMember('deepseek-flash'); worker.configuration.displayName = '审核员'
  const document: TeamDefinition = { name: '反馈团队', objective: '整理反馈', members: [worker], workflows: [] }
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [], refreshedAt: '' }
  const options = { accountKey: async () => 'developer-1', developer: async () => ({ accountId: 'developer-1' }), teams: async () => [{ id: 'team', name: '反馈团队' }], team: async () => ({ revision: 7, published_revision: 6, publishing_revision: 0, prepared_revision: 0, document, updated_at: '', trials: [] }), catalog: async () => catalog, extensionPath: '/app/team-development.ts', storage }
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
