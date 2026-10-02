import { expect, it } from 'vitest'
import { newMember } from '../../src/pages/team-workspace/member'
import { configureWorkflowResultProtocol, initialGraph } from '../../src/pages/team-workspace/graph'
import { applyTeamDevelopmentOperations } from '../../src/pages/team-workspace/development-proposal'
import { businessCompletionRequirement } from '../../src/pages/team-workspace/business-completion'
import type { EnterpriseBusinessCapabilityCatalog } from '../../src/types/api'
import type { TeamDefinition } from '../../src/types/team-workspace'

function fixture() {
  const lead = newMember('deepseek-flash'), worker = newMember('deepseek-flash')
  lead.configuration.role = 'avatar'; lead.configuration.displayName = '负责人'
  worker.configuration.displayName = '审核员'
  const document: TeamDefinition = { name: '合同团队', objective: '复核合同', members: [lead, worker], workflows: [{ id: 'flow', name: '合同复核', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }] }
  const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, refreshedAt: '', capabilities: [{
    id: 'submit', name: '提交指定合同版本', description: '提交员工授权版本', effect: 'write', resourceType: 'contract', requiresEmployeeIntent: true, status: 'available', params: [
      { name: 'primary_file_id', type: 'file', required: true },
      { name: 'material_file_ids', type: 'file', multiple: true, required: true },
      { name: 'material_summary', type: 'string' },
    ],
  }] }
  return { document, catalog }
}

function completionFixture() {
  const value = fixture()
  value.document.workflows[0] = configureWorkflowResultProtocol(value.document.workflows[0], true)
  value.document.members[1].configuration.businessCapabilityIds = ['submit']
  return value
}

it('adds and updates receipt completion checks while preserving delivery fields and existing business permissions', () => {
  const { document, catalog } = completionFixture()
  const output = structuredClone(document.workflows[0].graph_definition.output_contract)
  const prior = { version: 1, coverage: 'incomplete', output, required_artifacts: [{ id: 'report', path: 'report.json', content_type: 'application/json' }],
    required_checks: [{ id: 'result-shape', title: '存在结果分类', verifier_id: 'weave.deterministic', verifier_version: 'v1', parameters: { actual: { source: 'output', path: '/disposition' }, operator: 'equals', expected: { source: 'literal', value: 'complete' } } }], limitations: ['客户确认须独立核对'], external_effects: 'none' }
  document.workflows[0].graph_definition.delivery_contract = prior
  const operation = { kind: 'business_completion', flow: 'flow', capabilities: ['submit'], allowNeedsInput: true }
  const proposed = applyTeamDevelopmentOperations(document, [operation], catalog).document
  const contract = proposed.workflows[0].graph_definition.delivery_contract as typeof prior & { external_effects_check_id: string }
  expect(contract).toMatchObject({ version: 1, coverage: 'incomplete', output, required_artifacts: prior.required_artifacts, limitations: prior.limitations, external_effects: 'required', external_effects_check_id: 'business-action-receipts' })
  expect(contract.required_checks[0]).toEqual(prior.required_checks[0])
  expect(contract.required_checks[1]).toMatchObject({ id: 'business-action-receipts', verifier_id: 'weave.business-action-receipts', verifier_version: 'v1', parameters: { required_capability_ids: ['submit'], when_authorized: true, allow_needs_input: true } })
  expect(proposed.members).toEqual(document.members)
  expect(document.workflows[0].graph_definition.delivery_contract).toEqual(prior)
  const updated = applyTeamDevelopmentOperations(proposed, [{ ...operation, allowNeedsInput: false }], catalog).document
  expect((updated.workflows[0].graph_definition.delivery_contract as { required_checks: unknown[] }).required_checks).toHaveLength(2)
  expect(businessCompletionRequirement(updated.workflows[0])).toEqual({ capabilities: ['submit'], allowNeedsInput: false })
})

it.each(['unbound', 'disabled', 'outside-flow', 'duplicate', 'missing', 'too-many'] as const)('rejects %s completion requirements without granting or moving actions', (mode) => {
  const { document, catalog } = completionFixture()
  document.members[1].configuration.businessCapabilityIds = mode === 'unbound' ? [] : ['submit']
  if (mode === 'disabled') document.members[1].relationship.enabled = false
  if (mode === 'outside-flow') document.workflows[0].graph_definition.nodes = document.workflows[0].graph_definition.nodes.filter((node) => node.type !== 'worker')
  const capabilities = mode === 'duplicate' ? ['submit', 'submit'] : mode === 'missing' ? ['not-in-catalog'] : mode === 'too-many' ? Array.from({ length: 17 }, (_, index) => `action-${index}`) : ['submit']
  expect(() => applyTeamDevelopmentOperations(document, [{ kind: 'business_completion', flow: 'flow', capabilities, allowNeedsInput: true }], catalog)).toThrow()
  expect(document.workflows[0].graph_definition.delivery_contract).toBeUndefined()
})

it('refuses a different external-effects check or a conflicting output schema instead of replacing it', () => {
  const { document, catalog } = completionFixture()
  document.members[1].configuration.businessCapabilityIds = ['submit']
  const prior = { version: 1, coverage: 'explicit', output: { type: 'text' }, required_checks: [{ id: 'existing-effects', verifier_id: 'other.effects', verifier_version: 'v1' }], external_effects: 'required', external_effects_check_id: 'existing-effects' }
  document.workflows[0].graph_definition.delivery_contract = prior
  const operation = { kind: 'business_completion', flow: 'flow', capabilities: ['submit'], allowNeedsInput: true }
  expect(() => applyTeamDevelopmentOperations(document, [operation], catalog)).toThrow('另一项外部业务效果检查')
  expect(document.workflows[0].graph_definition.delivery_contract).toEqual(prior)
  document.workflows[0].graph_definition.delivery_contract = { version: 1, coverage: 'incomplete', output: { type: 'json', schema: { type: 'object' } } }
  expect(() => applyTeamDevelopmentOperations(document, [operation], catalog)).toThrow('输出格式不一致')
})

it('does not leave a configured completion check referring to an action removed later in the batch', () => {
  const { document, catalog } = completionFixture()
  document.members[1].configuration.businessCapabilityIds = ['submit']
  expect(() => applyTeamDevelopmentOperations(document, [
    { kind: 'business_completion', flow: 'flow', capabilities: ['submit'], allowNeedsInput: true },
    { kind: 'capability', member: document.members[1].id, capability: 'submit', selected: false },
  ], catalog)).toThrow('尚未绑定')
  expect(() => applyTeamDevelopmentOperations(document, [
    { kind: 'business_completion', flow: 'flow', capabilities: ['submit'], allowNeedsInput: true },
    { kind: 'result_protocol', flow: 'flow', enabled: false },
  ], catalog)).toThrow('结果分类')
})

it('requires the result protocol and rejects unknown or malformed existing receipt-check parameters', () => {
  const plain = fixture()
  plain.document.members[1].configuration.businessCapabilityIds = ['submit']
  const operation = { kind: 'business_completion', flow: 'flow', capabilities: ['submit'], allowNeedsInput: true }
  expect(() => applyTeamDevelopmentOperations(plain.document, [operation], plain.catalog)).toThrow('须先启用')
  const { document, catalog } = completionFixture()
  const valid = applyTeamDevelopmentOperations(document, [operation], catalog).document
  for (const parameters of [
    { required_capability_ids: ['submit'], when_authorized: true, allow_needs_input: true, unexpected: true },
    { required_capability_ids: ['submit'], when_authorized: false, allow_needs_input: true },
    { required_capability_ids: [], when_authorized: true, allow_needs_input: true },
  ]) {
    const malformed = structuredClone(valid)
    const contract = malformed.workflows[0].graph_definition.delivery_contract as { required_checks: Array<{ parameters: unknown }> }
    contract.required_checks[0].parameters = parameters
    expect(() => businessCompletionRequirement(malformed.workflows[0])).toThrow('参数或引用无效')
    expect(() => applyTeamDevelopmentOperations(malformed, [operation], catalog)).toThrow('参数或引用无效')
    expect(() => applyTeamDevelopmentOperations(malformed, [{ kind: 'team', objective: '修改说明' }], catalog)).toThrow('参数或引用无效')
  }
})

it('adds a member, explicitly binds the native multi-file parameter, and inserts a step without changing the source draft', () => {
  const { document, catalog } = fixture()
  const result = applyTeamDevelopmentOperations(document, [
    { kind: 'member_add', ref: 'submitter', name: '合同提交员', duty: '在员工授权后提交合同' },
    { kind: 'capability', member: 'submitter', capability: 'submit', selected: true, parameterSources: [{ name: 'material_file_ids', source: 'materials.ids' }] },
    { kind: 'step_add', flow: 'flow', after: 'work', member: 'submitter', name: '提交冻结版本', requirement: '只提交本次授权的冻结版本' },
  ], catalog)
  expect(document.members).toHaveLength(2)
  expect(document.workflows[0]?.graph_definition.nodes).toHaveLength(3)
  const submitter = result.document.members.find((member) => member.configuration.displayName === '合同提交员')!
  expect(submitter.configuration.businessCapabilityBindings).toEqual([{ capabilityId: 'submit', parameters: [
    { name: 'material_file_ids', source: 'materials.ids' },
  ] }])
  const graph = result.document.workflows[0]!.graph_definition
  const step = graph.nodes.find((node) => node.label === '提交冻结版本')!
  expect(step.config?.agent_id).toBe(submitter.id)
  expect(graph.edges.some((edge) => edge.from_node_id === 'work' && edge.to_node_id === step.id)).toBe(true)
  expect(graph.edges.some((edge) => edge.from_node_id === step.id && edge.to_node_id === 'deliver')).toBe(true)
})

it('fails closed on missing or mismatched native file bindings while keeping the legacy manifest text-only', () => {
  const { document, catalog } = fixture()
  const action = { kind: 'capability' as const, member: document.members[1]!.id, capability: 'submit', selected: true }
  expect(() => applyTeamDevelopmentOperations(document, [action], catalog)).toThrow('多文件参数 material_file_ids 必须绑定')
  expect(() => applyTeamDevelopmentOperations(document, [{
    ...action, parameterSources: [
      { name: 'primary_file_id', source: 'materials.single.name' },
      { name: 'material_file_ids', source: 'materials.ids' },
    ],
  }], catalog)).toThrow('材料来源与原生类型不匹配')
  const exactSingle = applyTeamDevelopmentOperations(document, [{
    ...action, parameterSources: [
      { name: 'primary_file_id', source: 'materials.single.id' },
      { name: 'material_file_ids', source: 'materials.ids' },
    ],
  }], catalog)
  expect(exactSingle.document.members[1]!.configuration.businessCapabilityBindings).toEqual([{ capabilityId: 'submit', parameters: [
    { name: 'primary_file_id', source: 'materials.single.id' },
    { name: 'material_file_ids', source: 'materials.ids' },
  ] }])
  expect(() => applyTeamDevelopmentOperations(document, [{
    ...action, parameterSources: [
      { name: 'material_file_ids', source: 'materials.manifest_json' },
    ],
  }], catalog)).toThrow('材料来源与原生类型不匹配')
  expect(() => applyTeamDevelopmentOperations(document, [{ ...action, fileSource: 'single' }], catalog)).toThrow('旧版文件来源提案不可用')

  const textOnlyCatalog: EnterpriseBusinessCapabilityCatalog = {
    ...catalog,
    capabilities: [{ ...catalog.capabilities[0]!, params: [{ name: 'material_manifest', type: 'string' }] }],
  }
  const mapped = applyTeamDevelopmentOperations(document, [{
    ...action, parameterSources: [{ name: 'material_manifest', source: 'materials.manifest_json' }],
  }], textOnlyCatalog)
  expect(mapped.document.members[1]!.configuration.businessCapabilityBindings).toEqual([{ capabilityId: 'submit', parameters: [
    { name: 'material_manifest', source: 'materials.manifest_json' },
  ] }])
})

it.each(['idempotency_key', 'idempotencyKey'])('rejects a Pi material mapping for system-owned %s before producing a proposal', (name) => {
  const { document, catalog } = fixture()
  catalog.capabilities[0]!.params!.push({ name, type: 'string', required: true })
  const action = { kind: 'capability', member: document.members[1]!.id, capability: 'submit', selected: true }
  expect(() => applyTeamDevelopmentOperations(document, [{ ...action, parameterSources: [
    { name: 'material_file_ids', source: 'materials.ids' }, { name, source: 'materials.single.sha256' },
  ] }], catalog)).toThrow('系统托管的防重复提交参数不能绑定材料')
  const valid = applyTeamDevelopmentOperations(document, [{ ...action, parameterSources: [{ name: 'material_file_ids', source: 'materials.ids' }] }], catalog)
  expect(valid.document.members[1]!.configuration.businessCapabilityBindings).toEqual([{ capabilityId: 'submit', parameters: [{ name: 'material_file_ids', source: 'materials.ids' }] }])
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
