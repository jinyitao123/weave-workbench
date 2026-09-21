import '@/styles/team-workspace.css'
import { Bot, Code2, ExternalLink, Plus, RefreshCw, Save, Search, UsersRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Modal, ProductField, ProductTextArea } from '@/components/ui'
import { configurationLabel, MemberInspector } from '@/components/development/MemberInspector'
import type { EnterpriseCreateTeamInput, EnterpriseCreateTeamResult, EnterpriseDevelopmentOverview, EnterpriseEnvironmentStatus, EnterpriseTeamMemberConfigDraft } from '@/types/api'

interface DevelopmentPageProps {
  environments: EnterpriseEnvironmentStatus[]
  overview?: EnterpriseDevelopmentOverview
  loading: boolean
  error: string
  onRefresh(): void
  onOpenForge(url: string): void
  onCreateTeam(input: EnterpriseCreateTeamInput): Promise<EnterpriseCreateTeamResult>
  onLoadMemberDraft(teamId: string, agentId: string): Promise<EnterpriseTeamMemberConfigDraft>
  onSaveMemberDraft(draft: EnterpriseTeamMemberConfigDraft): Promise<EnterpriseTeamMemberConfigDraft>
}

const fingerprint = (draft: EnterpriseTeamMemberConfigDraft) => JSON.stringify([draft.configuration, draft.relationship])

export function DevelopmentPage({ environments, overview, loading, error, onRefresh, onOpenForge, onCreateTeam, onLoadMemberDraft, onSaveMemberDraft }: DevelopmentPageProps) {
  const forge = environments.find((environment) => environment.id === 'forge-development')
  const weave = environments.find((environment) => environment.id === 'weave-development')
  const [activeTab, setActiveTab] = useState<'teams' | 'apps'>('teams')
  const [selection, setSelection] = useState({ team: '', member: '' })
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
  // App passes inline callbacks. Parent refreshes must never reset an edited draft.
  const loadRef = useRef(onLoadMemberDraft)
  loadRef.current = onLoadMemberDraft
  const selectedTeam = overview?.teams.find((team) => team.id === selection.team) ?? overview?.teams[0]
  const members = selectedTeam ? [selectedTeam.lead, ...selectedTeam.workers].filter((item): item is NonNullable<typeof item> => Boolean(item)) : []
  const selectedMember = members.find((member) => member.id === selection.member) ?? members[0]
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
  const environmentSummary = (environment: EnterpriseEnvironmentStatus | undefined, fallback: string, canOpen = false) => <div className="development-environment-summary">
    <i className={environment?.available ? 'is-online' : ''}/><span><strong>{environment?.name ?? fallback}</strong><small>{loading ? '正在检查' : environment?.available ? '可用' : '暂不可用'}</small></span>
    {canOpen ? <button type="button" className="development-environment-open" aria-label="打开 Forge" title="打开 Forge" disabled={!environment?.available} onClick={() => environment && onOpenForge(environment.url)}><ExternalLink size={13}/></button> : null}
  </div>

  return <div className="page development-shell"><div className="page-container development-page">
    <header className="page-header"><h1>开发中心</h1><button type="button" className="icon-button" aria-label="刷新开发中心" title="刷新开发中心" disabled={saving || loading} onClick={() => navigate(() => { onRefresh(); setRetry((value) => value + 1) })}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button></header>
    <div className="development-toolbar">
      <nav className="development-tabs" aria-label="开发中心分类">
        <button type="button" className={activeTab === 'teams' ? 'is-active' : ''} aria-pressed={activeTab === 'teams'} onClick={() => setActiveTab('teams')}><UsersRound size={14}/><strong>智能体团队</strong></button>
        <button type="button" className={activeTab === 'apps' ? 'is-active' : ''} aria-pressed={activeTab === 'apps'} onClick={() => setActiveTab('apps')}><Code2 size={14}/><strong>应用开发</strong></button>
      </nav>
      {activeTab === 'teams' ? environmentSummary(weave, 'Weave 协作服务') : environmentSummary(forge, 'Forge 业务环境', true)}
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
          <header className="team-stage__header"><h2>{configurationLabel(selectedTeam.name, '未命名团队')}</h2>{selectedTeam.objective ? <p>{configurationLabel(selectedTeam.objective, '团队协作')}</p> : null}</header>
          <div className="team-stage__section-heading"><h3>团队成员</h3></div>
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
          {!members.length ? <div className="development-observation-empty">暂无成员</div> : null}
        </main>
        <aside className="member-inspector" aria-label="成员配置">
          <header className="member-inspector__heading"><span><small>成员配置</small><h3>{configurationLabel(currentDraft?.configuration.displayName ?? selectedMember?.name, '选择成员')}</h3></span><span className="member-inspector__state" role="status">{dirty ? '未保存' : saved ? '已保存' : currentDraft?.revision ? '草稿' : ''}</span></header>
          {draftLoading ? <div className="team-config-loading">正在读取配置…</div> : null}
          {draftError ? <div className="member-inspector__error" role="alert">{draftError}{!currentDraft ? <button type="button" className="button" onClick={() => setRetry((value) => value + 1)}>重试</button> : null}</div> : null}
          {currentDraft ? <>
            <fieldset className="member-inspector__fields" disabled={saving}>
              <MemberInspector key={`${teamId}/${memberId}`} draft={currentDraft} runtimes={overview?.runtimes ?? []} onChange={(value) => { setDraft(value); setSaved(false); setDraftError('') }}/>
            </fieldset>
            <footer className="member-inspector__footer"><small>保存到草稿，不影响运行</small><button type="button" className="button button--primary" disabled={saving || !dirty || !currentDraft.configuration.displayName.trim()} onClick={() => void save()}><Save size={13}/>{saving ? '正在保存' : '保存草稿'}</button></footer>
          </> : !draftLoading && !draftError ? <div className="team-config-loading">选择团队成员</div> : null}
        </aside>
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
  </div></div>
}
