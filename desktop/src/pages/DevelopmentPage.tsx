import { Activity, ChevronRight, CircleDot, Code2, ExternalLink, RefreshCw, Users, UsersRound, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { EnterpriseDevelopmentOverview, EnterpriseEnvironmentStatus } from '@/types/api'

interface DevelopmentPageProps {
  environments: EnterpriseEnvironmentStatus[]
  overview?: EnterpriseDevelopmentOverview
  loading: boolean
  error: string
  onRefresh(): void
  onOpenForge(url: string): void
}

const healthName = (value?: string) => value === 'healthy' ? '健康' : value === 'degraded' ? '需关注' : '尚无运行证据'
const runName = (value: string) => ({ success: '已完成', succeeded: '已完成', completed: '已完成', failed: '失败', running: '运行中', waiting: '等待中', cancelled: '已取消' })[value] ?? readableName(value, '状态更新中')
const internalIdentifier = /[0-9a-f]{8}-[0-9a-f-]{27,}/i
const readableName = (value: string, fallback = '可读标识') => internalIdentifier.test(value.trim())
  ? fallback
  : value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (part) => part.toUpperCase())
const statusName = (value: string) => ({ active: '已启用', published: '已发布', draft: '草稿', archived: '已归档', building: '构建中', needs_repair: '需修复' })[value] ?? readableName(value, '当前状态')
const evaluationName = (value?: string) => value ? ({ evaluated: '已评估', pending: '待评估', passed: '已通过', failed: '未通过' })[value.toLowerCase()] ?? readableName(value, '评估状态') : '未评估'
const nodeTypeName = (value: string) => ({ agent: '智能体', human: '人工处理', tool: '业务工具', parallel: '并行协作', join: '汇总', start: '开始', end: '结束', wait: '等待处理', deliver: '交付' })[value.toLowerCase()] ?? readableName(value, '流程节点')

export function DevelopmentPage({ environments, overview, loading, error, onRefresh, onOpenForge }: DevelopmentPageProps) {
  const forge = environments.find((environment) => environment.id === 'forge-development')
  const weave = environments.find((environment) => environment.id === 'weave-development')
  const [selectedTeamID, setSelectedTeamID] = useState('')
  const [activeTab, setActiveTab] = useState<'teams' | 'apps'>('teams')
  useEffect(() => {
    if (!overview?.teams.length) { setSelectedTeamID(''); return }
    if (!overview.teams.some((team) => team.id === selectedTeamID)) setSelectedTeamID(overview.teams[0].id)
  }, [overview, selectedTeamID])
  const selectedTeam = useMemo(() => overview?.teams.find((team) => team.id === selectedTeamID), [overview, selectedTeamID])
  const environmentSummary = (id: 'forge-development' | 'weave-development') => {
    const environment = id === 'forge-development' ? forge : weave
    const isForge = id === 'forge-development'
    const fallbackName = isForge ? 'Forge 业务环境' : 'Weave 协作服务'
    const state = loading ? '正在检查' : environment?.available ? '可用' : '暂不可用'
    const version = environment?.version ? (isForge ? `ObjectStack ${environment.version}` : environment.version) : ''
    const detail = [state, version, isForge && environment?.available && !environment.secure ? 'HTTP' : ''].filter(Boolean).join(' · ')
    return <div className="development-environment-summary">
      <i className={environment?.available ? 'is-online' : ''}/>
      <span><strong>{environment?.name ?? fallbackName}</strong><small>{detail}</small></span>
      {isForge ? <button type="button" className="development-environment-open" aria-label="打开 Forge" title="打开 Forge" disabled={!environment?.available} onClick={() => environment && onOpenForge(environment.url)}><ExternalLink size={13}/></button> : null}
    </div>
  }
  return <div className="page scroll-area"><div className="page-container development-page">
    <header className="page-header"><div><h1>开发中心</h1></div><button type="button" className="icon-button" aria-label="重新检查环境" title="重新检查环境" onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button></header>
    <div className="development-toolbar">
      <nav className="development-tabs" aria-label="开发中心分类">
        <button type="button" className={activeTab === 'teams' ? 'is-active' : ''} onClick={() => setActiveTab('teams')}><UsersRound size={14}/><strong>智能体团队</strong></button>
        <button type="button" className={activeTab === 'apps' ? 'is-active' : ''} onClick={() => setActiveTab('apps')}><Code2 size={14}/><strong>应用开发</strong></button>
      </nav>
      {environmentSummary(activeTab === 'teams' ? 'weave-development' : 'forge-development')}
    </div>
    {activeTab === 'teams' ? <>
    <section className="development-observation" aria-label="团队与运行开发调试区">
      <div className="development-section-heading"><div><h2>团队与运行</h2></div>{overview ? <small>更新于 {new Date(overview.loadedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small> : null}</div>
      {error ? <div className="development-inline-error" role="alert">{error}</div> : null}
      {!overview && loading ? <div className="development-observation-empty">正在读取团队配置…</div> : null}
      {overview && overview.teams.length === 0 ? <div className="development-observation-empty"><Users size={20}/><strong>当前组织还没有团队</strong><span>团队建立后会在这里显示角色、版本和运行证据。</span></div> : null}
      {overview && overview.teams.length > 0 ? <div className="development-observation-layout">
        <nav className="development-team-list" aria-label="团队列表">{overview.teams.map((team) => <button type="button" key={team.id} className={team.id === selectedTeamID ? 'is-active' : ''} onClick={() => setSelectedTeamID(team.id)}><span><strong>{team.name}</strong><small>{team.workers.length + (team.lead ? 1 : 0)} 个角色 · {team.workflows.length} 个流程</small></span><ChevronRight size={14}/></button>)}</nav>
        {selectedTeam ? <div className="development-team-detail">
          <header><div><span className="development-kicker">{statusName(selectedTeam.status)} · {evaluationName(selectedTeam.evaluation)}</span><h3>{selectedTeam.name}</h3><p>{selectedTeam.objective || '尚未填写团队目标'}</p></div><span className="development-health"><CircleDot size={13}/>{healthName(selectedTeam.summary?.health)}</span></header>
          <div className="development-facts"><span><strong>{selectedTeam.workers.length + (selectedTeam.lead ? 1 : 0)}</strong><small>团队角色</small></span><span><strong>{selectedTeam.summary?.publishedWorkflowCount ?? 0}</strong><small>已发布流程</small></span><span><strong>{selectedTeam.runs.length}</strong><small>最近运行</small></span></div>
          <section className="development-detail-section"><h4>角色分工</h4><div className="development-roster">{[selectedTeam.lead, ...selectedTeam.workers].filter(Boolean).map((member) => member ? <article key={member.id}><span>{member.role === 'avatar' ? '负责人' : '成员'}</span><strong>{member.name}</strong><p>{member.duty || '尚未填写职责'}</p></article> : null)}</div></section>
          <section className="development-detail-section"><h4>流程版本与关系</h4>{selectedTeam.workflows.length === 0 ? <div className="development-subempty"><Workflow size={17}/><span>当前团队尚未发布或保存流程，关系图暂无内容。</span></div> : <div className="development-workflows">{selectedTeam.workflows.map((workflow) => <article key={workflow.id}><header><span><strong>{workflow.name}</strong><small>{workflow.publishedVersion ? `正式版 ${workflow.publishedVersion}` : workflow.draftVersion ? `草稿版 ${workflow.draftVersion}` : '尚未形成版本'}</small></span><i>{statusName(workflow.status)}</i></header><div className="development-node-strip">{workflow.nodes.length ? workflow.nodes.map((node, index) => <span key={node.id}>{index > 0 ? <ChevronRight size={12}/> : null}<b>{node.label || readableName(node.id, `流程节点 ${index + 1}`)}</b><small>{nodeTypeName(node.type)}</small></span>) : <em>这个版本没有可显示的节点</em>}</div></article>)}</div>}</section>
          <section className="development-detail-section"><h4>最近运行</h4>{selectedTeam.runs.length === 0 ? <div className="development-subempty"><Activity size={17}/><span>当前团队还没有真实运行记录。</span></div> : <div className="development-run-list">{selectedTeam.runs.map((run) => <article key={run.id}><span><strong>{run.step ? readableName(run.step, '团队协作') : run.agent ? readableName(run.agent, '团队协作') : '团队协作'}</strong><small>{run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN') : '最近运行'}</small></span><i>{runName(run.status)}</i></article>)}</div>}</section>
        </div> : null}
      </div> : null}
    </section>
    </> : <>
      <section className="development-app-workspace" aria-label="应用开发调试区">
        <div><Code2 size={20}/><span><strong>应用开发调试区</strong></span></div>
        <button type="button" className="button button--primary" disabled={!forge?.available} onClick={() => forge && onOpenForge(forge.url)}>打开 Forge 开发环境</button>
      </section>
    </>}
  </div></div>
}
