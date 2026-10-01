import { isSystemManagedBusinessParameter } from './member'
import { useEffect, useRef, useState } from 'react'
import { ProductSelect, ProductTextArea } from '@/components/ui'
import type { EnterpriseBusinessCapabilityCatalog } from '@/types/api'
import type { TeamWorkspace, TeamWorkspaceBridge } from '@/types/team-workspace'
export const runLabel = (status: string) => ({ submitting: '等待接单', queued: '排队中', running: '执行中', succeeded: '团队运行完成', failed: '团队运行失败', cancelled: '团队运行已取消', blocked: '等待处理', pending: '等待执行', completed: '步骤完成', tool_started: '工具调用中', tool_completed: '工具调用完成', tool_failed: '工具调用失败' }[status] ?? '等待更新')
type Activity = { status: string; completeness?: { member_tool_activity?: string }; members: Array<{ name: string; status: string; runtime?: { model?: string; configured_model?: string }; stages: Array<{ name: string; status: string; inputs: Array<{ source: string; summary?: string }>; tools?: Array<{ name: string; status: string; input?: string; output?: string }> | null; tool_calls?: number; failure_reason?: string }> }>; outputs: Array<{ title: string; content?: string }> }

function toolActivityEvidence(activity?: Activity): 'incomplete' | 'empty' | 'recorded' {
  if (activity?.completeness?.member_tool_activity !== 'complete' || !Array.isArray(activity.members) || activity.members.length === 0) return 'incomplete'
  const stages = activity.members.flatMap((member) => Array.isArray(member.stages) ? member.stages : [])
  if (!stages.length) return 'incomplete'
  let hasCalls = false
  for (const stage of stages) {
    if (stage.tools !== null && !Array.isArray(stage.tools)) return 'incomplete'
    if (stage.tool_calls !== undefined && (!Number.isInteger(stage.tool_calls) || stage.tool_calls < 0)) return 'incomplete'
    const tools = stage.tools ?? []
    const completedTools = tools.filter((tool) => tool.status === 'ok' || tool.status === 'error').length
    if (tools.length === 0 && (stage.tool_calls ?? 0) > 0
      || (stage.status === 'completed' || stage.status === 'failed') && (stage.tool_calls ?? 0) !== completedTools) return 'incomplete'
    if (tools.length > 0 || (stage.tool_calls ?? 0) > 0) hasCalls = true
  }
  return hasCalls ? 'recorded' : 'empty'
}
export function TrialPanel({ teamId, initialFlowId, draft, businessCapabilities, bridge, flush, refresh }: { initialFlowId?: string; teamId: string; draft: TeamWorkspace; businessCapabilities?: EnterpriseBusinessCapabilityCatalog; bridge: TeamWorkspaceBridge; flush(): Promise<TeamWorkspace | undefined>; refresh(): Promise<void> }) {
  const [flow, setFlow] = useState(initialFlowId ?? draft.document.workflows[0]?.id ?? '')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(draft.trials[0]?.request_id ?? '')
  const [activity, setActivity] = useState<Activity>()
  const [activityReadState, setActivityReadState] = useState<'loading' | 'loaded' | 'failed' | 'unavailable'>('unavailable')
  const [frozenInput, setFrozenInput] = useState('')
  const [runStatus, setRunStatus] = useState('')
  const [runOutput, setRunOutput] = useState('')
  const pending = useRef<{ requestId: string; revision: number; flow: string; input: string; businessActions: EnterpriseBusinessCapabilityCatalog['capabilities'] } | undefined>(undefined)
  const submitting = useRef(false)
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
        setActivity(view)
        setActivityReadState(viewResult.status === 'fulfilled' && view ? 'loaded' : viewResult.status === 'rejected' ? 'failed' : 'unavailable')
        setFrozenInput(material.input); setRunStatus(material.status ?? ''); setRunOutput(material.output ?? ''); setError('')
        await refresh()
        if (viewResult.status === 'rejected') timer = setTimeout(() => { void update() }, 5000)
        else if (!['succeeded', 'failed', 'cancelled'].includes(view?.status ?? material.status ?? trial.status)) timer = setTimeout(() => { void update() }, 2500)
      } catch (cause) { if (!disposed) { setError((cause as Error).message); timer = setTimeout(() => { void update() }, 5000) } }
    }
    setActivity(undefined); setActivityReadState(trial.run_id ? 'loading' : 'unavailable')
    setFrozenInput(''); setRunStatus(''); setRunOutput(''); void update()
    return () => { disposed = true; clearTimeout(timer) }
    // Polling is tied to this receipt, not to every refreshed overview object.
  }, [bridge, teamId, trial?.request_id, trial?.run_id])
  const toolEvidence = toolActivityEvidence(activity)
  const submit = async () => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true); setError('')
    try {
      const saved = await flush(); if (!saved) return
      if (saved.document.members.some((member) => member.configuration.businessCapabilityBindings.some((binding) => member.configuration.businessCapabilityIds.includes(binding.capabilityId) && binding.parameters.some((parameter) => isSystemManagedBusinessParameter(parameter.name))))) throw new Error('系统托管的防重复提交参数不能绑定材料，请到成员能力中移除旧映射后再调试')
      const selectedIds = new Set(saved.document.members.flatMap((member) => member.configuration.businessCapabilityIds))
      const catalog = businessCapabilities?.capabilities ?? []
      const unavailable = [...selectedIds].map((id) => catalog.find((action) => action.id === id)).find((action) => !action || action.status !== 'available')
      if (unavailable) throw new Error(unavailable?.unavailableReason ?? '当前团队已选择不可用的 Forge 业务能力，请先移除后再调试')
      const businessActions = catalog.filter((action) => selectedIds.has(action.id) && action.status === 'available')
      const missing = [...selectedIds].filter((id) => !businessActions.some((action) => action.id === id && action.actionName && action.objectName))
      if (missing.length) throw new Error('当前团队使用的 Forge 业务能力缺少调试定义，请刷新业务能力后重试')
      if (!pending.current || pending.current.revision !== saved.revision || pending.current.input !== input || pending.current.flow !== flow) pending.current = { requestId: crypto.randomUUID(), revision: saved.revision, flow, input, businessActions }
      const request = pending.current
      await bridge({ action: 'trial', teamId, revision: request.revision, workflowId: request.flow, requestId: request.requestId, input: request.input, businessActions: request.businessActions })
      setSelected(request.requestId); await refresh(); pending.current = undefined
    } catch (cause) { setError((cause as Error).message) }
    finally { submitting.current = false; setBusy(false) }
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
      <div className="tw-card tw-form" role="status">
        <h3>实际工具调用记录</h3>
        {activityReadState === 'loading' ? <p className="tw-muted">正在读取活动记录…</p>
          : activityReadState === 'failed' ? <p role="alert">活动记录暂时无法读取。下面的团队摘要不能证明业务已提交。</p>
            : activityReadState === 'unavailable' ? <p className="tw-muted">当前没有可读取的工具调用记录。团队摘要不能证明业务已提交。</p>
              : toolEvidence === 'empty' ? <p>平台完整活动记录显示本次调用次数为 0；不能据此认定已提交。</p>
                : toolEvidence === 'incomplete' ? <p className="tw-muted">活动记录未证明工具调用清单完整。团队摘要不能证明业务已提交。</p>
                  : <p className="tw-muted">请查看各成员步骤下方的工具调用记录。运行完成本身不代表业务动作成功。</p>}
      </div>
      {activity?.outputs?.map((output, i) => <div key={i} className="tw-card"><h3>团队摘要 · {output.title || '运行输出'}</h3><pre className="tw-result">{output.content || '没有返回可显示的内容'}</pre><p className="tw-muted">这是团队运行文本，不是业务办理回执。</p></div>)}
      {runOutput && !activity?.outputs?.some((output) => output.content === runOutput) && <div className="tw-card"><h3>团队摘要</h3><pre className="tw-result">{runOutput}</pre><p className="tw-muted">这是团队运行文本，不是业务办理回执。</p></div>}
    </div>}
  </div>
}
