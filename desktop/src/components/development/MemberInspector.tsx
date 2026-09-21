import { Check, Pencil } from 'lucide-react'
import { useState } from 'react'
import { ProductField, ProductSelect, ProductSwitch, ProductTextArea } from '@/components/ui'
import type { EnterpriseDevelopmentOverview, EnterpriseTeamMemberConfigDraft } from '@/types/api'

export function configurationLabel(value: string | undefined, fallback: string): string {
  if (!value?.trim()) return fallback
  if (/\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b|^(?:run|interaction)-/i.test(value) || /^[\da-f]{24,}$/i.test(value)) return fallback
  return value
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return <div className="member-summary-row"><dt>{label}</dt><dd>{configurationLabel(value, '未设置')}</dd></div>
}

function EditorButton({ editing, label, onClick }: { editing: boolean; label: string; onClick(): void }) {
  return <button type="button" className="member-config-card__action" onClick={onClick}>{editing ? <Check size={12}/> : <Pencil size={12}/>} {editing ? '完成' : label}</button>
}

type Section = 'role' | 'instructions' | 'execution' | 'resources'
const sections: Array<{ value: Section; label: string }> = [
  { value: 'role', label: '职责' }, { value: 'instructions', label: '指令' },
  { value: 'execution', label: '执行' }, { value: 'resources', label: '能力' },
]
const engines = [{ value: 'loom', label: 'Weave 内置运行时' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }, { value: 'opencode', label: 'OpenCode' }]

export function MemberInspector({ draft, runtimes, onChange }: {
  draft: EnterpriseTeamMemberConfigDraft
  runtimes: EnterpriseDevelopmentOverview['runtimes']
  onChange(draft: EnterpriseTeamMemberConfigDraft): void
}) {
  const [section, setSection] = useState<Section>('role')
  const [editing, setEditing] = useState<Section | null>(null)
  const config = draft.configuration
  const relationship = draft.relationship
  const setConfig = <K extends keyof typeof config>(key: K, value: typeof config[K]) => onChange({ ...draft, configuration: { ...config, [key]: value } })
  const setRelationship = <K extends keyof typeof relationship>(key: K, value: typeof relationship[K]) => onChange({ ...draft, relationship: { ...relationship, [key]: value } })
  const engineOptions = engines.some((engine) => engine.value === config.engine) ? engines : [...engines, { value: config.engine, label: configurationLabel(config.engine, '当前执行引擎') }]
  const runtimeOptions = [{ value: '', label: '自动选择' }, ...runtimes.map((runtime) => ({ value: runtime.id, label: configurationLabel(runtime.name, '已登记运行位置'), detail: runtime.online ? '在线' : '离线' }))]
  if (config.runtimeId && !runtimes.some((runtime) => runtime.id === config.runtimeId)) runtimeOptions.push({ value: config.runtimeId, label: '当前绑定位置（未连接）' })
  const permissionNames: Record<string, string> = { permissionAllow: '允许调用', permissionAsk: '调用前询问', permissionDeny: '禁止调用' }
  const toggleEditor = (target: Section) => setEditing((value) => value === target ? null : target)
  const executionSteps = config.engine === 'loom'
    ? ['接收团队任务', '装载指令与上下文', '模型调用与工具执行', '校验并返回结果']
    : ['接收团队任务', '发送到运行位置', `${engineOptions.find((item) => item.value === config.engine)?.label ?? '外部智能体'}执行`, '返回团队结果']

  return <>
    <nav className="member-inspector__tabs" aria-label="成员配置分类">{sections.map((item) => <button type="button" key={item.value} aria-pressed={section === item.value} className={section === item.value ? 'is-active' : ''} onClick={() => { setSection(item.value); setEditing(null) }}>{item.label}</button>)}</nav>
    <div className="member-inspector__body">
      {section === 'role' ? <section className={`member-config-card ${editing === 'role' ? 'is-editing' : ''}`}>
        <header><div><h4>定位与职责</h4><p>定义成员在团队中的身份、参与时机和交付边界。</p></div><EditorButton editing={editing === 'role'} label="编辑" onClick={() => toggleEditor('role')}/></header>
        {editing === 'role' ? <div className="member-config-form">
          <ProductField label="显示名称" value={config.displayName} onChange={(event) => setConfig('displayName', event.target.value)}/>
          {config.role !== 'avatar' ? <ProductSwitch label="参与团队协作" checked={relationship.enabled} onChange={(value) => setRelationship('enabled', value)}/> : null}
          <ProductTextArea label="团队职责" rows={4} value={relationship.duty} onChange={(event) => setRelationship('duty', event.target.value)}/>
          <ProductTextArea label="何时参与" rows={3} value={relationship.whenToUse} onChange={(event) => setRelationship('whenToUse', event.target.value)}/>
          <ProductTextArea label="交付要求" rows={3} value={relationship.resultRequirement} onChange={(event) => setRelationship('resultRequirement', event.target.value)}/>
          <ProductTextArea label="协作上下文" rows={3} value={relationship.contextInstruction} onChange={(event) => setRelationship('contextInstruction', event.target.value)}/>
        </div> : <dl className="member-summary"><SummaryRow label="名称" value={config.displayName}/><SummaryRow label="职责" value={relationship.duty}/><SummaryRow label="参与时机" value={relationship.whenToUse}/><SummaryRow label="交付要求" value={relationship.resultRequirement}/></dl>}
      </section> : null}

      {section === 'instructions' ? <section className={`member-config-card ${editing === 'instructions' ? 'is-editing' : ''}`}>
        <header><div><h4>工作指令</h4><p>约束成员如何理解任务、执行和输出。</p></div><EditorButton editing={editing === 'instructions'} label="编辑" onClick={() => toggleEditor('instructions')}/></header>
        {editing === 'instructions' ? <div className="member-config-form"><ProductTextArea label="系统指令" className="member-instruction-editor" rows={12} value={config.systemPrompt} onChange={(event) => setConfig('systemPrompt', event.target.value)}/><ProductTextArea label="输出格式" detail="JSON Schema，可留空" rows={7} value={config.outputSchema} onChange={(event) => setConfig('outputSchema', event.target.value)}/></div> : <div className="member-instruction-summary"><strong>系统指令</strong><p>{configurationLabel(config.systemPrompt, '未设置')}</p><small>{config.outputSchema ? '使用结构化输出' : '使用自由文本输出'}</small></div>}
      </section> : null}

      {section === 'execution' ? <section className={`member-config-card ${editing === 'execution' ? 'is-editing' : ''}`}>
        <header><div><h4>运行方式</h4><p>选择执行引擎、运行位置和资源边界。</p></div><EditorButton editing={editing === 'execution'} label="调整" onClick={() => toggleEditor('execution')}/></header>
        {editing === 'execution' ? <div className="member-config-form">
          <div className="product-field"><span><strong>执行引擎</strong></span><ProductSelect label="执行引擎" value={config.engine} options={engineOptions} onChange={(value) => setConfig('engine', value)}/></div>
          <ProductField label="模型" value={config.model} placeholder="跟随运行环境" onChange={(event) => setConfig('model', event.target.value)}/>
          <div className="product-field"><span><strong>运行位置</strong></span><ProductSelect label="运行位置" value={config.runtimeId} options={runtimeOptions} onChange={(value) => setConfig('runtimeId', value)}/></div>
          <ProductSwitch label="启用记忆" checked={config.memoryEnabled} onChange={(value) => setConfig('memoryEnabled', value)}/>
          {config.memoryEnabled ? <ProductSelect label="记忆范围" value={config.memoryScope} options={[{ value: 'tenant', label: '团队空间' }, { value: 'user', label: '当前员工' }, { value: 'session', label: '当前会话' }]} onChange={(value) => setConfig('memoryScope', value)}/> : null}
          <div className="member-limit-grid"><ProductField label="总令牌上限" type="number" min={0} value={config.maxTokens} onChange={(event) => setConfig('maxTokens', Number(event.target.value))}/><ProductField label="单次输出上限" type="number" min={0} value={config.maxOutputTokens} onChange={(event) => setConfig('maxOutputTokens', Number(event.target.value))}/><ProductField label="步骤上限" type="number" min={0} value={config.stepBudget} onChange={(event) => setConfig('stepBudget', Number(event.target.value))}/><ProductField label="成本上限（美元）" type="number" min={0} step="0.01" value={config.maxCostUsd} onChange={(event) => setConfig('maxCostUsd', Number(event.target.value))}/></div>
        </div> : <dl className="member-summary"><SummaryRow label="执行引擎" value={engineOptions.find((item) => item.value === config.engine)?.label}/><SummaryRow label="运行位置" value={runtimeOptions.find((item) => item.value === config.runtimeId)?.label}/><SummaryRow label="模型" value={config.model || '跟随运行环境'}/><SummaryRow label="记忆" value={config.memoryEnabled ? '已启用' : '未启用'}/></dl>}
        <div className="member-execution-flow" aria-label="成员执行链"><strong>成员执行链</strong><ol>{executionSteps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol></div>
      </section> : null}

      {section === 'resources' ? <>
        <section className="member-resource-group"><h4>已配置技能</h4>{config.skillNames.length ? <ul>{config.skillNames.map((name, index) => <li key={`${name}-${index}`}>{configurationLabel(name, '已绑定技能')}</li>)}</ul> : <p>暂无技能</p>}</section>
        <section className="member-resource-group"><h4>已配置工具服务</h4>{config.mcpServerIds.length ? <ul>{config.mcpServerIds.map((name, index) => <li key={`${name}-${index}`}>{configurationLabel(name, '已绑定工具服务')}</li>)}</ul> : <p>暂无工具服务</p>}</section>
        {(['permissionAllow', 'permissionAsk', 'permissionDeny'] as const).filter((key) => config[key].length).map((key) => <section className="member-resource-group" key={key}><h4>{permissionNames[key]}</h4><ul>{config[key].map((name, index) => <li key={`${name}-${index}`}>{configurationLabel(name, '已配置调用规则')}</li>)}</ul></section>)}
      </> : null}
    </div>
  </>
}
