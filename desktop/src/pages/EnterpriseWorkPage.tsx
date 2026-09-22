import { Bell, ClipboardCheck, RefreshCw, TimerReset } from 'lucide-react'
import { useState } from 'react'
import type { EnterpriseHumanTask, EnterpriseRunObservation, EnterpriseWorkChoice, EnterpriseWorkItem, EnterpriseWorkOverview } from '@/types/api'

interface EnterpriseWorkPageProps {
  overview?: EnterpriseWorkOverview
  loading: boolean
  error: string
  onRefresh(): void
  onComplete(task: EnterpriseHumanTask, decision: 'approved' | 'rejected', comment: string): Promise<void>
  onContinue(item: EnterpriseWorkItem): void
}

const statusCopy = (status: string) => ({ parked: '等待处理', queued: '排队中', running: '处理中', success: '已完成', succeeded: '已完成', completed: '已完成', failed: '失败', cancelled: '已取消' })[status] ?? readableName(status, '状态更新中')
const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '团队协作记录'
const internalIdentifier = /[0-9a-f]{8}-[0-9a-f-]{27,}/i
const readableName = (value?: string, fallback = '团队协作') => value?.trim() && !internalIdentifier.test(value.trim())
  ? value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (part) => part.toUpperCase())
  : fallback
const runChoice = (run: EnterpriseRunObservation, choices: EnterpriseWorkChoice[]) => choices.find((choice) => (
  Boolean(run.step?.includes(choice.workflowId)) || Boolean(run.agent?.includes(choice.workflowId))
))

export function EnterpriseWorkPage({ overview, loading, error, onRefresh, onComplete, onContinue }: EnterpriseWorkPageProps) {
  const [comments, setComments] = useState<Record<string, string>>({})
  const [busyTask, setBusyTask] = useState('')
  return <div className="page scroll-area"><div className="page-container enterprise-work-page">
    <header className="page-header"><div><h1>我的工作</h1></div><button type="button" className="icon-button" aria-label="刷新工作" onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button></header>
    {error ? <div className="development-inline-error" role="alert">{error}</div> : null}
    <div className="work-columns">
      <section className="work-panel"><div className="work-panel-heading"><ClipboardCheck size={15}/><h2>待我处理</h2><span>{(overview?.tasks.length ?? 0) + (overview?.items.filter((item) => item.actionable && item.status !== 'completed' && item.status !== 'cancelled').length ?? 0)}</span></div>
        {!overview && loading ? <div className="work-empty">正在读取待办…</div> : <>
          {overview?.items.filter((item) => item.actionable && item.status !== 'completed' && item.status !== 'cancelled').map((item) => <article key={item.id}><header><span><strong>{item.title}</strong><small>{item.source === 'weave' ? '团队退回' : '员工退回'} · {formatTime(item.createdAt)}</small></span><i>待处理</i></header><p>{item.returnReason ?? item.instructions ?? item.summary}</p>{item.materialLabel ? <small>材料：{item.materialLabel}</small> : null}<div><button type="button" className="button button--primary" onClick={() => onContinue(item)}>交给 Pi 继续</button></div></article>)}
          {overview?.tasks.length ? <div className="work-task-list">{overview.tasks.map((task) => <article key={task.interactionId}><header><span><strong>{task.title}</strong><small>团队人工步骤 · {formatTime(task.updatedAt)}</small></span><i>待处理</i></header><p>{task.instructions}</p><textarea className="work-input-surface" rows={2} placeholder="补充处理意见（可选）" value={comments[task.interactionId] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [task.interactionId]: event.target.value }))}/><div><button type="button" className="button" disabled={busyTask === task.interactionId} onClick={() => { setBusyTask(task.interactionId); void onComplete(task, 'rejected', comments[task.interactionId] ?? '').finally(() => setBusyTask('')) }}>退回</button><button type="button" className="button button--primary" disabled={busyTask === task.interactionId} onClick={() => { setBusyTask(task.interactionId); void onComplete(task, 'approved', comments[task.interactionId] ?? '').finally(() => setBusyTask('')) }}>确认接收</button></div></article>)}</div> : null}
          {!overview?.tasks.length && !overview?.items.some((item) => item.actionable && item.status !== 'completed' && item.status !== 'cancelled') ? <div className="work-empty">当前没有待处理事项。</div> : null}
        </>}
      </section>
      <section className="work-panel"><div className="work-panel-heading"><TimerReset size={15}/><h2>我发起的工作</h2><span>{overview?.runs.length ?? 0}</span></div>
        {!overview && loading ? <div className="work-empty">正在读取进度…</div> : overview?.runs.length ? <div className="work-run-list">{overview.runs.map((run) => {
          const choice = runChoice(run, overview.choices)
          return <article key={run.id}><span><strong>{choice?.workflowName ?? readableName(run.step || run.agent)}</strong><small>{choice ? `${choice.teamName} · ${formatTime(run.startedAt)}` : formatTime(run.startedAt)}</small></span><i className={`is-${run.status}`}>{statusCopy(run.status)}</i></article>
        })}</div> : <div className="work-empty">你还没有通过 Workbench 发起工作。</div>}
      </section>
    </div>
    {overview?.items.some((item) => !item.actionable) ? <section className="work-panel"><div className="work-panel-heading"><Bell size={15}/><h2>工作消息</h2><span>{overview.items.filter((item) => !item.actionable && !item.read).length}</span></div><div className="work-run-list">{overview.items.filter((item) => !item.actionable).map((item) => <article key={item.id}><span><strong>{item.title}</strong><small>{item.summary ?? (item.kind === 'failure' ? '处理失败，请查看详情。' : '处理已完成。')} · {formatTime(item.createdAt)}</small></span><i className={item.read ? '' : 'is-running'}>{item.read ? '已读' : '新消息'}</i></article>)}</div></section> : null}
  </div></div>
}
