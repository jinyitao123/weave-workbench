// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DevelopmentPage } from '../../src/pages/DevelopmentPage'
import { newMember } from '../../src/pages/team-workspace/member'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import { runLabel } from '../../src/pages/team-workspace/TrialPanel'
import type { EnterpriseDevelopmentOverview, PrimeWorkApi } from '../../src/types/api'
import type { TeamWorkspace, TeamWorkspaceCommand } from '../../src/types/team-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement, remote: TeamWorkspace
const overview: EnterpriseDevelopmentOverview = { version: '1', loadedAt: '', runtimes: [], models: ['deepseek-flash'], teams: [{ id: 'team', name: '合同团队', status: 'active', updatedAt: '', workflows: [], runs: [], workers: [] }] }
const call = vi.fn(async (command: TeamWorkspaceCommand): Promise<unknown> => {
  if (command.action === 'save') { if (command.revision !== remote.revision) throw new Error('草稿冲突'); remote = { ...remote, revision: remote.revision + 1, document: command.document } }
  return structuredClone(remote)
})
const bridge = { teamWorkspace: call, createDevelopmentTeam: vi.fn() } as unknown as PrimeWorkApi['enterprise']
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  await act(async () => button.click())
}
async function edit(label: string, value: string) {
  const input = [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].find((item) => item.getAttribute('aria-label') === label || item.closest('label')?.textContent?.includes(label))!
  expect(input, label).toBeTruthy()
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function open() { await act(async () => root.render(<DevelopmentPage overview={overview} loading={false} onRefresh={() => {}} bridge={bridge}/>)) }
async function selectMember(name: string) { await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.team-member-card')].find((b) => b.textContent?.includes(name))!.click()) }
async function saveSoon() { await click('保存') }
beforeEach(() => {
  vi.clearAllMocks()
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration = { ...lead.configuration, displayName: '负责人', role: 'avatar' }; worker.configuration.displayName = '审核员'
  remote = { revision: 1, published_revision: 0, publishing_revision: 0, prepared_revision: 0, updated_at: '', trials: [], document: { name: '合同团队', objective: '审核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '合同审核', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] } }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

it('saves one remote team draft while keeping the original member inspector', async () => {
  await open()
  expect(container.querySelector('.team-member-grid')).not.toBeNull()
  expect(container.querySelector('textarea')).toBeNull()
  await click('编辑团队目标与承接范围内容')
  await edit('团队目标与承接范围', '逐条核对原文')
  await selectMember('审核员'); await click('编辑团队职责内容'); await edit('团队职责', '检查付款条款')
  await saveSoon()
  expect(remote.document.members[1].relationship.duty).toBe('检查付款条款')
  expect(remote.document.objective).toBe('逐条核对原文')
})
it('blocks removal of referenced members and keeps the desktop on one visible flow', async () => {
  await open(); await selectMember('审核员'); await click('成员操作'); await click('移出团队')
  expect(container.textContent).toContain('仍被以下步骤使用')
  await click('工作流程')
  expect([...container.querySelectorAll('button')].some((button) => button.getAttribute('aria-label') === '新建流程')).toBe(false)
  expect([...container.querySelectorAll('button')].some((button) => button.textContent?.trim() === '选择工作流程')).toBe(false)
  expect(container.querySelector('.workflow-graph')).not.toBeNull()
})
it('shows actual flow links and material bindings, and invalidates old trial approval', async () => {
  remote.trials = [{ request_id: 'old', revision: 1, workflow_id: 'flow', run_id: 'run', status: 'succeeded', created_at: '2026-09-22T00:00:00Z' }]
  remote.published_document = structuredClone(remote.document)
  await open(); await click('工作流程'); await click('编辑步骤 审核员')
  expect(container.querySelectorAll('.workflow-graph>svg>path').length).toBe(2)
  const toggle = [...container.querySelectorAll<HTMLButtonElement>('.tw-source-list button')].find((b) => b.textContent?.startsWith('本次任务输入'))!
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  await act(async () => toggle.click())
  await act(async () => container.querySelector<HTMLButtonElement>('.tw-change-note')!.click())
  const publish = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '更新团队')!
  expect(publish.disabled).toBe(true)
  await saveSoon()
  expect(JSON.stringify(remote.document.workflows[0].graph_definition.nodes.find((n) => n.id === 'work')!.inputs)).not.toContain('run_input')
})
it('only saves the clicked snapshot and retains edits made while it is in flight', async () => {
  await open(); await click('编辑成员名称内容')
  let complete!: () => void
  call.mockImplementationOnce(async (command) => { await new Promise<void>((r) => { complete = r }); if (command.action === 'save') remote = { ...remote, revision: 2, document: command.document }; return structuredClone(remote) })
  await edit('成员名称', '第一版'); await click('保存')
  await edit('成员名称', '第二版'); await act(async () => complete())
  expect(container.textContent).toContain('修改尚未保存')
  expect(remote.document.members[0].configuration.displayName).toBe('第一版')
  expect(remote.revision).toBe(2)
  await click('保存')
  expect(remote.document.members[0].configuration.displayName).toBe('第二版')
  expect(remote.revision).toBe(3)
})
it('does not store unsaved edits on a delay, navigation or unmount', async () => {
  await open(); await click('编辑团队职责内容'); await edit('团队职责', '仅在页面中编辑')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)) })
  expect(call.mock.calls.filter(([command]) => command.action === 'save')).toHaveLength(0)
  await click('应用开发')
  expect(document.body.textContent).toContain('修改尚未保存')
  expect(container.textContent).not.toContain('打开 Forge 开发环境')
  await click('继续编辑')
  await act(async () => root.render(null))
  expect(call.mock.calls.filter(([command]) => command.action === 'save')).toHaveLength(0)
})

it('prevents duplicate trial submission and names tool completion states', async () => {
  await open(); await click('工作流程'); await click('调试'); await edit('测试输入', '隔离调试材料')
  const start = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '开始调试')!
  await act(async () => { start.click(); start.click() })
  expect(call.mock.calls.filter(([command]) => command.action === 'trial')).toHaveLength(1)
  expect(runLabel('tool_started')).toBe('执行中')
  expect(runLabel('tool_completed')).toBe('已完成')
  expect(runLabel('tool_failed')).toBe('失败')
})
