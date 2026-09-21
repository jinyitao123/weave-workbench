import { Activity, Boxes, CalendarClock, FolderGit2, RefreshCw, Wrench } from 'lucide-react'
import type { EnterpriseEnvironmentStatus, EnterpriseSession, WorkspaceView } from '@/types/api'

interface DevelopmentPageProps {
  environments: EnterpriseEnvironmentStatus[]
  session?: EnterpriseSession
  loading: boolean
  onRefresh(): void
  onSignOut(): void
  onOpenForge(url: string): void
  onNavigate(view: WorkspaceView): void
  onAddProject(): void
}

export function DevelopmentPage({ environments, session, loading, onRefresh, onSignOut, onOpenForge, onNavigate, onAddProject }: DevelopmentPageProps) {
  const forge = environments.find((environment) => environment.id === 'forge-development')
  const weave = environments.find((environment) => environment.id === 'weave-development')
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
    <section className="development-grid" aria-label="开发工具">
      <button type="button" onClick={() => onNavigate('plugins')}><span><Wrench size={19}/></span><strong>能力与连接</strong><small>管理当前运行环境可以使用的工具和扩展。</small></button>
      <button type="button" onClick={() => onNavigate('projects')}><span><FolderGit2 size={19}/></span><strong>工作空间文件夹</strong><small>管理桌面助手可以访问的本地文件范围。</small></button>
      <button type="button" onClick={() => onNavigate('scheduled')}><span><CalendarClock size={19}/></span><strong>定时工作</strong><small>查看和管理周期执行的工作。</small></button>
      <button type="button" onClick={() => onNavigate('activity')}><span><Activity size={19}/></span><strong>运行记录</strong><small>查看需要关注、运行中和已完成的工作。</small></button>
      <button type="button" onClick={onAddProject}><span><FolderGit2 size={19}/></span><strong>选择工作空间文件夹</strong><small>授权一个本地目录用于工作、开发和调试。</small></button>
    </section>
  </div></div>
}
