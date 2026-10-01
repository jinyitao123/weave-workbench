// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DevelopmentPage } from '../../src/pages/DevelopmentPage'
import { newMember } from '../../src/pages/team-workspace/member'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import { runLabel } from '../../src/pages/team-workspace/TrialPanel'
import type { EnterpriseBusinessCapabilityCatalog, EnterpriseDevelopmentOverview, PrimeWorkApi } from '../../src/types/api'
import type { TeamWorkspace, TeamWorkspaceCommand } from '../../src/types/team-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement, remote: TeamWorkspace
const overview: EnterpriseDevelopmentOverview = { version: '1', loadedAt: '', runtimes: [], models: ['deepseek-flash'], teams: [{ id: 'team', name: '合同团队', status: 'active', updatedAt: '', workflows: [], runs: [], workers: [] }] }
const call = vi.fn(async (command: TeamWorkspaceCommand): Promise<unknown> => {
  if (command.action === 'save') { if (command.revision !== remote.revision) throw new Error('草稿冲突'); remote = { ...remote, revision: remote.revision + 1, document: command.document } }
  return structuredClone(remote)
})
const getBusinessCapabilityCatalog = vi.fn(async (): Promise<EnterpriseBusinessCapabilityCatalog> => ({ version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [], refreshedAt: '' }))
const bridge = { teamWorkspace: call, createDevelopmentTeam: vi.fn(), getBusinessCapabilityCatalog } as unknown as PrimeWorkApi['enterprise']
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  await act(async () => button.click())
}
async function edit(label: string, value: string) {
  const input = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].find((item) => item.getAttribute('aria-label') === label || item.closest('label, .product-field')?.textContent?.includes(label) || item.parentElement?.textContent?.includes(label))!
  if (!input) throw new Error(`Missing field ${label}; visible labels: ${[...document.querySelectorAll('label')].map((item) => item.textContent?.trim()).join(' | ')}`)
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function open() { await act(async () => root.render(<DevelopmentPage overview={overview} loading={false} onRefresh={() => {}} bridge={bridge}/>)) }
async function selectMember(name: string) { await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.team-member-card')].find((b) => b.textContent?.includes(name))!.click()) }
async function saveSoon() { await click('保存') }
async function chooseProductOption(label: string, name: string) {
  await click(label)
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((button) => button.textContent?.includes(name))
  if (!option) throw new Error(`Missing option: ${name}`)
  await act(async () => option.click())
}
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
it('opens the requested team directly in its workflow canvas from the Pi sidebar', async () => {
  await act(async () => root.render(<DevelopmentPage overview={overview} loading={false} initialTeamId="team" initialView="workflow" onRefresh={() => {}} bridge={bridge}/>))
  expect(container.querySelector('.workflow-graph')).not.toBeNull()
  expect(container.textContent).toContain('合同审核')
})
it('marks an array action unavailable, keeps a selected one removable, and blocks update', async () => {
  const capabilityId = 'forge:action:forge_quote.update_lines'
  const worker = remote.document.members[1]!
  worker.configuration.businessCapabilityIds = [capabilityId]
  const published = structuredClone(remote.document)
  published.members[1]!.configuration.businessCapabilityIds = []
  published.members[1]!.configuration.businessCapabilityBindings = []
  remote.published_document = published
  remote.trials = [{ request_id: 'trial-ready', revision: 1, workflow_id: 'flow', run_id: 'run-ready', status: 'succeeded', created_at: '2026-09-24T00:00:00Z' }]
  getBusinessCapabilityCatalog.mockResolvedValueOnce({
    version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [{
      id: capabilityId, name: '调整报价明细', description: '按授权调整报价明细', effect: 'write', resourceType: 'forge_quote', requiresEmployeeIntent: true,
      status: 'unavailable', unavailableReason: '数组缺少条目结构，当前不能绑定/执行', actionName: 'update_lines', objectName: 'forge_quote',
      params: [{ name: 'lines', label: '明细', type: 'array' }],
    }],
  })

  await open()
  await selectMember('审核员')
  await click('能力')
  expect(container.textContent).toContain('数组缺少条目结构，当前不能绑定/执行')
  const changeNote = container.querySelector<HTMLButtonElement>('.tw-change-note')
  expect(changeNote).not.toBeNull()
  await act(async () => changeNote!.click())
  const update = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '更新团队')
  expect(update?.disabled).toBe(true)

  await click('返回对象详情')
  await click('能力')
  const remove = container.querySelector<HTMLButtonElement>('.member-capability-assigned__actions button[aria-label="移除调整报价明细"]')
  expect(remove?.disabled).toBe(false)
  await act(async () => remove!.click())
  expect(container.querySelector('.member-capability-assigned')).toBeNull()
  expect(container.textContent).toContain('当前成员没有配置业务动作')
})
it('keeps unassigned actions in the picker and requires a valid binding for native multiple files', async () => {
  const actionId = 'forge:action:sales_contract.ContractSubmit'
  getBusinessCapabilityCatalog.mockResolvedValueOnce({
    version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '',
    capabilities: [
      { id: actionId, name: '提交指定合同版本', description: '提交冻结合同文件', effect: 'write', resourceType: 'sales_contract',
        requiresEmployeeIntent: true, status: 'available', actionName: 'ContractSubmit', objectName: 'sales_contract',
        requiresRecord: true, params: [
          { name: 'primary_file_id', label: '主文件', type: 'file', required: true },
          { name: 'material_file_ids', label: '全部材料', type: 'file', multiple: true, required: true },
        ] },
      { id: 'forge:action:sales_lead.convert', name: '转为商机', description: '转换已授权线索', effect: 'write',
        resourceType: 'sales_lead', requiresEmployeeIntent: true, status: 'available', actionName: 'convert',
        objectName: 'sales_lead', requiresRecord: true },
    ],
  })
  await open()
  await selectMember('审核员')
  await click('能力')
  expect(container.textContent).not.toContain('提交指定合同版本')
  await click('添加业务动作')
  expect(document.body.textContent).toContain('提交指定合同版本')
  await click('添加到成员')
  expect(container.textContent).toContain('提交指定合同版本')
  expect(container.textContent).not.toContain('转为商机')
  expect(container.textContent).toContain('多文件参数须绑定“本次提交的全部文件”')
  expect(container.textContent).toContain('默认由 Pi 从本次材料中选择一份；清单外文件不可选。')
  await chooseProductOption('全部材料来源', '本次提交的全部文件')
  await saveSoon()
  expect(remote.document.members[1]!.configuration.businessCapabilityBindings).toEqual([{
    capabilityId: actionId, parameters: [{ name: 'material_file_ids', source: 'materials.ids' }],
  }])
  await chooseProductOption('全部材料来源', '请选择文件来源')
  await saveSoon()
  expect(remote.document.members[1]!.configuration.businessCapabilityBindings).toEqual([])
})
it('excludes both system idempotency parameters from the business material selectors', async () => {
  const actionId = 'forge:action:sales_contract.ContractSubmit'
  remote.document.members[1]!.configuration.businessCapabilityIds = [actionId]
  getBusinessCapabilityCatalog.mockResolvedValueOnce({
    version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [{
      id: actionId, name: '提交合同', description: '提交本轮材料', effect: 'write', resourceType: 'sales_contract', requiresEmployeeIntent: true, status: 'available', actionName: 'ContractSubmit', objectName: 'sales_contract', params: [
        { name: 'idempotency_key', label: '防重复提交参数', type: 'string', required: true },
        { name: 'idempotencyKey', label: '备用防重复提交参数', type: 'string' },
        { name: 'material_summary', label: '材料摘要', type: 'string' },
      ],
    }],
  })
  await open(); await selectMember('审核员'); await click('能力'); await click('配置输入')
  expect(container.textContent).not.toContain('idempotency')
  expect(container.querySelector('[aria-label="防重复提交参数来源"]')).toBeNull()
  expect(container.querySelector('[aria-label="备用防重复提交参数来源"]')).toBeNull()
  await chooseProductOption('材料摘要来源', '本次材料清单')
  await saveSoon()
  expect(remote.document.members[1]!.configuration.businessCapabilityBindings).toEqual([{ capabilityId: actionId, parameters: [{ name: 'material_summary', source: 'materials.manifest_json' }] }])
})

it('requires removal of old system mappings before update or trial and preserves valid material mappings', async () => {
  const actionId = 'forge:action:sales_contract.ContractSubmit', worker = remote.document.members[1]!
  worker.configuration.businessCapabilityIds = [actionId]
  worker.configuration.businessCapabilityBindings = [{ capabilityId: actionId, parameters: [
    { name: 'idempotency_key', source: 'materials.single.sha256' },
    { name: 'idempotencyKey', source: 'materials.manifest_json' },
    { name: 'material_summary', source: 'materials.manifest_json' },
  ] }]
  remote.published_document = structuredClone(remote.document)
  remote.published_document.members[1]!.configuration.businessCapabilityBindings = []
  remote.trials = [{ request_id: 'old-success', revision: 1, workflow_id: 'flow', run_id: 'old-run', status: 'succeeded', created_at: '' }]
  getBusinessCapabilityCatalog.mockResolvedValueOnce({
    version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [{
      id: actionId, name: '提交合同', description: '提交本轮材料', effect: 'write', resourceType: 'sales_contract', requiresEmployeeIntent: true, status: 'available', actionName: 'ContractSubmit', objectName: 'sales_contract', params: [{ name: 'material_summary', label: '材料摘要', type: 'string' }],
    }],
  })
  await open(); await selectMember('审核员'); await click('能力')
  expect(container.textContent).toContain('系统托管的防重复提交参数不能绑定材料，请移除旧映射')
  expect(container.textContent).not.toContain('idempotency')
  await act(async () => container.querySelector<HTMLButtonElement>('.tw-change-note')!.click())
  expect([...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '更新团队')?.disabled).toBe(true)
  await click('工作流程'); await click('调试此流程'); await edit('测试输入', '核对当前材料'); await click('开始调试')
  expect(container.textContent).toContain('移除旧映射后再调试')
  expect(call.mock.calls.some(([command]) => command.action === 'trial')).toBe(false)
  await click('团队分工'); await selectMember('审核员'); await click('能力'); await click('移除系统参数映射'); await saveSoon()
  expect(remote.document.members[1]!.configuration.businessCapabilityBindings).toEqual([{ capabilityId: actionId, parameters: [{ name: 'material_summary', source: 'materials.manifest_json' }] }])
  expect(container.textContent).not.toContain('系统托管的防重复提交参数不能绑定材料')
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
it('keeps the explicitly selected executor through save and a fresh read', async () => {
  const reviewer = newMember('deepseek-flash')
  reviewer.configuration.displayName = '复核员'
  remote.document.members.push(reviewer)
  await open(); await click('工作流程'); await click('编辑步骤 审核员')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="执行成员"]')?.textContent).toContain('审核员')
  await chooseProductOption('执行成员', '复核员'); await saveSoon()
  expect(remote.document.workflows[0].graph_definition.nodes.find((node) => node.id === 'work')?.config?.agent_id).toBe(reviewer.id)

  await act(async () => root.render(null)); await open(); await click('工作流程'); await click('编辑步骤 审核员')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="执行成员"]')?.textContent).toContain('复核员')
  expect(remote.document.workflows[0].graph_definition.nodes.find((node) => node.id === 'work')?.config?.agent_id).toBe(reviewer.id)
})
it('shows an unavailable executor and blocks save without discarding local edits', async () => {
  const workflow = remote.document.workflows[0]
  workflow.graph_definition.nodes = workflow.graph_definition.nodes.map((node) => node.id === 'work' ? { ...node, config: { ...node.config, agent_id: 'removed-member' } } : node)
  await open(); await click('工作流程'); await click('编辑步骤 审核员')
  expect(container.textContent).toContain('原执行成员不可用')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="执行成员"]')?.textContent).toContain('原执行成员不可用')
  await click('编辑步骤名称内容'); await edit('步骤名称', '修订后的审核步骤'); await saveSoon()
  expect(call.mock.calls.filter(([command]) => command.action === 'save')).toHaveLength(0)
  expect(remote.document.workflows[0].graph_definition.nodes.find((node) => node.id === 'work')?.config?.agent_id).toBe('removed-member')
  expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('修订后的审核步骤')
  expect(container.textContent).toContain('请重新选择执行成员')
})
it('inserts the selected responsible member instead of silently replacing it with the first worker', async () => {
  await open(); await click('工作流程'); await click('编辑步骤 审核员'); await click('在此后添加'); await click('串行步骤')
  await chooseProductOption('由谁执行', '负责人')
  await edit('步骤名称', '负责人复核'); await edit('这一步完成什么工作', '汇总并复核前一步结果。')
  await click('添加步骤')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="执行成员"]')?.textContent).toContain('负责人')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="编辑步骤 负责人复核"]')?.textContent).toContain('负责人')
  expect(container.textContent).toContain('汇总并复核前一步结果。')
})
it('adds parallel dispatch members and lets the lead summarize after the join', async () => {
  const delivery = newMember('deepseek-flash')
  delivery.configuration.displayName = '交付检查员'
  remote.document.members.push(delivery)

  await open(); await click('工作流程'); await click('编辑步骤 审核员'); await click('在此后添加'); await click('并行分支')
  await chooseProductOption('由谁执行', '交付检查员')
  await edit('步骤名称', '交付检查'); await edit('这一步完成什么工作', '核对交付范围与验收标准，并引用原文。')
  await click('添加步骤')

  await click('编辑步骤 交付检查'); await click('分支操作')
  expect([...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())).toEqual(['并行分支'])
  await click('编辑步骤 并行分工'); await click('并行后续操作'); await click('汇合后串行步骤')
  await chooseProductOption('由谁执行', '负责人')
  await edit('步骤名称', '合同结果汇总'); await edit('这一步完成什么工作', '汇总两个并行检查结果，列出结论、原文依据和待确认项。')
  await click('添加步骤'); await saveSoon()

  const graph = remote.document.workflows[0]!.graph_definition
  const parallel = graph.nodes.find((node) => node.type === 'parallel')!
  const join = graph.nodes.find((node) => node.type === 'join')!
  const branchWorkers = graph.edges.filter((edge) => edge.from_node_id === parallel.id).map((edge) => graph.nodes.find((node) => node.id === edge.to_node_id)!)
  expect(branchWorkers.every((node) => node.type === 'worker' && node.config?.kind === 'dispatch')).toBe(true)
  const finalizer = graph.nodes.find((node) => node.label === '合同结果汇总')!
  expect(finalizer.type).toBe('lead')
  expect(finalizer.config?.instruction).toBe('汇总两个并行检查结果，列出结论、原文依据和待确认项。')
  expect(graph.edges).toContainEqual(expect.objectContaining({ from_node_id: join.id, to_node_id: finalizer.id, route: 'success' }))
  expect(graph.nodes.find((node) => node.type === 'deliver')?.config?.result).toMatchObject({ node_id: finalizer.id })
})
it('requires an explicit executor selection before adding a step', async () => {
  await open(); await click('工作流程'); await click('编辑步骤 审核员'); await click('在此后添加'); await click('串行步骤')
  expect(document.querySelector<HTMLButtonElement>('[aria-label="由谁执行"]')?.textContent).toContain('请选择执行成员')
  await edit('步骤名称', '待分配步骤'); await edit('这一步完成什么工作', '等待明确选择执行成员。')
  await click('添加步骤')
  expect(document.body.textContent).toContain('请选择执行成员后再添加步骤')
  expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('待分配步骤')
  expect([...container.querySelectorAll<HTMLButtonElement>('.workflow-graph__node')]).toHaveLength(3)
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
  await open(); await click('工作流程'); await click('调试此流程'); await edit('测试输入', '隔离调试材料')
  const start = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '开始调试')!
  await act(async () => { start.click(); start.click() })
  expect(call.mock.calls.filter(([command]) => command.action === 'trial')).toHaveLength(1)
  expect(runLabel('tool_started')).toBe('工具调用中')
  expect(runLabel('tool_completed')).toBe('工具调用完成')
  expect(runLabel('tool_failed')).toBe('工具调用失败')
})
