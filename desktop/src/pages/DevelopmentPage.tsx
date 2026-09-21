import { Bot, Code2, ExternalLink, RefreshCw, Save, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ProductField, ProductSelect, ProductSwitch, ProductTextArea } from '@/components/ui'
import type { EnterpriseDevelopmentOverview, EnterpriseEnvironmentStatus, EnterpriseTeamMemberConfigDraft } from '@/types/api'

interface DevelopmentPageProps {
  environments: EnterpriseEnvironmentStatus[]
  overview?: EnterpriseDevelopmentOverview
  loading: boolean
  error: string
  onRefresh(): void
  onOpenForge(url: string): void
  onLoadMemberDraft(teamId: string, agentId: string): Promise<EnterpriseTeamMemberConfigDraft>
  onSaveMemberDraft(draft: EnterpriseTeamMemberConfigDraft): Promise<EnterpriseTeamMemberConfigDraft>
}

type ConfigSection = 'role' | 'runtime' | 'tools' | 'output' | 'limits'
const sections: Array<{ value: ConfigSection; label: string }> = [
  { value: 'role', label: '职责与指令' }, { value: 'runtime', label: '模型与执行' }, { value: 'tools', label: '技能与工具' },
  { value: 'output', label: '材料与输出' }, { value: 'limits', label: '执行限制' },
]
const lines = (value: string) => value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)
const joined = (value: string[]) => value.join('，')

export function DevelopmentPage({ environments, overview, loading, error, onRefresh, onOpenForge, onLoadMemberDraft, onSaveMemberDraft }: DevelopmentPageProps) {
  const forge = environments.find((environment) => environment.id === 'forge-development')
  const weave = environments.find((environment) => environment.id === 'weave-development')
  const [activeTab, setActiveTab] = useState<'teams' | 'apps'>('teams')
  const [selectedTeamID, setSelectedTeamID] = useState('')
  const [selectedAgentID, setSelectedAgentID] = useState('')
  const [section, setSection] = useState<ConfigSection>('role')
  const [draft, setDraft] = useState<EnterpriseTeamMemberConfigDraft>()
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!overview?.teams.length) { setSelectedTeamID(''); return }
    if (!overview.teams.some((team) => team.id === selectedTeamID)) setSelectedTeamID(overview.teams[0].id)
  }, [overview, selectedTeamID])
  const selectedTeam = useMemo(() => overview?.teams.find((team) => team.id === selectedTeamID), [overview, selectedTeamID])
  const members = useMemo(() => selectedTeam ? [selectedTeam.lead, ...selectedTeam.workers].filter((item): item is NonNullable<typeof item> => Boolean(item)) : [], [selectedTeam])
  useEffect(() => {
    if (!members.length) { setSelectedAgentID(''); return }
    if (!members.some((member) => member.id === selectedAgentID)) setSelectedAgentID(members[0].id)
  }, [members, selectedAgentID])
  useEffect(() => {
    if (!selectedTeamID || !selectedAgentID) { setDraft(undefined); return }
    let alive = true
    setDraft(undefined); setDraftLoading(true); setDraftError(''); setSaved(false)
    void onLoadMemberDraft(selectedTeamID, selectedAgentID).then((value) => { if (alive) setDraft(value) }).catch((cause) => { if (alive) setDraftError(cause instanceof Error ? cause.message : '配置读取失败') }).finally(() => { if (alive) setDraftLoading(false) })
    return () => { alive = false }
  }, [onLoadMemberDraft, selectedAgentID, selectedTeamID])

  const environmentSummary = (environment: EnterpriseEnvironmentStatus | undefined, fallback: string, canOpen = false) => <div className="development-environment-summary">
    <i className={environment?.available ? 'is-online' : ''}/><span><strong>{environment?.name ?? fallback}</strong><small>{loading ? '正在检查' : environment?.available ? '可用' : '暂不可用'}</small></span>
    {canOpen ? <button type="button" className="development-environment-open" aria-label="打开 Forge" title="打开 Forge" disabled={!environment?.available} onClick={() => environment && onOpenForge(environment.url)}><ExternalLink size={13}/></button> : null}
  </div>
  const updateConfiguration = <K extends keyof EnterpriseTeamMemberConfigDraft['configuration']>(key: K, value: EnterpriseTeamMemberConfigDraft['configuration'][K]) => setDraft((current) => current ? { ...current, configuration: { ...current.configuration, [key]: value } } : current)
  const updateRelationship = <K extends keyof EnterpriseTeamMemberConfigDraft['relationship']>(key: K, value: EnterpriseTeamMemberConfigDraft['relationship'][K]) => setDraft((current) => current ? { ...current, relationship: { ...current.relationship, [key]: value } } : current)
  const save = async () => {
    if (!draft) return
    setDraftLoading(true); setDraftError(''); setSaved(false)
    try { setDraft(await onSaveMemberDraft(draft)); setSaved(true) }
    catch (cause) { setDraftError(cause instanceof Error ? cause.message : '配置保存失败') }
    finally { setDraftLoading(false) }
  }

  return <div className="page scroll-area"><div className="page-container development-page">
    <header className="page-header"><div><h1>开发中心</h1></div><button type="button" className="icon-button" aria-label="重新检查环境" title="重新检查环境" onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button></header>
    <div className="development-toolbar">
      <nav className="development-tabs" aria-label="开发中心分类">
        <button type="button" className={activeTab === 'teams' ? 'is-active' : ''} onClick={() => setActiveTab('teams')}><UsersRound size={14}/><strong>智能体团队</strong></button>
        <button type="button" className={activeTab === 'apps' ? 'is-active' : ''} onClick={() => setActiveTab('apps')}><Code2 size={14}/><strong>应用开发</strong></button>
      </nav>
      {activeTab === 'teams' ? environmentSummary(weave, 'Weave 协作服务') : environmentSummary(forge, 'Forge 业务环境', true)}
    </div>
    {activeTab === 'apps' ? <section className="development-app-workspace"><div><Code2 size={20}/><span><strong>应用开发调试区</strong></span></div><button type="button" className="button button--primary" disabled={!forge?.available} onClick={() => forge && onOpenForge(forge.url)}>打开 Forge 开发环境</button></section> : null}
    {activeTab === 'teams' ? <section className="team-config-workspace" aria-label="智能体团队配置">
      {error ? <div className="development-inline-error" role="alert">{error}</div> : null}
      {!overview && loading ? <div className="development-observation-empty">正在读取团队配置…</div> : null}
      {overview?.teams.length === 0 ? <div className="development-observation-empty"><UsersRound size={20}/><strong>当前组织还没有团队</strong></div> : null}
      {overview?.teams.length ? <div className="team-config-layout">
        <aside className="team-config-sidebar">
          <ProductSelect label="选择团队" value={selectedTeamID} onChange={(value) => { setSelectedTeamID(value); setSelectedAgentID('') }} options={overview.teams.map((team) => ({ value: team.id, label: team.name, detail: team.objective }))}/>
          <div className="team-config-member-list">{members.map((member) => <button type="button" key={member.id} className={member.id === selectedAgentID ? 'is-active' : ''} onClick={() => setSelectedAgentID(member.id)}><span className="team-config-avatar"><Bot size={15}/></span><span><strong>{member.name}</strong><small>{member.role === 'avatar' ? '团队负责人' : member.duty || '团队成员'}</small></span></button>)}</div>
        </aside>
        <main className="team-config-main">
          {draftLoading && !draft ? <div className="team-config-loading">正在读取成员配置…</div> : null}
          {draftError ? <div className="development-inline-error" role="alert">{draftError}</div> : null}
          {draft ? <>
            <header className="team-config-heading"><div><span>{draft.configuration.role === 'avatar' ? '团队负责人' : '团队成员'}</span><h2>{draft.configuration.displayName}</h2><small>基于正式配置第 {draft.baseAgentVersion} 版{draft.revision ? ` · 草稿第 ${draft.revision} 版` : ''}</small></div><div>{saved ? <em>已保存</em> : null}<button type="button" className="button button--primary" disabled={draftLoading} onClick={() => void save()}><Save size={13}/>保存草稿</button></div></header>
            <nav className="team-config-sections" aria-label="配置分类">{sections.map((item) => <button type="button" key={item.value} className={section === item.value ? 'is-active' : ''} onClick={() => setSection(item.value)}>{item.label}</button>)}</nav>
            <div className="team-config-form">
              {section === 'role' ? <>
                <div className="team-config-grid"><ProductField label="显示名称" value={draft.configuration.displayName} onChange={(event) => updateConfiguration('displayName', event.target.value)}/><ProductSwitch label="参与团队协作" checked={draft.relationship.enabled} onChange={(value) => updateRelationship('enabled', value)}/></div>
                <ProductTextArea label="职责" rows={3} value={draft.relationship.duty} onChange={(event) => updateRelationship('duty', event.target.value)}/>
                <ProductTextArea label="何时使用" rows={3} value={draft.relationship.whenToUse} onChange={(event) => updateRelationship('whenToUse', event.target.value)}/>
                <ProductTextArea label="身份与系统指令" rows={10} value={draft.configuration.systemPrompt} onChange={(event) => updateConfiguration('systemPrompt', event.target.value)}/>
                <ProductTextArea label="协作上下文" rows={5} value={draft.relationship.contextInstruction} onChange={(event) => updateRelationship('contextInstruction', event.target.value)}/>
              </> : null}
              {section === 'runtime' ? <>
                <div className="team-config-grid"><label className="product-field"><span><strong>执行引擎</strong></span><ProductSelect label="执行引擎" value={draft.configuration.engine || 'loom'} onChange={(value) => updateConfiguration('engine', value)} options={[{ value: 'loom', label: 'Weave 内置运行时' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }, { value: 'opencode', label: 'OpenCode' }]}/></label><ProductField label="模型" value={draft.configuration.model} onChange={(event) => updateConfiguration('model', event.target.value)}/></div>
                <label className="product-field"><span><strong>运行位置</strong><small>只显示 Weave 已登记的位置</small></span><ProductSelect label="运行位置" value={draft.configuration.runtimeId} onChange={(value) => updateConfiguration('runtimeId', value)} options={[{ value: '', label: '自动选择' }, ...overview.runtimes.map((runtime) => ({ value: runtime.id, label: runtime.name, detail: `${runtime.online ? '在线' : '离线'} · ${runtime.engines.join(' / ') || '等待能力上报'}` })), ...(draft.configuration.runtimeId && !overview.runtimes.some((runtime) => runtime.id === draft.configuration.runtimeId) ? [{ value: draft.configuration.runtimeId, label: '当前绑定的运行位置', detail: '暂未连接' }] : [])]}/></label>
                <div className="team-config-grid"><ProductSwitch label="启用记忆" checked={draft.configuration.memoryEnabled} onChange={(value) => updateConfiguration('memoryEnabled', value)}/><label className="product-field"><span><strong>记忆范围</strong></span><ProductSelect label="记忆范围" value={draft.configuration.memoryScope || 'tenant'} onChange={(value) => updateConfiguration('memoryScope', value)} options={[{ value: 'tenant', label: '团队空间' }, { value: 'user', label: '当前员工' }, { value: 'session', label: '当前会话' }]}/></label></div>
              </> : null}
              {section === 'tools' ? <>
                <ProductTextArea label="技能" detail="多个技能用逗号或换行分隔。" rows={4} value={joined(draft.configuration.skillNames)} onChange={(event) => updateConfiguration('skillNames', lines(event.target.value))}/>
                <ProductTextArea label="工具服务" detail="填写已在 Weave 注册的工具服务名称。" rows={4} value={joined(draft.configuration.mcpServerIds)} onChange={(event) => updateConfiguration('mcpServerIds', lines(event.target.value))}/>
                <div className="team-config-grid"><ProductTextArea label="允许调用" rows={4} value={joined(draft.configuration.permissionAllow)} onChange={(event) => updateConfiguration('permissionAllow', lines(event.target.value))}/><ProductTextArea label="调用前询问" rows={4} value={joined(draft.configuration.permissionAsk)} onChange={(event) => updateConfiguration('permissionAsk', lines(event.target.value))}/></div>
                <ProductTextArea label="禁止调用" rows={3} value={joined(draft.configuration.permissionDeny)} onChange={(event) => updateConfiguration('permissionDeny', lines(event.target.value))}/>
              </> : null}
              {section === 'output' ? <><ProductTextArea label="结果要求" rows={5} value={draft.relationship.resultRequirement} onChange={(event) => updateRelationship('resultRequirement', event.target.value)}/><ProductTextArea label="输出格式" detail="使用 JSON Schema 描述结构化结果；留空表示自由文本。" rows={10} value={draft.configuration.outputSchema} onChange={(event) => updateConfiguration('outputSchema', event.target.value)}/></> : null}
              {section === 'limits' ? <div className="team-config-grid team-config-grid--limits"><ProductField label="总令牌上限" type="number" min={0} value={draft.configuration.maxTokens} onChange={(event) => updateConfiguration('maxTokens', Number(event.target.value))}/><ProductField label="单次输出上限" type="number" min={0} value={draft.configuration.maxOutputTokens} onChange={(event) => updateConfiguration('maxOutputTokens', Number(event.target.value))}/><ProductField label="步骤上限" type="number" min={0} value={draft.configuration.stepBudget} onChange={(event) => updateConfiguration('stepBudget', Number(event.target.value))}/><ProductField label="成本上限（美元）" type="number" min={0} step="0.01" value={draft.configuration.maxCostUsd} onChange={(event) => updateConfiguration('maxCostUsd', Number(event.target.value))}/></div> : null}
            </div>
          </> : null}
        </main>
      </div> : null}
    </section> : null}
  </div></div>
}
