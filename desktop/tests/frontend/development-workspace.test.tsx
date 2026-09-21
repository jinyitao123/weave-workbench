// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DevelopmentPage } from '../../src/pages/DevelopmentPage'
import type { EnterpriseDevelopmentOverview, EnterpriseTeamMemberConfigDraft } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
const overview: EnterpriseDevelopmentOverview = {
  version: '1', loadedAt: '', runtimes: [], teams: [{ id: 'team', name: '合同团队', status: 'active', updatedAt: '2026-09-21T00:00:00Z', workflows: [], runs: [], workers: [
    { id: 'reviewer', name: '审核员', role: 'worker', enabled: true }, { id: 'writer', name: '起草员', role: 'worker', enabled: true },
  ] }],
}
function fixture(agentId = 'reviewer'): EnterpriseTeamMemberConfigDraft {
  return { version: '1', teamId: 'team', agentId, agentName: agentId, baseAgentVersion: 1, revision: 1, updatedAt: '',
    configuration: { displayName: agentId === 'reviewer' ? '审核员' : '起草员', role: 'worker', engine: 'loom', runtimeId: '', model: '', systemPrompt: '检查合同', skillNames: [], mcpServerIds: ['3a57aefc-a5c4-44d3-8e0d-e46d06cd2d41'], permissionAllow: [], permissionAsk: [], permissionDeny: [], memoryEnabled: false, memoryScope: 'tenant', maxTokens: 0, maxOutputTokens: 0, stepBudget: 0, maxCostUsd: 0, outputSchema: '' },
    relationship: { duty: '检查条款', whenToUse: '', contextInstruction: '', allowedKinds: [], defaultKind: '', resultRequirement: '', enabled: true },
  }
}
const load = vi.fn(async (_team: string, member: string) => fixture(member))
const save = vi.fn(async (draft: EnterpriseTeamMemberConfigDraft) => ({ ...draft, revision: draft.revision + 1 }))
const createTeam = vi.fn(async () => ({ id: 'created-team', name: '采购团队', objective: '处理采购工作' }))
const updateTeam = vi.fn(async () => undefined)
const createTeamMember = vi.fn(async () => ({ id: 'new-member', name: '法务复核员' }))
const removeTeamMember = vi.fn(async () => undefined)
const createWorkflow = vi.fn(async () => ({ id: 'created-flow', name: '合同流程', draftVersion: 1 }))
const validateWorkflow = vi.fn(async () => ({ valid: true, issues: [] }))
async function render(value: EnterpriseDevelopmentOverview = overview, onRefresh = () => undefined) {
  await act(async () => root.render(<DevelopmentPage environments={[]} overview={value} loading={false} error="" onRefresh={onRefresh} onOpenForge={() => undefined} onCreateTeam={createTeam} onUpdateTeam={updateTeam} onCreateTeamMember={createTeamMember} onRemoveTeamMember={removeTeamMember} onCreateWorkflow={createWorkflow} onValidateWorkflow={validateWorkflow} onLoadMemberDraft={(team, member) => load(team, member)} onSaveMemberDraft={save}/>))
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  await act(async () => button.click())
}
async function editDuty(value: string) {
  const button = container.querySelector<HTMLButtonElement>('.member-config-card__action')!
  await act(async () => button.click())
  const input = container.querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

it('keeps edits when the parent supplies fresh callback identities', async () => {
  await render(); await editDuty('检查付款条件'); await render()
  expect(load).toHaveBeenCalledTimes(1)
  expect(container.querySelector('textarea')?.value).toBe('检查付款条件')
  await click('保存草稿')
  expect(save.mock.calls[0]?.[0].relationship.duty).toBe('检查付款条件')
  expect(container.querySelector('.member-inspector__state')?.textContent).toBe('已保存')
})

it('protects unsaved edits on member switch, and only switches after a successful save', async () => {
  await render(); await editDuty('检查付款条件')
  const writer = container.querySelectorAll<HTMLButtonElement>('.team-member-card')[1]
  await act(async () => writer.click())
  expect(document.querySelector('[role=dialog]')).not.toBeNull()
  save.mockRejectedValueOnce(new Error('配置草稿已被更新，请刷新后继续'))
  await click('保存并继续')
  expect(document.querySelector('[role=dialog]')).not.toBeNull()
  expect(container.querySelector('textarea')?.value).toBe('检查付款条件')
  await click('保存并继续')
  expect(document.querySelector('[role=dialog]')).toBeNull()
  expect(container.querySelector('.member-inspector__heading h3')?.textContent).toBe('起草员')
})

it('ignores stale responses after selecting another member', async () => {
  let resolveFirst!: (value: EnterpriseTeamMemberConfigDraft) => void
  load.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
  await render()
  await act(async () => container.querySelectorAll<HTMLButtonElement>('.team-member-card')[1].click())
  await act(async () => resolveFirst(fixture()))
  expect(container.querySelector('.member-inspector__heading h3')?.textContent).toBe('起草员')
})

it('shows bindings without exposing internal identifiers or fake resource options', async () => {
  await render(); await click('能力')
  expect(container.textContent).toContain('已绑定工具服务')
  expect(container.textContent).not.toContain('3a57aefc')
  expect(container.querySelector('select')).toBeNull()
})

it('turns the empty state into a minimal team creation path', async () => {
  const refresh = vi.fn()
  await render({ ...overview, teams: [] }, refresh)
  await click('新建团队')
  const name = document.querySelector<HTMLInputElement>('input')!
  const objective = document.querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '采购团队')
    name.dispatchEvent(new Event('input', { bubbles: true }))
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(objective, '处理采购工作')
    objective.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('创建团队')
  expect(createTeam).toHaveBeenCalledWith({ version: '1', name: '采购团队', objective: '处理采购工作' })
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[role=dialog]')).toBeNull()
})

it('creates a basic workflow from the current team without exposing internal identifiers', async () => {
  const refresh = vi.fn()
  const value: EnterpriseDevelopmentOverview = { ...overview, teams: [{ ...overview.teams[0], objective: '处理合同', lead: { id: 'lead-id', name: '负责人', role: 'avatar', enabled: true } }] }
  await render(value, refresh)
  await click('工作流程'); await click('新建流程')
  await click('创建流程')
  expect(createWorkflow).toHaveBeenCalledWith({ version: '1', teamId: 'team', name: '合同团队流程', description: '处理合同', leadId: 'lead-id', workerId: 'reviewer' })
})

it('edits team details and adds and removes an execution member', async () => {
  const refresh = vi.fn()
  await render(overview, refresh)
  await click('编辑团队资料')
  const fields = document.querySelectorAll<HTMLInputElement>('input')
  const objective = document.querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(fields[fields.length - 1], '合同交接组')
    fields[fields.length - 1].dispatchEvent(new Event('input', { bubbles: true }))
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(objective, '完成合同复核和交接')
    objective.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('保存')
  expect(updateTeam).toHaveBeenCalledWith({ version: '1', teamId: 'team', name: '合同交接组', objective: '完成合同复核和交接', expectedUpdatedAt: '2026-09-21T00:00:00Z' })

  await click('添加成员')
  const memberName = document.querySelectorAll<HTMLInputElement>('input').item(document.querySelectorAll<HTMLInputElement>('input').length - 1)
  const duty = document.querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(memberName, '法务复核员')
    memberName.dispatchEvent(new Event('input', { bubbles: true }))
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(duty, '复核合同法律条款')
    duty.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('添加')
  expect(createTeamMember).toHaveBeenCalledWith({ version: '1', teamId: 'team', name: '法务复核员', duty: '复核合同法律条款' })

  await click('移出成员'); await click('移出团队')
  expect(removeTeamMember).toHaveBeenCalledWith('team', 'reviewer')
})

it('checks the current draft and shows a readable result', async () => {
  const value: EnterpriseDevelopmentOverview = { ...overview, teams: [{ ...overview.teams[0], workflows: [{ id: 'flow-id', name: '合同流程', status: 'active', draftVersion: 2, inspectedVersion: 2, nodes: [{ id: 'start', type: 'lead', label: '理解任务' }], edges: [] }] }] }
  await render(value)
  await click('工作流程'); await click('检查草稿')
  expect(validateWorkflow).toHaveBeenCalledWith('flow-id', 2)
  expect(container.textContent).toContain('草稿通过检查')
  expect(container.textContent).not.toContain('flow-id')
})
