import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Check, ChevronLeft, Play, Plus } from 'lucide-react'
import '@/styles/team-workspace.css'
import { MemberInspector } from '@/components/development/MemberInspector'
import { Modal, ProductField, ProductSelect, ProductTextArea } from '@/components/ui'
import { EditableText } from '@/pages/team-workspace/EditableText'
import { FlowCanvas, ObjectMenu } from '@/pages/team-workspace/TeamCanvas'
import { StepInspector } from '@/pages/team-workspace/StepInspector'
import { TrialPanel } from '@/pages/team-workspace/TrialPanel'
import { useTeamDraft } from '@/pages/team-workspace/useTeamDraft'
import { addParallelBranch, configureWorkflowResultProtocol, initialGraph, insertStep, removeStep, serializeParallel, WORKBENCH_RESULT_PROTOCOL } from '@/pages/team-workspace/graph'
import { newMember } from '@/pages/team-workspace/member'
import '@/pages/team-workspace/workspace.css'
import type { EnterpriseBusinessCapabilityCatalog, EnterpriseDevelopmentOverview, PrimeWorkApi, RuntimeInfo } from '@/types/api'
import type { TeamDefinition, TeamDevelopmentProposalResult, TeamWorkspaceBridge } from '@/types/team-workspace'

const pendingDrafts = new Map<string, { revision: number; document: TeamDefinition }>()

export function TeamDevelopmentWorkspace({ teamId, accountId, runtime, enterprise, overview, catalog, catalogError, proposal, bindRequested, refreshVersion, view, onBound, onClearProposal, onDirtyChange, onError, onPublish }: {
  teamId: string; accountId: string; runtime?: RuntimeInfo | null; enterprise: PrimeWorkApi['enterprise']; overview?: EnterpriseDevelopmentOverview
  catalog?: EnterpriseBusinessCapabilityCatalog; catalogError: string; proposal?: TeamDevelopmentProposalResult; bindRequested: boolean; refreshVersion?: number; view: 'division' | 'workflow'
  onBound(): void; onClearProposal(): void; onDirtyChange(dirty: boolean): void; onError(message: string): void; onPublish(): void
}) {
  const bridge = useCallback<TeamWorkspaceBridge>((command) => enterprise.teamWorkspace({ ...command, accountId }), [enterprise, accountId])
  const workspace = useTeamDraft(teamId, bridge)
  const { draft, dirty, saving, edit, flush, replace } = workspace
  const pendingKey = `${accountId}:${teamId}`
  const restored = useRef(false)
  const [section, setSection] = useState<'workspace' | 'trial'>('workspace')
  const [teamInfoOpen, setTeamInfoOpen] = useState(false)
  const [workflowInfoOpen, setWorkflowInfoOpen] = useState(false)
  const [stepPanelOpen, setStepPanelOpen] = useState(false)
  const [memberId, setMemberId] = useState('')
  const [stepId, setStepId] = useState('')
  const [createMemberOpen, setCreateMemberOpen] = useState(false)
  const [memberName, setMemberName] = useState('')
  const [memberDuty, setMemberDuty] = useState('')
  const [createFlowOpen, setCreateFlowOpen] = useState(false)
  const [flowName, setFlowName] = useState('')
  const [flowDescription, setFlowDescription] = useState('')
  const [stepForm, setStepForm] = useState<{ placement: 'serial' | 'parallel'; after: string; member: string; name: string; requirement: string }>()
  const [working, setWorking] = useState(false)

  useEffect(() => { if ((refreshVersion ?? 0) > 0 && !dirty) void workspace.load() }, [refreshVersion])

  useEffect(() => {
    if (!draft || restored.current) return
    restored.current = true
    const pending = pendingDrafts.get(pendingKey)
    if (!pending) return
    if (pending.revision !== draft.revision) { pendingDrafts.delete(pendingKey); onError('远端草稿已更新，原本地未保存修改不能直接恢复'); return }
    edit(structuredClone(pending.document))
  }, [draft?.revision, pendingKey])
  useEffect(() => { if (!draft) return; if (dirty) pendingDrafts.set(pendingKey, { revision: draft.revision, document: structuredClone(draft.document) }); else pendingDrafts.delete(pendingKey) }, [dirty, draft?.revision, draft?.document, pendingKey])
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => { if (view === 'division') setSection('workspace') }, [view])
  useEffect(() => { if (!bindRequested || !draft || !runtime?.runtimeId) return; let active = true; void enterprise.updateTeamDevelopment(runtime.runtimeId, { teamId, accountId, revision: draft.revision, document: draft.document }).then(() => { if (active) onBound() }).catch((cause) => { if (active) onError(cause instanceof Error ? cause.message : '无法把草稿交给 Pi') }); return () => { active = false } }, [bindRequested, draft, runtime?.runtimeId, enterprise, teamId, accountId, onBound, onError])

  if (!draft) return <p className="team-development-inspector__loading">{workspace.error || '正在读取团队草稿…'}</p>
  const doc = draft.document
  const member = doc.members.find((item) => item.id === memberId) ?? doc.members[0]
  const flow = doc.workflows[0]
  const step = flow?.graph_definition.nodes.find((item) => item.id === stepId) ?? flow?.graph_definition.nodes[0]
  const workers = doc.members.filter((item) => item.configuration.role === 'worker' && item.relationship.enabled)
  const stepExecutors = doc.members.filter((item) => item.relationship.enabled)
  const editDocument = (next: TeamDefinition) => { edit(next); pendingDrafts.set(pendingKey, { revision: draft.revision, document: structuredClone(next) }); if (runtime?.runtimeId && !runtime.isStreaming) void enterprise.updateTeamDevelopment(runtime.runtimeId, { teamId, accountId, revision: draft.revision, document: next }).catch((cause) => onError(cause instanceof Error ? cause.message : 'Pi 上下文未同步')) }
  const selectStep = (id: string) => { setStepId(id); setStepPanelOpen(true) }
  const applyProposal = () => {
    if (!proposal) return
    if (proposal.revision !== draft.revision || JSON.stringify(proposal.baseDocument) !== JSON.stringify(doc)) { onError('草稿已变化，请在 Pi 主会话中重新生成修改'); return }
    editDocument(proposal.document); onClearProposal(); onError('')
  }
  const addMember = () => { const next = newMember(overview?.models[0] ?? ''); next.configuration.displayName = memberName.trim(); next.configuration.systemPrompt = memberDuty.trim(); next.relationship.duty = memberDuty.trim(); editDocument({ ...doc, members: [...doc.members, next] }); setMemberId(next.id); setCreateMemberOpen(false); setMemberName(''); setMemberDuty('') }
  const deleteMember = () => { if (!member || member.configuration.role === 'avatar') return; if (doc.members.filter((item) => item.configuration.role === 'worker').length <= 1) { onError('团队至少保留一位负责人和一位执行成员'); return }; if (doc.workflows.some((item) => item.graph_definition.nodes.some((node) => node.config?.agent_id === member.id))) { onError('该成员仍被流程步骤使用，请先调整流程中的执行成员'); return }; editDocument({ ...doc, members: doc.members.filter((item) => item.id !== member.id) }); setMemberId(''); onError('') }
  const addFlow = () => { const worker = doc.members.find((item) => item.configuration.role === 'worker' && item.relationship.enabled); if (!worker) { onError('请先添加并启用一位执行成员'); return }; editDocument({ ...doc, workflows: [{ id: crypto.randomUUID(), name: flowName.trim(), description: flowDescription.trim(), trigger_config: { schema_version: 1, type: 'conversation_explicit', config: {} }, graph_definition: initialGraph(worker) }] }); setFlowName(''); setFlowDescription(''); setCreateFlowOpen(false); onError('') }
  const openStepForm = (placement: 'serial' | 'parallel') => { if (!flow || !step) return; setStepForm({ placement, after: step.id, member: '', name: '', requirement: '' }) }
  const addStep = () => {
    if (!flow || !stepForm) return
    const actors = stepForm.placement === 'parallel' ? workers : stepExecutors
    const actor = actors.find((item) => item.id === stepForm.member)
    if (!actor || !stepForm.name.trim() || !stepForm.requirement.trim()) { onError('请填写步骤名称、工作要求并选择执行者'); return }
    try {
      const inserted = stepForm.placement === 'parallel' ? addParallelBranch(flow.graph_definition, stepForm.after, actor) : insertStep(flow.graph_definition, stepForm.after, actor)
      const originalDeliverySource = String((flow.graph_definition.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: unknown } | undefined)?.node_id ?? '')
      const updatedFlow = configureWorkflowResultProtocol({ ...flow, graph_definition: { ...inserted.graph, nodes: inserted.graph.nodes.map((node) => node.id !== inserted.selected ? node : node.type === 'lead' ? { ...node, label: stepForm.name.trim(), config: { ...node.config, instruction: stepForm.requirement.trim() } } : { ...node, label: stepForm.name.trim(), config: { ...node.config, result_requirement: stepForm.requirement.trim() } }) } }, flow.graph_definition.result_protocol === WORKBENCH_RESULT_PROTOCOL, undefined, originalDeliverySource)
      editDocument({ ...doc, workflows: doc.workflows.map((item) => item.id === flow.id ? updatedFlow : item) })
      setStepId(inserted.selected); setStepForm(undefined); onError('')
    } catch (cause) { onError(cause instanceof Error ? cause.message : '无法添加流程步骤') }
  }
  const deleteStep = () => { if (!flow || !step || !['worker', 'lead'].includes(step.type) || step.id === flow.graph_definition.entry_node_id) return; try { const originalDeliverySource = String((flow.graph_definition.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: unknown } | undefined)?.node_id ?? ''); const graph = removeStep(flow.graph_definition, step.id); const updatedFlow = configureWorkflowResultProtocol({ ...flow, graph_definition: graph }, flow.graph_definition.result_protocol === WORKBENCH_RESULT_PROTOCOL, undefined, originalDeliverySource); editDocument({ ...doc, workflows: doc.workflows.map((item) => item.id === flow.id ? updatedFlow : item) }); setStepId(''); onError('') } catch (cause) { onError(cause instanceof Error ? cause.message : '无法移除步骤') } }
  const serialize = () => { if (!flow || !step || step.type !== 'parallel') return; try { const graph = serializeParallel(flow.graph_definition, step.id); editDocument({ ...doc, workflows: doc.workflows.map((item) => item.id === flow.id ? { ...item, graph_definition: graph } : item) }); setStepId(''); onError('') } catch (cause) { onError(cause instanceof Error ? cause.message : '无法改为依次执行') } }

  const memberRole = (item: TeamDefinition['members'][number]) => item.configuration.role === 'avatar' ? '负责人' : item.configuration.role === 'worker' ? '执行成员' : '成员'
  const stepAfter = flow?.graph_definition.nodes.find((node) => node.id === stepForm?.after)
  const stepAfterLabel = stepAfter?.type === 'parallel' ? '并行汇合' : stepAfter?.label || '当前步骤'

  return <div className={`team-development-workspace team-development-workspace--${view}`}>
    {proposal && section === 'workspace' && <section className="team-development-inspector__proposal"><strong>Pi 提出的修改</strong><ul>{proposal.changes.map((item, index) => <li key={index}>{item}</li>)}</ul><button type="button" className="button button--primary" onClick={applyProposal}><Check size={13}/>应用到草稿</button></section>}
    {section === 'trial' && flow ? <section className="team-development-inspector__trial"><button type="button" className="team-development-inspector__back" onClick={() => setSection('workspace')}><ChevronLeft size={14}/>返回工作流程</button><TrialPanel key={flow.id} initialFlowId={flow.id} teamId={teamId} draft={draft} businessCapabilities={catalog} bridge={bridge} flush={async () => { if (dirty) throw new Error('请先保存草稿，再调试流程'); return draft }} refresh={workspace.refreshTrials}/></section> : view === 'division' ? <section className="team-development-inspector__division">
      <header className="team-development-workspace__team-summary"><div><small>团队目标</small><p title={doc.objective}>{doc.objective || '尚未填写团队目标'}</p></div><button type="button" className="button" aria-expanded={teamInfoOpen} aria-controls="team-development-team-info" onClick={() => setTeamInfoOpen((open) => !open)}>{teamInfoOpen ? '收起资料' : '团队资料'}</button></header>
      {teamInfoOpen && <div id="team-development-team-info" className="team-development-workspace__team-info"><EditableText label="团队名称" value={doc.name} multiline={false} onChange={(name) => editDocument({ ...doc, name })}/><EditableText label="团队目标" value={doc.objective} onChange={(objective) => editDocument({ ...doc, objective })}/></div>}
      <div className="team-development-workspace__member-layout">
        <aside className="team-development-workspace__member-list" aria-label="团队成员">
          <div className="team-development-workspace__member-list-heading"><h4>成员 <span>{doc.members.length}</span></h4><button type="button" className="button" onClick={() => setCreateMemberOpen(true)}><Plus size={13}/>添加</button></div>
          <div className="team-development-workspace__member-list-items">{doc.members.map((item) => <button type="button" key={item.id} aria-current={member?.id === item.id ? 'true' : undefined} className={member?.id === item.id ? 'is-selected' : ''} onClick={() => setMemberId(item.id)}><span className="team-development-workspace__member-avatar"><Bot size={14}/></span><span className="team-development-workspace__member-summary"><strong>{item.configuration.displayName}</strong><small>{memberRole(item)}</small><span>{item.relationship.duty || '尚未填写职责'}</span></span></button>)}</div>
        </aside>
        <section className="team-development-workspace__member-editor" aria-label={member ? `${member.configuration.displayName}配置` : '成员配置'}>
          {member ? <><header className="team-development-workspace__member-editor-header"><div><h3>{member.configuration.displayName}</h3><span>{memberRole(member)}{member.relationship.enabled ? ' · 参与协作' : ' · 已停用'}</span></div>{member.configuration.role !== 'avatar' && <ObjectMenu label="成员" actions={[{ label: '移出团队', danger: true, run: deleteMember }]}/>}</header><MemberInspector key={member.id} draft={{ version: '1', teamId, agentId: member.id, agentName: member.configuration.displayName, baseAgentVersion: 1, revision: draft.revision, updatedAt: draft.updated_at, configuration: member.configuration, relationship: member.relationship }} runtimes={overview?.runtimes ?? []} models={overview?.models ?? []} businessCapabilities={catalog} businessCapabilityError={catalogError} onChange={(next) => editDocument({ ...doc, members: doc.members.map((item) => item.id === member.id ? { ...item, configuration: next.configuration, relationship: next.relationship } : item) })}/></> : <div className="team-development-inspector__empty"><p>团队中还没有成员</p><button type="button" className="button button--primary" onClick={() => setCreateMemberOpen(true)}>添加成员</button></div>}
        </section>
      </div>
    </section> : <section className="team-development-inspector__workflow">
      {flow ? <>
        <header className="team-development-workspace__workflow-header"><div><h2>{flow.name}</h2><p title={flow.description}>{flow.description || '尚未填写流程说明'}</p></div><div className="team-development-workspace__workflow-actions"><button type="button" className="button" aria-expanded={workflowInfoOpen} aria-controls="team-development-workflow-info" onClick={() => setWorkflowInfoOpen((open) => !open)}>{workflowInfoOpen ? '收起设置' : '流程设置'}</button><button type="button" className="button" disabled={dirty || working || saving} title={dirty ? '请先保存草稿，再调试流程' : undefined} onClick={() => setSection('trial')}><Play size={13}/>调试流程</button><button type="button" className="button team-development-workspace__step-toggle" aria-expanded={stepPanelOpen} onClick={() => setStepPanelOpen((open) => !open)}>{stepPanelOpen ? '隐藏步骤' : '步骤详情'}</button></div></header>
        {workflowInfoOpen && <div id="team-development-workflow-info" className="team-development-workspace__workflow-info"><EditableText label="流程名称" value={flow.name} multiline={false} onChange={(name) => editDocument({ ...doc, workflows: doc.workflows.map((item) => item.id === flow.id ? { ...item, name } : item) })}/><EditableText label="流程说明" value={flow.description} onChange={(description) => editDocument({ ...doc, workflows: doc.workflows.map((item) => item.id === flow.id ? { ...item, description } : item) })}/></div>}
        <div className={`team-development-workspace__workflow-layout ${stepPanelOpen ? 'has-step-panel-open' : ''}`}>
          <div className="team-development-workspace__canvas"><FlowCanvas flow={flow} members={doc.members} selected={step?.id} onSelect={selectStep} onAdd={() => openStepForm('serial')} onBranch={() => openStepForm('parallel')} fitOnMount/></div>
          {step && <section className={`team-development-workspace__step-panel ${stepPanelOpen ? 'is-open' : ''}`} aria-label={`${step.label || '流程步骤'}配置`}><header className="team-development-workspace__step-header"><div><small>当前步骤</small><h3>{step.label || '流程步骤'}</h3></div><ObjectMenu label="步骤" actions={[...(step.type === 'parallel' ? [{ label: '改为依次执行', run: serialize }] : []), ...(['worker', 'lead'].includes(step.type) && step.id !== flow.graph_definition.entry_node_id ? [{ label: '删除步骤', danger: true, run: deleteStep }] : [])]}/></header><StepInspector key={step.id} flow={flow} step={step} members={doc.members} onChange={(next, graph) => editDocument({ ...doc, workflows: doc.workflows.map((item) => item.id === flow.id ? { ...item, graph_definition: graph ?? { ...item.graph_definition, nodes: item.graph_definition.nodes.map((node) => node.id === next.id ? next : node) } } : item) })}/></section>}
        </div>
      </> : <div className="team-development-inspector__empty"><p>还没有工作流程</p><button type="button" className="button button--primary" onClick={() => { setFlowName(''); setFlowDescription(''); setCreateFlowOpen(true) }}>新建流程</button></div>}
    </section>}
    <footer className="team-development-inspector__actions"><span className="team-development-inspector__state" role="status">{saving || working ? '保存中' : dirty ? '修改尚未保存' : '草稿已保存'}</span><div>{dirty && <><button type="button" className="button" disabled={working || saving} onClick={() => workspace.discard()}>放弃修改</button><button type="button" className="button button--primary" disabled={working || saving} onClick={() => void (async () => { setWorking(true); onError(''); try { const saved = await flush(); if (saved && runtime?.runtimeId) await enterprise.updateTeamDevelopment(runtime.runtimeId, { teamId, accountId, revision: saved.revision, document: saved.document }) } catch (cause) { onError(cause instanceof Error ? cause.message : '保存失败') } finally { setWorking(false) } })()}>保存草稿</button></>}{!dirty && section === 'workspace' && readyToPublish(draft, catalog) && <button type="button" className="button button--primary" disabled={working || saving} onClick={() => void (async () => { setWorking(true); onError(''); try { replace(await bridge({ action: 'publish', teamId, revision: draft.revision })); onPublish() } catch (cause) { onError(cause instanceof Error ? cause.message : '更新团队失败') } finally { setWorking(false) } })()}>更新团队</button>}</div></footer>
    {createMemberOpen && <Modal title="添加团队成员" onClose={() => setCreateMemberOpen(false)} footer={<><button type="button" className="button" onClick={() => setCreateMemberOpen(false)}>取消</button><button type="button" className="button button--primary" disabled={!memberName.trim() || !memberDuty.trim()} onClick={addMember}>添加成员</button></>}><div className="tw-form"><ProductField label="成员名称" value={memberName} maxLength={80} onChange={(event) => setMemberName(event.target.value)}/><ProductTextArea label="成员职责" value={memberDuty} rows={4} onChange={(event) => setMemberDuty(event.target.value)}/></div></Modal>}
    {createFlowOpen && <Modal title="新建工作流程" onClose={() => setCreateFlowOpen(false)} footer={<><button type="button" className="button" onClick={() => setCreateFlowOpen(false)}>取消</button><button type="button" className="button button--primary" disabled={!flowName.trim() || !flowDescription.trim()} onClick={addFlow}>创建流程</button></>}><div className="tw-form"><ProductField label="流程名称" value={flowName} maxLength={80} onChange={(event) => setFlowName(event.target.value)}/><ProductTextArea label="流程说明" value={flowDescription} rows={4} onChange={(event) => setFlowDescription(event.target.value)}/></div></Modal>}
    {stepForm && flow && <Modal title={stepForm.placement === 'parallel' ? '添加并行分支' : '添加流程步骤'} onClose={() => setStepForm(undefined)} footer={<><button type="button" className="button" onClick={() => setStepForm(undefined)}>取消</button><button type="button" className="button button--primary" disabled={!stepForm.member || !stepForm.name.trim() || !stepForm.requirement.trim()} onClick={addStep}>添加步骤</button></>}><div className="tw-form"><div className="team-development-workspace__step-form-context"><span>插入位置</span><strong>{stepAfterLabel}之后 · {stepForm.placement === 'parallel' ? '并行分支' : '串行步骤'}</strong></div><ProductSelect label="由谁执行" value={stepForm.member} options={[{ value: '', label: '请选择执行成员' }, ...(stepForm.placement === 'parallel' ? workers : stepExecutors).map((item) => ({ value: item.id, label: item.configuration.displayName }))]} onChange={(memberId) => setStepForm({ ...stepForm, member: memberId })}/><ProductField label="步骤名称" value={stepForm.name} maxLength={80} onChange={(event) => setStepForm({ ...stepForm, name: event.target.value })}/><ProductTextArea label="工作要求" rows={4} value={stepForm.requirement} onChange={(event) => setStepForm({ ...stepForm, requirement: event.target.value })}/></div></Modal>}
  </div>
  function readyToPublish(current: NonNullable<typeof draft>, business: EnterpriseBusinessCapabilityCatalog | undefined) { const ids = new Set(current.document.members.flatMap((item) => item.configuration.businessCapabilityIds)); const unavailableActions = [...ids].some((id) => business?.capabilities.find((item) => item.id === id)?.status !== 'available'); return !unavailableActions && current.document.workflows.length > 0 && current.document.workflows.every((item) => current.trials.some((trial) => trial.workflow_id === item.id && trial.revision === current.revision && trial.status === 'succeeded')) }
}
