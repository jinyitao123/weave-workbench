// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TeamDevelopmentWorkspace } from '../../src/components/inspector/TeamDevelopmentWorkspace'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import { newMember } from '../../src/pages/team-workspace/member'
import type { EnterpriseBusinessCapabilityCatalog, PrimeWorkApi } from '../../src/types/api'
import type { TeamWorkspace, TeamWorkspaceCommand } from '../../src/types/team-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it('lets the desktop developer create parallel checks, add a lead summary after the join, save, and read it back', async () => {
  const lead = newMember('deepseek-flash'), commercial = newMember('deepseek-flash'), delivery = newMember('deepseek-flash')
  lead.configuration = { ...lead.configuration, displayName: '合同协调员', role: 'avatar', systemPrompt: '核对材料并汇总团队结论。' }
  commercial.configuration.displayName = '商务检查员'
  delivery.configuration.displayName = '交付检查员'
  const definition = { name: '合同评审协作团队', objective: '核对指定合同版本并给出有依据的复核意见。', members: [lead, commercial, delivery], workflows: [{ id: 'flow', name: '合同复核流程', description: '', trigger_config: {}, graph_definition: initialGraph(commercial) }] }
  let remote: TeamWorkspace = { revision: 1, published_revision: 0, publishing_revision: 0, prepared_revision: 0, updated_at: '', trials: [], document: definition }
  const teamWorkspace = vi.fn(async (command: TeamWorkspaceCommand) => {
    if (command.action === 'save') remote = { ...remote, revision: remote.revision + 1, document: structuredClone(command.document) }
    return structuredClone(remote)
  })
  const enterprise = { teamWorkspace, updateTeamDevelopment: vi.fn() } as unknown as PrimeWorkApi['enterprise']
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [], refreshedAt: '' }
  const container = window.document.createElement('div'); window.document.body.append(container)
  const root: Root = createRoot(container)
  const render = async () => await act(async () => root.render(<TeamDevelopmentWorkspace teamId="team" accountId="developer" enterprise={enterprise} overview={{ version: '1', loadedAt: '', teams: [], runtimes: [], models: ['deepseek-flash'] }} catalog={catalog} catalogError="" bindRequested={false} view="workflow" onBound={() => {}} onClearProposal={() => {}} onDirtyChange={() => {}} onError={(message) => { if (message) throw new Error(message) }} onPublish={() => {}}/>))
  const click = async (label: string) => {
    const button = [...window.document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
    if (!button) throw new Error(`Missing button: ${label}`)
    await act(async () => button.click())
  }
  const edit = async (label: string, value: string) => {
    const input = [...window.document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].find((item) => item.getAttribute('aria-label') === label || item.closest('label')?.textContent?.includes(label))
    if (!input) throw new Error(`Missing field: ${label}`)
    await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const choose = async (label: string, name: string) => {
    await click(label)
    const option = [...window.document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((button) => button.textContent?.includes(name))
    if (!option) throw new Error(`Missing option: ${name}`)
    await act(async () => option.click())
  }
  try {
    await render()
    await act(async () => { await Promise.resolve() })
    await click('编辑步骤 商务检查员')
    await click('添加并行分支')
    await choose('由谁执行', '交付检查员')
    await edit('步骤名称', '交付检查'); await edit('工作要求', '核对交付范围、验收标准与责任边界，并引用原文。')
    await click('添加步骤')
    await choose('执行成员', '交付检查员')

    await click('编辑步骤 交付检查')
    expect([...container.querySelectorAll<HTMLButtonElement>('.team-step__actions button')].map((item) => item.textContent?.trim())).toEqual(['添加并行分支'])
    await click('编辑步骤 并行分工'); await click('汇合后添加步骤')
    expect(window.document.querySelector('.team-development-workspace__step-form-context')?.textContent).toContain('并行汇合之后')
    await choose('由谁执行', '合同协调员')
    await edit('步骤名称', '合同结果汇总'); await edit('工作要求', '汇总交付与商务检查结论，逐项列出原文依据和待确认事项。')
    await click('添加步骤'); await click('保存草稿')

    const graph = remote.document.workflows[0]!.graph_definition
    const parallel = graph.nodes.find((node) => node.type === 'parallel')!
    const join = graph.nodes.find((node) => node.type === 'join')!
    const branchWorkers = graph.edges.filter((edge) => edge.from_node_id === parallel.id).map((edge) => graph.nodes.find((node) => node.id === edge.to_node_id)!)
    expect(branchWorkers).toHaveLength(2)
    expect(branchWorkers.every((node) => node.type === 'worker' && node.config?.kind === 'dispatch')).toBe(true)
    expect(branchWorkers.find((node) => node.label === '交付检查')?.config?.agent_id).toBe(delivery.id)
    const finalizer = graph.nodes.find((node) => node.label === '合同结果汇总')!
    expect(finalizer.type).toBe('lead')
    expect(finalizer.config?.instruction).toBe('汇总交付与商务检查结论，逐项列出原文依据和待确认事项。')
    expect(graph.edges).toContainEqual(expect.objectContaining({ from_node_id: join.id, to_node_id: finalizer.id, route: 'success' }))
    expect(graph.nodes.find((node) => node.type === 'deliver')?.config?.result).toMatchObject({ node_id: finalizer.id })

    await act(async () => root.render(null)); await render(); await act(async () => { await Promise.resolve() })
    expect(container.querySelector<HTMLButtonElement>('[aria-label="编辑步骤 合同结果汇总"]')?.textContent).toContain('合同协调员')
    expect(teamWorkspace.mock.calls.some(([command]) => command.action === 'save')).toBe(true)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
