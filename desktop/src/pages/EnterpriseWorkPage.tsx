import { Bell, ClipboardCheck, RefreshCw, TimerReset } from 'lucide-react'
import { useState } from 'react'
import type { EnterpriseApprovalContextView, EnterpriseHumanTask, EnterpriseRunObservation, EnterpriseWorkChoice, EnterpriseWorkItem, EnterpriseWorkOverview, EnterpriseWorkReadStatus } from '@/types/api'

interface EnterpriseWorkPageProps {
  overview?: EnterpriseWorkOverview
  loading: boolean
  error: string
  onRefresh(): void
  onComplete(task: EnterpriseHumanTask, decision: 'approved' | 'rejected', comment: string): Promise<void>
  onInspect(task: EnterpriseHumanTask): Promise<EnterpriseApprovalContextView>
  onAssist(task: EnterpriseHumanTask): Promise<void>
  onContinue(item: EnterpriseWorkItem, context?: EnterpriseApprovalContextView): void | Promise<void>
}

const statusCopy = (status: string) => ({ parked: '等待处理', queued: '排队中', running: '处理中', success: '已完成', succeeded: '已完成', completed: '已完成', failed: '失败', cancelled: '已取消' })[status] ?? readableName(status, '状态更新中')
const itemSourceCopy = (item: EnterpriseWorkItem) => item.source === 'weave' ? '团队执行消息' : 'Forge 业务通知'
const canContinueItem = (item: EnterpriseWorkItem) => item.source === 'forge' && item.kind === 'result' && Boolean(item.notificationType) || item.source === 'weave' && (
  Boolean(item.workReference && item.runReference && item.sessionReference)
  || /^weave\.team_run\.(result|failure|revision_required|cancelled)$/.test(item.notificationType ?? '')
)
const itemSummary = (item: EnterpriseWorkItem) => {
  if (item.source === 'weave') {
    if (item.summary) return `团队文本摘要（非业务回执）：${item.summary}。是否办理以平台动作回执和 Forge 当前记录为准。`
    return item.kind === 'failure' ? '团队运行失败，业务结果需要在 Forge 核对。' : item.kind === 'cancelled' ? '团队运行已取消；Forge 业务状态需单独核对。' : '团队运行已返回结果，业务是否完成需单独核对。'
  }
  return item.summary ?? (item.kind === 'failure' ? '业务处理失败，请打开原事项查看。' : '业务状态有更新，请打开原事项核对。')
}
const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '团队协作记录'
const internalIdentifier = /[0-9a-f]{8}-[0-9a-f-]{27,}/i
const readableName = (value?: string, fallback = '团队协作') => value?.trim() && !internalIdentifier.test(value.trim())
  ? value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (part) => part.toUpperCase())
  : fallback
const runChoice = (run: EnterpriseRunObservation, choices: EnterpriseWorkChoice[]) => choices.find((choice) => (
  Boolean(run.step?.includes(choice.workflowId)) || Boolean(run.agent?.includes(choice.workflowId))
))

function ReadIssue({ label, status, onRetry }: { label: string; status?: EnterpriseWorkReadStatus; onRetry(): void }) {
  if (status?.status !== 'failed') return null
  return <p className="development-inline-error" role="alert">{label}暂时不可用：{status.error ?? '服务暂时不可用'} <button type="button" className="button" onClick={onRetry}>重试读取</button></p>
}

export function EnterpriseWorkPage({ overview, loading, error, onRefresh, onComplete, onInspect, onAssist, onContinue }: EnterpriseWorkPageProps) {
  const [comments, setComments] = useState<Record<string, string>>({})
  const [busyTask, setBusyTask] = useState('')
  const [contexts, setContexts] = useState<Record<string, EnterpriseApprovalContextView>>({})
  const [contextErrors, setContextErrors] = useState<Record<string, string>>({})
  const [busyContext, setBusyContext] = useState('')
  const inspect = (task: EnterpriseHumanTask) => {
    setBusyContext(task.interactionId)
    setContextErrors((current) => ({ ...current, [task.interactionId]: '' }))
    void onInspect(task).then((context) => setContexts((current) => ({ ...current, [task.interactionId]: context })))
      .catch((failure) => setContextErrors((current) => ({ ...current, [task.interactionId]: failure instanceof Error ? failure.message : '材料读取失败' })))
      .finally(() => setBusyContext(''))
  }
  return <div className="page scroll-area"><div className="page-container enterprise-work-page">
    <header className="page-header"><div><h1>我的工作</h1></div><button type="button" className="icon-button" aria-label="刷新工作" onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button></header>
    {error ? <div className="development-inline-error" role="alert">{error}</div> : null}
    <div className="work-columns">
      <section className="work-panel"><div className="work-panel-heading"><ClipboardCheck size={15}/><h2>待我处理</h2><span>{(overview?.tasks.length ?? 0) + (overview?.items.filter((item) => item.actionable && item.status !== 'completed' && item.status !== 'cancelled').length ?? 0)}</span></div>
        {!overview && loading ? <div className="work-empty">正在读取待办…</div> : !overview ? <div className="work-empty">待办暂时无法读取。</div> : <>
          <ReadIssue label="团队人工步骤" status={overview.reads.weaveTasks} onRetry={onRefresh}/>
          <ReadIssue label="业务审批" status={overview.reads.forgeApprovals} onRetry={onRefresh}/>
          <ReadIssue label="工作通知" status={overview.reads.notifications} onRetry={onRefresh}/>
      {overview?.items.filter((item) => item.actionable && item.status !== 'completed' && item.status !== 'cancelled').map((item) => <article key={item.id}><header><span><strong>{item.title}</strong><small>{item.source === 'weave' ? '团队需要补充' : 'Forge 业务退回'} · {formatTime(item.createdAt)}</small></span><i>待处理</i></header><p>{item.returnReason ?? item.instructions ?? item.summary}</p>{item.materialLabel ? <small>材料：{item.materialLabel}</small> : null}<div><button type="button" className="button button--primary" disabled={!canContinueItem(item)} onClick={() => { void onContinue(item) }}>交给 Pi 继续</button>{!canContinueItem(item) ? <small>请从本人业务事项或完整的团队消息打开原工作。</small> : null}</div></article>)}
          {overview?.tasks.length ? <div className="work-task-list">{overview.tasks.map((task) => <article key={task.interactionId}><header><span><strong>{task.title}</strong><small>{task.source === 'forge' ? '业务审批' : '团队人工步骤'} · {formatTime(task.updatedAt)}</small></span><i>待处理</i></header><p>{task.instructions}</p>{task.materialLabel ? <small>材料：{task.materialLabel}</small> : null}{task.source === 'forge' ? <><button type="button" className="button" disabled={busyContext === task.interactionId} onClick={() => inspect(task)}>{busyContext === task.interactionId ? '正在读取…' : contexts[task.interactionId] ? '重新读取材料' : '查看材料'}</button>{contexts[task.interactionId] ? <button type="button" className="button" disabled={busyContext === task.interactionId} onClick={() => { setBusyContext(task.interactionId); void onAssist(task).catch((failure) => setContextErrors((current) => ({ ...current, [task.interactionId]: failure instanceof Error ? failure.message : '无法交给 Pi 核对' }))).finally(() => setBusyContext('')) }}>让 Pi 协助复核</button> : null}{contextErrors[task.interactionId] ? <p role="alert">{contextErrors[task.interactionId]}</p> : null}{contexts[task.interactionId] ? <section className="work-approval-context"><h3>{contexts[task.interactionId].title}</h3><small>{contexts[task.interactionId].step}</small><dl>{contexts[task.interactionId].fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>{contexts[task.interactionId].files.map((file) => <div key={file.name}><strong>{file.name}</strong><small>已核对提交版本</small><pre>{file.content}</pre></div>)}{contexts[task.interactionId].originalFiles?.map((file, index) => <div key={`${file.name}:${index}`}><strong>{file.name}</strong><small>PDF/DOCX 原件 · {file.bytes} 字节 · 已核验 · {file.extraction.status === 'complete' ? '文本提取完整' : file.extraction.status === 'partial' ? '部分内容未提取' : '未提取到可读文本'}</small><pre>{file.extraction.content}</pre>{file.extraction.limitations.length ? <small>提取结果有内容缺口，请在 Forge 查看完整原件。</small> : null}</div>)}<p>此处仅列出本审批已绑定且可读取的文件。</p></section> : null}</> : null}{task.mode !== 'revision' ? <textarea className="work-input-surface" rows={2} placeholder="补充处理意见（可选）" value={comments[task.interactionId] ?? ''} onChange={(event) => setComments((current) => ({ ...current, [task.interactionId]: event.target.value }))}/> : null}<div>{task.mode === 'revision' ? <button type="button" className="button button--primary" onClick={() => { setBusyContext(task.interactionId); void onInspect(task).then((context) => onContinue({ id: task.interactionId, kind: 'revision_required', title: task.title, instructions: task.instructions, status: 'pending', actionable: true, read: false, source: 'forge', createdAt: task.updatedAt, materialLabel: task.materialLabel, returnReason: context.returnReason }, context)).catch((failure) => setContextErrors((current) => ({ ...current, [task.interactionId]: failure instanceof Error ? failure.message : '材料读取失败' }))).finally(() => setBusyContext('')) }}>交给 Pi 继续</button> : <><button type="button" className="button" disabled={busyTask === task.interactionId} onClick={() => { setBusyTask(task.interactionId); void onComplete(task, 'rejected', comments[task.interactionId] ?? '').finally(() => setBusyTask('')) }}>{task.source === 'forge' ? '退回修改' : '退回'}</button><button type="button" className="button button--primary" disabled={busyTask === task.interactionId || (task.source === 'forge' && !contexts[task.interactionId])} onClick={() => { setBusyTask(task.interactionId); void onComplete(task, 'approved', comments[task.interactionId] ?? '').finally(() => setBusyTask('')) }}>{task.source === 'forge' ? '同意' : '确认接收'}</button></>}</div></article>)}</div> : null}
          {!overview.tasks.length && !overview.items.some((item) => item.actionable && item.status !== 'completed' && item.status !== 'cancelled') && overview.reads.weaveTasks.status === 'loaded' && overview.reads.forgeApprovals.status === 'loaded' && overview.reads.notifications.status === 'loaded' ? <div className="work-empty">当前没有待处理事项。</div> : null}
        </>}
      </section>
      <section className="work-panel"><div className="work-panel-heading"><TimerReset size={15}/><h2>我发起的工作</h2><span>{overview?.runs.length ?? 0}</span></div>
        {!overview && loading ? <div className="work-empty">正在读取进度…</div> : !overview ? <div className="work-empty">进度暂时无法读取。</div> : <>
          <ReadIssue label="工作进度" status={overview.reads.runs} onRetry={onRefresh}/>
          {overview.runs.length ? <div className="work-run-list">{overview.runs.map((run) => {
          const choice = runChoice(run, overview.choices)
          return <article key={run.id}><span><strong>{choice?.workflowName ?? readableName(run.step || run.agent)}</strong><small>{choice ? `${choice.teamName} · ${formatTime(run.startedAt)}` : formatTime(run.startedAt)}</small></span><i className={`is-${run.status}`}>团队执行 · {statusCopy(run.status)}</i></article>
          })}</div> : overview.reads.runs.status === 'loaded' ? <div className="work-empty">你还没有通过 Workbench 发起工作。</div> : null}
          <ReadIssue label="团队目录" status={overview.reads.teamChoices} onRetry={onRefresh}/>
        </>}
      </section>
    </div>
    {overview?.items.some((item) => !item.actionable) ? <section className="work-panel"><div className="work-panel-heading"><Bell size={15}/><h2>工作消息</h2><span>{overview.items.filter((item) => !item.actionable && !item.read).length}</span></div><div className="work-run-list">{overview.items.filter((item) => !item.actionable).map((item) => <article key={item.id}><span><strong>{item.title}</strong><small>{itemSourceCopy(item)} · {itemSummary(item)} · {formatTime(item.createdAt)}</small></span><div className="work-message-actions"><i className={item.read ? '' : 'is-running'}>{item.read ? '已读' : '新消息'}</i><button type="button" className="button" disabled={!canContinueItem(item)} onClick={() => onContinue(item)}>{canContinueItem(item) ? '交给 Pi 查看' : '原工作暂不可续接'}</button></div></article>)}</div></section> : null}
  </div></div>
}
