import { Check, FileText, Bot } from 'lucide-react'
import { ProductSelect, ProductField } from '@/components/ui'
import { EditableText } from './EditableText'
import { bindings, originalBinding, predecessors, type Step } from './graph'
import type { TeamDefinition } from '@/types/team-workspace'
export function StepInspector({ flow, step, members, onChange }: { flow: TeamDefinition['workflows'][number]; step: Step; members: TeamDefinition['members']; onChange(step: Step): void }) {
  const inputs = bindings(step)
  const lead = members.find((member) => member.configuration.role === 'avatar' && member.relationship.enabled)
  const agentId = String(step.config?.agent_id ?? '').trim()
  const assignedWorker = members.find((member) => member.id === agentId && member.configuration.role === 'worker' && member.relationship.enabled)
  const executorUnavailable = step.type === 'worker' ? !assignedWorker : step.type === 'lead' && !lead
  const selectedMember = step.type === 'lead' ? lead?.id ?? `unavailable-lead:${step.id}` : assignedWorker?.id ?? `unavailable-worker:${step.id}`
  const executorOptions = [
    ...(executorUnavailable ? [{ value: selectedMember, label: step.type === 'worker' ? agentId ? '原执行成员不可用' : '尚未指定执行成员' : '负责人不可用' }] : []),
    ...members.filter((member) => member.relationship.enabled).map((member) => ({ value: member.id, label: member.configuration.displayName })),
  ]
  const isEntryLead = step.type === 'lead' && step.id === flow.graph_definition.entry_node_id
  const changeExecutor = (memberId: string) => {
    const member = members.find((candidate) => candidate.id === memberId)
    if (!member) return
    if (member.configuration.role === 'avatar') {
      onChange({ ...step, type: 'lead', config: { instruction: String(step.config?.instruction ?? step.config?.result_requirement ?? member.configuration.systemPrompt) } })
      return
    }
    onChange({ ...step, type: 'worker', config: { kind: 'consult', agent_id: member.id, agent_version: 1, result_requirement: String(step.config?.result_requirement ?? step.config?.instruction ?? member.relationship.resultRequirement) } })
  }
  return <div className="tw-inspector-content">
    <EditableText label="步骤名称" value={step.label ?? ''} placeholder="例如：归类反馈、检查结果" multiline={false} onChange={(label) => onChange({ ...step, label })}/>
    {['lead', 'worker'].includes(step.type) && <>
      {executorUnavailable && <p role="alert">{step.type === 'worker' ? agentId ? '该步骤引用的执行成员不存在、已停用或角色不匹配，请重新选择执行成员后再保存。' : '该步骤尚未指定执行成员，请选择成员后再保存。' : '该流程缺少启用中的负责人，请先恢复负责人配置后再保存。'}</p>}
      {isEntryLead ? <div className="tw-assignee"><span>由谁执行</span><Bot size={15}/>{lead?.configuration.displayName || '负责人不可用'}</div> : <section><h4>由谁执行</h4><ProductSelect label="执行成员" value={selectedMember} options={executorOptions} onChange={changeExecutor}/></section>}
      <EditableText label={step.type === 'lead' ? '处理指令' : '交付要求'} placeholder={step.type === 'lead' ? '例如：识别任务目标，列出需要各成员完成的事项。' : '例如：按产品模块分组，返回问题清单，并保留原始反馈作为依据。'} value={String(step.config?.[step.type === 'lead' ? 'instruction' : 'result_requirement'] ?? '')} onChange={(text) => onChange({ ...step, config: { ...step.config, [step.type === 'lead' ? 'instruction' : 'result_requirement']: text } })}/>
      <section><h4>交给它哪些内容</h4><p className="tw-muted">勾选的内容会直接传给此步骤，可同时选择多项。</p><div className="tw-source-list"><button type="button" aria-pressed={Object.values(inputs).some((b) => b.value.source === 'run_input')} onClick={() => { const selected = Object.values(inputs).some((b) => b.value.source === 'run_input'); const next = Object.fromEntries(Object.entries(inputs).filter(([, b]) => b.value.source !== 'run_input')); if (!selected) next.original = originalBinding(); onChange({ ...step, inputs: next }) }}><FileText size={14}/><span><strong>本次任务输入</strong><small>发起任务时提交的原始内容</small></span>{Object.values(inputs).some((b) => b.value.source === 'run_input') && <Check size={13}/>}</button>
      {predecessors(flow.graph_definition, step.id).map((prior) => { const selected = Object.values(inputs).some((b) => b.value.node_id === prior.id); return <button type="button" key={prior.id} aria-pressed={selected} onClick={() => { const next = Object.fromEntries(Object.entries(inputs).filter(([, b]) => b.value.node_id !== prior.id)); if (!selected) next[`result_${prior.id.replace(/[^a-zA-Z0-9_]/g, '_')}`] = { value: { source: 'node_output', node_id: prior.id, path: '' }, expected_type: prior.type === 'join' ? 'json' : 'text' }; onChange({ ...step, inputs: next }) }}><FileText size={14}/><span><strong>{prior.label || '前序步骤'}的结果</strong><small>此步骤完成后生成的内容</small></span>{selected && <Check size={13}/>}</button> })}</div></section>
    </>}
    {step.type === 'deliver' && <section><h4>交付内容</h4><ProductSelect label="交付哪一步的结果" value={String((step.config?.result as { node_id?: string })?.node_id ?? '')} options={predecessors(flow.graph_definition, step.id).map((n) => ({ value: n.id, label: n.label || '前序结果' }))} onChange={(node_id) => onChange({ ...step, config: { ...step.config, result: { source: 'node_output', node_id, path: '' } } })}/></section>}
    {['fork', 'parallel'].includes(step.type) && <p className="tw-muted">从此处分成多路执行，各成员按步骤配置接收材料。</p>}
    {step.type === 'join' && <section><h4>汇合条件</h4><ProductSelect label="汇合条件" value={String(step.config?.policy || 'all_success')} options={[{ value: 'all_success', label: '全部成功后继续' }, { value: 'fail_fast', label: '任一失败即停止' }, { value: 'quorum', label: '指定数量成功后继续' }, { value: 'deadline', label: '等待到截止时间' }]} onChange={(policy) => onChange({ ...step, config: { policy, ...(policy === 'quorum' ? { success_count: 1 } : {}), ...(policy === 'deadline' ? { deadline_seconds: 300 } : {}) } })}/>{step.config?.policy === 'quorum' && <ProductField label="所需成功分支数" type="number" min={1} max={flow.graph_definition.edges.filter((e) => e.to_node_id === step.id).length} value={Number(step.config.success_count ?? 1)} onChange={(e) => onChange({ ...step, config: { ...step.config, success_count: Number(e.target.value) } })}/ >}{step.config?.policy === 'deadline' && <ProductField label="最长等待秒数" type="number" min={1} value={Number(step.config.deadline_seconds ?? 300)} onChange={(e) => onChange({ ...step, config: { ...step.config, deadline_seconds: Number(e.target.value) } })}/>}</section>}
  </div>
}
