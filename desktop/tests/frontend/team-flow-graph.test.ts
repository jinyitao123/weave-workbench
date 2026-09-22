import { expect, it } from 'vitest'
import { newMember } from '../../src/pages/team-workspace/member'
import { initialGraph, insertStep, addParallelBranch, removeStep, serializeParallel } from '../../src/pages/team-workspace/graph'

const member = newMember('organization-model')
member.configuration.displayName = '问题分类员'
member.relationship.resultRequirement = '按产品模块分类并标明依据'
it('supports non-contract teams with serial, parallel, and return-to-serial connections', () => {
  const graph = initialGraph(member)
  const branch = addParallelBranch(graph, 'work', member)
  const parallel = branch.graph.nodes.find((n) => n.type === 'parallel')!
  const join = branch.graph.nodes.find((n) => n.type === 'join')!
  expect(branch.graph.edges.filter((e) => e.from_node_id === parallel.id).every((e) => e.route === 'branch')).toBe(true)
  expect(branch.graph.edges.filter((e) => e.to_node_id === join.id)).toHaveLength(2)
  const insideBranch = insertStep(branch.graph, branch.selected, member)
  expect(insideBranch.graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ from_node_id: branch.selected, to_node_id: insideBranch.selected, route: 'success' }),
    expect.objectContaining({ from_node_id: insideBranch.selected, to_node_id: join.id, route: 'join' }),
  ]))
  const afterParallel = insertStep(branch.graph, parallel.id, member)
  expect(afterParallel.graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ from_node_id: join.id, to_node_id: afterParallel.selected, route: 'success' }),
  ]))
  const third = addParallelBranch(branch.graph, parallel.id, member)
  const reduced = removeStep(third.graph, third.selected)
  expect(reduced.edges).toEqual(branch.graph.edges)
  const serial = serializeParallel(reduced, parallel.id)
  expect(serial.nodes.some((n) => n.type === 'parallel' || n.type === 'join')).toBe(false)
  expect(serial.edges.some((e) => e.from_node_id === 'work' && e.to_node_id === branch.selected)).toBe(true)
  expect(serial.nodes.find((n) => n.id === 'work')?.config?.result_requirement).toBe('按产品模块分类并标明依据')
})
it('delivers the inserted final step and protects consumed outputs from deletion', () => {
  const inserted = insertStep(initialGraph(member), 'work', member)
  expect(inserted.graph.nodes.find((n) => n.type === 'deliver')?.config?.result).toMatchObject({ node_id: inserted.selected })
  expect(() => removeStep(inserted.graph, 'work')).toThrow('输入来源')
  const restored = removeStep(inserted.graph, inserted.selected)
  expect(restored.nodes.find((n) => n.type === 'deliver')?.config?.result).toMatchObject({ node_id: 'work' })
})
