import { expect, it, vi } from 'vitest'
import { teamWorkspaceRequest } from '../../electron/main/enterprise/team-workspace'
import type { TeamDefinition } from '../../src/types/team-workspace'

it('keeps workflow input bindings and structured output schemas unchanged across the bridge', async () => {
  const graph = { schema_version: 1, entry_node_id: 'review', nodes: [{ id: 'review', type: 'worker', inputs: { original: { value: { source: 'run_input', path: '' }, expected_type: 'text' } } }], edges: [] }
  const config = { display_name: '审核员', system_prompt: '逐条核对', output_schema: { type: 'object', properties: { contract_name: { type: 'string' } } }, tool_loop_control: { slice_rounds: 3, initial_total_rounds: 12 } }
  const wire = { name: '审核团队', objective: '', members: [{ id: 'member', configuration: config, relationship: { result_requirement: '附上依据' } }], workflows: [{ id: 'flow', graph_definition: graph, trigger_config: {} }] }
  const read = vi.fn(async () => structuredClone({ revision: 2, document: wire, published_document: wire }))
  const write = vi.fn(async () => ({ body: await read() }))
  const result = await teamWorkspaceRequest({ action: 'get', teamId: 'team' }, read, write) as { document: TeamDefinition; published_document: TeamDefinition }
  expect(result.document.workflows[0].graph_definition).toEqual(graph)
  expect(result.published_document.members[0].configuration.displayName).toBe('审核员')
  expect(result.document.members[0].configuration.toolLoopControl).toEqual({ sliceRounds: 3, initialTotalRounds: 12 })
  await teamWorkspaceRequest({ action: 'save', teamId: 'team', revision: 2, document: result.document }, read, write)
  const body = (write.mock.calls as unknown as Array<[string, string, { document: { members: Array<{ configuration: typeof config }>; workflows: Array<{ graph_definition: unknown }> } }]>)[0][2]
  expect(body.document.members[0].configuration.output_schema).toEqual(config.output_schema)
  expect(body.document.workflows[0].graph_definition).toEqual(graph)
})

it('freezes Forge action definitions into a development trial request', async () => {
  const read = vi.fn()
  const write = vi.fn(async () => ({ body: { request_id: 'trial-1' } }))
  await teamWorkspaceRequest({
    action: 'trial', teamId: 'team', revision: 3, workflowId: 'flow', requestId: '00000000-0000-4000-8000-000000000001', input: 'sample',
    businessActions: [{ id: 'forge:action:sales_contract.ContractSubmit', name: '提交指定合同版本', description: '提交冻结版本', effect: 'write', resourceType: 'sales_contract', requiresEmployeeIntent: true, status: 'available', actionName: 'ContractSubmit', objectName: 'sales_contract', requiresRecord: true, params: [{ name: 'material_file_id', type: 'string', required: true }] }],
  }, read, write)
  expect(write).toHaveBeenCalledWith('/v1/teams/team/development/trials', 'POST', expect.objectContaining({
    business_actions: [{ capability_id: 'forge:action:sales_contract.ContractSubmit', name: 'ContractSubmit', object_name: 'sales_contract', label: '提交指定合同版本', description: '提交冻结版本', requires_record: true, requires_confirmation: false, params: [{ name: 'material_file_id', type: 'string', required: true }] }],
  }))
})
