import { Activity, Boxes, CalendarClock, ChevronRight, CircleDot, FolderGit2, RefreshCw, Users, Workflow, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { EnterpriseDevelopmentOverview, EnterpriseEnvironmentStatus, EnterpriseSession, WorkspaceView } from '@/types/api'

interface DevelopmentPageProps {
  environments: EnterpriseEnvironmentStatus[]
  session?: EnterpriseSession
  overview?: EnterpriseDevelopmentOverview
  loading: boolean
  error: string
  onRefresh(): void
  onSignOut(): void
  onOpenForge(url: string): void
  onNavigate(view: WorkspaceView): void
  onAddProject(): void
}

const healthName = (value?: string) => value === 'healthy' ? '健康' : value === 'degraded' ? '需关注' : '尚无运行证据'
const runName = (value: string) => ({ succeeded: '已完成', failed: '失败', running: '运行中', waiting: '等待中', cancelled: '已取消' })[value] ?? value

export function DevelopmentPage({ environments, session, overview, loading, error, onRefresh, onSignOut, onOpenForge, onNavigate, onAddProject }: DevelopmentPageProps) {
  const forge = environments.find((environment) => environment.id === 'forge-development')
  const weave = environments.find((environment) => environment.id === 'weave-development')
  const [selectedTeamID, setSelectedTeamID] = useState('')
  useEffect(() => {
    if (!overview?.teams.length) { setSelectedTeamID(''); return }
    if (!overview.teams.some((team) => team.id === selectedTeamID)) setSelectedTeamID(overview.teams[0].id)
  }, [overview, selectedTeamID])
  const selectedTeam = useMemo(() => overview?.teams.find((team) => team.id === selectedTeamID), [overview, selectedTeamID])
  const environmentRows = [
    { id: 'forge-development', fallbackName: 'Forge 业务环境', detail: forge?.version ? `ObjectStack ${forge.version}` : '业务应用与流程', value: forge },
    { id: 'weave-development', fallbackName: 'Weave 协作服务', detail: '团队、任务与执行', value: weave },
  ]
  return <div className="page scroll-area"><div className="page-container development-page">
    <header className="page-header"><div><h1>开发中心</h1><p>调试智能体团队、业务应用和本地项目。</p></div><button type="button" className="icon-button" aria-label="重新检查环境" title="重新检查环境" onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button></header>
    {session?.user ? <section className="development-account"><span><strong>{session.user.name}</strong><small>{session.user.email} · {session.role}</small></span><button type="button" className="button" onClick={onSignOut}>退出登录</button></section> : null}
    <section className="development-environments" aria-label="线上联调环境">
      {environmentRows.map(({ id, fallbackName, detail, value: environment }) => {
        const state = loading ? '正在检查' : environment?.available ? '可用' : '暂不可用'
        const isForge = id === 'forge-development'
        return <div className="development-environment" key={id}>
          <span className={`environment-mark ${environment?.available ? 'is-online' : ''}`}><Boxes size={18}/></span>
          <span className="environment-copy"><strong>{environment?.name ?? fallbackName}</strong><small>{detail}</small></span>
          <span className={`environment-state ${environment?.available ? 'is-online' : ''}`}><i/>{state}</span>
          {isForge && environment?.available && !environment.secure ? <span className="environment-note">当前通过 HTTP 连接</span> : null}
          {isForge ? <button type="button" className="button" disabled={!environment?.available} onClick={() => environment && onOpenForge(environment.url)}>打开 Forge</button> : <span className="environment-note">桌面助手将通过此服务调用智能体团队</span>}
        </div>
      })}
    </section>
    <section className="development-observation" aria-label="团队与运行观察">
      <div className="development-section-heading"><div><h2>团队与运行</h2><p>这里直接读取 Weave 当前组织中的真实定义与执行记录。</p></div>{overview ? <small>更新于 {new Date(overview.loadedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small> : null}</div>
      {error ? <div className="development-inline-error" role="alert">{error}</div> : null}
      {!overview && loading ? <div className="development-observation-empty">正在读取团队配置…</div> : null}
      {overview && overview.teams.length === 0 ? <div className="development-observation-empty"><Users size={20}/><strong>当前组织还没有团队</strong><span>团队建立后会在这里显示角色、版本和运行证据。</span></div> : null}
      {overview && overview.teams.length > 0 ? <div className="development-observation-layout">
        <nav className="development-team-list" aria-label="团队列表">{overview.teams.map((team) => <button type="button" key={team.id} className={team.id === selectedTeamID ? 'is-active' : ''} onClick={() => setSelectedTeamID(team.id)}><span><strong>{team.name}</strong><small>{team.workers.length + (team.lead ? 1 : 0)} 个角色 · {team.workflows.length} 个流程</small></span><ChevronRight size={14}/></button>)}</nav>
        {selectedTeam ? <div className="development-team-detail">
          <header><div><span className="development-kicker">{selectedTeam.status} · {selectedTeam.evaluation ?? '未评估'}</span><h3>{selectedTeam.name}</h3><p>{selectedTeam.objective || '尚未填写团队目标'}</p></div><span className="development-health"><CircleDot size={13}/>{healthName(selectedTeam.summary?.health)}</span></header>
          <div className="development-facts"><span><strong>{selectedTeam.workers.length + (selectedTeam.lead ? 1 : 0)}</strong><small>团队角色</small></span><span><strong>{selectedTeam.summary?.publishedWorkflowCount ?? 0}</strong><small>已发布流程</small></span><span><strong>{selectedTeam.runs.length}</strong><small>最近运行</small></span></div>
          <section className="development-detail-section"><h4>角色分工</h4><div className="development-roster">{[selectedTeam.lead, ...selectedTeam.workers].filter(Boolean).map((member) => member ? <article key={member.id}><span>{member.role === 'avatar' ? '负责人' : '成员'}</span><strong>{member.name}</strong><p>{member.duty || '尚未填写职责'}</p></article> : null)}</div></section>
          <section className="development-detail-section"><h4>流程版本与关系</h4>{selectedTeam.workflows.length === 0 ? <div className="development-subempty"><Workflow size={17}/><span>当前团队尚未发布或保存流程，关系图暂无内容。</span></div> : <div className="development-workflows">{selectedTeam.workflows.map((workflow) => <article key={workflow.id}><header><span><strong>{workflow.name}</strong><small>{workflow.publishedVersion ? `已发布 v${workflow.publishedVersion}` : workflow.draftVersion ? `草稿 v${workflow.draftVersion}` : '无版本'}</small></span><i>{workflow.status}</i></header><div className="development-node-strip">{workflow.nodes.length ? workflow.nodes.map((node, index) => <span key={node.id}>{index > 0 ? <ChevronRight size={12}/> : null}<b>{node.label || node.id}</b><small>{node.type}</small></span>) : <em>这个版本没有可显示的节点</em>}</div></article>)}</div>}</section>
          <section className="development-detail-section"><h4>最近运行</h4>{selectedTeam.runs.length === 0 ? <div className="development-subempty"><Activity size={17}/><span>当前团队还没有真实运行记录。</span></div> : <div className="development-run-list">{selectedTeam.runs.map((run) => <article key={run.id}><span><strong>{run.step || run.agent || run.id}</strong><small>{run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN') : run.id}</small></span><i>{runName(run.status)}</i></article>)}</div>}</section>
        </div> : null}
      </div> : null}
    </section>
    <section className="development-grid" aria-label="开发工具">
      <button type="button" onClick={() => onNavigate('plugins')}><span><Wrench size={19}/></span><strong>能力与连接</strong><small>管理当前运行环境可以使用的工具和扩展。</small></button>
      <button type="button" onClick={() => onNavigate('projects')}><span><FolderGit2 size={19}/></span><strong>工作空间文件夹</strong><small>管理桌面助手可以访问的本地文件范围。</small></button>
      <button type="button" onClick={() => onNavigate('scheduled')}><span><CalendarClock size={19}/></span><strong>定时工作</strong><small>查看和管理周期执行的工作。</small></button>
      <button type="button" onClick={() => onNavigate('activity')}><span><Activity size={19}/></span><strong>运行记录</strong><small>查看需要关注、运行中和已完成的工作。</small></button>
      <button type="button" onClick={onAddProject}><span><FolderGit2 size={19}/></span><strong>选择工作空间文件夹</strong><small>授权一个本地目录用于工作、开发和调试。</small></button>
    </section>
  </div></div>
}
