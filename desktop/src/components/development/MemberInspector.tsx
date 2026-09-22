import { Check, Plus, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { EditableText } from '@/pages/team-workspace/EditableText'
import { Modal, ProductField, ProductSelect, ProductSwitch, ProductTextArea } from '@/components/ui'
import type { EnterpriseBusinessCapabilityCatalog, EnterpriseDevelopmentOverview, EnterpriseTeamMemberConfigDraft, EnterpriseTeamMemberSkill } from '@/types/api'

export function configurationLabel(value: string | undefined, fallback: string): string {
  if (!value?.trim()) return fallback
  if (/\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b|^(?:run|interaction)-/i.test(value) || /^[\da-f]{24,}$/i.test(value)) return fallback
  return value
}

type Section = 'role' | 'instructions' | 'execution' | 'resources'
const sections: Array<{ value: Section; label: string }> = [
  { value: 'role', label: '职责' }, { value: 'instructions', label: '指令' },
  { value: 'execution', label: '执行' }, { value: 'resources', label: '能力' },
]
const engines = [{ value: 'loom', label: 'Weave 内置运行时' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }, { value: 'opencode', label: 'OpenCode' }]

export function MemberInspector({ draft, runtimes, models, businessCapabilities, businessCapabilityError, onChange }: {
  draft: EnterpriseTeamMemberConfigDraft
  runtimes: EnterpriseDevelopmentOverview['runtimes']
  models: EnterpriseDevelopmentOverview['models']
  businessCapabilities?: EnterpriseBusinessCapabilityCatalog
  businessCapabilityError?: string
  onChange(draft: EnterpriseTeamMemberConfigDraft): void
}) {
  const [section, setSection] = useState<Section>('role')
  const [skillEditor, setSkillEditor] = useState<{ index: number; value: EnterpriseTeamMemberSkill }>()
  const [skillError, setSkillError] = useState('')
  const config = draft.configuration
  const relationship = draft.relationship
  const setConfig = <K extends keyof typeof config>(key: K, value: typeof config[K]) => onChange({ ...draft, configuration: { ...config, [key]: value } })
  const setRelationship = <K extends keyof typeof relationship>(key: K, value: typeof relationship[K]) => onChange({ ...draft, relationship: { ...relationship, [key]: value } })
  const setEngine = (engine: string) => onChange({
    ...draft,
    configuration: {
      ...config,
      engine,
      model: engine === 'loom' ? (models.includes(config.model) ? config.model : models[0] ?? '') : '',
      runtimeId: engine === 'loom' ? '' : config.runtimeId,
    },
  })
  const engineOptions = engines.some((engine) => engine.value === config.engine) ? engines : [...engines, { value: config.engine, label: configurationLabel(config.engine, '当前执行引擎') }]
  const runtimeOptions = [{ value: '', label: '自动选择' }, ...runtimes.map((runtime) => ({ value: runtime.id, label: configurationLabel(runtime.name, '已登记运行位置'), detail: runtime.online ? '在线' : '离线' }))]
  if (config.runtimeId && !runtimes.some((runtime) => runtime.id === config.runtimeId)) runtimeOptions.push({ value: config.runtimeId, label: '当前绑定位置（未连接）' })
  const modelOptions: Array<{ value: string; label: string; detail?: string }> = models.map((model) => ({ value: model, label: model }))
  if (config.model && !models.includes(config.model)) modelOptions.push({ value: config.model, label: config.model, detail: '当前模型尚未接入' })
  const modelReady = config.engine !== 'loom' || models.includes(config.model)
  const permissionNames: Record<string, string> = { permissionAllow: '允许调用', permissionAsk: '调用前询问', permissionDeny: '禁止调用' }
  const openSkill = (index = -1, value: EnterpriseTeamMemberSkill = { name: '', description: '', body: '', alwaysActive: false }) => { setSkillError(''); setSkillEditor({ index, value }) }
  const saveSkill = () => {
    if (!skillEditor) return
    const value = { ...skillEditor.value, name: skillEditor.value.name.trim(), description: skillEditor.value.description.trim(), body: skillEditor.value.body.trim() }
    if (!value.name || !value.body) { setSkillError('请填写技能名称和内容'); return }
    if (config.skills.some((skill, index) => index !== skillEditor.index && skill.name.trim() === value.name)) { setSkillError('技能名称不能重复'); return }
    const skills = [...config.skills]
    if (skillEditor.index < 0) skills.push(value); else skills[skillEditor.index] = value
    setConfig('skills', skills); setSkillEditor(undefined)
  }
  const toggleBusinessCapability = (id: string) => {
    const selected = config.businessCapabilityIds.includes(id)
    setConfig('businessCapabilityIds', selected ? config.businessCapabilityIds.filter((value) => value !== id) : [...config.businessCapabilityIds, id])
  }
  const uploadSkill = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 512 * 1024) {
      setSkillEditor({ index: -1, value: { name: file.name.replace(/\.(md|txt)$/i, '').trim(), description: '', body: '', alwaysActive: false } })
      setSkillError('技能文件不能超过 512 KB')
      return
    }
    try {
      const body = await file.text()
      openSkill(-1, { name: file.name.replace(/\.(md|txt)$/i, '').trim(), description: '', body, alwaysActive: false })
    } catch {
      setSkillEditor({ index: -1, value: { name: file.name.replace(/\.(md|txt)$/i, '').trim(), description: '', body: '', alwaysActive: false } })
      setSkillError('技能文件读取失败')
    }
  }

  return <>
    <nav className="member-inspector__tabs" aria-label="成员配置分类">{sections.map((item) => <button type="button" key={item.value} aria-pressed={section === item.value} className={section === item.value ? 'is-active' : ''} onClick={() => { setSection(item.value) }}>{item.label}</button>)}</nav>
    <div className="member-inspector__body">
      {section === 'role' ? <div className="tw-member-definition">
        <EditableText label="成员名称" value={config.displayName} multiline={false} placeholder="例如：问题分类员" onChange={(value) => setConfig('displayName', value)}/>
        <EditableText label="团队职责" value={relationship.duty} placeholder="例如：将用户反馈按产品模块分类，找出重复问题，并保留原始反馈依据。" onChange={(value) => setRelationship('duty', value)}/>
        <EditableText label="交付要求" value={relationship.resultRequirement} placeholder="例如：返回分类清单，每项包含问题摘要、所属模块和原文依据。" onChange={(value) => setRelationship('resultRequirement', value)}/>
        <details className="tw-member-advanced"><summary>参与条件与协作设置</summary><EditableText label="何时参与" value={relationship.whenToUse} placeholder="例如：任务涉及用户反馈分类时参与。" onChange={(value) => setRelationship('whenToUse', value)}/><EditableText label="协作上下文" value={relationship.contextInstruction} placeholder="例如：保留其他成员已标记的不确定事项，交给负责人确认。" onChange={(value) => setRelationship('contextInstruction', value)}/>{config.role !== 'avatar' && <ProductSwitch label="参与团队协作" checked={relationship.enabled} onChange={(value) => setRelationship('enabled', value)}/>}</details>
      </div> : null}

      {section === 'instructions' ? <div className="tw-member-definition"><EditableText label="工作方法" value={config.systemPrompt} placeholder="例如：先读完整输入，再按模块分类；无法确定归属时单独列出，不猜测缺失事实。" onChange={(value) => setConfig('systemPrompt', value)}/><details className="tw-member-advanced"><summary>结构化输出格式</summary><EditableText label="输出格式" value={config.outputSchema} placeholder="JSON Schema；没有程序对接要求时可留空。" onChange={(value) => setConfig('outputSchema', value)}/></details></div> : null}

      {section === 'execution' ? <section className="member-config-card">
        <header><div><h4>运行方式</h4></div></header>
        {<div className="member-config-form">
          <div className="product-field"><span><strong>执行引擎</strong></span><ProductSelect label="执行引擎" value={config.engine} options={engineOptions} onChange={setEngine}/></div>
          {config.engine === 'loom' ? <><div className="product-field"><span><strong>模型</strong></span><ProductSelect label="模型" value={config.model} options={modelOptions} disabled={!models.length} onChange={(value) => setConfig('model', value)}/></div>{!modelReady ? <p className="member-inspector__error" role="alert">组织尚未配置可用模型</p> : null}</> : null}
          {config.engine !== 'loom' ? <div className="product-field"><span><strong>运行位置</strong></span><ProductSelect label="运行位置" value={config.runtimeId} options={runtimeOptions} onChange={(value) => setConfig('runtimeId', value)}/></div> : null}
          <details className="tw-member-advanced"><summary>执行限制与记忆</summary>{config.engine === 'loom' && <><ProductSwitch label="设置工具执行轮次" checked={!!config.toolLoopControl} onChange={(enabled) => setConfig('toolLoopControl', enabled ? { sliceRounds: 5, initialTotalRounds: 30 } : null)}/>{config.toolLoopControl && <div className="member-limit-grid"><ProductField label="每次连续执行轮数" type="number" min={1} max={1000} value={config.toolLoopControl.sliceRounds} onChange={(e) => setConfig('toolLoopControl', { ...config.toolLoopControl!, sliceRounds: Number(e.target.value) })}/><ProductField label="总执行轮数" type="number" min={1} value={config.toolLoopControl.initialTotalRounds} onChange={(e) => setConfig('toolLoopControl', { ...config.toolLoopControl!, initialTotalRounds: Number(e.target.value) })}/></div>}<ProductField label="相同工具调用最多连续重复次数" type="number" min={0} value={config.maxToolRepeats ?? 0} onChange={(e) => setConfig('maxToolRepeats', Number(e.target.value))}/></>}
          <ProductSwitch label="启用记忆" checked={config.memoryEnabled} onChange={(value) => setConfig('memoryEnabled', value)}/>
          {config.memoryEnabled ? <ProductSelect label="记忆范围" value={config.memoryScope} options={[{ value: 'tenant', label: '团队空间' }, { value: 'user', label: '当前员工' }, { value: 'session', label: '当前会话' }]} onChange={(value) => setConfig('memoryScope', value)}/> : null}
          <div className="member-limit-grid"><ProductField label="总令牌上限" type="number" min={0} value={config.maxTokens} onChange={(event) => setConfig('maxTokens', Number(event.target.value))}/><ProductField label="单次输出上限" type="number" min={0} value={config.maxOutputTokens} onChange={(event) => setConfig('maxOutputTokens', Number(event.target.value))}/><ProductField label="步骤上限" type="number" min={0} value={config.stepBudget} onChange={(event) => setConfig('stepBudget', Number(event.target.value))}/><ProductField label="成本上限（美元）" type="number" min={0} step="0.01" value={config.maxCostUsd} onChange={(event) => setConfig('maxCostUsd', Number(event.target.value))}/></div>
          </details></div>}

      </section> : null}

      {section === 'resources' ? <>
        <section className="member-resource-group"><div className="member-resource-toolbar"><h4>业务能力</h4><small>Forge 按当前员工权限提供</small></div>{businessCapabilityError ? <p role="alert">{businessCapabilityError}</p> : businessCapabilities?.capabilities.length ? <ul className="member-capability-list">{businessCapabilities.capabilities.map((capability) => {
          const selected = config.businessCapabilityIds.includes(capability.id)
          return <li key={capability.id}><button type="button" aria-pressed={selected} className={selected ? 'is-selected' : ''} onClick={() => toggleBusinessCapability(capability.id)}><span><strong>{configurationLabel(capability.name, '业务能力')}</strong><small>{configurationLabel(capability.description, '由 Forge 提供')}</small></span>{selected ? <Check size={14}/> : <Plus size={14}/>}</button></li>
        })}</ul> : <p>暂无可分配的业务能力</p>}{config.businessCapabilityIds.filter((id) => !businessCapabilities?.capabilities.some((capability) => capability.id === id)).map((id) => <div className="member-resource-unavailable" key={id}><span>已有业务能力当前不可用</span><button type="button" onClick={() => toggleBusinessCapability(id)}>移除</button></div>)}</section>
        <section className="member-resource-group"><div className="member-resource-toolbar"><h4>技能</h4><span><label className="button member-skill-upload"><Upload size={12}/>上传<input type="file" accept=".md,.txt,text/markdown,text/plain" onChange={(event) => { void uploadSkill(event.target.files?.[0]); event.target.value = '' }}/></label><button type="button" className="button" onClick={() => openSkill()}><Plus size={12}/>手动添加</button></span></div>{config.skills.length ? <ul className="member-skill-list">{config.skills.map((skill, index) => <li key={`${skill.name}-${index}`}><button type="button" onClick={() => openSkill(index, skill)}><strong>{configurationLabel(skill.name, '未命名技能')}</strong><small>{configurationLabel(skill.description, '手动技能')}</small></button><button type="button" aria-label={`移除${configurationLabel(skill.name, '技能')}`} title="移除技能" onClick={() => setConfig('skills', config.skills.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={12}/></button></li>)}</ul> : <p>暂无技能</p>}{config.skillNames.length ? <div className="member-resource-readonly"><small>现有版本绑定</small>{config.skillNames.map((name, index) => <span key={`${name}-${index}`}>{configurationLabel(name, '已绑定技能')}</span>)}</div> : null}</section>
        <section className="member-resource-group"><h4>已配置工具服务</h4>{config.mcpServerIds.length ? <ul>{config.mcpServerIds.map((name, index) => <li key={`${name}-${index}`}>{configurationLabel(name, '已绑定工具服务')}</li>)}</ul> : <p>暂无工具服务</p>}</section>
        {(['permissionAllow', 'permissionAsk', 'permissionDeny'] as const).filter((key) => config[key].length).map((key) => <section className="member-resource-group" key={key}><h4>{permissionNames[key]}</h4><ul>{config[key].map((name, index) => <li key={`${name}-${index}`}>{configurationLabel(name, '已配置调用规则')}</li>)}</ul></section>)}
      </> : null}
    </div>
    {skillEditor ? <Modal title={skillEditor.index < 0 ? '添加技能' : '编辑技能'} onClose={() => setSkillEditor(undefined)} footer={<><button type="button" className="button" onClick={() => setSkillEditor(undefined)}>取消</button><button type="button" className="button button--primary" disabled={!skillEditor.value.name.trim() || !skillEditor.value.body.trim()} onClick={saveSkill}>保存技能</button></>}><div className="team-create-form member-skill-form"><ProductField autoFocus label="技能名称" maxLength={80} value={skillEditor.value.name} onChange={(event) => setSkillEditor({ ...skillEditor, value: { ...skillEditor.value, name: event.target.value } })}/><ProductField label="用途" maxLength={240} value={skillEditor.value.description} onChange={(event) => setSkillEditor({ ...skillEditor, value: { ...skillEditor.value, description: event.target.value } })}/><ProductTextArea label="技能内容" rows={7} value={skillEditor.value.body} onChange={(event) => setSkillEditor({ ...skillEditor, value: { ...skillEditor.value, body: event.target.value } })}/><ProductSwitch label="每次执行都加载" checked={skillEditor.value.alwaysActive} onChange={(value) => setSkillEditor({ ...skillEditor, value: { ...skillEditor.value, alwaysActive: value } })}/>{skillError ? <p role="alert">{skillError}</p> : null}</div></Modal> : null}
  </>
}
