// @vitest-environment jsdom
// Behaviour of the team development sidebar (团队分工 / 工作流) against one remote draft.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamDevelopmentInspector } from '../../src/components/inspector/TeamDevelopmentInspector'
import { newMember } from '../../src/pages/team-workspace/member'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import { runLabel } from '../../src/pages/team-workspace/TrialPanel'
import type { EnterpriseBusinessCapabilityCatalog, EnterpriseDevelopmentOverview, PrimeWorkApi, RuntimeInfo } from '../../src/types/api'
import type { TeamWorkspace, TeamWorkspaceCommand } from '../../src/types/team-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement, remote: TeamWorkspace, accountId = ''
let testRun = 0
let failNextTrial = false
const overview: EnterpriseDevelopmentOverview = { version: '1', loadedAt: '', runtimes: [], models: ['deepseek-flash'], teams: [{ id: 'team', name: '合同团队', status: 'active', updatedAt: '', workflows: [], runs: [], workers: [] }] }
const call = vi.fn(async (command: TeamWorkspaceCommand): Promise<unknown> => {
  if (command.action === 'save') { if (command.revision !== remote.revision) throw new Error('草稿冲突'); remote = { ...remote, revision: remote.revision + 1, document: command.document } }
  if (command.action === 'trial' && failNextTrial) { failNextTrial = false; throw new Error('传输结果待核对') }
  return structuredClone(remote)
})
const getBusinessCapabilityCatalog = vi.fn(async (): Promise<EnterpriseBusinessCapabilityCatalog> => ({ version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [], refreshedAt: '' }))
const invalidateTeamDevelopmentTurn = vi.fn(async (_runtimeId: string) => {})
const enterprise = { teamWorkspace: call, createDevelopmentTeam: vi.fn(), getBusinessCapabilityCatalog, updateTeamDevelopment: vi.fn(async () => {}), invalidateTeamDevelopmentTurn, getTeamDevelopmentState: vi.fn(async () => ({})) } as unknown as PrimeWorkApi['enterprise']
const agent = { onEvent: () => () => {} } as unknown as PrimeWorkApi['agent']

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')]
async function click(label: string) {
  const button = buttons().find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  await act(async () => button.click())
}
async function edit(label: string, value: string) {
  const input = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].find((item) => item.getAttribute('aria-label') === label || item.closest('label, .product-field')?.textContent?.includes(label))
  if (!input) throw new Error(`Missing field ${label}`)
  await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function open(view: 'division' | 'workflow' = 'division', runtime?: RuntimeInfo, teamOverview = overview) { await act(async () => root.render(<TeamDevelopmentInspector enterprise={enterprise} agent={agent} accountId={accountId} runtime={runtime} overview={teamOverview} loading={false} onRefresh={() => {}} view={view}/>)) }
async function selectMember(name: string) { await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.team-member-list button')].find((b) => b.textContent?.includes(name))!.click()) }
async function save() { await click('保存草稿') }
const publishButton = () => buttons().find((button) => button.textContent?.trim() === '更新团队')
async function chooseProductOption(label: string, name: string) {
  await click(label)
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((button) => button.textContent?.includes(name))
  if (!option) throw new Error(`Missing option: ${name}`)
  await act(async () => option.click())
}
const contractAction = (params: NonNullable<EnterpriseBusinessCapabilityCatalog['capabilities'][number]['params']>) => ({ id: 'forge:action:sales_contract.ContractSubmit', name: '提交合同', description: '提交本轮材料', effect: 'write' as const, resourceType: 'sales_contract', requiresEmployeeIntent: true, status: 'available' as const, actionName: 'ContractSubmit', objectName: 'sales_contract', params })

beforeEach(() => {
  vi.clearAllMocks()
  failNextTrial = false
  // Unsaved drafts survive remounts per account; a fresh account keeps tests independent.
  accountId = `developer-${++testRun}`
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration = { ...lead.configuration, displayName: '负责人', role: 'avatar' }; worker.configuration.displayName = '审核员'
  remote = { revision: 1, published_revision: 0, publishing_revision: 0, prepared_revision: 0, updated_at: '', trials: [], document: { name: '合同团队', objective: '审核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '合同审核', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] } }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

it('edits team details and a member, then saves one remote draft', async () => {
  await open()
  expect(container.querySelector('.team-member-list')).not.toBeNull()
  expect(container.querySelector('textarea')).toBeNull()
  await click('编辑')
  await edit('团队目标', '逐条核对原文')
  await click('编辑可用人群内容'); await edit('可用人群', 'sales_employee\ndelivery_reviewer\nsales_employee')
  await click('确定')
  await selectMember('审核员'); await click('编辑团队职责内容'); await edit('团队职责', '检查付款条款')
  await save()
  expect(remote.document.members[1]!.relationship.duty).toBe('检查付款条款')
  expect(remote.document.objective).toBe('逐条核对原文')
  expect(remote.document.audience).toEqual(['sales_employee', 'delivery_reviewer'])
})

it('invalidates the current Pi request when the UI switches team or edits an unsaved document during streaming', async () => {
  const otherTeam = { id: 'other-team', name: '其他团队', status: 'active' as const, updatedAt: '', workflows: [], runs: [], workers: [] }
  const runtime = { runtimeId: 'pi-runtime', isStreaming: true, cwd: '/work' } as RuntimeInfo
  await open('division', runtime, { ...overview, teams: [...overview.teams, otherTeam] })
  await chooseProductOption('团队', '其他团队')
  expect(invalidateTeamDevelopmentTurn).toHaveBeenCalledWith('pi-runtime')
  const count = invalidateTeamDevelopmentTurn.mock.calls.length
  await click('编辑')
  await edit('团队目标', '未保存的界面目标修改')
  await click('确定')
  expect(invalidateTeamDevelopmentTurn.mock.calls.length).toBeGreaterThan(count)
  expect(invalidateTeamDevelopmentTurn.mock.calls.every(([runtimeId]) => runtimeId === 'pi-runtime')).toBe(true)
  expect(enterprise.updateTeamDevelopment).not.toHaveBeenCalled()
})

it.each([false, true])('keeps newer editor focus when delayed member-navigation focus arrives (editing=%s)', async (editing) => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  try {
    await open(); await selectMember('审核员')
    if (editing) await click('编辑团队职责内容')
    const editor = container.querySelector<HTMLTextAreaElement>('.tw-editable.is-editing textarea')
    if (editing) expect(document.activeElement).toBe(editor)
    const pending = [...frames.values()]; frames.clear()
    await act(async () => { for (const callback of pending) callback(0) })
    if (editing) {
      expect(container.querySelector('.tw-editable.is-editing textarea')).toBe(editor)
      expect(document.activeElement).toBe(editor)
      await edit('团队职责', '检查付款条款'); await save()
      expect(remote.document.members[1]!.relationship.duty).toBe('检查付款条款')
    } else expect(document.activeElement).toBe(container.querySelector('.team-panel__detail-head h3'))
  } finally { vi.unstubAllGlobals() }
})

it('opens the workflow view on the flow canvas', async () => {
  await open('workflow')
  expect(container.querySelector('.workflow-graph')).not.toBeNull()
  expect(container.textContent).toContain('合同审核')
})

it('marks an unavailable action, keeps it removable, and blocks update', async () => {
  const capabilityId = 'forge:action:forge_quote.update_lines'
  remote.document.members[1]!.configuration.businessCapabilityIds = [capabilityId]
  remote.trials = [{ request_id: 'trial-ready', revision: 1, workflow_id: 'flow', run_id: 'run-ready', status: 'succeeded', created_at: '2026-09-24T00:00:00Z' }]
  getBusinessCapabilityCatalog.mockResolvedValueOnce({
    version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [{
      id: capabilityId, name: '调整报价明细', description: '按授权调整报价明细', effect: 'write', resourceType: 'forge_quote', requiresEmployeeIntent: true,
      status: 'unavailable', unavailableReason: '数组缺少条目结构，当前不能绑定/执行', actionName: 'update_lines', objectName: 'forge_quote',
      params: [{ name: 'lines', label: '明细', type: 'array' }],
    }],
  })
  await open(); await selectMember('审核员')
  expect(container.textContent).toContain('数组缺少条目结构，当前不能绑定/执行')
  expect(publishButton()?.disabled).toBe(true)
  expect(container.textContent).toContain('有不可用的业务动作')
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
      { ...contractAction([{ name: 'primary_file_id', label: '主文件', type: 'file', required: true }, { name: 'material_file_ids', label: '全部材料', type: 'file', multiple: true, required: true }]), name: '提交指定合同版本', requiresRecord: true },
      { id: 'forge:action:sales_lead.convert', name: '转为商机', description: '转换已授权线索', effect: 'write', resourceType: 'sales_lead', requiresEmployeeIntent: true, status: 'available', actionName: 'convert', objectName: 'sales_lead', requiresRecord: true },
    ],
  })
  await open(); await selectMember('审核员')
  expect(container.textContent).not.toContain('提交指定合同版本')
  await click('添加业务动作')
  expect(document.body.textContent).toContain('提交指定合同版本')
  await click('添加到成员')
  expect(container.textContent).toContain('提交指定合同版本')
  expect(container.textContent).not.toContain('转为商机')
  expect(container.textContent).toContain('多文件参数须绑定“本次提交的全部文件”')
  expect(container.textContent).not.toContain('material_file_ids')
  await chooseProductOption('全部材料来源', '本次提交的全部文件'); await save()
  expect(remote.document.members[1]!.configuration.businessCapabilityBindings).toEqual([{ capabilityId: actionId, parameters: [{ name: 'material_file_ids', source: 'materials.ids' }] }])
  await chooseProductOption('全部材料来源', '请选择文件来源'); await save()
  expect(remote.document.members[1]!.configuration.businessCapabilityBindings).toEqual([])
})

it('excludes both system idempotency parameters from the business material selectors', async () => {
  const action = contractAction([{ name: 'idempotency_key', label: '防重复提交参数', type: 'string', required: true }, { name: 'idempotencyKey', label: '备用防重复提交参数', type: 'string' }, { name: 'material_summary', label: '材料摘要', type: 'string' }])
  remote.document.members[1]!.configuration.businessCapabilityIds = [action.id]
  getBusinessCapabilityCatalog.mockResolvedValueOnce({ version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [action] })
  await open(); await selectMember('审核员'); await click('配置输入')
  expect(container.textContent).not.toContain('idempotency')
  expect(container.querySelector('[aria-label="防重复提交参数来源"]')).toBeNull()
  expect(container.querySelector('[aria-label="备用防重复提交参数来源"]')).toBeNull()
  await chooseProductOption('材料摘要来源', '本次材料清单'); await save()
  expect(remote.document.members[1]!.configuration.businessCapabilityBindings).toEqual([{ capabilityId: action.id, parameters: [{ name: 'material_summary', source: 'materials.manifest_json' }] }])
})

it('requires removal of old system mappings before update or trial and preserves valid material mappings', async () => {
  const action = contractAction([{ name: 'material_summary', label: '材料摘要', type: 'string' }]), worker = remote.document.members[1]!
  worker.configuration.businessCapabilityIds = [action.id]
  worker.configuration.businessCapabilityBindings = [{ capabilityId: action.id, parameters: [
    { name: 'idempotency_key', source: 'materials.single.sha256' },
    { name: 'idempotencyKey', source: 'materials.manifest_json' },
    { name: 'material_summary', source: 'materials.manifest_json' },
  ] }]
  remote.trials = [{ request_id: 'old-success', revision: 1, workflow_id: 'flow', run_id: 'old-run', status: 'succeeded', created_at: '' }]
  getBusinessCapabilityCatalog.mockResolvedValueOnce({ version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [action] })
  await open(); await selectMember('审核员')
  expect(container.textContent).toContain('系统托管的防重复提交参数不能绑定材料，请移除旧映射')
  expect(container.textContent).not.toContain('idempotency')
  expect(publishButton()?.disabled).toBe(true)

  await open('workflow'); await click('调试'); await edit('测试输入', '核对当前材料'); await click('开始调试')
  expect(container.textContent).toContain('移除旧映射后再调试')
  expect(call.mock.calls.some(([command]) => command.action === 'trial')).toBe(false)

  await open('division'); await selectMember('审核员'); await click('移除系统参数映射'); await save()
  expect(remote.document.members[1]!.configuration.businessCapabilityBindings).toEqual([{ capabilityId: action.id, parameters: [{ name: 'material_summary', source: 'materials.manifest_json' }] }])
  expect(container.textContent).not.toContain('系统托管的防重复提交参数不能绑定材料')
})

it('confirms before removing a member and blocks removal while a step still uses it', async () => {
  const spare = newMember('deepseek-flash'); spare.configuration.displayName = '备用审核员'; remote.document.members.push(spare)
  await open(); await selectMember('审核员'); await click('成员操作'); await click('移出团队')
  expect(document.body.textContent).toContain('把“审核员”移出团队？')
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((button) => button.textContent === '移出团队')!.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('该成员仍被流程步骤使用')
  expect(remote.document.members).toHaveLength(3)
  await open('workflow')
  expect(buttons().some((button) => button.textContent?.trim() === '新建流程')).toBe(false)
  expect(container.querySelector('.workflow-graph')).not.toBeNull()
})

it('shows actual flow links and material bindings, and invalidates old trial approval', async () => {
  remote.trials = [{ request_id: 'old', revision: 1, workflow_id: 'flow', run_id: 'run', status: 'succeeded', created_at: '2026-09-22T00:00:00Z' }]
  await open('workflow')
  expect(publishButton()?.disabled).toBe(false)
  await click('编辑步骤 审核员')
  expect(container.querySelectorAll('.workflow-graph>svg>path').length).toBe(2)
  const toggle = [...container.querySelectorAll<HTMLButtonElement>('.tw-source-list button')].find((b) => b.textContent?.startsWith('本次任务输入'))!
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  await act(async () => toggle.click())
  expect(publishButton()).toBeUndefined()
  await save()
  expect(JSON.stringify(remote.document.workflows[0]!.graph_definition.nodes.find((n) => n.id === 'work')!.inputs)).not.toContain('run_input')
  expect(publishButton()?.disabled).toBe(true)
  expect(container.textContent).toContain('流程“合同审核”还需通过当前草稿的试跑。')
})

it('keeps the explicitly selected executor through save and a fresh read', async () => {
  const reviewer = newMember('deepseek-flash')
  reviewer.configuration.displayName = '复核员'
  remote.document.members.push(reviewer)
  await open('workflow'); await click('编辑步骤 审核员')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="执行成员"]')?.textContent).toContain('审核员')
  await chooseProductOption('执行成员', '复核员'); await save()
  expect(remote.document.workflows[0]!.graph_definition.nodes.find((node) => node.id === 'work')?.config?.agent_id).toBe(reviewer.id)

  await act(async () => root.render(null)); await open('workflow'); await click('编辑步骤 审核员')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="执行成员"]')?.textContent).toContain('复核员')
})

it('shows an unavailable executor and refuses to save without discarding local edits', async () => {
  const workflow = remote.document.workflows[0]!
  workflow.graph_definition.nodes = workflow.graph_definition.nodes.map((node) => node.id === 'work' ? { ...node, config: { ...node.config, agent_id: 'removed-member' } } : node)
  await open('workflow'); await click('编辑步骤 审核员')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="执行成员"]')?.textContent).toContain('原执行成员不可用')
  expect(container.textContent).toContain('请重新选择执行成员')
  await click('编辑交付要求内容'); await edit('交付要求', '修订后的审核要求'); await save()
  expect(call.mock.calls.filter(([command]) => command.action === 'save')).toHaveLength(0)
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('请重新选择执行成员后再保存')
  expect(container.textContent).toContain('修改尚未保存')
})

it('inserts the selected responsible member instead of silently replacing it with the first worker', async () => {
  await open('workflow'); await click('编辑步骤 审核员'); await click('添加下一步')
  await chooseProductOption('由谁执行', '负责人')
  await edit('步骤名称', '负责人复核'); await edit('工作要求', '汇总并复核前一步结果。')
  await click('添加步骤')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="执行成员"]')?.textContent).toContain('负责人')
  expect(container.querySelector<HTMLButtonElement>('[aria-label="编辑步骤 负责人复核"]')?.textContent).toContain('负责人')
  expect(container.textContent).toContain('汇总并复核前一步结果。')
})

it('adds parallel dispatch members and lets the lead summarize after the join', async () => {
  const delivery = newMember('deepseek-flash')
  delivery.configuration.displayName = '交付检查员'
  remote.document.members.push(delivery)
  await open('workflow'); await click('编辑步骤 审核员'); await click('添加并行分支')
  await chooseProductOption('由谁执行', '交付检查员')
  await edit('步骤名称', '交付检查'); await edit('工作要求', '核对交付范围与验收标准，并引用原文。')
  await click('添加步骤')

  await click('编辑步骤 交付检查')
  expect(buttons().some((button) => button.textContent?.trim() === '添加下一步')).toBe(false)
  expect(buttons().some((button) => button.textContent?.trim() === '添加并行分支')).toBe(true)
  await click('编辑步骤 并行分工'); await click('汇合后添加步骤')
  await chooseProductOption('由谁执行', '负责人')
  await edit('步骤名称', '合同结果汇总'); await edit('工作要求', '汇总两个并行检查结果，列出结论、原文依据和待确认项。')
  await click('添加步骤'); await save()

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
  await open('workflow'); await click('编辑步骤 审核员'); await click('添加下一步')
  expect(document.querySelector<HTMLButtonElement>('[aria-label="由谁执行"]')?.textContent).toContain('请选择执行成员')
  await edit('步骤名称', '待分配步骤'); await edit('工作要求', '等待明确选择执行成员。')
  expect(buttons().find((button) => button.textContent === '添加步骤')?.disabled).toBe(true)
  expect(document.querySelector<HTMLInputElement>('.modal input')?.value).toBe('待分配步骤')
  expect([...container.querySelectorAll<HTMLButtonElement>('.workflow-graph__node')]).toHaveLength(3)
})

it('only saves the clicked snapshot and retains edits made while it is in flight', async () => {
  await open(); await click('编辑成员名称内容')
  let complete!: () => void
  call.mockImplementationOnce(async (command) => { await new Promise<void>((r) => { complete = r }); if (command.action === 'save') remote = { ...remote, revision: 2, document: command.document }; return structuredClone(remote) })
  await edit('成员名称', '第一版'); await save()
  await edit('成员名称', '第二版'); await act(async () => complete())
  expect(container.textContent).toContain('修改尚未保存')
  expect(remote.document.members[0]!.configuration.displayName).toBe('第一版')
  expect(remote.revision).toBe(2)
  await save()
  expect(remote.document.members[0]!.configuration.displayName).toBe('第二版')
  expect(remote.revision).toBe(3)
})

it('does not store unsaved edits on a delay or unmount, and confirms before discarding them', async () => {
  await open(); await click('编辑团队职责内容'); await edit('团队职责', '仅在页面中编辑')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)) })
  expect(call.mock.calls.filter(([command]) => command.action === 'save')).toHaveLength(0)
  await click('放弃修改')
  expect(document.body.textContent).toContain('未保存的修改将会丢失')
  await click('取消')
  expect(container.textContent).toContain('修改尚未保存')
  await act(async () => root.render(null))
  expect(call.mock.calls.filter(([command]) => command.action === 'save')).toHaveLength(0)
})

it('prevents duplicate trial submission and names tool completion states', async () => {
  await open('workflow'); await click('调试'); await edit('测试输入', '隔离调试材料')
  const start = buttons().find((button) => button.textContent === '开始调试')!
  await act(async () => { start.click(); start.click() })
  expect(call.mock.calls.filter(([command]) => command.action === 'trial')).toHaveLength(1)
  expect(runLabel('tool_started')).toBe('工具调用中')
  expect(runLabel('tool_completed')).toBe('工具调用完成')
  expect(runLabel('tool_failed')).toBe('工具调用失败')
})

it('keeps candidate actions closed by default and retries one fixed simulation scope', async () => {
  const action = contractAction([])
  remote.document.members[1]!.configuration.businessCapabilityIds = [action.id]
  getBusinessCapabilityCatalog.mockResolvedValueOnce({ version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [action], refreshedAt: '' })
  failNextTrial = true
  await open('workflow'); await click('调试'); await edit('测试输入', '模拟合同检查')
  const actionChoice = container.querySelector<HTMLButtonElement>('.product-switch')
  expect(actionChoice?.getAttribute('aria-checked')).toBe('false')
  expect(actionChoice?.textContent).toContain('本次未开放')
  expect(container.textContent).not.toContain(action.id)
  await act(async () => actionChoice!.click())
  expect(container.querySelector<HTMLButtonElement>('.product-switch')?.getAttribute('aria-checked')).toBe('true')

  await click('开始调试')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('传输结果待核对')
  await click('重试本次提交')
  const trials = call.mock.calls.map(([command]) => command).filter((command) => command.action === 'trial')
  expect(trials).toHaveLength(2)
  expect(trials[0]!.requestId).toBe(trials[1]!.requestId)
  expect(trials[0]!.businessActions).toMatchObject([{ id: action.id, simulationAuthorized: true }])
  expect(trials[1]!.businessActions).toEqual(trials[0]!.businessActions)
})
