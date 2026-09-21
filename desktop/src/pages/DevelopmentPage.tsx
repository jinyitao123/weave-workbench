import '@/styles/team-workspace.css'
import { Bot, CheckCircle2, Code2, ExternalLink, Pencil, Plus, RefreshCw, Save, Search, UserMinus, UserPlus, UsersRound, Workflow } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Modal, ProductField, ProductTextArea } from '@/components/ui'
import { configurationLabel, MemberInspector } from '@/components/development/MemberInspector'
import type { EnterpriseCreateTeamInput, EnterpriseCreateTeamMemberInput, EnterpriseCreateTeamResult, EnterpriseCreateWorkflowInput, EnterpriseCreateWorkflowResult, EnterpriseDevelopmentOverview, EnterpriseEnvironmentStatus, EnterpriseTeamMemberConfigDraft, EnterpriseTeamMemberMutationResult, EnterpriseUpdateTeamInput, EnterpriseWorkflowObservation, EnterpriseWorkflowValidation } from '@/types/api'

interface DevelopmentPageProps {
  environments: EnterpriseEnvironmentStatus[]
  overview?: EnterpriseDevelopmentOverview
  loading: boolean
  error: string
  onRefresh(): void
  onOpenForge(url: string): void
  onCreateTeam(input: EnterpriseCreateTeamInput): Promise<EnterpriseCreateTeamResult>
  onUpdateTeam(input: EnterpriseUpdateTeamInput): Promise<void>
  onCreateTeamMember(input: EnterpriseCreateTeamMemberInput): Promise<EnterpriseTeamMemberMutationResult>
  onRemoveTeamMember(teamId: string, memberId: string): Promise<void>
  onCreateWorkflow(input: EnterpriseCreateWorkflowInput): Promise<EnterpriseCreateWorkflowResult>
  onValidateWorkflow(workflowId: string, version: number): Promise<EnterpriseWorkflowValidation>
  onLoadMemberDraft(teamId: string, agentId: string): Promise<EnterpriseTeamMemberConfigDraft>
  onSaveMemberDraft(draft: EnterpriseTeamMemberConfigDraft): Promise<EnterpriseTeamMemberConfigDraft>
  onApplyMemberDraft(teamId: string, agentId: string, revision: number): Promise<EnterpriseTeamMemberConfigDraft>
}

const fingerprint = (draft: EnterpriseTeamMemberConfigDraft) => JSON.stringify([draft.configuration, draft.relationship])

function workflowLayout(workflow: EnterpriseWorkflowObservation) {
  const nodes = workflow.nodes
  const nodeIds = new Set(nodes.map((node) => node.id))
  const forwardEdges = workflow.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.route !== 'back')
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  forwardEdges.forEach((edge) => indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1))
  const remaining = new Set(nodes.map((node) => node.id))
  const levels: typeof nodes[] = []
  while (remaining.size) {
    let level = nodes.filter((node) => remaining.has(node.id) && (indegree.get(node.id) ?? 0) === 0)
    if (!level.length) level = nodes.filter((node) => remaining.has(node.id)).slice(0, 1)
    levels.push(level)
    level.forEach((node) => {
      remaining.delete(node.id)
      forwardEdges.filter((edge) => edge.from === node.id && remaining.has(edge.to)).forEach((edge) => indegree.set(edge.to, Math.max(0, (indegree.get(edge.to) ?? 0) - 1)))
    })
  }
  const width = Math.max(430, levels.length * 150 - 20)
  const height = Math.max(240, Math.max(1, ...levels.map((level) => level.length)) * 82 + 54)
  const positions = new Map<string, { x: number; y: number }>()
  levels.forEach((level, column) => level.forEach((node, row) => positions.set(node.id, { x: column * 150, y: height / 2 - ((level.length - 1) * 82) / 2 + row * 82 - 26 })))
  return { width, height, positions }
}

export function DevelopmentPage({ environments, overview, loading, error, onRefresh, onOpenForge, onCreateTeam, onUpdateTeam, onCreateTeamMember, onRemoveTeamMember, onCreateWorkflow, onValidateWorkflow, onLoadMemberDraft, onSaveMemberDraft, onApplyMemberDraft }: DevelopmentPageProps) {
  const forge = environments.find((environment) => environment.id === 'forge-development')
  const weave = environments.find((environment) => environment.id === 'weave-development')
  const [activeTab, setActiveTab] = useState<'teams' | 'apps'>('teams')
  const [workspaceView, setWorkspaceView] = useState<'members' | 'workflow'>('members')
  const [selection, setSelection] = useState({ team: '', member: '' })
  const [flowSelection, setFlowSelection] = useState({ workflow: '', node: '' })
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<EnterpriseTeamMemberConfigDraft>()
  const [baseline, setBaseline] = useState('')
  const [draftLoading, setDraftLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createObjective, setCreateObjective] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [teamEditOpen, setTeamEditOpen] = useState(false)
  const [teamEditName, setTeamEditName] = useState('')
  const [teamEditObjective, setTeamEditObjective] = useState('')
  const [memberCreateOpen, setMemberCreateOpen] = useState(false)
  const [memberCreateName, setMemberCreateName] = useState('')
  const [memberCreateDuty, setMemberCreateDuty] = useState('')
  const [memberRemoveOpen, setMemberRemoveOpen] = useState(false)
  const [teamMutationBusy, setTeamMutationBusy] = useState(false)
  const [teamMutationError, setTeamMutationError] = useState('')
  const [flowCreateOpen, setFlowCreateOpen] = useState(false)
  const [flowCreateName, setFlowCreateName] = useState('')
  const [flowCreateDescription, setFlowCreateDescription] = useState('')
  const [flowCreating, setFlowCreating] = useState(false)
  const [flowCreateError, setFlowCreateError] = useState('')
  const [validation, setValidation] = useState<{ workflowId: string; version: number; result: EnterpriseWorkflowValidation }>()
  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState('')
  // App passes inline callbacks. Parent refreshes must never reset an edited draft.
  const loadRef = useRef(onLoadMemberDraft)
  loadRef.current = onLoadMemberDraft
  const selectedTeam = overview?.teams.find((team) => team.id === selection.team) ?? overview?.teams[0]
  const members = selectedTeam ? [selectedTeam.lead, ...selectedTeam.workers].filter((item): item is NonNullable<typeof item> => Boolean(item)) : []
  const selectedMember = members.find((member) => member.id === selection.member) ?? members[0]
  const selectedWorkflow = selectedTeam?.workflows.find((workflow) => workflow.id === flowSelection.workflow) ?? selectedTeam?.workflows[0]
  const selectedNode = selectedWorkflow?.nodes.find((node) => node.id === flowSelection.node) ?? selectedWorkflow?.nodes[0]
  const graphLayout = selectedWorkflow ? workflowLayout(selectedWorkflow) : undefined
  const teamId = selectedTeam?.id
  const memberId = selectedMember?.id
  const currentDraft = draft?.teamId === teamId && draft?.agentId === memberId ? draft : undefined
  const dirty = Boolean(currentDraft && fingerprint(currentDraft) !== baseline)
  const filteredTeams = overview?.teams.filter((team) => configurationLabel(team.name, '未命名团队').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? []

  useEffect(() => {
    setDraft(undefined); setDraftError(''); setSaved(false); setBaseline('')
    if (!teamId || !memberId) { setDraftLoading(false); return }
    let alive = true
    setDraftLoading(true)
    void loadRef.current(teamId, memberId).then((value) => {
      if (alive) { setDraft(value); setBaseline(fingerprint(value)) }
    }).catch((cause) => {
      if (alive) setDraftError(cause instanceof Error ? configurationLabel(cause.message, '配置读取失败') : '配置读取失败')
    }).finally(() => { if (alive) setDraftLoading(false) })
    return () => { alive = false }
  }, [teamId, memberId, retry])

  useEffect(() => {
    if (!dirty) return
    const preventClose = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventClose)
    return () => window.removeEventListener('beforeunload', preventClose)
  }, [dirty])

  const navigate = (action: () => void) => {
    if (saving) return
    if (dirty) setPendingAction(() => action)
    else action()
  }
  const save = async () => {
    if (!currentDraft || saving) return false
    setSaving(true); setDraftError(''); setSaved(false)
    try {
      const value = await onSaveMemberDraft(currentDraft)
      setDraft(value); setBaseline(fingerprint(value)); setSaved(true)
      return true
    } catch (cause) {
      setDraftError(cause instanceof Error ? configurationLabel(cause.message, '配置保存失败') : '配置保存失败')
      return false
    } finally { setSaving(false) }
  }
  const applyMemberDraft = async () => {
    if (!currentDraft || currentDraft.revision < 1 || dirty || saving) return
    setSaving(true); setDraftError(''); setSaved(false)
    try {
      const value = await onApplyMemberDraft(currentDraft.teamId, currentDraft.agentId, currentDraft.revision)
      setDraft(value); setBaseline(fingerprint(value)); onRefresh()
    } catch (cause) {
      setDraftError(cause instanceof Error ? configurationLabel(cause.message, '配置应用失败') : '配置应用失败')
    } finally { setSaving(false) }
  }
  const createTeam = async () => {
    const name = createName.trim(), objective = createObjective.trim()
    if (!name || !objective || creating) return
    setCreating(true); setCreateError('')
    try {
      const created = await onCreateTeam({ version: '1', name, objective })
      setSelection({ team: created.id, member: '' })
      setCreateOpen(false); setCreateName(''); setCreateObjective('')
      onRefresh()
    } catch (cause) {
      setCreateError(cause instanceof Error ? configurationLabel(cause.message, '团队创建失败') : '团队创建失败')
    } finally { setCreating(false) }
  }
  const openCreate = () => { setCreateError(''); setCreateOpen(true) }
  const openTeamEdit = () => {
    if (!selectedTeam) return
    setTeamMutationError(''); setTeamEditName(selectedTeam.name); setTeamEditObjective(selectedTeam.objective ?? ''); setTeamEditOpen(true)
  }
  const updateTeam = async () => {
    if (!selectedTeam || !teamEditName.trim() || !teamEditObjective.trim() || teamMutationBusy) return
    setTeamMutationBusy(true); setTeamMutationError('')
    try {
      await onUpdateTeam({ version: '1', teamId: selectedTeam.id, name: teamEditName.trim(), objective: teamEditObjective.trim(), expectedUpdatedAt: selectedTeam.updatedAt })
      setTeamEditOpen(false); onRefresh()
    } catch (cause) { setTeamMutationError(cause instanceof Error ? configurationLabel(cause.message, '团队资料保存失败') : '团队资料保存失败') }
    finally { setTeamMutationBusy(false) }
  }
  const openMemberCreate = () => { setTeamMutationError(''); setMemberCreateName(''); setMemberCreateDuty(''); setMemberCreateOpen(true) }
  const createMember = async () => {
    if (!selectedTeam || !memberCreateName.trim() || !memberCreateDuty.trim() || teamMutationBusy) return
    setTeamMutationBusy(true); setTeamMutationError('')
    try {
      const member = await onCreateTeamMember({ version: '1', teamId: selectedTeam.id, name: memberCreateName.trim(), duty: memberCreateDuty.trim() })
      setSelection({ team: selectedTeam.id, member: member.id }); setMemberCreateOpen(false); onRefresh()
    } catch (cause) { setTeamMutationError(cause instanceof Error ? configurationLabel(cause.message, '成员添加失败') : '成员添加失败') }
    finally { setTeamMutationBusy(false) }
  }
  const removeMember = async () => {
    if (!selectedTeam || !selectedMember || selectedMember.role === 'avatar' || teamMutationBusy) return
    setTeamMutationBusy(true); setTeamMutationError('')
    try {
      await onRemoveTeamMember(selectedTeam.id, selectedMember.id)
      setSelection({ team: selectedTeam.id, member: selectedTeam.lead?.id ?? '' }); setMemberRemoveOpen(false); onRefresh()
    } catch (cause) { setTeamMutationError(cause instanceof Error ? configurationLabel(cause.message, '成员移出失败') : '成员移出失败') }
    finally { setTeamMutationBusy(false) }
  }
  const createWorkflow = async () => {
    const lead = selectedTeam?.lead, worker = selectedTeam?.workers.find((member) => member.enabled)
    const name = flowCreateName.trim(), description = flowCreateDescription.trim()
    if (!selectedTeam || !lead || !worker || !name || !description || flowCreating) return
    setFlowCreating(true); setFlowCreateError('')
    try {
      const created = await onCreateWorkflow({ version: '1', teamId: selectedTeam.id, name, description, leadId: lead.id, workerId: worker.id })
      setFlowSelection({ workflow: created.id, node: '' })
      setFlowCreateOpen(false); setFlowCreateName(''); setFlowCreateDescription('')
      onRefresh()
    } catch (cause) {
      setFlowCreateError(cause instanceof Error ? configurationLabel(cause.message, '流程创建失败') : '流程创建失败')
    } finally { setFlowCreating(false) }
  }
  const openFlowCreate = () => {
    setFlowCreateError('')
    setFlowCreateName(selectedTeam ? `${configurationLabel(selectedTeam.name, '团队')}流程` : '')
    setFlowCreateDescription(selectedTeam?.objective ?? '')
    setFlowCreateOpen(true)
  }
  const nodeTypeLabel = (type: string) => ({ lead: '负责人', worker: '执行成员', deliver: '交付', wait: '人工处理', condition: '条件判断', parallel: '并行', join: '汇合', loop: '循环', transform: '转换', handoff: '交接' })[type] ?? '处理步骤'
  const issueLabel = (code: string) => ({ workflow_agent_version_not_found: '成员版本不可用', workflow_agent_version_mismatch: '成员版本已变化', workflow_node_unreachable: '步骤未接入流程', workflow_route_missing: '步骤缺少下一步', workflow_dependency_missing: '依赖能力未配置', workflow_factory_unavailable: '执行能力不可用', workflow_trigger_invalid: '启动方式配置无效' })[code] ?? '流程配置需要调整'
  const currentValidation = selectedWorkflow?.draftVersion && validation?.workflowId === selectedWorkflow.id && validation.version === selectedWorkflow.draftVersion ? validation.result : undefined
  const validateWorkflow = async () => {
    if (!selectedWorkflow?.draftVersion || validating) return
    setValidating(true); setValidationError('')
    try {
      const result = await onValidateWorkflow(selectedWorkflow.id, selectedWorkflow.draftVersion)
      setValidation({ workflowId: selectedWorkflow.id, version: selectedWorkflow.draftVersion, result })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      setValidationError(message === 'workflow store failed' ? '成员还没有可用于运行的模型版本，暂时无法检查草稿' : configurationLabel(message, '流程检查失败'))
    } finally { setValidating(false) }
  }
  const environmentSummary = (environment: EnterpriseEnvironmentStatus | undefined, fallback: string, canOpen = false) => <div className="development-environment-summary">
    <i className={environment?.available ? 'is-online' : ''}/><span><strong>{environment?.name ?? fallback}</strong><small>{loading ? '正在检查' : environment?.available ? '可用' : '暂不可用'}</small></span>
    {canOpen ? <button type="button" className="development-environment-open" aria-label="打开 Forge" title="打开 Forge" disabled={!environment?.available} onClick={() => environment && onOpenForge(environment.url)}><ExternalLink size={13}/></button> : null}
  </div>

  return <div className="page development-shell"><div className="page-container development-page">
    <div className="development-toolbar">
      <nav className="development-tabs" aria-label="开发中心分类">
        <button type="button" className={activeTab === 'teams' ? 'is-active' : ''} aria-pressed={activeTab === 'teams'} onClick={() => setActiveTab('teams')}><UsersRound size={14}/><strong>智能体团队</strong></button>
        <button type="button" className={activeTab === 'apps' ? 'is-active' : ''} aria-pressed={activeTab === 'apps'} onClick={() => setActiveTab('apps')}><Code2 size={14}/><strong>应用开发</strong></button>
      </nav>
      <div className="development-toolbar__meta">{activeTab === 'teams' ? environmentSummary(weave, 'Weave 协作服务') : environmentSummary(forge, 'Forge 业务环境', true)}<button type="button" className="icon-button" aria-label="刷新开发中心" title="刷新开发中心" disabled={saving || loading} onClick={() => navigate(() => { onRefresh(); setRetry((value) => value + 1) })}><RefreshCw size={13} className={loading ? 'spin' : ''}/></button></div>
    </div>
    {activeTab === 'apps' ? <section className="development-app-workspace"><div><Code2 size={20}/><span><strong>应用开发调试区</strong></span></div><button type="button" className="button button--primary" disabled={!forge?.available} onClick={() => forge && onOpenForge(forge.url)}>打开 Forge 开发环境</button></section> : null}
    <section className="team-workspace" aria-label="智能体团队配置" hidden={activeTab !== 'teams'}>
      {error ? <div className="development-inline-error" role="alert">{configurationLabel(error, '团队读取失败')}</div> : null}
      {!overview && loading ? <div className="development-observation-empty">正在读取团队配置…</div> : null}
      {overview?.teams.length === 0 ? <div className="team-workspace-empty"><UsersRound size={20}/><strong>当前组织还没有团队</strong><button type="button" className="button button--primary" onClick={openCreate}><Plus size={13}/>新建团队</button></div> : null}
      {selectedTeam ? <div className="team-workspace__layout">
        <aside className="team-collection" aria-label="团队列表">
          <div className="team-collection__heading"><span>团队</span><button type="button" aria-label="新建团队" title="新建团队" onClick={openCreate}><Plus size={13}/></button></div>
          <label className="team-collection__search"><Search size={13}/><input aria-label="搜索团队" placeholder="搜索团队" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
          <div className="team-collection__items">{filteredTeams.map((team) => <button type="button" key={team.id} disabled={saving} aria-pressed={team.id === teamId} className={team.id === teamId ? 'is-active' : ''} onClick={() => { if (team.id !== teamId) navigate(() => setSelection({ team: team.id, member: '' })) }}><UsersRound size={14}/><span>{configurationLabel(team.name, '未命名团队')}</span></button>)}{!filteredTeams.length ? <p>没有匹配的团队</p> : null}</div>
        </aside>
        <main className="team-stage">
          <header className="team-stage__header"><div><h2>{configurationLabel(selectedTeam.name, '未命名团队')}</h2>{selectedTeam.objective ? <p>{configurationLabel(selectedTeam.objective, '团队协作')}</p> : null}</div><button type="button" aria-label="编辑团队资料" title="编辑团队资料" onClick={openTeamEdit}><Pencil size={13}/></button></header>
          <nav className="team-stage__views" aria-label="团队开发视图"><button type="button" className={workspaceView === 'members' ? 'is-active' : ''} aria-pressed={workspaceView === 'members'} onClick={() => navigate(() => setWorkspaceView('members'))}><UsersRound size={13}/>团队分工</button><button type="button" className={workspaceView === 'workflow' ? 'is-active' : ''} aria-pressed={workspaceView === 'workflow'} onClick={() => navigate(() => setWorkspaceView('workflow'))}><Workflow size={13}/>工作流程</button></nav>
          {workspaceView === 'members' ? <><div className="team-stage__section-heading"><h3>团队成员</h3><button type="button" onClick={openMemberCreate}><UserPlus size={12}/>添加成员</button></div>
          <div className="team-member-grid">{members.map((member) => {
            const selected = member.id === memberId
            const name = selected && currentDraft ? currentDraft.configuration.displayName : member.name
            const duty = selected && currentDraft ? currentDraft.relationship.duty : member.duty
            const enabled = selected && currentDraft ? currentDraft.relationship.enabled : member.enabled
            return <button type="button" className={`team-member-card ${selected ? 'is-selected' : ''}`} key={member.id} aria-pressed={selected} disabled={saving} onClick={() => { if (!selected) navigate(() => setSelection({ team: selectedTeam.id, member: member.id })) }}>
              <span className="team-member-card__heading"><span className="team-config-avatar"><Bot size={16}/></span><span><strong>{configurationLabel(name, member.role === 'avatar' ? '团队负责人' : '团队成员')}</strong><small>{member.role === 'avatar' ? '负责人' : '成员'}{!enabled ? ' · 未参与' : ''}</small></span></span>
              <span className="team-member-card__duty">{configurationLabel(duty, '未设置团队职责')}</span>
              {selected && (dirty || saved) ? <span className="team-member-card__draft">{dirty ? '未保存' : '草稿已保存'}</span> : null}
            </button>
          })}</div>
          {!members.length ? <div className="development-observation-empty">暂无成员</div> : null}</> : <div className="workflow-stage">
            <div className="workflow-stage__toolbar"><span>{selectedWorkflow ? configurationLabel(selectedWorkflow.name, '未命名流程') : '工作流程'}</span><div>{selectedWorkflow?.draftVersion ? <button type="button" disabled={validating} onClick={() => void validateWorkflow()}><CheckCircle2 size={12}/>{validating ? '正在检查' : '检查草稿'}</button> : null}<button type="button" onClick={openFlowCreate}><Plus size={12}/>新建流程</button></div></div>
            {currentValidation ? <div className={`workflow-validation ${currentValidation.valid ? 'is-valid' : 'is-invalid'}`} role="status">{currentValidation.valid ? '草稿通过检查' : `${currentValidation.issues.length} 项配置需要调整`}</div> : validationError ? <div className="workflow-validation is-invalid" role="alert">{validationError}</div> : null}
            {selectedTeam.workflows.length > 1 ? <div className="workflow-switcher">{selectedTeam.workflows.map((workflow) => <button type="button" key={workflow.id} className={workflow.id === selectedWorkflow?.id ? 'is-active' : ''} onClick={() => setFlowSelection({ workflow: workflow.id, node: '' })}>{configurationLabel(workflow.name, '未命名流程')}</button>)}</div> : null}
            {selectedWorkflow && graphLayout ? <div className="workflow-graph-scroll"><div className="workflow-graph" style={{ width: graphLayout.width, height: graphLayout.height }}>
              <svg aria-hidden="true" width={graphLayout.width} height={graphLayout.height}><defs><marker id="workflow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8Z"/></marker></defs>{selectedWorkflow.edges.map((edge, index) => {
                const from = graphLayout.positions.get(edge.from), to = graphLayout.positions.get(edge.to)
                if (!from || !to) return null
                const startX = from.x + 122, startY = from.y + 26, endX = to.x - 2, endY = to.y + 26
                const back = endX <= startX
                const path = back ? `M ${startX} ${startY} C ${startX + 34} ${graphLayout.height - 10}, ${Math.max(8, endX - 34)} ${graphLayout.height - 10}, ${endX} ${endY}` : `M ${startX} ${startY} C ${(startX + endX) / 2} ${startY}, ${(startX + endX) / 2} ${endY}, ${endX} ${endY}`
                return <path key={`${edge.from}-${edge.to}-${index}`} d={path} className={back ? 'is-back' : ''} markerEnd="url(#workflow-arrow)"/>
              })}</svg>
              {selectedWorkflow.nodes.map((node) => { const position = graphLayout.positions.get(node.id); if (!position) return null; const hasIssue = currentValidation?.issues.some((issue) => issue.nodeId === node.id); return <button type="button" key={node.id} style={{ left: position.x, top: position.y }} className={`workflow-graph__node ${node.id === selectedNode?.id ? 'is-selected' : ''} ${hasIssue ? 'has-issue' : ''}`} aria-pressed={node.id === selectedNode?.id} onClick={() => setFlowSelection({ workflow: selectedWorkflow.id, node: node.id })}><span>{node.type === 'deliver' ? <CheckCircle2 size={15}/> : node.type === 'lead' ? <UsersRound size={15}/> : <Bot size={15}/>}</span><span><strong>{configurationLabel(node.label, nodeTypeLabel(node.type))}</strong><small>{nodeTypeLabel(node.type)}</small></span></button> })}
            </div></div> : <div className="workflow-empty"><Workflow size={20}/><strong>还没有工作流程</strong><p>先建立一条基础流程，再按实际需要增加分支、并行、人工处理或循环。</p><button type="button" className="button button--primary" disabled={!selectedTeam.lead || !selectedTeam.workers.some((member) => member.enabled)} onClick={openFlowCreate}><Plus size={13}/>新建流程</button></div>}
          </div>}
        </main>
        {workspaceView === 'members' ? <aside className="member-inspector" aria-label="成员配置">
          <header className="member-inspector__heading"><span><small>成员配置</small><h3>{configurationLabel(currentDraft?.configuration.displayName ?? selectedMember?.name, '选择成员')}</h3></span><span className="member-inspector__actions"><span className="member-inspector__state" role="status">{dirty ? '未保存' : currentDraft?.revision ? '草稿' : currentDraft ? '已生效' : ''}</span>{selectedMember?.role !== 'avatar' ? <button type="button" aria-label="移出成员" title="移出成员" disabled={saving} onClick={() => navigate(() => { setTeamMutationError(''); setMemberRemoveOpen(true) })}><UserMinus size={13}/></button> : null}</span></header>
          {draftLoading ? <div className="team-config-loading">正在读取配置…</div> : null}
          {draftError ? <div className="member-inspector__error" role="alert">{draftError}{!currentDraft ? <button type="button" className="button" onClick={() => setRetry((value) => value + 1)}>重试</button> : null}</div> : null}
          {currentDraft ? <>
            <fieldset className="member-inspector__fields" disabled={saving}>
              <MemberInspector key={`${teamId}/${memberId}`} draft={currentDraft} runtimes={overview?.runtimes ?? []} onChange={(value) => { setDraft(value); setSaved(false); setDraftError('') }}/>
            </fieldset>
            <footer className="member-inspector__footer"><small>{currentDraft.revision ? '应用后，新工作使用这份配置' : '当前配置已用于新工作'}</small><span className="member-inspector__footer-actions"><button type="button" className="button" disabled={saving || !dirty || !currentDraft.configuration.displayName.trim()} onClick={() => void save()}><Save size={13}/>保存草稿</button><button type="button" className="button button--primary" disabled={saving || dirty || currentDraft.revision < 1} onClick={() => void applyMemberDraft()}><CheckCircle2 size={13}/>{saving ? '处理中' : '应用配置'}</button></span></footer>
          </> : !draftLoading && !draftError ? <div className="team-config-loading">选择团队成员</div> : null}
        </aside> : <aside className="member-inspector" aria-label="流程步骤">
          <header className="member-inspector__heading"><span><small>流程步骤</small><h3>{configurationLabel(selectedNode?.label, selectedNode ? nodeTypeLabel(selectedNode.type) : '选择步骤')}</h3></span>{selectedWorkflow ? <span className="member-inspector__state">{selectedWorkflow.publishedVersion ? '已发布' : '草稿'}</span> : null}</header>
          {selectedWorkflow && selectedNode ? <div className="workflow-inspector"><dl className="member-summary"><div className="member-summary-row"><dt>所属流程</dt><dd>{configurationLabel(selectedWorkflow.name, '未命名流程')}</dd></div><div className="member-summary-row"><dt>步骤类型</dt><dd>{nodeTypeLabel(selectedNode.type)}</dd></div>{selectedNode.workerId ? <div className="member-summary-row"><dt>执行成员</dt><dd>{configurationLabel(members.find((member) => member.id === selectedNode.workerId)?.name, '团队成员')}</dd></div> : null}<div className="member-summary-row"><dt>当前版本</dt><dd>{selectedWorkflow.publishedVersion ? `正式版 ${selectedWorkflow.publishedVersion}` : selectedWorkflow.draftVersion ? '开发草稿' : '未保存'}</dd></div></dl>{currentValidation && !currentValidation.valid ? <section className="workflow-issues"><h4>检查结果</h4>{currentValidation.issues.filter((issue) => !issue.nodeId || issue.nodeId === selectedNode.id).map((issue, index) => <p key={`${issue.code}-${index}`}>{issueLabel(issue.code)}</p>)}</section> : null}</div> : <div className="team-config-loading">创建流程后可查看步骤配置</div>}
        </aside>}
      </div> : null}
    </section>
    {pendingAction ? <Modal title="有未保存的修改" onClose={() => { if (!saving) setPendingAction(null) }} footer={<>
      <button type="button" className="button" disabled={saving} onClick={() => setPendingAction(null)}>继续编辑</button>
      <button type="button" className="button" disabled={saving} onClick={() => { pendingAction(); setPendingAction(null) }}>放弃修改</button>
      <button type="button" className="button button--primary" disabled={saving} onClick={() => { void save().then((success) => { if (success) { pendingAction(); setPendingAction(null) } }) }}>{saving ? '正在保存' : '保存并继续'}</button>
    </>}><p>{configurationLabel(currentDraft?.configuration.displayName, '当前成员')}的修改尚未保存。</p>{draftError ? <p role="alert">{draftError}</p> : null}</Modal> : null}
    {createOpen ? <Modal title="新建团队" onClose={() => { if (!creating) setCreateOpen(false) }} footer={<>
      <button type="button" className="button" disabled={creating} onClick={() => setCreateOpen(false)}>取消</button>
      <button type="button" className="button button--primary" disabled={creating || !createName.trim() || !createObjective.trim()} onClick={() => void createTeam()}>{creating ? '正在创建' : '创建团队'}</button>
    </>}><div className="team-create-form"><ProductField autoFocus label="团队名称" maxLength={80} value={createName} onChange={(event) => setCreateName(event.target.value)}/><ProductTextArea label="团队目标" rows={5} maxLength={2000} value={createObjective} onChange={(event) => setCreateObjective(event.target.value)}/>{createError ? <p role="alert">{createError}</p> : null}</div></Modal> : null}
    {teamEditOpen ? <Modal title="编辑团队资料" onClose={() => { if (!teamMutationBusy) setTeamEditOpen(false) }} footer={<><button type="button" className="button" disabled={teamMutationBusy} onClick={() => setTeamEditOpen(false)}>取消</button><button type="button" className="button button--primary" disabled={teamMutationBusy || !teamEditName.trim() || !teamEditObjective.trim()} onClick={() => void updateTeam()}>{teamMutationBusy ? '正在保存' : '保存'}</button></>}><div className="team-create-form"><ProductField autoFocus label="团队名称" maxLength={80} value={teamEditName} onChange={(event) => setTeamEditName(event.target.value)}/><ProductTextArea label="团队目标" rows={5} maxLength={2000} value={teamEditObjective} onChange={(event) => setTeamEditObjective(event.target.value)}/>{teamMutationError ? <p role="alert">{teamMutationError}</p> : null}</div></Modal> : null}
    {memberCreateOpen ? <Modal title="添加成员" onClose={() => { if (!teamMutationBusy) setMemberCreateOpen(false) }} footer={<><button type="button" className="button" disabled={teamMutationBusy} onClick={() => setMemberCreateOpen(false)}>取消</button><button type="button" className="button button--primary" disabled={teamMutationBusy || !memberCreateName.trim() || !memberCreateDuty.trim()} onClick={() => void createMember()}>{teamMutationBusy ? '正在添加' : '添加'}</button></>}><div className="team-create-form"><ProductField autoFocus label="成员名称" maxLength={80} value={memberCreateName} onChange={(event) => setMemberCreateName(event.target.value)}/><ProductTextArea label="团队职责" rows={5} maxLength={2000} value={memberCreateDuty} onChange={(event) => setMemberCreateDuty(event.target.value)}/>{teamMutationError ? <p role="alert">{teamMutationError}</p> : null}</div></Modal> : null}
    {memberRemoveOpen && selectedMember ? <Modal title="移出成员" onClose={() => { if (!teamMutationBusy) setMemberRemoveOpen(false) }} footer={<><button type="button" className="button" disabled={teamMutationBusy} onClick={() => setMemberRemoveOpen(false)}>取消</button><button type="button" className="button button--danger" disabled={teamMutationBusy} onClick={() => void removeMember()}>{teamMutationBusy ? '正在移出' : '移出团队'}</button></>}><p>“{configurationLabel(selectedMember.name, '当前成员')}”将不再参与这个团队的新工作，已有运行记录仍会保留。</p>{teamMutationError ? <p role="alert">{teamMutationError}</p> : null}</Modal> : null}
    {flowCreateOpen ? <Modal title="新建工作流程" onClose={() => { if (!flowCreating) setFlowCreateOpen(false) }} footer={<>
      <button type="button" className="button" disabled={flowCreating} onClick={() => setFlowCreateOpen(false)}>取消</button>
      <button type="button" className="button button--primary" disabled={flowCreating || !flowCreateName.trim() || !flowCreateDescription.trim()} onClick={() => void createWorkflow()}>{flowCreating ? '正在创建' : '创建流程'}</button>
    </>}><div className="team-create-form"><ProductField autoFocus label="流程名称" maxLength={80} value={flowCreateName} onChange={(event) => setFlowCreateName(event.target.value)}/><ProductTextArea label="流程用途" rows={4} maxLength={2000} value={flowCreateDescription} onChange={(event) => setFlowCreateDescription(event.target.value)}/>{flowCreateError ? <p role="alert">{flowCreateError}</p> : null}</div></Modal> : null}
  </div></div>
}
