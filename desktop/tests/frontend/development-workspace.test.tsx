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
  version: '1', loadedAt: '', runtimes: [], teams: [{ id: 'team', name: '合同团队', status: 'active', workflows: [], runs: [], workers: [
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
async function render(value: EnterpriseDevelopmentOverview = overview, onRefresh = () => undefined) {
  await act(async () => root.render(<DevelopmentPage environments={[]} overview={value} loading={false} error="" onRefresh={onRefresh} onOpenForge={() => undefined} onCreateTeam={createTeam} onLoadMemberDraft={(team, member) => load(team, member)} onSaveMemberDraft={save}/>))
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  await act(async () => button.click())
}
async function editDuty(value: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.member-setting__toggle')].find((item) => item.textContent?.startsWith('团队职责'))!
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
  await render(); await click('技能与工具')
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
