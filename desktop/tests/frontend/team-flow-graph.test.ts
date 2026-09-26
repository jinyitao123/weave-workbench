import { expect, it } from 'vitest'
import { newMember } from '../../src/pages/team-workspace/member'
import { canInsertSerialStep, initialGraph, insertStep, addParallelBranch, removeStep, serializeParallel, stripDerivedJoinOutput } from '../../src/pages/team-workspace/graph'

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
