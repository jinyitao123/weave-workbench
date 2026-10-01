import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Check, ChevronLeft, ChevronRight, GitBranch, Plus } from 'lucide-react'
import { MemberInspector } from '@/components/development/MemberInspector'
import { Modal, ProductField, ProductSelect, ProductTextArea, Segmented } from '@/components/ui'
import { FlowCanvas, ObjectMenu, stepTypeLabel } from '@/pages/team-workspace/TeamCanvas'
import { StepInspector } from '@/pages/team-workspace/StepInspector'
import { TrialPanel } from '@/pages/team-workspace/TrialPanel'
import { useTeamDraft } from '@/pages/team-workspace/useTeamDraft'
import { addParallelBranch, canInsertSerialStep, configureWorkflowResultProtocol, initialGraph, insertStep, removeStep, serializeParallel, WORKBENCH_RESULT_PROTOCOL } from '@/pages/team-workspace/graph'
import { isSystemManagedBusinessParameter, newMember } from '@/pages/team-workspace/member'
import type { EnterpriseBusinessCapabilityCatalog, EnterpriseDevelopmentOverview, PrimeWorkApi, RuntimeInfo } from '@/types/api'
import type { TeamDefinition, TeamDevelopmentProposalResult, TeamWorkspace, TeamWorkspaceBridge } from '@/types/team-workspace'

const pendingDrafts = new Map<string, { revision: number; document: TeamDefinition }>()
type Member = TeamDefinition['members'][number]
function focusAfterRender(target: () => HTMLElement | null) { requestAnimationFrame(() => target()?.focus()) }
const memberRole = (item: Member) => item.configuration.role === 'avatar' ? '负责人' : item.configuration.role === 'worker' ? '执行成员' : '成员'

/** Why the team cannot be updated yet; empty when it can. Mirrors the publish rule below. */
export function publishBlocker(current: TeamWorkspace, business: EnterpriseBusinessCapabilityCatalog | undefined): string {
  const ids = new Set(current.document.members.flatMap((item) => item.configuration.businessCapabilityIds))
  if ([...ids].some((id) => business?.capabilities.find((item) => item.id === id)?.status !== 'available')) return '有不可用的业务动作'
  if (current.document.members.some((item) => item.configuration.businessCapabilityBindings.some((binding) => item.configuration.businessCapabilityIds.includes(binding.capabilityId) && binding.parameters.some((parameter) => isSystemManagedBusinessParameter(parameter.name))))) return '有需要移除的旧参数映射'
  if (!current.document.workflows.length) return '还没有工作流程'
  if (!current.document.workflows.every((item) => current.trials.some((trial) => trial.workflow_id === item.id && trial.revision === current.revision && trial.status === 'succeeded'))) return '当前草稿还需调试通过'
  return ''
}

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
  const stepPanel = useRef<HTMLElement>(null)
  const memberHeading = useRef<HTMLHeadingElement>(null)
  const revealStep = useRef(false)
  const [mode, setMode] = useState<'edit' | 'trial'>('edit')
  const [teamInfo, setTeamInfo] = useState<{ name: string; objective: string }>()
  const [flowInfo, setFlowInfo] = useState<{ name: string; description: string }>()
  const [memberId, setMemberId] = useState('')
  const [memberOpen, setMemberOpen] = useState(false)
  const [stepId, setStepId] = useState('')
  const [createMemberOpen, setCreateMemberOpen] = useState(false)
  const [memberName, setMemberName] = useState('')
  const [memberDuty, setMemberDuty] = useState('')
  const [createFlowOpen, setCreateFlowOpen] = useState(false)
  const [flowName, setFlowName] = useState('')
  const [flowDescription, setFlowDescription] = useState('')
  const [stepForm, setStepForm] = useState<{ placement: 'serial' | 'parallel'; after: string; member: string; name: string; requirement: string }>()
  const [stepFormError, setStepFormError] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
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
  useEffect(() => { if (view === 'division') setMode('edit') }, [view])
  // Bring the chosen step's details into view when they sit below the visible canvas.
  useEffect(() => {
    const panel = stepPanel.current, scroller = panel?.closest('.team-panel__scroll')
    if (!revealStep.current || !panel || !scroller) return
    revealStep.current = false
    if (panel.getBoundingClientRect().top > scroller.getBoundingClientRect().bottom - 80) panel.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [stepId])
  useEffect(() => { if (!bindRequested || !draft || !runtime?.runtimeId) return; let active = true; void enterprise.updateTeamDevelopment(runtime.runtimeId, { teamId, accountId, revision: draft.revision, document: draft.document }).then(() => { if (active) onBound() }).catch((cause) => { if (active) onError(cause instanceof Error ? cause.message : '无法把草稿交给 Pi') }); return () => { active = false } }, [bindRequested, draft, runtime?.runtimeId, enterprise, teamId, accountId, onBound, onError])

  if (!draft) return <p className="team-panel__empty">{workspace.error || '正在读取团队草稿…'}</p>
  const doc = draft.document
  const member = doc.members.find((item) => item.id === memberId) ?? doc.members[0]
  const flow = doc.workflows[0]
  const step = flow?.graph_definition.nodes.find((item) => item.id === stepId) ?? flow?.graph_definition.nodes[0]
  const workers = doc.members.filter((item) => item.configuration.role === 'worker' && item.relationship.enabled)
  const stepExecutors = doc.members.filter((item) => item.relationship.enabled)
  const editDocument = (next: TeamDefinition) => { edit(next); pendingDrafts.set(pendingKey, { revision: draft.revision, document: structuredClone(next) }); if (runtime?.runtimeId && !runtime.isStreaming) void enterprise.updateTeamDevelopment(runtime.runtimeId, { teamId, accountId, revision: draft.revision, document: next }).catch((cause) => onError(cause instanceof Error ? cause.message : 'Pi 上下文未同步')) }
  const editFlow = (update: (item: TeamDefinition['workflows'][number]) => TeamDefinition['workflows'][number]) => { if (flow) editDocument({ ...doc, workflows: doc.workflows.map((item) => item.id === flow.id ? update(item) : item) }) }
  const applyProposal = () => {
    if (!proposal) return
    if (proposal.revision !== draft.revision || JSON.stringify(proposal.baseDocument) !== JSON.stringify(doc)) { onError('草稿已变化，请在 Pi 主会话中重新生成修改'); return }
    editDocument(proposal.document); onClearProposal(); onError('')
  }
  // Opening details moves focus to them; going back returns it to the same row.
  const openMember = (id: string) => { setMemberId(id); setMemberOpen(true); focusAfterRender(() => memberHeading.current) }
  const closeMember = () => { setMemberOpen(false); focusAfterRender(() => memberHeading.current?.closest('.team-division')?.querySelector<HTMLElement>(`[data-member-id="${member?.id}"]`) ?? null) }
  const addMember = () => { const next = newMember(overview?.models[0] ?? ''); next.configuration.displayName = memberName.trim(); next.configuration.systemPrompt = memberDuty.trim(); next.relationship.duty = memberDuty.trim(); editDocument({ ...doc, members: [...doc.members, next] }); openMember(next.id); setCreateMemberOpen(false); setMemberName(''); setMemberDuty('') }
  const deleteMember = () => { if (!member || member.configuration.role === 'avatar') return; if (doc.members.filter((item) => item.configuration.role === 'worker').length <= 1) { onError('团队至少保留一位负责人和一位执行成员'); return }; if (doc.workflows.some((item) => item.graph_definition.nodes.some((node) => node.config?.agent_id === member.id))) { onError('该成员仍被流程步骤使用，请先调整流程中的执行成员'); return }; editDocument({ ...doc, members: doc.members.filter((item) => item.id !== member.id) }); setMemberId(''); setMemberOpen(false); onError('') }
  const addFlow = () => { const worker = doc.members.find((item) => item.configuration.role === 'worker' && item.relationship.enabled); if (!worker) { onError('请先添加并启用一位执行成员'); return }; editDocument({ ...doc, workflows: [{ id: crypto.randomUUID(), name: flowName.trim(), description: flowDescription.trim(), trigger_config: { schema_version: 1, type: 'conversation_explicit', config: {} }, graph_definition: initialGraph(worker) }] }); setFlowName(''); setFlowDescription(''); setCreateFlowOpen(false); onError('') }
  const openStepForm = (placement: 'serial' | 'parallel') => { if (!flow || !step) return; setStepFormError(''); setStepForm({ placement, after: step.id, member: '', name: '', requirement: '' }) }
  const deliverySource = () => String((flow?.graph_definition.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: unknown } | undefined)?.node_id ?? '')
  const addStep = () => {
    if (!flow || !stepForm) return
    const actors = stepForm.placement === 'parallel' ? workers : stepExecutors
    const actor = actors.find((item) => item.id === stepForm.member)
    if (!actor || !stepForm.name.trim() || !stepForm.requirement.trim()) { setStepFormError('请填写步骤名称、工作要求并选择执行者'); return }
    try {
      const inserted = stepForm.placement === 'parallel' ? addParallelBranch(flow.graph_definition, stepForm.after, actor) : insertStep(flow.graph_definition, stepForm.after, actor)
      const updatedFlow = configureWorkflowResultProtocol({ ...flow, graph_definition: { ...inserted.graph, nodes: inserted.graph.nodes.map((node) => node.id !== inserted.selected ? node : node.type === 'lead' ? { ...node, label: stepForm.name.trim(), config: { ...node.config, instruction: stepForm.requirement.trim() } } : { ...node, label: stepForm.name.trim(), config: { ...node.config, result_requirement: stepForm.requirement.trim() } }) } }, flow.graph_definition.result_protocol === WORKBENCH_RESULT_PROTOCOL, undefined, deliverySource())
      editFlow(() => updatedFlow)
      setStepId(inserted.selected); setStepForm(undefined); onError('')
    } catch (cause) { setStepFormError(cause instanceof Error ? cause.message : '无法添加流程步骤') }
  }
  const deleteStep = () => { if (!flow || !step || !['worker', 'lead'].includes(step.type) || step.id === flow.graph_definition.entry_node_id) return; try { const graph = removeStep(flow.graph_definition, step.id); const updatedFlow = configureWorkflowResultProtocol({ ...flow, graph_definition: graph }, flow.graph_definition.result_protocol === WORKBENCH_RESULT_PROTOCOL, undefined, deliverySource()); editFlow(() => updatedFlow); setStepId(''); onError('') } catch (cause) { onError(cause instanceof Error ? cause.message : '无法移除步骤') } }
  const serialize = () => { if (!flow || !step || step.type !== 'parallel') return; try { const graph = serializeParallel(flow.graph_definition, step.id); editFlow((item) => ({ ...item, graph_definition: graph })); setStepId(''); onError('') } catch (cause) { onError(cause instanceof Error ? cause.message : '无法改为依次执行') } }
  const save = async () => { setWorking(true); onError(''); try { const saved = await flush(); if (saved && runtime?.runtimeId) await enterprise.updateTeamDevelopment(runtime.runtimeId, { teamId, accountId, revision: saved.revision, document: saved.document }) } catch (cause) { onError(cause instanceof Error ? cause.message : '保存失败') } finally { setWorking(false) } }
  const publish = async () => { setWorking(true); onError(''); try { replace(await bridge({ action: 'publish', teamId, revision: draft.revision })); onPublish() } catch (cause) { onError(cause instanceof Error ? cause.message : '更新团队失败') } finally { setWorking(false) } }

  const stepAfter = flow?.graph_definition.nodes.find((node) => node.id === stepForm?.after)
  const stepAfterLabel = stepAfter?.type === 'parallel' ? '并行汇合' : stepAfter?.label || '当前步骤'
  const blocker = publishBlocker(draft, catalog)
  const busy = working || saving
  const canAddNext = Boolean(flow && step && canInsertSerialStep(flow.graph_definition, step.id))
  const canBranch = Boolean(step && ['worker', 'parallel'].includes(step.type))
  const stepActions = flow && step ? [...(step.type === 'parallel' ? [{ label: '改为依次执行', run: serialize }] : []), ...(['worker', 'lead'].includes(step.type) && step.id !== flow.graph_definition.entry_node_id ? [{ label: '删除步骤', danger: true, confirm: `删除步骤“${step.label || stepTypeLabel(step.type)}”？`, run: deleteStep }] : [])] : []

  const division = <div className="team-division" data-pane={memberOpen ? 'detail' : 'list'}>
    <section className="team-panel__card team-panel__team-info" aria-label="团队资料">
      <div><small>团队目标</small><p>{doc.objective || '尚未填写'}</p></div>
      <button type="button" className="button" onClick={() => setTeamInfo({ name: doc.name, objective: doc.objective })}>编辑</button>
    </section>
    <div className="team-division__list">
      <div className="team-panel__section-head"><h3>成员 <span>{doc.members.length}</span></h3><button type="button" className="button" onClick={() => setCreateMemberOpen(true)}><Plus size={13}/>添加成员</button></div>
      <ul className="team-member-list" aria-label="团队成员">{doc.members.map((item, index) => <li key={item.id}><button type="button" data-member-id={item.id} aria-current={member?.id === item.id ? 'true' : undefined} className={memberId ? item.id === memberId ? 'is-selected' : '' : index === 0 ? 'is-default' : ''} onClick={() => openMember(item.id)}>
        <span className="team-member-list__avatar"><Bot size={14}/></span>
        <span className="team-member-list__text"><span><strong>{item.configuration.displayName}</strong><em>{memberRole(item)}{item.relationship.enabled ? '' : ' · 已停用'}</em></span><small>{item.relationship.duty || '尚未填写职责'}</small></span>
        <ChevronRight className="team-member-list__chevron" size={14}/>
      </button></li>)}</ul>
    </div>
    <section className="team-division__detail" aria-label={member ? `${member.configuration.displayName}配置` : '成员配置'}>
      {member ? <>
        <header className="team-panel__detail-head">
          <button type="button" className="team-panel__back" onClick={closeMember}><ChevronLeft size={14}/>成员</button>
          <div><h3 ref={memberHeading} tabIndex={-1}>{member.configuration.displayName}</h3><small>{memberRole(member)}{member.relationship.enabled ? '' : ' · 已停用'}</small></div>
          <ObjectMenu label="成员" actions={member.configuration.role === 'avatar' ? [] : [{ label: '移出团队', danger: true, confirm: `把“${member.configuration.displayName}”移出团队？`, run: deleteMember }]}/>
        </header>
        <MemberInspector key={member.id} draft={{ version: '1', teamId, agentId: member.id, agentName: member.configuration.displayName, baseAgentVersion: 1, revision: draft.revision, updatedAt: draft.updated_at, configuration: member.configuration, relationship: member.relationship }} runtimes={overview?.runtimes ?? []} models={overview?.models ?? []} businessCapabilities={catalog} businessCapabilityError={catalogError} onChange={(next) => editDocument({ ...doc, members: doc.members.map((item) => item.id === member.id ? { ...item, configuration: next.configuration, relationship: next.relationship } : item) })}/>
      </> : <div className="team-panel__empty"><p>团队中还没有成员</p><button type="button" className="button button--primary" onClick={() => setCreateMemberOpen(true)}>添加成员</button></div>}
    </section>
  </div>

  const workflow = flow ? <div className="team-workflow">
    <header className="team-panel__card team-workflow__head">
      <div><strong>{flow.name}</strong><p>{flow.description || '尚未填写流程说明'}</p></div>
      <button type="button" className="button" onClick={() => setFlowInfo({ name: flow.name, description: flow.description })}>编辑</button>
    </header>
    <Segmented<'edit' | 'trial'> label="流程视图" value={mode} options={[{ value: 'edit', label: '编辑流程' }, { value: 'trial', label: '调试' }]} onChange={setMode}/>
    {mode === 'trial'
      ? <section className="team-workflow__trial" aria-label="调试流程">{dirty ? <p className="team-panel__notice" role="status">请先保存草稿，再调试流程</p> : null}<TrialPanel key={flow.id} initialFlowId={flow.id} teamId={teamId} draft={draft} businessCapabilities={catalog} bridge={bridge} flush={async () => { if (dirty) throw new Error('请先保存草稿，再调试流程'); return draft }} refresh={workspace.refreshTrials}/></section>
      : <>
        <FlowCanvas flow={flow} members={doc.members} selected={step?.id} onSelect={(id) => { revealStep.current = true; setStepId(id) }}/>
        {step && <section ref={stepPanel} className="team-panel__card team-step" aria-label={`${step.label || '流程步骤'}配置`}>
          <header className="team-panel__detail-head">
            <div><h3>{step.label || stepTypeLabel(step.type)}</h3><small>{stepTypeLabel(step.type)}</small></div>
            <ObjectMenu label="步骤" actions={stepActions}/>
          </header>
          {canAddNext || canBranch ? <div className="team-step__actions">
            {canAddNext ? <button type="button" className="button" onClick={() => openStepForm('serial')}><Plus size={13}/>{step.type === 'parallel' ? '汇合后添加步骤' : '添加下一步'}</button> : null}
            {canBranch ? <button type="button" className="button" onClick={() => openStepForm('parallel')}><GitBranch size={13}/>添加并行分支</button> : null}
          </div> : null}
          <StepInspector key={step.id} flow={flow} step={step} members={doc.members} onChange={(next, graph) => editFlow((item) => ({ ...item, graph_definition: graph ?? { ...item.graph_definition, nodes: item.graph_definition.nodes.map((node) => node.id === next.id ? next : node) } }))}/>
        </section>}
      </>}
  </div> : <div className="team-panel__empty"><p>还没有工作流程</p><button type="button" className="button button--primary" onClick={() => { setFlowName(''); setFlowDescription(''); setCreateFlowOpen(true) }}>新建流程</button></div>

  return <div className="team-panel__workspace">
    {proposal && mode === 'edit' && <section className="team-panel__suggestion" aria-label="Pi 提出的修改">
      <strong>Pi 提出的修改</strong>
      <ul>{proposal.changes.map((item, index) => <li key={index}>{item}</li>)}</ul>
      <div className="team-panel__suggestion-actions"><button type="button" className="button" onClick={onClearProposal}>忽略</button><button type="button" className="button button--primary" onClick={applyProposal}><Check size={13}/>应用到草稿</button></div>
    </section>}
    <div className="team-panel__scroll">{view === 'division' ? division : workflow}</div>
    <footer className="team-panel__footer">
      <span className="team-panel__state" role="status">{busy ? '保存中' : dirty ? '修改尚未保存' : blocker ? `草稿已保存 · ${blocker}` : '草稿已保存'}</span>
      <div>{dirty
        ? <><button type="button" className="button" disabled={busy} onClick={() => setDiscardOpen(true)}>放弃修改</button><button type="button" className="button button--primary" disabled={busy} onClick={() => void save()}>保存草稿</button></>
        : <button type="button" className="button button--primary" disabled={busy || Boolean(blocker)} title={blocker || undefined} onClick={() => void publish()}>更新团队</button>}</div>
    </footer>
    {teamInfo && <Modal title="团队资料" onClose={() => setTeamInfo(undefined)} footer={<><button type="button" className="button" onClick={() => setTeamInfo(undefined)}>取消</button><button type="button" className="button button--primary" disabled={!teamInfo.name.trim()} onClick={() => { editDocument({ ...doc, name: teamInfo.name.trim(), objective: teamInfo.objective.trim() }); setTeamInfo(undefined) }}>确定</button></>}><div className="tw-form"><ProductField autoFocus label="团队名称" value={teamInfo.name} maxLength={80} onChange={(event) => setTeamInfo({ ...teamInfo, name: event.target.value })}/><ProductTextArea label="团队目标" rows={4} value={teamInfo.objective} onChange={(event) => setTeamInfo({ ...teamInfo, objective: event.target.value })}/></div></Modal>}
    {flowInfo && flow && <Modal title="流程资料" onClose={() => setFlowInfo(undefined)} footer={<><button type="button" className="button" onClick={() => setFlowInfo(undefined)}>取消</button><button type="button" className="button button--primary" disabled={!flowInfo.name.trim()} onClick={() => { editFlow((item) => ({ ...item, name: flowInfo.name.trim(), description: flowInfo.description.trim() })); setFlowInfo(undefined) }}>确定</button></>}><div className="tw-form"><ProductField autoFocus label="流程名称" value={flowInfo.name} maxLength={80} onChange={(event) => setFlowInfo({ ...flowInfo, name: event.target.value })}/><ProductTextArea label="流程说明" rows={4} value={flowInfo.description} onChange={(event) => setFlowInfo({ ...flowInfo, description: event.target.value })}/></div></Modal>}
    {discardOpen && <Modal title="放弃修改" onClose={() => setDiscardOpen(false)} footer={<><button type="button" className="button" onClick={() => setDiscardOpen(false)}>取消</button><button type="button" className="button button--danger" onClick={() => { setDiscardOpen(false); workspace.discard() }}>放弃修改</button></>}><p>未保存的修改将会丢失。</p></Modal>}
    {createMemberOpen && <Modal title="添加成员" onClose={() => setCreateMemberOpen(false)} footer={<><button type="button" className="button" onClick={() => setCreateMemberOpen(false)}>取消</button><button type="button" className="button button--primary" disabled={!memberName.trim() || !memberDuty.trim()} onClick={addMember}>添加成员</button></>}><div className="tw-form"><ProductField autoFocus label="成员名称" value={memberName} maxLength={80} onChange={(event) => setMemberName(event.target.value)}/><ProductTextArea label="成员职责" value={memberDuty} rows={4} onChange={(event) => setMemberDuty(event.target.value)}/></div></Modal>}
    {createFlowOpen && <Modal title="新建流程" onClose={() => setCreateFlowOpen(false)} footer={<><button type="button" className="button" onClick={() => setCreateFlowOpen(false)}>取消</button><button type="button" className="button button--primary" disabled={!flowName.trim() || !flowDescription.trim()} onClick={addFlow}>创建流程</button></>}><div className="tw-form"><ProductField autoFocus label="流程名称" value={flowName} maxLength={80} onChange={(event) => setFlowName(event.target.value)}/><ProductTextArea label="流程说明" value={flowDescription} rows={4} onChange={(event) => setFlowDescription(event.target.value)}/></div></Modal>}
    {stepForm && flow && <Modal title={stepForm.placement === 'parallel' ? '添加并行分支' : '添加步骤'} onClose={() => setStepForm(undefined)} footer={<><button type="button" className="button" onClick={() => setStepForm(undefined)}>取消</button><button type="button" className="button button--primary" disabled={!stepForm.member || !stepForm.name.trim() || !stepForm.requirement.trim()} onClick={addStep}>添加步骤</button></>}><div className="tw-form"><div className="team-development-workspace__step-form-context"><span>插入位置</span><strong>{stepAfterLabel}之后 · {stepForm.placement === 'parallel' ? '并行分支' : '串行步骤'}</strong></div><ProductSelect label="由谁执行" value={stepForm.member} options={[{ value: '', label: '请选择执行成员' }, ...(stepForm.placement === 'parallel' ? workers : stepExecutors).map((item) => ({ value: item.id, label: item.configuration.displayName }))]} onChange={(memberId) => setStepForm({ ...stepForm, member: memberId })}/><ProductField label="步骤名称" value={stepForm.name} maxLength={80} onChange={(event) => setStepForm({ ...stepForm, name: event.target.value })}/><ProductTextArea label="工作要求" rows={4} value={stepForm.requirement} onChange={(event) => setStepForm({ ...stepForm, requirement: event.target.value })}/>{stepFormError ? <p className="team-panel__field-error" role="alert">{stepFormError}</p> : null}</div></Modal>}
  </div>
}
