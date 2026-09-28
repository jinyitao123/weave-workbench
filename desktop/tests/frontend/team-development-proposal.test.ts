import { expect, it } from 'vitest'
import { newMember } from '../../src/pages/team-workspace/member'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import { applyTeamDevelopmentOperations } from '../../src/pages/team-workspace/development-proposal'
import type { EnterpriseBusinessCapabilityCatalog } from '../../src/types/api'
import type { TeamDefinition } from '../../src/types/team-workspace'

function fixture() {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; lead.configuration.displayName = '负责人'
  worker.configuration.displayName = '审核员'
  const document: TeamDefinition = { name: '合同团队', objective: '复核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '合同复核', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [{
    id: 'submit', name: '提交指定合同版本', description: '提交员工授权版本', effect: 'write', resourceType: 'contract', requiresEmployeeIntent: true, status: 'available', params: [
      { name: 'material_file_id', type: 'string' }, { name: 'material_name', type: 'string' }, { name: 'material_sha256', type: 'string' },
    ],
  }] }
  return { document, catalog }
}

it('adds a member, binds one file atomically, and inserts a step without changing the source draft', () => {
  const { document, catalog } = fixture()
  const result = applyTeamDevelopmentOperations(document, [
    { kind: 'member_add', ref: 'submitter', name: '合同提交员', duty: '在员工授权后提交合同' },
    { kind: 'capability', member: 'submitter', capability: 'submit', selected: true, fileSource: 'single' },
    { kind: 'step_add', flow: 'flow', after: 'work', member: 'submitter', name: '提交冻结版本', requirement: '只提交本次授权的冻结版本' },
  ], catalog)
  expect(document.members).toHaveLength(2)
  expect(document.workflows[0]?.graph_definition.nodes).toHaveLength(3)
  const submitter = result.document.members.find((member) => member.configuration.displayName === '合同提交员')!
  expect(submitter.configuration.businessCapabilityBindings).toEqual([{ capabilityId: 'submit', parameters: [
    { name: 'material_file_id', source: 'materials.single.id' },
    { name: 'material_name', source: 'materials.single.name' },
    { name: 'material_sha256', source: 'materials.single.sha256' },
  ] }])
  const graph = result.document.workflows[0]!.graph_definition
  const step = graph.nodes.find((node) => node.label === '提交冻结版本')!
  expect(step.config?.agent_id).toBe(submitter.id)
  expect(graph.edges.some((edge) => edge.from_node_id === 'work' && edge.to_node_id === step.id)).toBe(true)
  expect(graph.edges.some((edge) => edge.from_node_id === step.id && edge.to_node_id === 'deliver')).toBe(true)
})

it('rejects invented business actions and references before producing a proposal', () => {
  const { document, catalog } = fixture()
  expect(() => applyTeamDevelopmentOperations(document, [{ kind: 'capability', member: document.members[1]!.id, capability: 'unknown', selected: true }], catalog)).toThrow('不在当前可绑定目录')
  expect(() => applyTeamDevelopmentOperations(document, [{ kind: 'step_add', flow: 'flow', after: 'missing', member: document.members[1]!.id, name: '复核', requirement: '检查' }], catalog)).toThrow('请选择连接完整')
})

it('keeps parallel proposal legs dispatch-only and rejects serial work inside one branch', () => {
  const { document, catalog } = fixture()
  const delivery = newMember('deepseek-flash')
  delivery.configuration.displayName = '交付检查员'
  document.members.push(delivery)
  const proposal = applyTeamDevelopmentOperations(document, [{ kind: 'step_add', flow: 'flow', after: 'work', member: delivery.id, name: '交付检查', requirement: '核对交付范围', placement: 'parallel' }], catalog)
  const graph = proposal.document.workflows[0]!.graph_definition
  const parallel = graph.nodes.find((node) => node.type === 'parallel')!
  const branch = graph.edges.find((edge) => edge.from_node_id === parallel.id)!.to_node_id
  expect(graph.edges.filter((edge) => edge.from_node_id === parallel.id).map((edge) => graph.nodes.find((node) => node.id === edge.to_node_id)?.config?.kind)).toEqual(['dispatch', 'dispatch'])
  expect(() => applyTeamDevelopmentOperations(proposal.document, [{ kind: 'step_add', flow: 'flow', after: branch, member: delivery.id, name: '分支后处理', requirement: '不得插入', placement: 'serial' }], catalog)).toThrow('并行分支由单个成员直接进入汇合')
})

it('allows the team lead to own a serial summary step and stores its instruction', () => {
  const { document, catalog } = fixture()
  const proposal = applyTeamDevelopmentOperations(document, [{ kind: 'step_add', flow: 'flow', after: 'work', member: document.members[0]!.id, name: '汇总结果', requirement: '汇总前序检查结论与原文依据。', placement: 'serial' }], catalog)
  const finalizer = proposal.document.workflows[0]!.graph_definition.nodes.find((node) => node.label === '汇总结果')!
  expect(finalizer.type).toBe('lead')
  expect(finalizer.config?.instruction).toBe('汇总前序检查结论与原文依据。')
  expect(finalizer.config?.result_requirement).toBeUndefined()
})

it('limits a member step to explicitly selected task input and earlier results', () => {
  const { document, catalog } = fixture()
  const proposal = applyTeamDevelopmentOperations(document, [{ kind: 'step_input', flow: 'flow', step: 'work', source: 'run_input', selected: false }], catalog)
  expect(Object.values(proposal.document.workflows[0]!.graph_definition.nodes.find((node) => node.id === 'work')!.inputs ?? {}).some((binding) => binding.value.source === 'run_input')).toBe(false)
  expect(() => applyTeamDevelopmentOperations(document, [{ kind: 'step_input', flow: 'flow', step: 'work', source: 'node_output', from: 'deliver', selected: true }], catalog)).toThrow('前序结果')
})

it('uses the same result protocol configuration for Pi proposals and rejects an unsupported join source', () => {
  const { document, catalog } = fixture()
  const proposal = applyTeamDevelopmentOperations(document, [{ kind: 'result_protocol', flow: 'flow', enabled: true }], catalog)
  const graph = proposal.document.workflows[0]!.graph_definition
  expect(graph.result_protocol).toBe('workbench_result_v1')
  expect(graph.output_contract).toMatchObject({ type: 'json', schema: { required: ['disposition', 'summary', 'missing_items'] } })
  expect(graph.nodes.find((node) => node.id === 'work')?.output).toMatchObject({ type: 'json' })
  expect(document.workflows[0]!.graph_definition.result_protocol).toBeUndefined()

  const branched = applyTeamDevelopmentOperations(document, [{ kind: 'step_add', flow: 'flow', after: 'work', member: document.members[1]!.id, name: '并行复核', requirement: '独立检查', placement: 'parallel' }], catalog)
  const join = branched.document.workflows[0]!.graph_definition.nodes.find((node) => node.type === 'join')!
  const joinDelivery = applyTeamDevelopmentOperations(branched.document, [{ kind: 'delivery', flow: 'flow', from: join.id }], catalog)
  expect(() => applyTeamDevelopmentOperations(joinDelivery.document, [{ kind: 'result_protocol', flow: 'flow', enabled: true }], catalog)).toThrow('并行汇合后添加负责人或成员汇总步骤')
})

it('moves the Pi result protocol to an inserted final step, preserves it for a branch, and removes stale delivery references', () => {
  const { document, catalog } = fixture()
  const enabled = applyTeamDevelopmentOperations(document, [{ kind: 'result_protocol', flow: 'flow', enabled: true }], catalog)
  const serial = applyTeamDevelopmentOperations(enabled.document, [{ kind: 'step_add', flow: 'flow', after: 'work', member: document.members[1]!.id, name: '第一汇总', requirement: '汇总检查意见。' }], catalog)
  const flowAfterSerial = serial.document.workflows[0]!.graph_definition
  const firstFinal = flowAfterSerial.nodes.find((node) => node.label === '第一汇总')!
  expect((flowAfterSerial.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: string } | undefined)?.node_id).toBe(firstFinal.id)
  expect(flowAfterSerial.nodes.find((node) => node.id === 'work')?.output).toMatchObject({ type: 'text' })
  expect(firstFinal.output).toMatchObject({ type: 'json' })

  const second = applyTeamDevelopmentOperations(serial.document, [{ kind: 'step_add', flow: 'flow', after: firstFinal.id, member: document.members[1]!.id, name: '最终汇总', requirement: '形成最终意见。' }], catalog)
  const secondFlow = second.document.workflows[0]!.graph_definition
  const finalNode = secondFlow.nodes.find((node) => node.label === '最终汇总')!
  expect((secondFlow.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: string } | undefined)?.node_id).toBe(finalNode.id)
  expect(secondFlow.nodes.find((node) => node.id === firstFinal.id)?.output).toMatchObject({ type: 'text' })
  expect(finalNode.output).toMatchObject({ type: 'json' })

  const branched = applyTeamDevelopmentOperations(second.document, [{ kind: 'step_add', flow: 'flow', after: 'work', member: document.members[1]!.id, name: '并行检查', requirement: '独立复核', placement: 'parallel' }], catalog)
  const branchGraph = branched.document.workflows[0]!.graph_definition
  expect((branchGraph.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: string } | undefined)?.node_id).toBe(finalNode.id)
  expect(branchGraph.nodes.find((node) => node.id === finalNode.id)?.output).toMatchObject({ type: 'json' })

  const removed = applyTeamDevelopmentOperations(branched.document, [{ kind: 'step_remove', flow: 'flow', step: finalNode.id }], catalog)
  const repairedGraph = removed.document.workflows[0]!.graph_definition
  const repairedSourceId = (repairedGraph.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: string } | undefined)?.node_id
  expect(repairedSourceId).toBe(firstFinal.id)
  expect(repairedGraph.nodes.some((node) => node.id === repairedSourceId)).toBe(true)
  expect(repairedGraph.nodes.find((node) => node.id === repairedSourceId)?.output).toMatchObject({ type: 'json' })
})
