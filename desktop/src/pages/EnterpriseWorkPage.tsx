import { CheckCircle2, ClipboardCheck, LoaderCircle, RefreshCw, Send, TimerReset } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ProductSelect } from '@/components/ui'
import type { EnterpriseHumanTask, EnterpriseRunObservation, EnterpriseWorkChoice, EnterpriseWorkOverview, EnterpriseWorkReceipt } from '@/types/api'

interface EnterpriseWorkPageProps {
  overview?: EnterpriseWorkOverview
  loading: boolean
  error: string
  receipt?: EnterpriseWorkReceipt
  onRefresh(): void
  onSubmit(choice: EnterpriseWorkChoice, goal: string): Promise<void>
  onComplete(task: EnterpriseHumanTask, decision: 'approved' | 'rejected', comment: string): Promise<void>
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

export function EnterpriseWorkPage({ overview, loading, error, receipt, onRefresh, onSubmit, onComplete }: EnterpriseWorkPageProps) {
  const [choiceID, setChoiceID] = useState('')
  const [goal, setGoal] = useState('')
  const [comments, setComments] = useState<Record<string, string>>({})
  const [busyTask, setBusyTask] = useState('')
  useEffect(() => {
    if (!overview?.choices.length) { setChoiceID(''); return }
    if (!overview.choices.some((choice) => `${choice.workflowId}:${choice.version}` === choiceID)) {
      const first = overview.choices[0]
      setChoiceID(`${first.workflowId}:${first.version}`)
    }
  }, [choiceID, overview])
  const selected = overview?.choices.find((choice) => `${choice.workflowId}:${choice.version}` === choiceID)
  return <div className="page scroll-area"><div className="page-container enterprise-work-page">
    <header className="page-header"><div><h1>我的工作</h1></div><button type="button" className="icon-button" aria-label="刷新工作" onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button></header>
    {error ? <div className="development-inline-error" role="alert">{error}</div> : null}
    <section className="work-submit-card">
      <div className="work-section-title"><span><Send size={16}/></span><div><h2>发起工作</h2></div></div>
      {overview && overview.choices.length === 0 ? <div className="work-empty">当前没有已发布且可使用的团队流程。</div> : <form onSubmit={(event) => { event.preventDefault(); if (selected && goal.trim()) void onSubmit(selected, goal).then(() => setGoal('')) }}>
        <label>处理流程<ProductSelect label="处理流程" value={choiceID} disabled={loading} onChange={setChoiceID} options={(overview?.choices ?? []).map((choice) => ({ value: `${choice.workflowId}:${choice.version}`, label: choice.teamName, detail: `${choice.workflowName} · 正式版 ${choice.version}` }))}/></label>
        <label>工作说明<textarea className="work-input-surface" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="例如：我填报了一份合同，请交给处理员工复核并完成后续交接。" rows={4}/></label>
        <button type="submit" className="button button--primary" disabled={!selected || !goal.trim() || loading}>{loading ? <LoaderCircle className="spin" size={14}/> : <Send size={14}/>}提交工作</button>
      </form>}
      {receipt ? <div className="work-receipt" role="status"><CheckCircle2 size={16}/><span><strong>工作已接收</strong><small>已进入团队协作</small></span></div> : null}
    </section>
    <div className="work-columns">
      <section className="work-panel"><div className="work-panel-heading"><ClipboardCheck size={15}/><h2>待我处理</h2><span>{overview?.tasks.length ?? 0}</span></div>
        {!overview && loading ? <div className="work-empty">正在读取待办…</div> : overview?.tasks.length ? <div className="work-task-list">{overview.tasks.map((task) => <article key={task.interactionId}><header><span><strong>{task.title}</strong><small>已发布流程 · {formatTime(task.updatedAt)}</small></span><i>待处理</i></header><p>{task.instructions}</p><textarea className="work-input-surface" rows={2} placeholder="补充处理意见（可选）" value={comments[task.interactionId] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [task.interactionId]: event.target.value }))}/><div><button type="button" className="button" disabled={busyTask === task.interactionId} onClick={() => { setBusyTask(task.interactionId); void onComplete(task, 'rejected', comments[task.interactionId] ?? '').finally(() => setBusyTask('')) }}>退回</button><button type="button" className="button button--primary" disabled={busyTask === task.interactionId} onClick={() => { setBusyTask(task.interactionId); void onComplete(task, 'approved', comments[task.interactionId] ?? '').finally(() => setBusyTask('')) }}>确认接收</button></div></article>)}</div> : <div className="work-empty">当前没有待处理事项。</div>}
      </section>
      <section className="work-panel"><div className="work-panel-heading"><TimerReset size={15}/><h2>我发起的工作</h2><span>{overview?.runs.length ?? 0}</span></div>
        {!overview && loading ? <div className="work-empty">正在读取进度…</div> : overview?.runs.length ? <div className="work-run-list">{overview.runs.map((run) => {
          const choice = runChoice(run, overview.choices)
          return <article key={run.id}><span><strong>{choice?.workflowName ?? readableName(run.step || run.agent)}</strong><small>{choice ? `${choice.teamName} · ${formatTime(run.startedAt)}` : formatTime(run.startedAt)}</small></span><i className={`is-${run.status}`}>{statusCopy(run.status)}</i></article>
        })}</div> : <div className="work-empty">你还没有通过 Workbench 发起工作。</div>}
      </section>
    </div>
  </div></div>
}
