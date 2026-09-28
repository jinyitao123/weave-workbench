import { expect, it } from 'vitest'
import { newMember } from '../../src/pages/team-workspace/member'
import { canInsertSerialStep, configureWorkflowResultProtocol, initialGraph, insertStep, addParallelBranch, removeStep, serializeParallel, stripDerivedJoinOutput, validateWorkflowResultProtocol, WORKBENCH_RESULT_PROTOCOL } from '../../src/pages/team-workspace/graph'

const member = newMember('organization-model')
member.configuration.displayName = '问题分类员'
member.relationship.resultRequirement = '按产品模块分类并标明依据'
const lead = newMember('organization-model')
lead.configuration = { ...lead.configuration, displayName: '团队负责人', role: 'avatar', systemPrompt: '汇总各执行成员的结果。' }
it('builds Weave-compatible parallel legs and allows a lead finalizer after their join', () => {
  const graph = initialGraph(member)
  const branch = addParallelBranch(graph, 'work', member)
  const parallel = branch.graph.nodes.find((n) => n.type === 'parallel')!
  const join = branch.graph.nodes.find((n) => n.type === 'join')!
  const branchWorkers = branch.graph.nodes.filter((node) => node.type === 'worker' && branch.graph.edges.some((edge) => edge.to_node_id === node.id && edge.route === 'branch'))
  expect(branchWorkers).toHaveLength(2)
  expect(branchWorkers.every((node) => node.config?.kind === 'dispatch')).toBe(true)
  expect(canInsertSerialStep(branch.graph, branch.selected)).toBe(false)
  expect(canInsertSerialStep(branch.graph, parallel.id)).toBe(true)
  expect(branch.graph.edges.filter((e) => e.from_node_id === parallel.id).every((e) => e.route === 'branch')).toBe(true)
  expect(branch.graph.edges.filter((e) => e.to_node_id === join.id)).toHaveLength(2)
  expect(join.output).toBeUndefined()
  expect(() => insertStep(branch.graph, branch.selected, member)).toThrow('并行分支由单个成员直接进入汇合')
  const afterParallel = insertStep(branch.graph, parallel.id, lead)
  const finalizer = afterParallel.graph.nodes.find((node) => node.id === afterParallel.selected)!
  const finalizerInputs = finalizer.inputs as Record<string, unknown> | undefined
  expect(finalizer.type).toBe('lead')
  expect(finalizer.config?.instruction).toBe('汇总各执行成员的结果。')
  expect(finalizerInputs?.previous).toMatchObject({ value: { source: 'node_output', node_id: join.id }, expected_type: 'json' })
  expect(afterParallel.graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ from_node_id: join.id, to_node_id: afterParallel.selected, route: 'success' }),
  ]))
  expect(afterParallel.graph.nodes.find((node) => node.type === 'deliver')?.config?.result).toMatchObject({ node_id: afterParallel.selected })
  const withoutFinalizer = removeStep(afterParallel.graph, afterParallel.selected)
  expect(withoutFinalizer.nodes.some((node) => node.id === afterParallel.selected)).toBe(false)
  expect(withoutFinalizer.nodes.find((node) => node.type === 'deliver')?.config?.result).toMatchObject({ node_id: join.id })
  const third = addParallelBranch(branch.graph, parallel.id, member)
  const reduced = removeStep(third.graph, third.selected)
  expect(reduced.edges).toEqual(branch.graph.edges)
  const serial = serializeParallel(reduced, parallel.id)
  expect(serial.nodes.some((n) => n.type === 'parallel' || n.type === 'join')).toBe(false)
  expect(serial.edges.some((e) => e.from_node_id === 'work' && e.to_node_id === branch.selected)).toBe(true)
  expect(serial.nodes.filter((node) => node.type === 'worker').every((node) => node.config?.kind === 'consult')).toBe(true)
  expect(serial.nodes.find((n) => n.id === 'work')?.config?.result_requirement).toBe('按产品模块分类并标明依据')
})
it('moves legacy explicit join output into an unsaved, Weave-compatible desktop draft', () => {
  const graph = addParallelBranch(initialGraph(member), 'work', member).graph
  const join = graph.nodes.find((node) => node.type === 'join')!
  const legacy = { name: '团队', objective: '复核', members: [lead, member], workflows: [{ id: 'flow', name: '流程', description: '', trigger_config: {}, graph_definition: { ...graph, nodes: graph.nodes.map((node) => node.id === join.id ? { ...node, output: { type: 'json' } } : node) } }] }
  const normalized = stripDerivedJoinOutput(legacy)
  const normalizedJoin = normalized.document.workflows[0]!.graph_definition.nodes.find((node) => node.type === 'join')!
  expect(normalized.changed).toBe(true)
  expect(normalizedJoin.output).toBeUndefined()
  expect(stripDerivedJoinOutput(normalized.document).changed).toBe(false)
})
it('delivers the inserted final step and protects consumed outputs from deletion', () => {
  const inserted = insertStep(initialGraph(member), 'work', member)
  expect(inserted.graph.nodes.find((n) => n.type === 'deliver')?.config?.result).toMatchObject({ node_id: inserted.selected })
  expect(() => removeStep(inserted.graph, 'work')).toThrow('输入来源')
  const restored = removeStep(inserted.graph, inserted.selected)
  expect(restored.nodes.find((n) => n.type === 'deliver')?.config?.result).toMatchObject({ node_id: 'work' })
})

it('configures the optional result protocol only on a final direct member and restores its text contract', () => {
  const graph = initialGraph(member)
  const flow = { id: 'flow', name: '检查', description: '', trigger_config: {}, graph_definition: graph }
  const configured = configureWorkflowResultProtocol(flow, true)
  expect(configured.graph_definition.result_protocol).toBe(WORKBENCH_RESULT_PROTOCOL)
  expect(configured.graph_definition.output_contract).toMatchObject({ type: 'json', schema: { required: ['disposition', 'summary', 'missing_items'] } })
  expect(configured.graph_definition.nodes.find((node) => node.id === 'work')?.output).toMatchObject({ type: 'json', schema: { properties: { disposition: { enum: ['complete', 'needs_input'] } } } })
  expect(validateWorkflowResultProtocol(configured)).toBeUndefined()
  expect(configureWorkflowResultProtocol(configured, false).graph_definition).toMatchObject({ output_contract: { type: 'text' } })
  expect(configureWorkflowResultProtocol(configured, false).graph_definition.result_protocol).toBeUndefined()
  expect(configured.graph_definition.result_protocol).toBe(WORKBENCH_RESULT_PROTOCOL)

  expect(() => configureWorkflowResultProtocol(flow, true, 'lead')).toThrow('直接连接交付步骤')
  const parallel = addParallelBranch(graph, 'work', member).graph
  const join = parallel.nodes.find((node) => node.type === 'join')!
  const fromJoin = { ...flow, graph_definition: { ...parallel, nodes: parallel.nodes.map((node) => node.type === 'deliver' ? { ...node, config: { ...node.config, result: { source: 'node_output', node_id: join.id, path: '' } } } : node) } }
  expect(() => configureWorkflowResultProtocol(fromJoin, true)).toThrow('并行汇合后添加负责人或成员汇总步骤')

  const custom = { ...flow, graph_definition: { ...graph, output_contract: { type: 'json', schema: { type: 'object' } } } }
  expect(() => configureWorkflowResultProtocol(custom, true)).toThrow('桌面不会覆盖它')
  const changedContract = { ...configured, graph_definition: { ...configured.graph_definition, output_contract: { type: 'json', schema: { type: 'object' } } } }
  expect(() => configureWorkflowResultProtocol(changedContract, false)).toThrow('保留现有格式')
  expect(changedContract.graph_definition.output_contract).toEqual({ type: 'json', schema: { type: 'object' } })
})

it('moves the protocol to a serial final member, preserves it for an upstream branch, and repairs delivery after deletion', () => {
  const initial = initialGraph(member)
  const flow = { id: 'flow', name: '检查', description: '', trigger_config: {}, graph_definition: initial }
  const first = insertStep(initial, 'work', member)
  const firstFlow = configureWorkflowResultProtocol({ ...flow, graph_definition: first.graph }, true)
  const previousSourceId = first.selected
  const second = insertStep(firstFlow.graph_definition, first.selected, member)
  const serial = configureWorkflowResultProtocol({ ...firstFlow, graph_definition: second.graph }, true, undefined, previousSourceId)
  const deliverySource = serial.graph_definition.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: string }
  expect(deliverySource.node_id).toBe(second.selected)
  expect(serial.graph_definition.nodes.find((node) => node.id === first.selected)?.output).toMatchObject({ type: 'text' })
  expect(serial.graph_definition.nodes.find((node) => node.id === second.selected)?.output).toMatchObject({ type: 'json' })

  const branchedGraph = addParallelBranch(serial.graph_definition, 'work', member).graph
  const branched = configureWorkflowResultProtocol({ ...serial, graph_definition: branchedGraph }, true, undefined, second.selected)
  const branchDelivery = branched.graph_definition.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: string }
  expect(branchDelivery.node_id).toBe(second.selected)
  expect(branched.graph_definition.nodes.find((node) => node.id === second.selected)?.output).toMatchObject({ type: 'json' })

  const removedGraph = removeStep(branched.graph_definition, second.selected)
  const repaired = configureWorkflowResultProtocol({ ...branched, graph_definition: removedGraph }, true, undefined, second.selected)
  const repairedSourceId = (repaired.graph_definition.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: string } | undefined)?.node_id
  expect(repairedSourceId).toBe(first.selected)
  expect(repaired.graph_definition.nodes.some((node) => node.id === repairedSourceId)).toBe(true)
  expect(repaired.graph_definition.nodes.find((node) => node.id === repairedSourceId)?.output).toMatchObject({ type: 'json' })
})
