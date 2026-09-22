import '@/styles/team-workspace.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Code2, Plus, RefreshCw, UsersRound, Workflow, Play, X } from 'lucide-react'
import { Modal, ProductField, ProductTextArea, ProductSelect } from '@/components/ui'
import { MemberInspector } from '@/components/development/MemberInspector'
import type { PrimeWorkApi, EnterpriseBusinessCapabilityCatalog, EnterpriseDevelopmentOverview, EnterpriseEnvironmentStatus } from '@/types/api'
import type { TeamDefinition, TeamWorkspaceBridge } from '@/types/team-workspace'
import { useTeamDraft } from './team-workspace/useTeamDraft'
import { newMember } from './team-workspace/member'
import { StepInspector } from './team-workspace/StepInspector'
import { FlowCanvas, ObjectMenu } from './team-workspace/TeamCanvas'
import { EditableText } from './team-workspace/EditableText'
import { TrialPanel } from './team-workspace/TrialPanel'
import { initialGraph, insertStep, addParallelBranch, serializeParallel, removeStep } from './team-workspace/graph'
import './team-workspace/workspace.css'

interface Props { overview?: EnterpriseDevelopmentOverview; loading: boolean; error?: string; accountId?: string; bridge: PrimeWorkApi['enterprise']; environments?: EnterpriseEnvironmentStatus[]; onOpenForge?(url: string): void; onNavigationGuard?(guard?: (action: () => void) => void): void; onRefresh(): void }
export function DevelopmentPage({ overview, loading, error, accountId, bridge, environments = [], onOpenForge, onNavigationGuard, onRefresh }: Props) {
  const navigationGuard = useRef<((action: () => void) => void) | undefined>(undefined)
  const registerGuard = useCallback((guard?: (action: () => void) => void) => { navigationGuard.current = guard; onNavigationGuard?.(guard) }, [onNavigationGuard])
  const navigate = (action: () => void) => navigationGuard.current ? navigationGuard.current(action) : action()
  const [teamId, setTeamId] = useState('')
  const [tab, setTab] = useState('teams')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(''), [objective, setObjective] = useState(''), [mutationError, setMutationError] = useState('')
  const [createdTeam, setCreatedTeam] = useState<{ id: string; name: string }>()
  const [businessCapabilities, setBusinessCapabilities] = useState<EnterpriseBusinessCapabilityCatalog>()
  const [businessCapabilityError, setBusinessCapabilityError] = useState('')
  const call = useCallback(<T,>(command: Parameters<TeamWorkspaceBridge>[0]) => bridge.teamWorkspace<T>({ ...command, accountId }), [bridge, accountId])
  useEffect(() => {
    let active = true
    setBusinessCapabilityError('')
    if (typeof bridge.getBusinessCapabilityCatalog !== 'function') return () => { active = false }
    void bridge.getBusinessCapabilityCatalog().then((catalog) => { if (active) setBusinessCapabilities(catalog) }).catch((cause) => {
      if (active) { setBusinessCapabilities(undefined); setBusinessCapabilityError((cause as Error).message) }
    })
    return () => { active = false }
  }, [bridge, accountId])
  const teams = (overview?.teams ?? []).filter((t) => t.status !== 'archived')
  const selected = teamId || teams[0]?.id || ''
  const create = async () => {
    setBusy(true); setMutationError('')
    try { const team = await bridge.createDevelopmentTeam({ version: '1', name, objective }); setCreatedTeam(team); setTeamId(team.id); setCreating(false); setName(''); setObjective(''); onRefresh() }
    catch (cause) { setMutationError((cause as Error).message) }
    finally { setBusy(false) }
  }
  const options = [...teams.map((t) => ({ id: t.id, name: t.name })), ...(createdTeam && !teams.some((t) => t.id === createdTeam.id) ? [createdTeam] : [])]
  const forge = environments.find((e) => e.id === 'forge-development')
  return <div className="page development-shell"><div className="page-container development-page tw-restored">
    <div className="development-toolbar"><nav className="development-tabs" aria-label="开发中心分类"><button type="button" className={tab === 'teams' ? 'is-active' : ''} onClick={() => setTab('teams')}><UsersRound size={14}/><strong>智能体团队</strong></button><button type="button" className={tab === 'apps' ? 'is-active' : ''} onClick={() => navigate(() => setTab('apps'))}><Code2 size={14}/><strong>应用开发</strong></button></nav><button type="button" className="icon-button" aria-label="刷新开发中心" disabled={loading} onClick={onRefresh}><RefreshCw size={14}/></button></div>
    {error && <p className="tw-alert" role="alert">{error}</p>}
    {tab === 'apps' ? <section className="development-app-workspace"><strong>应用开发调试区</strong><button type="button" className="button" disabled={!forge?.available} onClick={() => forge && onOpenForge?.(forge.url)}>打开 Forge 开发环境</button></section> : selected ? <TeamEditor key={selected} teamId={selected} teams={options} overview={overview} businessCapabilities={businessCapabilities} businessCapabilityError={businessCapabilityError} bridge={call} registerGuard={registerGuard} onSelect={setTeamId} onCreate={() => setCreating(true)} onDeleted={() => { setTeamId(''); setCreatedTeam(undefined); onRefresh() }}/> : <div className="team-workspace-empty"><UsersRound size={24}/><strong>{loading ? '正在读取团队…' : '当前组织还没有团队'}</strong><button type="button" className="button" onClick={() => setCreating(true)}>新建团队</button></div>}
    {creating && <Modal title="新建团队" onClose={() => { if (!busy) setCreating(false) }} footer={<><button type="button" className="button" disabled={busy} onClick={() => setCreating(false)}>取消</button><button type="button" className="button button--primary" disabled={busy || !name.trim() || !objective.trim()} onClick={() => void create()}>{busy ? '正在创建' : '创建团队'}</button></>}><div className="tw-form"><ProductField autoFocus label="团队名称" maxLength={80} value={name} onChange={(e) => setName(e.target.value)}/><ProductTextArea label="团队目标" rows={4} maxLength={2000} value={objective} onChange={(e) => setObjective(e.target.value)}/>{mutationError && <p role="alert">{mutationError}</p>}</div></Modal>}
  </div></div>
}

function TeamEditor({ teamId, teams, overview, businessCapabilities, businessCapabilityError, bridge, registerGuard, onSelect, onCreate, onDeleted }: { teamId: string; teams: Array<{ id: string; name: string }>; overview?: EnterpriseDevelopmentOverview; businessCapabilities?: EnterpriseBusinessCapabilityCatalog; businessCapabilityError?: string; bridge: TeamWorkspaceBridge; registerGuard(guard?: (action: () => void) => void): void; onSelect(id: string): void; onCreate(): void; onDeleted(): void }) {
  const workspace = useTeamDraft(teamId, bridge)
  const { draft, dirty, saving, error, edit, flush, replace } = workspace
  const [view, setView] = useState<'members' | 'workflow'>('members')
  const [memberId, setMemberId] = useState(''), [stepId, setStepId] = useState('')
  const [panel, setPanel] = useState<'object' | 'team' | 'trial' | 'changes'>('object')
  const [creatingObject, setCreatingObject] = useState<'member' | 'flow' | 'step'>(), [objectName, setObjectName] = useState(''), [objectPurpose, setObjectPurpose] = useState('')
  const [stepOperation, setStepOperation] = useState<'insert' | 'branch'>('insert'), [stepMember, setStepMember] = useState('')
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [deleting, setDeleting] = useState(false)
  const [undo, setUndo] = useState<{ document: TeamDefinition; label: string }>(), [notice, setNotice] = useState('')
  const [pendingNavigation, setPendingNavigation] = useState<(() => void)>()
  const navigate = useCallback((action: () => void) => { if (dirty || saving) setPendingNavigation(() => action); else action() }, [dirty, saving])
  useEffect(() => { registerGuard(navigate); return () => registerGuard(undefined) }, [navigate, registerGuard])
  const perform = async (action: () => Promise<void>) => { setBusy(true); setActionError(''); try { await action() } catch (cause) { setActionError((cause as Error).message) } finally { setBusy(false) } }
  if (!draft) return <div className="team-workspace-empty">{error ? <><p role="alert">{error}</p><button type="button" className="button" onClick={() => void workspace.load()}>重新读取</button></> : '正在读取团队…'}</div>
  const doc = draft.document, member = doc.members.find((m) => m.id === memberId) ?? doc.members[0], flow = doc.workflows[0]
  const step = flow?.graph_definition.nodes.find((n) => n.id === stepId) ?? flow?.graph_definition.nodes[0]
  const change = (document: TeamDefinition) => { setUndo(undefined); setNotice(''); edit(document) }
  const addMember = () => { setObjectName(''); setObjectPurpose(''); setCreatingObject('member') }
  const createMember = () => { const next = newMember(member?.configuration.model || overview?.models[0]); next.configuration.displayName = objectName.trim(); next.relationship.duty = objectPurpose.trim(); next.configuration.systemPrompt = objectPurpose.trim(); setCreatingObject(undefined); change({ ...doc, members: [...doc.members, next] }); setMemberId(next.id); setView('members'); setPanel('object') }
  const removeMember = () => {
    if (!member || member.configuration.role === 'avatar') return
    const uses = doc.workflows.flatMap((f) => f.graph_definition.nodes.filter((n) => n.config?.agent_id === member.id).map((n) => `${f.name} / ${n.label || '执行步骤'}`))
    if (uses.length) { setActionError(`“${member.configuration.displayName}”仍被以下步骤使用：${uses.join('、')}。请先调整执行成员。`); return }
    if (doc.members.length <= 2) { setActionError('团队至少保留一位负责人和一位执行成员。'); return }
    change({ ...doc, members: doc.members.filter((m) => m.id !== member.id) }); setUndo({ document: structuredClone(doc), label: `已移出“${member.configuration.displayName}”` }); setMemberId(''); setActionError('')
  }
  const addFlow = () => { if (doc.workflows.length) return; setObjectName(''); setObjectPurpose(''); setCreatingObject('flow') }
  const createFlow = () => {
    if (doc.workflows.length) { setCreatingObject(undefined); return }
    const worker = doc.members.find((m) => m.configuration.role === 'worker' && m.relationship.enabled)
    if (!worker) { setActionError('请先添加执行成员'); return }
    const next = { id: crypto.randomUUID(), name: objectName.trim(), description: objectPurpose.trim(), trigger_config: { schema_version: 1, type: 'conversation_explicit', config: {} }, graph_definition: initialGraph(worker) }
    setCreatingObject(undefined); change({ ...doc, workflows: [next] }); setView('workflow'); setPanel('object')
  }
  const applyGraph = (operation: 'insert' | 'branch' | 'serial') => {
    if (!flow || !step) return
    const worker = doc.members.find((m) => m.id === stepMember && m.configuration.role === 'worker' && m.relationship.enabled) ?? doc.members.find((m) => m.configuration.role === 'worker' && m.relationship.enabled)
    if (!worker) { setActionError('请先添加执行成员'); return }
    try {
      const next = operation === 'serial' ? { graph: serializeParallel(flow.graph_definition, step.id), selected: '' } : operation === 'branch' ? addParallelBranch(flow.graph_definition, step.id, worker) : insertStep(flow.graph_definition, step.id, worker)
      if (operation !== 'serial') { next.graph.nodes = next.graph.nodes.map((n) => n.id === next.selected ? { ...n, label: objectName.trim(), config: { ...n.config, result_requirement: objectPurpose.trim() } } : n); setCreatingObject(undefined) }
      change({ ...doc, workflows: doc.workflows.map((f) => f.id === flow.id ? { ...f, graph_definition: next.graph } : f) }); setUndo({ document: structuredClone(doc), label: '已调整流程连接' }); setStepId(next.selected); setPanel('object'); setActionError('')
    } catch (cause) { setActionError((cause as Error).message) }
  }
  const changeGraph = (operation: 'insert' | 'branch' | 'serial') => { if (operation === 'serial') { applyGraph(operation); return }; setStepOperation(operation); setObjectName(''); setObjectPurpose(''); setStepMember(doc.members.find((m) => m.configuration.role === 'worker' && m.relationship.enabled)?.id || ''); setCreatingObject('step') }
  const addStep = () => changeGraph('insert')
  const baseline = draft.published_document
  const changes: string[] = []
  if (baseline) {
    if (baseline.name !== doc.name || baseline.objective !== doc.objective) changes.push('团队说明')
    for (const m of doc.members) { const old = baseline.members.find((x) => x.id === m.id); if (!old) changes.push(`新增成员：${m.configuration.displayName}`); else if (JSON.stringify(old) !== JSON.stringify(m)) changes.push(`修改成员：${m.configuration.displayName}`) }
    for (const m of baseline.members) if (!doc.members.some((x) => x.id === m.id)) changes.push(`移出成员：${m.configuration.displayName}`)
    for (const f of doc.workflows) { const old = baseline.workflows.find((x) => x.id === f.id); if (!old) changes.push(`新增流程：${f.name}`); else if (JSON.stringify(old) !== JSON.stringify(f)) changes.push(`修改流程：${f.name}`) }
    for (const f of baseline.workflows) if (!doc.workflows.some((x) => x.id === f.id)) changes.push(`删除流程：${f.name}`)
  }
  const ready = !dirty && doc.workflows.length > 0 && doc.workflows.every((f) => draft.trials.some((t) => t.revision === draft.revision && t.workflow_id === f.id && t.status === 'succeeded'))
  const hasChanges = changes.length > 0 || !!draft.publishing_revision
  const title = panel === 'team' ? (view === 'members' ? '团队资料' : '流程说明') : panel === 'trial' ? '流程调试' : panel === 'changes' ? '待生效的修改' : view === 'members' ? member?.configuration.displayName || '团队成员' : step?.label || '流程步骤'
  return <section className="team-workspace tw-restored-workspace">
    {(error || actionError) && <div className="tw-alert" role="alert">{error || actionError}{error && <button type="button" className="button" onClick={() => void perform(async () => { await flush() })}>重试</button>}</div>}
    {(undo || notice) && <div className="tw-top-tips" aria-live="polite">{undo && <div className="tw-tip" role="status"><span>{undo.label}</span><button type="button" className="button" onClick={() => { edit(undo.document); setUndo(undefined) }}>撤销</button><button type="button" className="tw-edit-icon" aria-label="关闭提示" onClick={() => setUndo(undefined)}><X size={13}/></button></div>}{notice && <div className="tw-tip" role="status"><span>{notice}</span><button type="button" className="tw-edit-icon" aria-label="关闭提示" onClick={() => setNotice('')}><X size={13}/></button></div>}</div>}
    <div className={`team-workspace__layout team-workspace__layout--${view}`}>
      <aside className="team-collection"><div className="tw-team-picker"><ProductSelect label="切换团队" value={teamId} options={teams.map((t) => ({ value: t.id, label: t.id === teamId ? doc.name : t.name }))} onChange={(id) => navigate(() => onSelect(id))}/></div><button type="button" className="button tw-text-action" aria-label="新建团队" onClick={() => navigate(onCreate)}><Plus size={14}/>新建团队</button><nav className="team-stage__views" aria-label="团队开发视图"><button type="button" className={view === 'members' ? 'is-active' : ''} onClick={() => { setView('members'); setPanel('object') }}><UsersRound size={13}/>团队分工</button><button type="button" className={view === 'workflow' ? 'is-active' : ''} onClick={() => { setView('workflow'); setPanel('object') }}><Workflow size={13}/>工作流程</button></nav><span className="tw-save-state" role="status">{saving ? '保存中' : dirty ? '未保存' : error ? '同步失败' : ''}</span><ObjectMenu label="团队" actions={[{ label: '删除团队', danger: true, run: () => setDeleting(true) }]}/></aside>
      <main className="team-stage">
        {view === 'members' ? <><div className="team-profile-overview"><EditableText label="团队名称" value={doc.name} multiline={false} onChange={(name) => change({ ...doc, name })}/><EditableText label="团队目标与承接范围" value={doc.objective} onChange={(objective) => change({ ...doc, objective })}/></div><div className="team-stage__section-heading"><h3>团队成员</h3><button type="button" onClick={addMember}><Plus size={12}/>添加成员</button></div><div className="team-member-grid">{doc.members.map((m) => <button type="button" className={`team-member-card ${member?.id === m.id && panel === 'object' ? 'is-selected' : ''}`} key={m.id} onClick={() => { setMemberId(m.id); setPanel('object') }}><span className="team-member-card__heading"><span className="team-config-avatar"><Bot size={16}/></span><span><strong>{m.configuration.displayName}</strong><small>{m.configuration.role === 'avatar' ? '负责人' : '成员'}</small></span></span><span className="team-member-card__duty">{m.relationship.duty || '尚未填写职责'}</span></button>)}</div></> : <div className="workflow-stage">{flow ? <><div className="workflow-stage__toolbar"><div className="workflow-profile"><EditableText label="流程名称" value={flow.name} multiline={false} onChange={(name) => change({ ...doc, workflows: doc.workflows.map((f) => f.id === flow.id ? { ...f, name } : f) })}/><EditableText label="流程说明" value={flow.description} onChange={(description) => change({ ...doc, workflows: doc.workflows.map((f) => f.id === flow.id ? { ...f, description } : f) })}/></div><button type="button" onClick={() => setPanel('trial')}><Play size={12}/>调试</button></div><FlowCanvas flow={flow} members={doc.members} selected={step?.id} onSelect={(id) => { setStepId(id); setPanel('object') }} onAdd={addStep} onBranch={() => changeGraph('branch')}/></> : <div className="workflow-empty"><Workflow size={22}/><strong>当前团队还没有流程</strong><button type="button" className="button" onClick={addFlow}><Plus size={13}/>新建流程</button></div>}</div>}
        {dirty && <div className="tw-save-bar"><span>修改尚未保存</span><button type="button" className="button" disabled={saving} onClick={() => workspace.discard()}>放弃修改</button><button type="button" className="button button--primary" disabled={saving} onClick={() => void perform(async () => { await flush() })}>{saving ? '保存中' : '保存'}</button></div>}{hasChanges && <button type="button" className="tw-change-note" onClick={() => setPanel('changes')}><span className="tw-change-dot"/>{draft.publishing_revision ? '更新尚未完成' : `草稿 · ${changes.length} 项修改`}<span>查看修改</span></button>}
      </main>
      <aside className="member-inspector" aria-label={title}><header className="member-inspector__heading"><span><small>{panel === 'object' ? view === 'members' ? '成员配置' : '流程步骤' : doc.name}</small><h3>{title}</h3></span>{panel !== 'object' ? <button type="button" className="icon-button" aria-label="返回对象详情" onClick={() => setPanel('object')}><X size={15}/></button> : view === 'members' && member?.configuration.role !== 'avatar' ? <ObjectMenu label="成员" actions={[{ label: '移出团队', danger: true, run: removeMember }]}/> : view === 'workflow' && step ? <ObjectMenu label="步骤" actions={[{ label: '在后面插入步骤', run: addStep }, ...(['worker', 'parallel'].includes(step.type) ? [{ label: '添加并行分支', run: () => changeGraph('branch') }] : []), ...(step.type === 'parallel' ? [{ label: '改为依次执行', run: () => changeGraph('serial') }] : []), ...(step.type === 'worker' ? [{ label: '删除步骤', danger: true, run: () => { try { const next = removeStep(flow.graph_definition, step.id); change({ ...doc, workflows: doc.workflows.map((f) => f.id === flow.id ? { ...f, graph_definition: next } : f) }); setUndo({ document: structuredClone(doc), label: `已删除“${step.label || '执行步骤'}”` }); setStepId('') } catch (cause) { setActionError((cause as Error).message) } } }] : []) ]}/> : null}</header>
        <fieldset className="member-inspector__fields" disabled={!!draft.publishing_revision || busy}>
          {panel === 'object' && view === 'members' && member && <MemberInspector key={member.id} draft={{ version: '1', teamId, agentId: member.id, agentName: member.configuration.displayName, baseAgentVersion: 1, revision: draft.revision, updatedAt: draft.updated_at, configuration: member.configuration, relationship: member.relationship }} models={overview?.models ?? []} runtimes={overview?.runtimes ?? []} businessCapabilities={businessCapabilities} businessCapabilityError={businessCapabilityError} onChange={(next) => change({ ...doc, members: doc.members.map((m) => m.id === member.id ? { ...m, configuration: next.configuration, relationship: next.relationship } : m) })}/>}
          {panel === 'object' && view === 'workflow' && flow && step && <StepInspector key={step.id} flow={flow} step={step} members={doc.members} onChange={(next) => change({ ...doc, workflows: doc.workflows.map((f) => f.id === flow.id ? { ...f, graph_definition: { ...f.graph_definition, nodes: f.graph_definition.nodes.map((n) => n.id === next.id ? next : n) } } : f) })}/>}
          {panel === 'trial' && <div className="tw-inspector-content"><TrialPanel key={flow?.id} initialFlowId={flow?.id} teamId={teamId} draft={draft} bridge={bridge} flush={async () => { if (dirty) throw new Error('请先保存修改，再调试本次配置'); return draft }} refresh={workspace.refreshTrials}/></div>}
        </fieldset>
          {panel === 'changes' && <div className="tw-inspector-content tw-form"><ul className="tw-change-list">{changes.map((item) => <li key={item}>{item}</li>)}</ul>{baseline && !draft.publishing_revision && <button type="button" className="button" disabled={busy || saving} onClick={() => { change(structuredClone(baseline)); setUndo({ document: structuredClone(doc), label: '已恢复到当前生效配置' }) }}>恢复生效配置</button>}<p className="tw-muted">更新后用于新工作，正在执行的工作保持原配置。</p>{!ready && !draft.publishing_revision && <div className="tw-readiness">{doc.workflows.filter((f) => dirty || !draft.trials.some((t) => t.workflow_id === f.id && t.revision === draft.revision && t.status === 'succeeded')).map((f) => <button type="button" key={f.id} onClick={() => { setView('workflow'); setPanel('trial') }}><Play size={13}/>{f.name} · 待调试</button>)}</div>}<button type="button" className="button button--primary" disabled={busy || saving || (!ready && !draft.publishing_revision)} onClick={() => void perform(async () => { const saved = await flush(); if (!saved) return; replace(await bridge({ action: 'publish', teamId, revision: saved.revision })); setNotice('团队已更新，新工作将使用本次配置。'); setPanel('object') })}>{busy ? '正在更新' : draft.publishing_revision ? '继续本次更新' : '更新团队'}</button></div>}
      </aside>
    </div>
    {pendingNavigation && <Modal title="修改尚未保存" onClose={() => setPendingNavigation(undefined)} footer={<><button type="button" className="button" onClick={() => setPendingNavigation(undefined)}>继续编辑</button><button type="button" className="button" disabled={saving} onClick={() => { const next = pendingNavigation; workspace.discard(); setPendingNavigation(undefined); next() }}>放弃修改并离开</button><button type="button" className="button button--primary" disabled={saving} onClick={() => void perform(async () => { await flush(); const next = pendingNavigation; setPendingNavigation(undefined); next() })}>保存并离开</button></>}><p>未保存的修改只保留在当前页面。</p>{actionError && <p role="alert">{actionError}</p>}</Modal>}
    {creatingObject && <Modal title={creatingObject === 'member' ? '添加成员' : creatingObject === 'flow' ? '新建流程' : stepOperation === 'branch' ? '添加并行分支' : '添加下一步'} onClose={() => setCreatingObject(undefined)} footer={<><button type="button" className="button" onClick={() => setCreatingObject(undefined)}>取消</button><button type="button" className="button button--primary" disabled={!objectName.trim() || !objectPurpose.trim()} onClick={creatingObject === 'member' ? createMember : creatingObject === 'flow' ? createFlow : () => applyGraph(stepOperation)}>{creatingObject === 'member' ? '添加成员' : creatingObject === 'flow' ? '创建流程' : '添加步骤'}</button></>}><div className="tw-form">{creatingObject === 'step' && <ProductSelect label="由谁执行" value={stepMember} options={doc.members.filter((m) => m.relationship.enabled && (stepOperation !== 'branch' || m.configuration.role === 'worker')).map((m) => ({ value: m.id, label: m.configuration.displayName }))} onChange={setStepMember}/>}<ProductField autoFocus label={creatingObject === 'member' ? '成员名称' : creatingObject === 'flow' ? '流程名称' : '步骤名称'} placeholder={creatingObject === 'member' ? '例如：问题分类员' : creatingObject === 'flow' ? '例如：产品反馈处理流程' : '例如：整理用户反馈'} maxLength={80} value={objectName} onChange={(e) => setObjectName(e.target.value)}/><ProductTextArea label={creatingObject === 'member' ? '负责什么' : creatingObject === 'flow' ? '这个流程完成什么工作' : '这一步完成什么工作'} placeholder={creatingObject === 'member' ? '例如：将反馈按产品模块分类，标出重复问题和判断依据。' : '例如：接收用户反馈，分类后形成待处理的问题清单。'} rows={4} value={objectPurpose} onChange={(e) => setObjectPurpose(e.target.value)}/></div></Modal>}
    {deleting && <Modal title={`删除“${doc.name}”`} onClose={() => { if (!busy) setDeleting(false) }} footer={<><button type="button" className="button" disabled={busy} onClick={() => setDeleting(false)}>取消</button><button type="button" className="button button--danger" disabled={busy || !!draft.publishing_revision} onClick={() => void perform(async () => { await bridge({ action: 'delete', teamId }); onDeleted() })}>{busy ? '正在删除' : '删除团队'}</button></>}><p>团队将停止接新工作，已有运行、交付和历史版本保留。</p>{actionError && <p role="alert">{actionError}</p>}</Modal>}
  </section>
}
