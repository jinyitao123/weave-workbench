import { Plus, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { EditableText } from '@/pages/team-workspace/EditableText'
import { Modal, ProductField, ProductSelect, ProductSwitch, ProductTextArea } from '@/components/ui'
import type { EnterpriseBusinessCapabilityBinding, EnterpriseBusinessCapabilityCatalog, EnterpriseDevelopmentOverview, EnterpriseTeamMemberConfigDraft, EnterpriseTeamMemberSkill } from '@/types/api'

type BusinessCapability = EnterpriseBusinessCapabilityCatalog['capabilities'][number]
type BusinessParameter = NonNullable<BusinessCapability['params']>[number]
type BindingSource = EnterpriseBusinessCapabilityBinding['parameters'][number]['source']

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
const materialBindingSources: Array<{ value: '' | EnterpriseBusinessCapabilityBinding['parameters'][number]['source']; label: string }> = [
  { value: '', label: '由成员填写' },
  { value: 'materials.single.id', label: '本次唯一文件 · 标识' },
  { value: 'materials.single.name', label: '本次唯一文件 · 名称' },
  { value: 'materials.single.sha256', label: '本次唯一文件 · 摘要' },
  { value: 'materials.manifest_json', label: '本次全部文件 · 有序清单' },
]

function parameterSourceOptions(parameter: BusinessParameter, current?: BindingSource) {
  const options = parameter.type === 'string'
    ? materialBindingSources
    : parameter.type === 'file' && !parameter.multiple
      ? materialBindingSources.filter((item) => item.value === '' || item.value === 'materials.single.id')
      : [{ value: '' as const, label: parameter.type === 'file' ? '暂不支持文件列表参数' : '由成员填写' }]
  if (current && !options.some((item) => item.value === current)) return [...options, { value: current, label: '当前映射与参数类型不兼容' }]
  return options
}

function singleFileParameters(parameters: BusinessParameter[]): Array<{ name: string; source: BindingSource }> | undefined {
  const file = parameters.find((parameter) => /(?:^|_)file_id$/.test(parameter.name) && (parameter.type === 'string' || parameter.type === 'file') && !parameter.multiple)
  if (!file) return undefined
  const prefix = file.name.replace(/(?:^|_)file_id$/, '')
  const name = parameters.find((parameter) => [prefix ? `${prefix}_name` : 'file_name', prefix ? `${prefix}_file_name` : 'name'].includes(parameter.name) && parameter.type === 'string')
  const digest = parameters.find((parameter) => [prefix ? `${prefix}_sha256` : 'file_sha256', prefix ? `${prefix}_file_sha256` : 'sha256'].includes(parameter.name) && parameter.type === 'string')
  if (!name || !digest) return undefined
  return [
    { name: file.name, source: 'materials.single.id' },
    { name: name.name, source: 'materials.single.name' },
    { name: digest.name, source: 'materials.single.sha256' },
  ]
}

function capabilityImpact(capability: BusinessCapability): string {
  return capability.effect === 'write' ? '会修改业务记录' : '只读取业务资料'
}

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
  const [capabilityPickerOpen, setCapabilityPickerOpen] = useState(false)
  const [capabilitySearch, setCapabilitySearch] = useState('')
  const [expandedCapability, setExpandedCapability] = useState('')
  const [individualFileMapping, setIndividualFileMapping] = useState('')
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
    const capability = businessCapabilities?.capabilities.find((item) => item.id === id)
    if (!selected && capability?.status === 'unavailable') return
    const fileParameters = !selected && capability ? singleFileParameters(capability.params ?? []) : undefined
    onChange({ ...draft, configuration: {
      ...config,
      businessCapabilityIds: selected ? config.businessCapabilityIds.filter((value) => value !== id) : [...config.businessCapabilityIds, id],
      businessCapabilityBindings: selected
        ? config.businessCapabilityBindings.filter((binding) => binding.capabilityId !== id)
        : fileParameters
          ? [...config.businessCapabilityBindings.filter((binding) => binding.capabilityId !== id), { capabilityId: id, parameters: fileParameters }]
          : config.businessCapabilityBindings,
    } })
    setExpandedCapability(selected ? '' : id)
    if (!selected) setCapabilityPickerOpen(false)
  }
  const setBusinessCapabilitySources = (capabilityId: string, updates: Array<{ name: string; source: string }>) => {
    const current = config.businessCapabilityBindings.find((binding) => binding.capabilityId === capabilityId)
    const names = new Set(updates.map((parameter) => parameter.name))
    const parameters = (current?.parameters ?? []).filter((parameter) => !names.has(parameter.name))
    for (const parameter of updates) if (parameter.source) parameters.push({ name: parameter.name, source: parameter.source as BindingSource })
    const bindings = config.businessCapabilityBindings.filter((binding) => binding.capabilityId !== capabilityId)
    if (parameters.length) bindings.push({ capabilityId, parameters })
    setConfig('businessCapabilityBindings', bindings)
  }
  const setBusinessCapabilityParamSource = (capabilityId: string, name: string, source: string) => setBusinessCapabilitySources(capabilityId, [{ name, source }])
  const availableToAdd = (businessCapabilities?.capabilities ?? []).filter((capability) =>
    !config.businessCapabilityIds.includes(capability.id) &&
    `${capability.name} ${capability.description}`.toLocaleLowerCase().includes(capabilitySearch.trim().toLocaleLowerCase()),
  )
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
        <section className="member-resource-group member-business-actions">
          <div className="member-resource-toolbar"><div><h4>业务动作 <span className="member-resource-count">{config.businessCapabilityIds.length}</span></h4><small>由 Forge 提供；实际调用仍按发起员工的本次授权校验</small></div><button type="button" className="button" onClick={() => { setCapabilitySearch(''); setCapabilityPickerOpen(true) }}><Plus size={12}/>添加业务动作</button></div>
          {businessCapabilityError ? <p role="alert" className="member-inspector__error">{businessCapabilityError}</p> : null}
          {config.businessCapabilityIds.length ? <ul className="member-capability-list">{config.businessCapabilityIds.map((id) => {
            const capability = businessCapabilities?.capabilities.find((item) => item.id === id)
            if (!capability) return <li key={id} className="member-capability-assigned"><div className="member-capability-assigned__summary"><strong>已绑定的业务动作暂不可读取</strong><button type="button" className="button" onClick={() => toggleBusinessCapability(id)}>移除</button></div></li>
            const bindings = config.businessCapabilityBindings.find((binding) => binding.capabilityId === id)
            const fileParameters = singleFileParameters(capability.params ?? [])
            const mappedSource = (name: string) => bindings?.parameters.find((item) => item.name === name)?.source
            const fileMode = fileParameters?.every((item) => mappedSource(item.name) === item.source) ? 'single' : fileParameters?.every((item) => !mappedSource(item.name)) ? 'member' : 'individual'
            const selectedFileMode = individualFileMapping === id ? 'individual' : fileMode
            const parameters = (capability.params ?? []).filter((parameter) => selectedFileMode === 'individual' || !fileParameters?.some((item) => item.name === parameter.name))
            const expanded = expandedCapability === id
            return <li key={id} className="member-capability-assigned">
              <div className="member-capability-assigned__summary"><span><strong>{configurationLabel(capability.name, '业务动作')}</strong><small>{capabilityImpact(capability)}{capability.requiresEmployeeIntent ? ' · 需本轮员工授权' : ''}</small></span><div className="member-capability-assigned__actions">{capability.params?.length ? <button type="button" className="button" aria-expanded={expanded} onClick={() => setExpandedCapability(expanded ? '' : id)}>{expanded ? '收起配置' : '配置输入'}</button> : null}<button type="button" className="button" aria-label={'移除' + configurationLabel(capability.name, '业务动作')} onClick={() => toggleBusinessCapability(id)}>移除</button></div></div>
              {capability.status === 'unavailable' ? <p className="member-inspector__error" role="alert">{capability.unavailableReason ?? '该业务动作当前不可用'}。移除后才能更新团队。</p> : null}
              {expanded ? <div className="member-capability-parameters"><p>{capability.description}</p>
                {fileParameters ? <><ProductSelect label={configurationLabel(capability.name, '业务动作') + '文件来源'} value={selectedFileMode ?? 'member'} options={[{ value: 'single', label: '本次唯一文件（系统注入）' }, { value: 'member', label: '由成员填写' }, { value: 'individual', label: '分别设置接口字段' }]} onChange={(mode) => { if (mode === 'individual') { setIndividualFileMapping(id); return }; setIndividualFileMapping(''); setBusinessCapabilitySources(id, fileParameters.map((item) => ({ name: item.name, source: mode === 'single' ? item.source : '' }))) }}/>{selectedFileMode === 'single' ? <small>文件标识、名称和摘要来自同一份冻结文件；有多份材料时，此来源不可用。</small> : selectedFileMode === 'member' ? <small className="member-capability-caution">文件参数尚未绑定本次材料，成员需要自行提供。</small> : null}</> : null}
                {parameters.map((parameter) => { const source = mappedSource(parameter.name); return <div className="member-capability-parameter" key={parameter.name}><span><strong>{configurationLabel(parameter.label, parameter.name)}</strong><small>{parameter.name}</small></span><ProductSelect label={(parameter.label || parameter.name) + '来源'} value={source ?? ''} options={parameterSourceOptions(parameter, source)} onChange={(value) => setBusinessCapabilityParamSource(id, parameter.name, value)}/></div> })}
              </div> : null}
            </li>
          })}</ul> : <p className="member-resource-empty">当前成员没有配置业务动作。</p>}
        </section>
        <section className="member-resource-group"><div className="member-resource-toolbar"><h4>技能 <span className="member-resource-count">{config.skills.length + config.skillNames.length}</span></h4><span><label className="button member-skill-upload"><Upload size={12}/>上传<input type="file" accept=".md,.txt,text/markdown,text/plain" onChange={(event) => { void uploadSkill(event.target.files?.[0]); event.target.value = '' }}/></label><button type="button" className="button" onClick={() => openSkill()}><Plus size={12}/>新建技能</button></span></div>{config.skills.length ? <ul className="member-skill-list">{config.skills.map((skill, index) => <li key={skill.name + '-' + index}><button type="button" onClick={() => openSkill(index, skill)}><strong>{configurationLabel(skill.name, '未命名技能')}</strong><small>{configurationLabel(skill.description, '成员工作方法')}</small></button><button type="button" aria-label={'移除' + configurationLabel(skill.name, '技能')} onClick={() => setConfig('skills', config.skills.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={12}/></button></li>)}</ul> : !config.skillNames.length ? <p className="member-resource-empty">当前成员没有配置技能。</p> : null}{config.skillNames.length ? <div className="member-resource-readonly"><small>现有版本绑定</small>{config.skillNames.map((name, index) => <span key={name + '-' + index}>{configurationLabel(name, '已绑定技能')}</span>)}</div> : null}</section>
        <section className="member-resource-group"><div className="member-resource-toolbar"><h4>其他工具（MCP） <span className="member-resource-count">{config.mcpServerIds.length}</span></h4></div>{config.mcpServerIds.length ? <ul>{config.mcpServerIds.map((name, index) => <li key={name + '-' + index}>{configurationLabel(name, '已绑定工具服务')}</li>)}</ul> : <p className="member-resource-empty">当前没有可分配的工具服务，连接由组织管理。</p>}</section>
        {(['permissionAllow', 'permissionAsk', 'permissionDeny'] as const).filter((key) => config[key].length).map((key) => <section className="member-resource-group" key={key}><h4>{permissionNames[key]}</h4><ul>{config[key].map((name, index) => <li key={name + '-' + index}>{configurationLabel(name, '已配置调用规则')}</li>)}</ul></section>)}
      </> : null}
    </div>
    {capabilityPickerOpen ? <Modal title="添加业务动作" onClose={() => setCapabilityPickerOpen(false)} footer={<button type="button" className="button" onClick={() => setCapabilityPickerOpen(false)}>关闭</button>}><div className="member-capability-picker">
      <ProductField autoFocus label="搜索业务动作" value={capabilitySearch} onChange={(event) => setCapabilitySearch(event.target.value)}/>
      {businessCapabilityError ? <p role="alert">{businessCapabilityError}</p> : !businessCapabilities ? <p>正在读取业务动作…</p> : availableToAdd.length ? <ul>{availableToAdd.map((capability) => <li key={capability.id}><div><strong>{configurationLabel(capability.name, '业务动作')}</strong><small>{capabilityImpact(capability)}{capability.requiresEmployeeIntent ? ' · 需本轮员工授权' : ''}</small></div><button type="button" className="button" disabled={capability.status === 'unavailable'} onClick={() => toggleBusinessCapability(capability.id)}>添加到成员</button><details><summary>查看说明与接口参数</summary><p>{capability.description}</p>{capability.params?.length ? <ul>{capability.params.map((parameter) => <li key={parameter.name}>{configurationLabel(parameter.label, parameter.name)}{parameter.required ? ' · 必填' : ''}</li>)}</ul> : null}</details>{capability.status === 'unavailable' ? <p role="alert">{capability.unavailableReason ?? '当前不能绑定该业务动作'}</p> : null}</li>)}</ul> : <p>没有其他可添加的业务动作。</p>}
    </div></Modal> : null}
    {skillEditor ? <Modal title={skillEditor.index < 0 ? '添加技能' : '编辑技能'} onClose={() => setSkillEditor(undefined)} footer={<><button type="button" className="button" onClick={() => setSkillEditor(undefined)}>取消</button><button type="button" className="button button--primary" disabled={!skillEditor.value.name.trim() || !skillEditor.value.body.trim()} onClick={saveSkill}>保存技能</button></>}><div className="team-create-form member-skill-form"><ProductField autoFocus label="技能名称" maxLength={80} value={skillEditor.value.name} onChange={(event) => setSkillEditor({ ...skillEditor, value: { ...skillEditor.value, name: event.target.value } })}/><ProductField label="用途" maxLength={240} value={skillEditor.value.description} onChange={(event) => setSkillEditor({ ...skillEditor, value: { ...skillEditor.value, description: event.target.value } })}/><ProductTextArea label="技能内容" rows={7} value={skillEditor.value.body} onChange={(event) => setSkillEditor({ ...skillEditor, value: { ...skillEditor.value, body: event.target.value } })}/><ProductSwitch label="每次执行都加载" checked={skillEditor.value.alwaysActive} onChange={(value) => setSkillEditor({ ...skillEditor, value: { ...skillEditor.value, alwaysActive: value } })}/>{skillError ? <p role="alert">{skillError}</p> : null}</div></Modal> : null}
  </>
}
