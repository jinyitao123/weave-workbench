import { isSystemManagedBusinessParameter } from './member'
import { useEffect, useRef, useState } from 'react'
import { ProductSelect, ProductSwitch, ProductTextArea } from '@/components/ui'
import type { EnterpriseBusinessCapabilityCatalog } from '@/types/api'
import type { DevelopmentTrialAction, TeamWorkspace, TeamWorkspaceBridge } from '@/types/team-workspace'
import { workflowCandidateCapabilityIds } from './development-trial'
import { toolActivityEvidence, trialToolMissingDetails, trialToolPayload, trialToolPayloadCompleteness, trialToolStatus, type TrialToolEvidence } from '@/lib/trial-tool-evidence'
export const runLabel = (status: string) => ({ submitting: '等待接单', queued: '排队中', running: '执行中', succeeded: '团队运行完成', failed: '团队运行失败', cancelled: '团队运行已取消', blocked: '等待处理', pending: '等待执行', completed: '步骤完成', tool_started: '工具调用中', tool_completed: '工具调用完成', tool_failed: '工具调用失败' }[status] ?? '等待更新')
type Activity = { status: string; completeness?: { member_tool_activity?: string; member_tool_payloads?: string }; members: Array<{ name: string; status: string; runtime?: { model?: string; configured_model?: string }; stages: Array<{ name: string; status: string; inputs: Array<{ source: string; summary?: string }>; tools?: Array<TrialToolEvidence & { name: string }> | null; tool_calls?: number; failure_reason?: string }> }>; outputs: Array<{ title: string; content?: string }> }

export function TrialPanel({ teamId, initialFlowId, draft, businessCapabilities, bridge, flush, refresh }: { initialFlowId?: string; teamId: string; draft: TeamWorkspace; businessCapabilities?: EnterpriseBusinessCapabilityCatalog; bridge: TeamWorkspaceBridge; flush(): Promise<TeamWorkspace | undefined>; refresh(): Promise<void> }) {
  const [flow, setFlow] = useState(initialFlowId ?? draft.document.workflows[0]?.id ?? '')
  const [input, setInput] = useState('')
  const [simulationSelections, setSimulationSelections] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(draft.trials[0]?.request_id ?? '')
  const [activity, setActivity] = useState<Activity>()
  const [activityReadState, setActivityReadState] = useState<'loading' | 'loaded' | 'failed' | 'unavailable'>('unavailable')
  const [frozenInput, setFrozenInput] = useState('')
  const [runStatus, setRunStatus] = useState('')
  const [runOutput, setRunOutput] = useState('')
  const pending = useRef<{ requestId: string; revision: number; flow: string; input: string; simulationActionIds: string[]; businessActions: DevelopmentTrialAction[] } | undefined>(undefined)
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
  const payloadEvidence = trialToolPayloadCompleteness(activity)
  const candidate = draft.document.workflows.find((item) => item.id === flow)
  const candidateCapabilityIds = candidate ? workflowCandidateCapabilityIds(draft.document, candidate) : []
  const candidateActions = candidateCapabilityIds.flatMap((id) => {
    const action = businessCapabilities?.capabilities.find((item) => item.id === id)
    return action ? [action] : []
  })
  const missingCatalogAction = candidateCapabilityIds.some((id) => !businessCapabilities?.capabilities.some((item) => item.id === id))
  const selectionKey = `${draft.revision}:${flow}`
  const selectedSimulationActionIds = pending.current?.revision === draft.revision && pending.current.flow === flow
    ? pending.current.simulationActionIds
    : simulationSelections[selectionKey] ?? []
  const selectedSimulationActionSet = new Set(selectedSimulationActionIds)
  const submit = async () => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true); setError('')
    try {
      if (pending.current) {
        const request = pending.current
        await bridge({ action: 'trial', teamId, revision: request.revision, workflowId: request.flow, requestId: request.requestId, input: request.input, businessActions: request.businessActions })
        setSelected(request.requestId); await refresh(); pending.current = undefined
        setSimulationSelections((current) => ({ ...current, [`${request.revision}:${request.flow}`]: [] }))
        return
      }
      const saved = await flush(); if (!saved) return
      if (saved.document.members.some((member) => member.configuration.businessCapabilityBindings.some((binding) => member.configuration.businessCapabilityIds.includes(binding.capabilityId) && binding.parameters.some((parameter) => isSystemManagedBusinessParameter(parameter.name))))) throw new Error('系统托管的防重复提交参数不能绑定材料，请到成员能力中移除旧映射后再调试')
      const savedFlow = saved.document.workflows.find((item) => item.id === flow)
      if (!savedFlow) throw new Error('当前流程已变化，请重新选择流程后调试')
      const candidateIds = workflowCandidateCapabilityIds(saved.document, savedFlow)
      const catalog = businessCapabilities?.capabilities ?? []
      const candidates = candidateIds.map((id) => catalog.find((action) => action.id === id))
      const unavailable = candidates.find((action) => action?.status !== 'available' || action?.executionMode === 'employee_only' || !action?.actionName || !action?.objectName)
      if (unavailable) throw new Error(unavailable?.unavailableReason ?? '当前流程绑定的 Forge 业务动作暂不可用，请刷新业务动作目录后重试')
      if (candidates.some((action) => !action)) throw new Error('当前流程绑定的 Forge 业务能力缺少调试定义，请刷新业务能力后重试')
      const selected = [...new Set(selectedSimulationActionIds)].filter((id) => candidateIds.includes(id)).sort()
      if (selected.length !== selectedSimulationActionIds.length) throw new Error('本次模拟动作与当前流程不一致，请重新选择')
      const businessActions = (candidates as NonNullable<typeof candidates[number]>[]).map((action) => ({ ...action, simulationAuthorized: selected.includes(action.id) }))
      pending.current = { requestId: crypto.randomUUID(), revision: saved.revision, flow, input, simulationActionIds: selected, businessActions }
      const request = pending.current
      await bridge({ action: 'trial', teamId, revision: request.revision, workflowId: request.flow, requestId: request.requestId, input: request.input, businessActions: request.businessActions })
      setSelected(request.requestId); await refresh(); pending.current = undefined
      setSimulationSelections((current) => ({ ...current, [`${request.revision}:${request.flow}`]: [] }))
    } catch (cause) { setError((cause as Error).message) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <div className="tw-form">
    <h3>测试任务</h3>
    <ProductSelect label="测试流程" value={flow} options={draft.document.workflows.map((f) => ({ value: f.id, label: f.name }))} disabled={busy || Boolean(pending.current)} onChange={setFlow}/>
    <section aria-label="本次模拟动作">
      <h4>本次模拟动作</h4>
      <p className="tw-muted">默认不开放业务动作。开启后，当前流程成员才能在本次隔离试跑中调用；模拟不会访问 Forge 或写入业务数据。已选择的动作仍需成功回执覆盖，才能满足发布要求。</p>
      {candidateActions.length === 0
        ? <p className="tw-muted">{missingCatalogAction ? '当前流程的业务动作目录尚未完整读取，动作范围无法核验。' : '当前流程的候选成员没有绑定业务动作，可按只读范围调试。'}</p>
        : <div className="tw-form" role="group" aria-label="本次模拟动作选择">{candidateActions.map((action) => {
          const selectedAction = selectedSimulationActionSet.has(action.id)
          const available = action.status === 'available' && action.executionMode !== 'employee_only' && Boolean(action.actionName && action.objectName)
          return <ProductSwitch key={action.id} checked={selectedAction} label={action.name} detail={`${action.effect === 'write' ? '业务写动作' : '只读业务动作'} · ${selectedAction ? '已选择本次模拟，覆盖尚未验证' : '本次未开放'}${!available ? ` · ${action.unavailableReason ?? '当前不可用于团队试跑'}` : ''}`} disabled={busy || Boolean(pending.current) || !available || Boolean(draft.publishing_revision)} onChange={(checked) => setSimulationSelections((current) => {
            const before = current[selectionKey] ?? []
            const next = checked ? [...before, action.id] : before.filter((id) => id !== action.id)
            return { ...current, [selectionKey]: next }
          })}/>
        })}</div>}
      {missingCatalogAction && candidateActions.length > 0 && <p className="tw-muted">部分绑定动作暂不可读取；本次动作范围未完整，不能开始试跑。</p>}
    </section>
    <ProductTextArea label="测试输入" rows={10} value={input} disabled={busy || Boolean(pending.current)} onChange={(e) => setInput(e.target.value)} placeholder="输入测试任务，或导入文本文件"/>
    <div className="tw-actions"><label className="button tw-file">导入文件<input type="file" accept=".txt,.md,.csv,.json" disabled={busy || Boolean(pending.current)} onChange={(e) => { const file = e.target.files?.[0]; if (file) { if (file.size > 650000) { setError('输入最多 650 KB'); return }; void file.text().then((text) => setInput((before) => `${before}${before ? '\n\n' : ''}材料：${file.name}\n${text}`)) }; e.target.value = '' }}/></label><button type="button" className="button button--primary" disabled={busy || !flow || !input.trim() || !!draft.publishing_revision} onClick={() => void submit()}>{busy ? '正在提交' : pending.current ? '重试本次提交' : '开始调试'}</button></div>
    {error && <p role="alert">{error}</p>}
    {draft.trials.length > 0 && <><h3>调试记录</h3><div className="tw-trials">{draft.trials.map((t) => <button type="button" key={t.request_id} className={selected === t.request_id ? 'is-active' : ''} onClick={() => setSelected(t.request_id)}><strong>{draft.document.workflows.find((f) => f.id === t.workflow_id)?.name ?? '历史流程'}</strong><span>{runLabel(t.request_id === selected ? activity?.status ?? runStatus ?? t.status : t.status)} · {t.revision === draft.revision ? '当前草稿' : '较早草稿'} · {new Date(t.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></button>)}</div></>}
    {trial && <div className="tw-form"><details><summary>本次固定输入</summary><pre className="tw-result">{frozenInput || '正在读取'}</pre></details>
      {activity?.members?.map((member, index) => <div className="tw-card tw-form" key={index}><div className="tw-section-title"><h4>{member.name}</h4><span>{runLabel(member.status)}</span></div><small className="tw-muted">{member.runtime?.model || member.runtime?.configured_model || '模型尚未上报'}</small>{member.stages.map((stage, i) => <div key={i}><strong>{stage.name} · {runLabel(stage.status)}</strong><p>输入：{stage.inputs.map((b) => b.source === 'run_input' ? '任务输入' : '前序结果').join('、') || '尚未上报'}</p>{stage.failure_reason && <p role="alert">{stage.failure_reason}</p>}{stage.inputs.some((b) => b.summary) && <details><summary>运行输入摘要</summary>{stage.inputs.map((b, j) => <pre className="tw-result" key={j}>{b.summary}</pre>)}</details>}{stage.tools?.map((tool, j) => {
        const input = trialToolPayload(tool, 'input')
        const output = trialToolPayload(tool, 'output')
        const missingDetails = trialToolMissingDetails(tool)
        return <details key={j}><summary>{tool.name} · {trialToolStatus(tool)}</summary>{input !== undefined && <><h5>调用参数</h5><pre className="tw-result">{input || '（空内容）'}</pre></>}{output !== undefined && <><h5>工具返回</h5><pre className="tw-result">{output || '（空内容）'}</pre></>}{missingDetails && <p className="tw-muted">{missingDetails}</p>}</details>
      })}</div>)}</div>)}
      <div className="tw-card tw-form" role="status">
        <h3>调试工具调用记录</h3>
        <p className="tw-muted">开发调试中的 Forge 业务动作是模拟调用，不会访问 Forge 或写入业务数据。团队运行完成不代表实际业务动作成功。</p>
        {activityReadState === 'loading' ? <p className="tw-muted">正在读取活动记录…</p>
          : activityReadState === 'failed' ? <p role="alert">活动记录暂时无法读取。下面的团队摘要不能证明业务已提交。</p>
            : activityReadState === 'unavailable' ? <p className="tw-muted">当前没有可读取的工具调用记录。团队摘要不能证明业务已提交。</p>
              : toolEvidence === 'empty' ? <p>平台完整活动记录显示本次调用次数为 0；不能据此认定已提交。</p>
                : toolEvidence === 'incomplete' ? <p className="tw-muted">活动记录未证明工具调用清单完整。团队摘要不能证明业务已提交。</p>
                  : <p className="tw-muted">请查看各成员步骤下方的工具调用记录。运行完成本身不代表业务动作成功。</p>}
        {activityReadState === 'loaded' && toolEvidence !== 'empty' && payloadEvidence !== 'complete' && <p className="tw-muted">{payloadEvidence === 'unavailable' ? '调用参数和模拟回执暂无可核验记录。' : '调用参数或模拟回执不完整，请结合逐项缺失或截断标记核对。'}</p>}
      </div>
      {activity?.outputs?.map((output, i) => <div key={i} className="tw-card"><h3>团队摘要 · {output.title || '运行输出'}</h3><pre className="tw-result">{output.content || '没有返回可显示的内容'}</pre><p className="tw-muted">这是团队运行文本，不是业务办理回执。</p></div>)}
      {runOutput && !activity?.outputs?.some((output) => output.content === runOutput) && <div className="tw-card"><h3>团队摘要</h3><pre className="tw-result">{runOutput}</pre><p className="tw-muted">这是团队运行文本，不是业务办理回执。</p></div>}
    </div>}
  </div>
}
