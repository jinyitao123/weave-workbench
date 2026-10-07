// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamDevelopmentInspector } from '../../src/components/inspector/TeamDevelopmentInspector'
import { newMember } from '../../src/pages/team-workspace/member'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import type { EnterpriseDevelopmentOverview, PrimeWorkApi } from '../../src/types/api'
import type { TeamWorkspace, TeamWorkspaceCommand } from '../../src/types/team-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined, container: HTMLDivElement | undefined
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); root = undefined; container = undefined })

it('shows a Pi proposal beside the main conversation and saves only after applying it', async () => {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; lead.configuration.displayName = '负责人'; worker.configuration.displayName = '审核员'
  let remote: TeamWorkspace = { revision: 2, published_revision: 1, publishing_revision: 0, prepared_revision: 0, updated_at: '', trials: [], document: { name: '合同团队', objective: '复核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '合同复核', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] } }
  const base = structuredClone(remote.document), proposed = structuredClone(base)
  proposed.members[1]!.relationship.duty = '核对付款条件'
  const call = vi.fn(async (command: TeamWorkspaceCommand) => {
    if (command.action === 'save') remote = { ...remote, revision: remote.revision + 1, document: command.document }
    return structuredClone(remote)
  })
  const invalidateTeamDevelopmentTurn = vi.fn(async () => {})
  const enterprise = {
    teamWorkspace: call,
    getBusinessCapabilityCatalog: async () => ({ version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [], refreshedAt: '' }),
    getTeamDevelopmentState: async () => ({ teamId: 'team', revision: 2, proposal: { revision: 2, baseDocument: base, document: proposed, changes: ['修改成员：审核员'] } }),
    updateTeamDevelopment: vi.fn(async () => {}),
    invalidateTeamDevelopmentTurn,
  } as unknown as PrimeWorkApi['enterprise']
  const agent = { onEvent: () => () => {} } as unknown as PrimeWorkApi['agent']
  const overview: EnterpriseDevelopmentOverview = { version: '1', loadedAt: '', models: ['deepseek-flash'], runtimes: [], teams: [{ id: 'team', name: '合同团队', status: 'active', updatedAt: '', workers: [], workflows: [], runs: [] }] }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<TeamDevelopmentInspector enterprise={enterprise} agent={agent} accountId="developer" runtime={{ runtimeId: 'pi', harness: 'pi', cwd: '/work', isStreaming: false }} overview={overview} loading={false} onRefresh={() => {}} view="division"/>))
  const apply = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('应用到草稿'))
  expect(apply).toBeTruthy()
  await act(async () => apply!.click())
  expect(invalidateTeamDevelopmentTurn).toHaveBeenCalledWith('pi')
  expect(remote.document.members[1]?.relationship.duty).toBe('')
  expect(container.textContent).toContain('修改尚未保存')
  await act(async () => root!.unmount())
  root = createRoot(container)
  await act(async () => root!.render(<TeamDevelopmentInspector enterprise={enterprise} agent={agent} accountId="developer" runtime={{ runtimeId: 'pi', harness: 'pi', cwd: '/work', isStreaming: false }} overview={overview} loading={false} onRefresh={() => {}} view="division"/>))
  expect(container.textContent).toContain('修改尚未保存')
  const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('保存草稿'))!
  await act(async () => save.click())
  expect(remote.document.members[1]?.relationship.duty).toBe('核对付款条件')
  expect(enterprise.updateTeamDevelopment).toHaveBeenCalled()
})
