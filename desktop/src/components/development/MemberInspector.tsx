import { ChevronDown, Pencil } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { ProductField, ProductSelect, ProductSwitch, ProductTextArea } from '@/components/ui'
import type { EnterpriseDevelopmentOverview, EnterpriseTeamMemberConfigDraft } from '@/types/api'

// Internal references remain in the payload, never in display labels.
export function configurationLabel(value: string | undefined, fallback: string): string {
  if (!value?.trim()) return fallback
  if (/\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b|^(?:run|interaction)-/i.test(value) || /^[\da-f]{24,}$/i.test(value)) return fallback
  return value
}

function EditSection({ label, summary, children }: { label: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <section className={`member-setting ${open ? 'is-open' : ''}`}>
    <button type="button" className="member-setting__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span><strong>{label}</strong>{!open ? <small>{configurationLabel(summary, '未设置')}</small> : null}</span>
      {open ? <ChevronDown size={13}/> : <Pencil size={12}/>}
    </button>
    {open ? <div id={id} className="member-setting__editor">{children}</div> : null}
  </section>
}

type Section = 'role' | 'instructions' | 'execution' | 'resources'
const sections: Array<{ value: Section; label: string }> = [
  { value: 'role', label: '职责' }, { value: 'instructions', label: '指令' },
  { value: 'execution', label: '执行' }, { value: 'resources', label: '技能与工具' },
]
const engines = [{ value: 'loom', label: 'Weave 内置运行时' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }, { value: 'opencode', label: 'OpenCode' }]

export function MemberInspector({ draft, runtimes, onChange }: {
  draft: EnterpriseTeamMemberConfigDraft
  runtimes: EnterpriseDevelopmentOverview['runtimes']
  onChange(draft: EnterpriseTeamMemberConfigDraft): void
}) {
  const [section, setSection] = useState<Section>('role')
  const config = draft.configuration
  const relationship = draft.relationship
  const setConfig = <K extends keyof typeof config>(key: K, value: typeof config[K]) => onChange({ ...draft, configuration: { ...config, [key]: value } })
  const setRelationship = <K extends keyof typeof relationship>(key: K, value: typeof relationship[K]) => onChange({ ...draft, relationship: { ...relationship, [key]: value } })
  const engineOptions = engines.some((engine) => engine.value === config.engine) ? engines : [...engines, { value: config.engine, label: configurationLabel(config.engine, '当前执行引擎') }]
  const runtimeOptions = [{ value: '', label: '自动选择' }, ...runtimes.map((runtime) => ({ value: runtime.id, label: configurationLabel(runtime.name, '已登记运行位置'), detail: runtime.online ? '在线' : '离线' }))]
  if (config.runtimeId && !runtimes.some((runtime) => runtime.id === config.runtimeId)) runtimeOptions.push({ value: config.runtimeId, label: '当前绑定位置（未连接）' })
  const permissionNames: Record<string, string> = { permissionAllow: '允许调用', permissionAsk: '调用前询问', permissionDeny: '禁止调用' }
  return <>
    <nav className="member-inspector__tabs" aria-label="成员配置分类">{sections.map((item) => <button type="button" key={item.value} aria-pressed={section === item.value} className={section === item.value ? 'is-active' : ''} onClick={() => setSection(item.value)}>{item.label}</button>)}</nav>
    <div className="member-inspector__body">
      {section === 'role' ? <>
        <EditSection label="显示名称" summary={config.displayName}><ProductField label="显示名称" value={config.displayName} onChange={(event) => setConfig('displayName', event.target.value)}/></EditSection>
        {draft.configuration.role !== 'avatar' ? <ProductSwitch label="参与团队协作" checked={relationship.enabled} onChange={(value) => setRelationship('enabled', value)}/> : null}
        <EditSection label="团队职责" summary={relationship.duty}><ProductTextArea label="团队职责" rows={5} value={relationship.duty} onChange={(event) => setRelationship('duty', event.target.value)}/></EditSection>
        <EditSection label="何时参与" summary={relationship.whenToUse}><ProductTextArea label="何时参与" rows={4} value={relationship.whenToUse} onChange={(event) => setRelationship('whenToUse', event.target.value)}/></EditSection>
        <EditSection label="交付要求" summary={relationship.resultRequirement}><ProductTextArea label="交付要求" rows={5} value={relationship.resultRequirement} onChange={(event) => setRelationship('resultRequirement', event.target.value)}/></EditSection>
        <EditSection label="协作上下文" summary={relationship.contextInstruction}><ProductTextArea label="协作上下文" rows={5} value={relationship.contextInstruction} onChange={(event) => setRelationship('contextInstruction', event.target.value)}/></EditSection>
      </> : null}
      {section === 'instructions' ? <>
        <EditSection label="系统指令" summary={config.systemPrompt}><ProductTextArea label="系统指令" className="member-instruction-editor" rows={14} value={config.systemPrompt} onChange={(event) => setConfig('systemPrompt', event.target.value)}/></EditSection>
        <EditSection label="输出格式" summary={config.outputSchema ? '结构化输出' : '自由文本'}><ProductTextArea label="输出格式" detail="JSON Schema" rows={10} value={config.outputSchema} onChange={(event) => setConfig('outputSchema', event.target.value)}/></EditSection>
      </> : null}
      {section === 'execution' ? <>
        <div className="product-field"><span><strong>执行引擎</strong></span><ProductSelect label="执行引擎" value={config.engine} options={engineOptions} onChange={(value) => setConfig('engine', value)}/></div>
        <EditSection label="模型" summary={config.model || '跟随运行环境'}><ProductField label="模型" value={config.model} onChange={(event) => setConfig('model', event.target.value)}/></EditSection>
        <div className="product-field"><span><strong>运行位置</strong></span><ProductSelect label="运行位置" value={config.runtimeId} options={runtimeOptions} onChange={(value) => setConfig('runtimeId', value)}/></div>
        <EditSection label="记忆" summary={config.memoryEnabled ? '已启用' : '未启用'}>
          <ProductSwitch label="启用记忆" checked={config.memoryEnabled} onChange={(value) => setConfig('memoryEnabled', value)}/>
          {config.memoryEnabled ? <ProductSelect label="记忆范围" value={config.memoryScope} options={[{ value: 'tenant', label: '团队空间' }, { value: 'user', label: '当前员工' }, { value: 'session', label: '当前会话' }]} onChange={(value) => setConfig('memoryScope', value)}/> : null}
        </EditSection>
        <EditSection label="执行限制" summary="令牌、步骤与成本">
          <ProductField label="总令牌上限" type="number" min={0} value={config.maxTokens} onChange={(event) => setConfig('maxTokens', Number(event.target.value))}/>
          <ProductField label="单次输出上限" type="number" min={0} value={config.maxOutputTokens} onChange={(event) => setConfig('maxOutputTokens', Number(event.target.value))}/>
          <ProductField label="步骤上限" type="number" min={0} value={config.stepBudget} onChange={(event) => setConfig('stepBudget', Number(event.target.value))}/>
          <ProductField label="成本上限（美元）" type="number" min={0} step="0.01" value={config.maxCostUsd} onChange={(event) => setConfig('maxCostUsd', Number(event.target.value))}/>
        </EditSection>
      </> : null}
      {section === 'resources' ? <>
        <section className="member-resource-group"><h4>已配置技能</h4>{config.skillNames.length ? <ul>{config.skillNames.map((name, index) => <li key={`${name}-${index}`}>{configurationLabel(name, '已绑定技能')}</li>)}</ul> : <p>暂无技能</p>}</section>
        <section className="member-resource-group"><h4>已配置工具服务</h4>{config.mcpServerIds.length ? <ul>{config.mcpServerIds.map((name, index) => <li key={`${name}-${index}`}>{configurationLabel(name, '已绑定工具服务')}</li>)}</ul> : <p>暂无工具服务</p>}</section>
        {(['permissionAllow', 'permissionAsk', 'permissionDeny'] as const).filter((key) => config[key].length).map((key) => <section className="member-resource-group" key={key}><h4>{permissionNames[key]}</h4><ul>{config[key].map((name, index) => <li key={`${name}-${index}`}>{configurationLabel(name, '已配置调用规则')}</li>)}</ul></section>)}
      </> : null}
    </div>
  </>
}
