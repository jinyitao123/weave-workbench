import { useEffect, useRef, useState } from 'react'
import { ProductSelect, ProductTextArea } from '@/components/ui'
import type { TeamWorkspace, TeamWorkspaceBridge } from '@/types/team-workspace'
export const runLabel = (status: string) => ({ submitting: '等待接单', queued: '排队中', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', blocked: '等待处理', pending: '等待执行', completed: '已完成' }[status] ?? '等待更新')
type Activity = { status: string; members: Array<{ name: string; status: string; runtime?: { model?: string; configured_model?: string }; stages: Array<{ name: string; status: string; inputs: Array<{ source: string; summary?: string }>; tools: Array<{ name: string; status: string; input?: string; output?: string }>; failure_reason?: string }> }>; outputs: Array<{ title: string; content?: string }> }
export function TrialPanel({ teamId, initialFlowId, draft, bridge, flush, refresh }: { initialFlowId?: string; teamId: string; draft: TeamWorkspace; bridge: TeamWorkspaceBridge; flush(): Promise<TeamWorkspace | undefined>; refresh(): Promise<void> }) {
  const [flow, setFlow] = useState(initialFlowId ?? draft.document.workflows[0]?.id ?? '')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(draft.trials[0]?.request_id ?? '')
  const [activity, setActivity] = useState<Activity>()
  const [frozenInput, setFrozenInput] = useState('')
  const [runStatus, setRunStatus] = useState('')
  const [runOutput, setRunOutput] = useState('')
  const pending = useRef<{ requestId: string; revision: number; flow: string; input: string } | undefined>(undefined)
  const trial = draft.trials.find((t) => t.request_id === selected)
  useEffect(() => {
    if (!trial) return
    let disposed = false, timer: ReturnType<typeof setTimeout>
    const update = async () => {
      try {
        const [viewResult, materialResult] = await Promise.allSettled([
          trial.run_id ? bridge<Activity>({ action: 'activity', teamId, runId: trial.run_id }) : Promise.resolve(undefined),
          bridge<{ input: string; status?: string; output?: string }>({ action: 'input', teamId, requestId: trial.request_id }),
        ])
        if (disposed) return
        if (materialResult.status === 'rejected') throw materialResult.reason
        const view = viewResult.status === 'fulfilled' ? viewResult.value : undefined
        const material = materialResult.value
        setActivity(view); setFrozenInput(material.input); setRunStatus(material.status ?? ''); setRunOutput(material.output ?? ''); setError('')
        await refresh()
        if (!['succeeded', 'failed', 'cancelled'].includes(view?.status ?? material.status ?? trial.status)) timer = setTimeout(() => { void update() }, 2500)
      } catch (cause) { if (!disposed) { setError((cause as Error).message); timer = setTimeout(() => { void update() }, 5000) } }
    }
    setActivity(undefined); setFrozenInput(''); setRunStatus(''); setRunOutput(''); void update()
    return () => { disposed = true; clearTimeout(timer) }
    // Polling is tied to this receipt, not to every refreshed overview object.
  }, [bridge, teamId, trial?.request_id, trial?.run_id])
  const submit = async () => {
    setBusy(true); setError('')
    try {
      const saved = await flush(); if (!saved) return
      if (!pending.current || pending.current.revision !== saved.revision || pending.current.input !== input || pending.current.flow !== flow) pending.current = { requestId: crypto.randomUUID(), revision: saved.revision, flow, input }
      const request = pending.current
      await bridge({ action: 'trial', teamId, revision: request.revision, workflowId: request.flow, requestId: request.requestId, input: request.input })
      setSelected(request.requestId); await refresh(); pending.current = undefined
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="tw-form">
    <h3>测试任务</h3>
    <ProductSelect label="测试流程" value={flow} options={draft.document.workflows.map((f) => ({ value: f.id, label: f.name }))} onChange={setFlow}/>
    <ProductTextArea label="测试输入" rows={10} value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入测试任务，或导入文本文件"/>
    <div className="tw-actions"><label className="button tw-file">导入文件<input type="file" accept=".txt,.md,.csv,.json" onChange={(e) => { const file = e.target.files?.[0]; if (file) { if (file.size > 650000) { setError('输入最多 650 KB'); return }; void file.text().then((text) => setInput((before) => `${before}${before ? '\n\n' : ''}材料：${file.name}\n${text}`)) }; e.target.value = '' }}/></label><button type="button" className="button button--primary" disabled={busy || !flow || !input.trim() || !!draft.publishing_revision} onClick={() => void submit()}>{busy ? '正在提交' : pending.current ? '重试本次提交' : '开始调试'}</button></div>
    {error && <p role="alert">{error}</p>}
    {draft.trials.length > 0 && <><h3>调试记录</h3><div className="tw-trials">{draft.trials.map((t) => <button type="button" key={t.request_id} className={selected === t.request_id ? 'is-active' : ''} onClick={() => setSelected(t.request_id)}><strong>{draft.document.workflows.find((f) => f.id === t.workflow_id)?.name ?? '历史流程'}</strong><span>{runLabel(t.request_id === selected ? activity?.status ?? runStatus ?? t.status : t.status)} · {t.revision === draft.revision ? '当前草稿' : '较早草稿'} · {new Date(t.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></button>)}</div></>}
    {trial && <div className="tw-form"><details><summary>本次固定输入</summary><pre className="tw-result">{frozenInput || '正在读取'}</pre></details>
      {activity?.members?.map((member, index) => <div className="tw-card tw-form" key={index}><div className="tw-section-title"><h4>{member.name}</h4><span>{runLabel(member.status)}</span></div><small className="tw-muted">{member.runtime?.model || member.runtime?.configured_model || '模型尚未上报'}</small>{member.stages.map((stage, i) => <div key={i}><strong>{stage.name} · {runLabel(stage.status)}</strong><p>输入：{stage.inputs.map((b) => b.source === 'run_input' ? '任务输入' : '前序结果').join('、') || '尚未上报'}</p>{stage.failure_reason && <p role="alert">{stage.failure_reason}</p>}{stage.inputs.some((b) => b.summary) && <details><summary>运行输入摘要</summary>{stage.inputs.map((b, j) => <pre className="tw-result" key={j}>{b.summary}</pre>)}</details>}{stage.tools?.map((tool, j) => <details key={j}><summary>{tool.name} · {runLabel(tool.status)}</summary><pre className="tw-result">{tool.input}\n{tool.output}</pre></details>)}</div>)}</div>)}
      {activity?.outputs?.map((output, i) => <div key={i} className="tw-card"><h3>{output.title || '交付结果'}</h3><pre className="tw-result">{output.content || '没有返回可显示的内容'}</pre></div>)}
      {runOutput && !activity?.outputs?.some((output) => output.content === runOutput) && <div className="tw-card"><h3>最终结果</h3><pre className="tw-result">{runOutput}</pre></div>}
    </div>}
  </div>
}
