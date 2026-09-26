import type { EnterpriseWorkflowGraphDefinition as Graph } from '../../types/api'
import type { TeamDefinition } from '../../types/team-workspace'
export type Step = Graph['nodes'][number]
export type Binding = { value: { source: string; node_id?: string; path: string }; expected_type: string }
export function bindings(step: Step): Record<string, Binding> { return (step.inputs ?? {}) as Record<string, Binding> }
export function originalBinding(): Binding { return { value: { source: 'run_input', path: '' }, expected_type: 'text' } }
export function predecessors(graph: Graph, id: string): Step[] {
  const found = new Set<string>()
  const visit = (to: string) => { for (const edge of graph.edges.filter((e) => e.to_node_id === to)) { if (!found.has(edge.from_node_id)) { found.add(edge.from_node_id); visit(edge.from_node_id) } } }
  visit(id)
  return graph.nodes.filter((n) => found.has(n.id) && ['lead', 'worker', 'join'].includes(n.type))
}
export function isParallelBranchWorker(graph: Graph, id: string): boolean {
  const incoming = graph.edges.filter((edge) => edge.to_node_id === id)
  const outgoing = graph.edges.filter((edge) => edge.from_node_id === id)
  return incoming.length === 1 && incoming[0].route === 'branch' && outgoing.length === 1 && outgoing[0].route === 'join'
}
export function canInsertSerialStep(graph: Graph, id: string): boolean {
  const node = graph.nodes.find((item) => item.id === id)
  if (node?.type === 'parallel') {
    const join = String(node.config?.join_node_id ?? '')
    return graph.nodes.some((item) => item.id === join && item.type === 'join')
  }
  if (!node || !['lead', 'worker', 'join'].includes(node.type) || isParallelBranchWorker(graph, id)) return false
  return graph.edges.filter((edge) => edge.from_node_id === id).length === 1
}
export function initialGraph(member: TeamDefinition['members'][number]): Graph {
  return { schema_version: 1, entry_node_id: 'lead', input_contract: { type: 'text' }, output_contract: { type: 'text' }, nodes: [
    { id: 'lead', type: 'lead', label: '理解任务', config: { instruction: '理解任务输入与团队目标，明确分工和输出要求。' }, inputs: { original: originalBinding() }, output: { type: 'text' } },
    { id: 'work', type: 'worker', label: member.configuration.displayName, config: { kind: 'consult', agent_id: member.id, agent_version: 1, result_requirement: member.relationship.resultRequirement || '按照成员职责处理任务输入，返回结果和依据。' }, inputs: { original: originalBinding(), brief: { value: { source: 'node_output', node_id: 'lead', path: '' }, expected_type: 'text' } }, output: { type: 'text' } },
    { id: 'deliver', type: 'deliver', label: '交付结果', config: { result: { source: 'node_output', node_id: 'work', path: '' } } },
  ], edges: [{ id: 'a', from_node_id: 'lead', to_node_id: 'work', route: 'success' }, { id: 'b', from_node_id: 'work', to_node_id: 'deliver', route: 'success' }] }
}
export function stripDerivedJoinOutput(document: TeamDefinition): { document: TeamDefinition; changed: boolean } {
  let changed = false
  const workflows = document.workflows.map((flow) => {
    const nodes = flow.graph_definition.nodes.map((node) => {
      if (node.type !== 'join' || node.output === undefined) return node
      const { output: _output, ...derived } = node
      changed = true
      return derived as Step
    })
    return nodes === flow.graph_definition.nodes ? flow : { ...flow, graph_definition: { ...flow.graph_definition, nodes } }
  })
  return { document: changed ? { ...document, workflows } : document, changed }
}
function edge(from: string, to: string, route = 'success') { return { id: crypto.randomUUID(), from_node_id: from, to_node_id: to, route } }
function memberStep(member: TeamDefinition['members'][number], previous?: Step, workerKind: 'consult' | 'dispatch' = 'consult'): Step {
  const common = { id: `step-${crypto.randomUUID()}`, label: member.configuration.displayName, inputs: { original: originalBinding(), ...(previous && ['lead', 'worker', 'join'].includes(previous.type) ? { previous: { value: { source: 'node_output', node_id: previous.id, path: '' }, expected_type: previous.type === 'join' ? 'json' : 'text' } } : {}) }, output: { type: 'text' } }
  if (member.configuration.role === 'avatar') return { ...common, type: 'lead', config: { instruction: member.configuration.systemPrompt || member.relationship.resultRequirement || '汇总前序结果，按团队交付要求形成最终结果。' } }
  return { ...common, type: 'worker', config: { kind: workerKind, agent_id: member.id, agent_version: 1, result_requirement: member.relationship.resultRequirement || '按照成员职责处理任务输入，返回结果与依据。' } }
}
export function insertStep(graph: Graph, id: string, member: TeamDefinition['members'][number]): { graph: Graph; selected: string } {
  const previous = graph.nodes.find((n) => n.id === id)
  if (previous?.type === 'parallel') {
    const join = String(previous.config?.join_node_id ?? '')
    if (!graph.nodes.some((n) => n.id === join && n.type === 'join')) throw new Error('并行区域缺少汇合步骤')
    return insertStep(graph, join, member)
  }
  if (isParallelBranchWorker(graph, id)) throw new Error('并行分支由单个成员直接进入汇合；请选中“并行分工”，在汇合后添加串行步骤')
  const outgoing = graph.edges.filter((e) => e.from_node_id === id)
  if (!previous || !['lead', 'worker', 'join'].includes(previous.type) || outgoing.length !== 1) throw new Error('请选择连接完整的步骤后添加下一步')
  const next = memberStep(member, previous), after = outgoing[0].to_node_id
  const nextRoute = outgoing[0].route === 'join' ? 'join' : 'success'
  return { selected: next.id, graph: { ...graph, nodes: [...graph.nodes.map((n) => n.id === after && n.type === 'deliver' ? { ...n, config: { ...n.config, result: { source: 'node_output', node_id: next.id, path: '' } } } : n), next], edges: [...graph.edges.filter((e) => e !== outgoing[0]), edge(id, next.id), edge(next.id, after, nextRoute)] } }
}
export function addParallelBranch(graph: Graph, id: string, member: TeamDefinition['members'][number]): { graph: Graph; selected: string } {
  if (member.configuration.role !== 'worker' || !member.relationship.enabled) throw new Error('并行分支只能由已启用的执行成员负责')
  const node = graph.nodes.find((n) => n.id === id)
  if (node?.type === 'parallel') {
    const next = memberStep(member, undefined, 'dispatch'), join = String(node.config?.join_node_id ?? '')
    if (!graph.nodes.some((n) => n.id === join && n.type === 'join')) throw new Error('并行区域缺少汇合步骤')
    return { selected: next.id, graph: { ...graph, nodes: [...graph.nodes, next], edges: [...graph.edges, edge(id, next.id, 'branch'), edge(next.id, join, 'join')] } }
  }
  if (node?.type !== 'worker') throw new Error('请选择执行步骤，将它扩展为并行分工')
  const incoming = graph.edges.filter((e) => e.to_node_id === id), outgoing = graph.edges.filter((e) => e.from_node_id === id)
  if (incoming.length !== 1 || outgoing.length !== 1) throw new Error('该步骤连接不完整，请先调整流程')
  if (incoming[0].route === 'branch') return addParallelBranch(graph, incoming[0].from_node_id, member)
  const parallel = `parallel-${crypto.randomUUID()}`, join = `join-${crypto.randomUUID()}`, next = memberStep(member, graph.nodes.find((n) => n.id === incoming[0].from_node_id), 'dispatch')
  const existingDispatch = { ...node, config: { ...node.config, kind: 'dispatch' } }
  const nodes: Step[] = [...graph.nodes.map((item) => item.id === node.id ? existingDispatch : item), next, { id: parallel, type: 'parallel', label: '并行分工', config: { join_node_id: join } }, { id: join, type: 'join', label: '汇总分支', config: { policy: 'all_success' } }]
  // Existing consumers of this worker remain bound to it. A finalizer may also
  // select the new join result explicitly, instead of silently changing types.
  return { selected: next.id, graph: { ...graph, nodes, edges: [...graph.edges.filter((e) => e !== incoming[0] && e !== outgoing[0]), edge(incoming[0].from_node_id, parallel), edge(parallel, id, 'branch'), edge(parallel, next.id, 'branch'), edge(id, join, 'join'), edge(next.id, join, 'join'), edge(join, outgoing[0].to_node_id)] } }
}
export function removeStep(graph: Graph, id: string): Graph {
  const node = graph.nodes.find((n) => n.id === id), incoming = graph.edges.filter((e) => e.to_node_id === id), outgoing = graph.edges.filter((e) => e.from_node_id === id)
  if (!node || !['worker', 'lead'].includes(node.type) || id === graph.entry_node_id || incoming.length !== 1 || outgoing.length !== 1) throw new Error('请选择连接完整的执行步骤')
  const dependent = graph.nodes.filter((n) => n.id !== id && (Object.values(bindings(n)).some((b) => b.value?.node_id === id) || (incoming[0].route === 'branch' && (n.config?.result as { node_id?: string })?.node_id === id)))
  if (dependent.length) throw new Error(`请先调整“${dependent.map((n) => n.label || '执行步骤').join('、')}”的输入来源`)
  if (incoming[0].route === 'branch') {
    if (node.type !== 'worker') throw new Error('并行分支只能移除执行成员')
    const siblings = graph.edges.filter((e) => e.from_node_id === incoming[0].from_node_id)
    if (siblings.length <= 2) throw new Error('并行区域至少保留两个分支；可先将并行区域改为串行')
    const join = graph.nodes.find((n) => n.id === outgoing[0].to_node_id)
    if (Number(join?.config?.success_count ?? 0) > siblings.length - 1) throw new Error('请先降低汇合所需的成功分支数')
    return { ...graph, nodes: graph.nodes.filter((n) => n.id !== id), edges: graph.edges.filter((e) => e.from_node_id !== id && e.to_node_id !== id) }
  }
  const previous = incoming[0].from_node_id
  return { ...graph, nodes: graph.nodes.filter((n) => n.id !== id).map((n) => n.type === 'deliver' && (n.config?.result as { node_id?: string })?.node_id === id ? { ...n, config: { ...n.config, result: { source: 'node_output', node_id: previous, path: '' } } } : n), edges: [...graph.edges.filter((e) => e.from_node_id !== id && e.to_node_id !== id), edge(previous, outgoing[0].to_node_id)] }
}
export function serializeParallel(graph: Graph, id: string): Graph {
  const parallel = graph.nodes.find((n) => n.id === id), join = String(parallel?.config?.join_node_id ?? '')
  const branches = graph.edges.filter((e) => e.from_node_id === id).map((e) => e.to_node_id)
  const incoming = graph.edges.filter((e) => e.to_node_id === id), outgoing = graph.edges.filter((e) => e.from_node_id === join)
  if (parallel?.type !== 'parallel' || incoming.length !== 1 || outgoing.length !== 1 || !branches.length) throw new Error('并行区域连接不完整')
  if (graph.nodes.some((n) => Object.values(bindings(n)).some((b) => b.value?.node_id === join) || (n.config?.result as { node_id?: string })?.node_id === join)) throw new Error('请先将汇总结果的使用者改为读取各成员结果，再改为串行')
  const removed = new Set([id, join])
  const branchIds = new Set(branches)
  return { ...graph, nodes: graph.nodes.filter((n) => !removed.has(n.id)).map((node) => branchIds.has(node.id) && node.type === 'worker' ? { ...node, config: { ...node.config, kind: 'consult' } } : node), edges: [...graph.edges.filter((e) => !removed.has(e.from_node_id) && !removed.has(e.to_node_id)), edge(incoming[0].from_node_id, branches[0]), ...branches.slice(1).map((to, i) => edge(branches[i], to)), edge(branches[branches.length - 1], outgoing[0].to_node_id)] }
}
