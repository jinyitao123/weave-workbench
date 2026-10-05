import { expect, it } from 'vitest'
import { newMember } from '../../src/pages/team-workspace/member'
import { initialGraph } from '../../src/pages/team-workspace/graph'
import { freezeDevelopmentTrialActions, publicationReadinessBlocker, workflowCandidateCapabilityIds, workflowSimulationChoices, workflowTrialBlocker } from '../../src/pages/team-workspace/development-trial'
import type { EnterpriseBusinessCapabilityCatalog } from '../../src/types/api'
import type { TeamDefinition, TeamWorkspace } from '../../src/types/team-workspace'

const writeAction = { id: 'forge:action:contracts.submit', name: '提交合同', description: '提交当前合同版本', effect: 'write' as const, resourceType: 'contracts', requiresEmployeeIntent: true, status: 'available' as const, actionName: 'Submit', objectName: 'contracts' }
const readAction = { id: 'forge:action:contracts.read', name: '读取合同', description: '读取当前合同材料', effect: 'read' as const, resourceType: 'contracts', requiresEmployeeIntent: false, status: 'available' as const, actionName: 'Read', objectName: 'contracts' }
const catalog: EnterpriseBusinessCapabilityCatalog = { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities: [writeAction, readAction], refreshedAt: '' }

function fixture() {
  const lead = newMember('model'), worker = newMember('model'), unrelated = newMember('model')
  lead.configuration.role = 'avatar'; lead.configuration.displayName = '负责人'
  worker.configuration.displayName = '审核员'; worker.configuration.businessCapabilityIds = [writeAction.id, readAction.id]
  unrelated.configuration.displayName = '其他成员'; unrelated.configuration.businessCapabilityIds = ['forge:action:unrelated.write']
  const flow: TeamDefinition['workflows'][number] = { id: 'flow', name: '合同流程', description: '', trigger_config: {}, graph_definition: initialGraph(worker) }
  const document: TeamDefinition = { name: '合同团队', objective: '审核合同', members: [lead, worker, unrelated], workflows: [flow] }
  const workspace: TeamWorkspace = { revision: 3, published_revision: 2, publishing_revision: 0, prepared_revision: 0, document, updated_at: '', trials: [{ request_id: 'trial', revision: 3, workflow_id: flow.id, run_id: 'run', status: 'succeeded', created_at: '' }] }
  return { document, flow, workspace }
}

it('uses only the current workflow executors when freezing business action definitions', () => {
  const { document, flow } = fixture()
  expect(workflowCandidateCapabilityIds(document, flow)).toEqual([writeAction.id, readAction.id])
})

it('defaults every candidate action to closed and only opens exact, uniquely selected options', () => {
  const { document, flow } = fixture()
  const choices = workflowSimulationChoices([writeAction, readAction])
  const closed = freezeDevelopmentTrialActions(choices, [])
  expect(closed.map((action) => action.simulationAuthorized)).toEqual([false, false])
  const selected = freezeDevelopmentTrialActions(choices, ['提交合同'])
  expect(selected.map((action) => action.simulationAuthorized)).toEqual([true, false])
  expect(() => freezeDevelopmentTrialActions(choices, ['其他成员动作'])).toThrow(/不属于当前流程候选范围/)
  expect(workflowCandidateCapabilityIds(document, flow)).not.toContain('forge:action:unrelated.write')
})

it('fails closed for an older write-action response without readiness while allowing a read-only flow', () => {
  const { workspace } = fixture()
  expect(publicationReadinessBlocker(workspace, catalog)).toContain('无法确认')

  const readOnly = structuredClone(workspace)
  readOnly.document.members[1]!.configuration.businessCapabilityIds = []
  expect(publicationReadinessBlocker(readOnly, catalog)).toBe('')
  readOnly.publication_readiness = {} as NonNullable<TeamWorkspace['publication_readiness']>
  expect(publicationReadinessBlocker(readOnly, catalog)).toContain('无法读取')
  readOnly.publication_readiness = { ready: true, workflows: [] }
  expect(publicationReadinessBlocker(readOnly, catalog)).toContain('尚无服务端模拟覆盖结果')
})

it('requires per-workflow server coverage, so a successful read-only flow cannot unlock a write flow', () => {
  const { workspace, document, flow } = fixture()
  const readOnly: TeamDefinition['workflows'][number] = { id: 'read-only', name: '只读流程', description: '', trigger_config: {}, graph_definition: initialGraph(document.members[1]!) }
  readOnly.graph_definition.nodes = readOnly.graph_definition.nodes.map((node) => node.type === 'worker' ? { ...node, config: { ...node.config, agent_id: document.members[2]!.id } } : node)
  const dualDocument = structuredClone(document)
  dualDocument.members[2]!.configuration.businessCapabilityIds = []
  dualDocument.workflows = [readOnly, flow]
  const dual = { ...workspace, document: dualDocument, trials: [{ request_id: 'read-only-run', revision: 3, workflow_id: readOnly.id, run_id: 'a', status: 'succeeded', created_at: '' }] }
  expect(workflowTrialBlocker(dual)).toContain('合同流程')
  dual.publication_readiness = { ready: false, workflows: [
    { workflow_id: readOnly.id, required_capability_ids: [], covered_capability_ids: [], missing_capability_ids: [], passed: true },
    { workflow_id: flow.id, required_capability_ids: [writeAction.id], covered_capability_ids: [], missing_capability_ids: [writeAction.id], passed: false },
  ] }
  expect(publicationReadinessBlocker(dual, catalog)).toContain('提交合同')
  expect(publicationReadinessBlocker(dual, catalog)).not.toContain(writeAction.id)
})

it('accepts a passing readiness result only when required capabilities are covered', () => {
  const { workspace, flow } = fixture()
  workspace.publication_readiness = { ready: true, workflows: [{ workflow_id: flow.id, required_capability_ids: [writeAction.id], covered_capability_ids: [writeAction.id], missing_capability_ids: [], passed: true }] }
  expect(publicationReadinessBlocker(workspace, catalog)).toBe('')
  workspace.publication_readiness.workflows[0]!.covered_capability_ids = []
  expect(publicationReadinessBlocker(workspace, catalog)).toContain('提交合同')
})
