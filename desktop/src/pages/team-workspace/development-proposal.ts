import type { EnterpriseBusinessCapabilityCatalog } from '../../types/api'
import type { TeamDefinition } from '../../types/team-workspace'
import { addParallelBranch, bindings, configureWorkflowResultProtocol, initialGraph, insertStep, isParallelBranchWorker, originalBinding, predecessors, removeStep, validateWorkflowResultProtocol, WORKBENCH_RESULT_PROTOCOL } from './graph'
import { newMember } from './member'

export type TeamDevelopmentOperation =
  | { kind: 'team'; name?: string; objective?: string }
  | { kind: 'member_add'; ref: string; name: string; duty: string }
  | { kind: 'member'; member: string; name?: string; duty?: string; instruction?: string; resultRequirement?: string; whenToUse?: string; contextInstruction?: string; enabled?: boolean; outputSchema?: string }
  | { kind: 'member_remove'; member: string }
  | { kind: 'skill'; member: string; name: string; selected: boolean; description?: string; body?: string; alwaysActive?: boolean }
  | { kind: 'capability'; member: string; capability: string; selected: boolean; fileSource?: 'single' | 'member' }
  | { kind: 'flow_add'; name: string; description: string; member: string }
  | { kind: 'flow'; flow: string; name?: string; description?: string }
  | { kind: 'step_add'; flow: string; after: string; member: string; name: string; requirement: string; placement?: 'serial' | 'parallel' }
  | { kind: 'step'; flow: string; step: string; name?: string; member?: string; requirement?: string }
  | { kind: 'step_remove'; flow: string; step: string }
  | { kind: 'step_input'; flow: string; step: string; source: 'run_input' | 'node_output'; from?: string; selected: boolean }
  | { kind: 'delivery'; flow: string; from: string }
  | { kind: 'result_protocol'; flow: string; enabled: boolean; from?: string }
  | { kind: 'join'; flow: string; step: string; policy: 'all_success' | 'fail_fast' | 'quorum' | 'deadline'; successCount?: number; deadlineSeconds?: number }

export interface TeamDevelopmentProposal {
  document: TeamDefinition
  changes: string[]
}

function string(value: unknown, label: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`请为${label}填写有效内容`)
  return value.trim()
}

function optional(value: unknown, label: string, max = 2000): string | undefined {
  return value === undefined ? undefined : string(value, label, max)
}

function singleFileMapping(params: NonNullable<EnterpriseBusinessCapabilityCatalog['capabilities'][number]['params']>) {
  const file = params.find((param) => /(?:^|_)file_id$/.test(param.name) && !param.multiple && (param.type === 'file' || param.type === 'string'))
  if (!file) return undefined
  const prefix = file.name.replace(/(?:^|_)file_id$/, '')
  const name = params.find((param) => [prefix ? `${prefix}_name` : 'file_name', prefix ? `${prefix}_file_name` : 'name'].includes(param.name) && param.type === 'string')
  const digest = params.find((param) => [prefix ? `${prefix}_sha256` : 'file_sha256', prefix ? `${prefix}_file_sha256` : 'sha256'].includes(param.name) && param.type === 'string')
  if (!name || !digest) return undefined
  return [
    { name: file.name, source: 'materials.single.id' as const },
    { name: name.name, source: 'materials.single.name' as const },
    { name: digest.name, source: 'materials.single.sha256' as const },
  ]
}

export function applyTeamDevelopmentOperations(base: TeamDefinition, raw: unknown, catalog: EnterpriseBusinessCapabilityCatalog): TeamDevelopmentProposal {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 24) throw new Error('Pi 需提交 1 至 24 项团队修改')
  const document = structuredClone(base)
  const changes: string[] = []
  const added = new Map<string, string>()
  const member = (reference: unknown) => {
    const key = string(reference, '成员引用', 128)
    const match = document.members.find((item) => item.id === (added.get(key) ?? key))
    if (!match) throw new Error('Pi 引用了当前团队中不存在的成员，请重新生成修改')
    return match
  }
  const flow = (reference: unknown) => {
    const key = string(reference, '流程引用', 128)
    const match = document.workflows.find((item) => item.id === key)
    if (!match) throw new Error('Pi 引用了当前团队中不存在的流程，请重新生成修改')
    return match
  }
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Pi 修改格式无效')
    const operation = item as Record<string, unknown>
    switch (operation.kind) {
      case 'team': {
        const name = optional(operation.name, '团队名称', 80)
        const objective = optional(operation.objective, '团队目标')
        if (!name && !objective) throw new Error('团队修改缺少目标字段')
        if (name) document.name = name
        if (objective) document.objective = objective
        changes.push('修改团队说明')
        break
      }
      case 'member_add': {
        const ref = string(operation.ref, '新成员引用', 64)
        if (added.has(ref) || document.members.some((item) => item.id === ref)) throw new Error('新成员引用重复')
        const name = string(operation.name, '成员名称', 80)
        const duty = string(operation.duty, '成员职责')
        const next = newMember(document.members.find((item) => item.configuration.role === 'worker')?.configuration.model)
        next.configuration.displayName = name
        next.configuration.systemPrompt = duty
        next.relationship.duty = duty
        document.members.push(next)
        added.set(ref, next.id)
        changes.push(`新增成员：${name}`)
        break
      }
      case 'member': {
        const target = member(operation.member)
        const name = optional(operation.name, '成员名称', 80)
        const duty = optional(operation.duty, '成员职责')
        const instruction = optional(operation.instruction, '成员指令', 16000)
        const resultRequirement = optional(operation.resultRequirement, '交付要求')
        const whenToUse = optional(operation.whenToUse, '参与条件')
        const contextInstruction = optional(operation.contextInstruction, '协作上下文')
        const outputSchema = optional(operation.outputSchema, '输出格式', 16000)
        if (!name && !duty && !instruction && !resultRequirement && !whenToUse && !contextInstruction && outputSchema === undefined && operation.enabled === undefined) throw new Error('成员修改缺少目标字段')
        if (name) target.configuration.displayName = name
        if (duty) target.relationship.duty = duty
        if (instruction) target.configuration.systemPrompt = instruction
        if (resultRequirement) target.relationship.resultRequirement = resultRequirement
        if (whenToUse) target.relationship.whenToUse = whenToUse
        if (contextInstruction) target.relationship.contextInstruction = contextInstruction
        if (outputSchema) { JSON.parse(outputSchema); target.configuration.outputSchema = outputSchema }
        if (operation.enabled !== undefined) {
          if (typeof operation.enabled !== 'boolean' || target.configuration.role === 'avatar' && !operation.enabled) throw new Error('成员参与状态无效')
          target.relationship.enabled = operation.enabled
        }
        changes.push(`修改成员：${target.configuration.displayName}`)
        break
      }
      case 'member_remove': {
        const target = member(operation.member)
        if (target.configuration.role === 'avatar' || document.members.filter((item) => item.configuration.role === 'worker').length <= 1) throw new Error('团队必须保留负责人和执行成员')
        if (document.workflows.some((item) => item.graph_definition.nodes.some((node) => node.config?.agent_id === target.id))) throw new Error('成员仍被流程步骤使用，请先调整执行成员')
        document.members = document.members.filter((item) => item.id !== target.id)
        changes.push(`移出成员：${target.configuration.displayName}`)
        break
      }
      case 'skill': {
        const target = member(operation.member)
        const name = string(operation.name, '技能名称', 80)
        if (typeof operation.selected !== 'boolean') throw new Error('技能须明确选择添加或移除')
        if (operation.selected) {
          const body = string(operation.body, '技能内容', 50_000)
          const description = operation.description === undefined ? '' : string(operation.description, '技能说明', 2000)
          const value = { name, description, body, alwaysActive: operation.alwaysActive === true }
          target.configuration.skills = [...target.configuration.skills.filter((item) => item.name !== name), value]
        } else target.configuration.skills = target.configuration.skills.filter((item) => item.name !== name)
        changes.push(`${operation.selected ? '配置' : '移除'}技能：${target.configuration.displayName} · ${name}`)
        break
      }
      case 'capability': {
        const target = member(operation.member)
        const id = string(operation.capability, '业务动作', 256)
        const capability = catalog.capabilities.find((item) => item.id === id)
        if (capability?.status !== 'available') throw new Error('业务动作不在当前可绑定目录中')
        if (typeof operation.selected !== 'boolean') throw new Error('业务动作须明确选择添加或移除')
        if (operation.selected && !target.configuration.businessCapabilityIds.includes(id)) target.configuration.businessCapabilityIds.push(id)
        if (!operation.selected) target.configuration.businessCapabilityIds = target.configuration.businessCapabilityIds.filter((value) => value !== id)
        target.configuration.businessCapabilityBindings = target.configuration.businessCapabilityBindings.filter((binding) => binding.capabilityId !== id)
        if (operation.selected && operation.fileSource === 'single') {
          const parameters = singleFileMapping(capability.params ?? [])
          if (!parameters) throw new Error('该业务动作没有可一次绑定的文件标识、名称与摘要')
          target.configuration.businessCapabilityBindings.push({ capabilityId: id, parameters })
        } else if (operation.fileSource && operation.fileSource !== 'member') throw new Error('文件来源选择无效')
        changes.push(`${operation.selected ? '添加' : '移除'}业务动作：${target.configuration.displayName} · ${capability.name}`)
        break
      }
      case 'flow_add': {
        if (document.workflows.length) throw new Error('当前团队已有流程，请修改现有流程')
        const actor = member(operation.member)
        if (actor.configuration.role !== 'worker' || !actor.relationship.enabled) throw new Error('新流程须选择已启用的执行成员')
        const name = string(operation.name, '流程名称', 80)
        const description = string(operation.description, '流程说明')
        document.workflows.push({ id: crypto.randomUUID(), name, description, trigger_config: { schema_version: 1, type: 'conversation_explicit', config: {} }, graph_definition: initialGraph(actor) })
        changes.push(`新增流程：${name}`)
        break
      }
      case 'flow': {
        const target = flow(operation.flow)
        const name = optional(operation.name, '流程名称', 80)
        const description = optional(operation.description, '流程说明')
        if (!name && !description) throw new Error('流程修改缺少目标字段')
        if (name) target.name = name
        if (description) target.description = description
        changes.push(`修改流程：${target.name}`)
        break
      }
      case 'step_add': {
        const target = flow(operation.flow)
        const actor = member(operation.member)
        if (!actor.relationship.enabled || operation.placement === 'parallel' && actor.configuration.role !== 'worker') throw new Error('并行分支须选择已启用的执行成员；串行步骤可由团队负责人或执行成员负责')
        const after = string(operation.after, '前置步骤', 128)
        const name = string(operation.name, '步骤名称', 80)
        const requirement = string(operation.requirement, '步骤任务')
        const previousDeliverySourceId = String((target.graph_definition.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: unknown } | undefined)?.node_id ?? '')
        const next = operation.placement === 'parallel'
          ? addParallelBranch(target.graph_definition, after, actor)
          : operation.placement === undefined || operation.placement === 'serial'
            ? insertStep(target.graph_definition, after, actor)
            : undefined
        if (!next) throw new Error('步骤排列方式无效')
        const graph = { ...next.graph, nodes: next.graph.nodes.map((node) => node.id !== next.selected ? node : node.type === 'lead' ? { ...node, label: name, config: { ...node.config, instruction: requirement } } : { ...node, label: name, config: { ...node.config, result_requirement: requirement } }) }
        target.graph_definition = configureWorkflowResultProtocol(
          { ...target, graph_definition: graph }, target.graph_definition.result_protocol === WORKBENCH_RESULT_PROTOCOL,
          undefined, previousDeliverySourceId,
        ).graph_definition
        changes.push(`新增${operation.placement === 'parallel' ? '并行' : '串行'}步骤：${name}`)
        break
      }
      case 'step': {
        const target = flow(operation.flow)
        const stepId = string(operation.step, '步骤引用', 128)
        const current = target.graph_definition.nodes.find((node) => node.id === stepId)
        if (!current) throw new Error('Pi 引用了当前流程中不存在的步骤')
        const name = optional(operation.name, '步骤名称', 80)
        const requirement = optional(operation.requirement, '步骤任务')
        const actor = operation.member === undefined ? undefined : member(operation.member)
        const parallelBranchWorker = isParallelBranchWorker(target.graph_definition, stepId)
        if (actor && (!['lead', 'worker'].includes(current.type) || !actor.relationship.enabled || parallelBranchWorker && actor.configuration.role !== 'worker')) throw new Error('该步骤不能分配给所选成员')
        if (!name && !requirement && !actor) throw new Error('步骤修改需要 name、requirement 或 member；修改处理指令请填写 requirement')
        target.graph_definition = { ...target.graph_definition, nodes: target.graph_definition.nodes.map((node) => node.id === stepId ? {
          ...node, ...(name ? { label: name } : {}), ...(actor ? { type: actor.configuration.role === 'avatar' ? 'lead' : 'worker' } : {}), config: actor?.configuration.role === 'avatar' ? {
            instruction: requirement ?? String(current.config?.instruction ?? current.config?.result_requirement ?? actor.configuration.systemPrompt),
          } : actor ? {
            kind: parallelBranchWorker ? 'dispatch' : 'consult', agent_id: actor.id, agent_version: 1,
            result_requirement: requirement ?? String(current.config?.result_requirement ?? current.config?.instruction ?? actor.relationship.resultRequirement),
          } : { ...node.config,
            ...(requirement ? { [node.type === 'lead' ? 'instruction' : 'result_requirement']: requirement } : {}),
          },
        } : node) }
        changes.push(`修改步骤：${name ?? current.label ?? '执行步骤'}`)
        break
      }
      case 'step_remove': {
        const target = flow(operation.flow)
        const stepId = string(operation.step, '步骤引用', 128)
        const previousDeliverySourceId = String((target.graph_definition.nodes.find((node) => node.type === 'deliver')?.config?.result as { node_id?: unknown } | undefined)?.node_id ?? '')
        const graph = removeStep(target.graph_definition, stepId)
        target.graph_definition = configureWorkflowResultProtocol(
          { ...target, graph_definition: graph }, target.graph_definition.result_protocol === WORKBENCH_RESULT_PROTOCOL,
          undefined, previousDeliverySourceId,
        ).graph_definition
        changes.push('移除流程步骤')
        break
      }
      case 'step_input': {
        const target = flow(operation.flow)
        const stepId = string(operation.step, '步骤引用', 128)
        const node = target.graph_definition.nodes.find((item) => item.id === stepId)
        if (!node || !['lead', 'worker'].includes(node.type)) throw new Error('该步骤不支持输入选择')
        if (typeof operation.selected !== 'boolean') throw new Error('输入来源须明确选择添加或移除')
        if (operation.source !== 'run_input' && operation.source !== 'node_output') throw new Error('输入来源无效')
        const from = operation.source === 'node_output' ? string(operation.from, '前序步骤', 128) : undefined
        const current = bindings(node)
        const next = Object.fromEntries(Object.entries(current).filter(([, binding]) => operation.source === 'run_input' ? binding.value.source !== 'run_input' : binding.value.node_id !== from))
        if (operation.selected && operation.source === 'run_input') next.original = originalBinding()
        else if (operation.selected && operation.source === 'node_output') {
          const prior = predecessors(target.graph_definition, stepId).find((item) => item.id === from)
          if (!prior) throw new Error('输入来源必须是当前步骤的前序结果')
          next[`result_${from!.replace(/[^a-zA-Z0-9_]/g, '_')}`] = { value: { source: 'node_output', node_id: from, path: '' }, expected_type: prior.type === 'join' ? 'json' : 'text' }
        }
        target.graph_definition = { ...target.graph_definition, nodes: target.graph_definition.nodes.map((item) => item.id === stepId ? { ...item, inputs: next } : item) }
        changes.push(`调整步骤输入：${node.label ?? '执行步骤'}`)
        break
      }
      case 'delivery': {
        const target = flow(operation.flow)
        const from = string(operation.from, '交付来源', 128)
        target.graph_definition = configureWorkflowResultProtocol(target, target.graph_definition.result_protocol === WORKBENCH_RESULT_PROTOCOL, from).graph_definition
        changes.push('调整流程交付来源')
        break
      }
      case 'result_protocol': {
        const target = flow(operation.flow)
        if (typeof operation.enabled !== 'boolean') throw new Error('结果分类须明确选择普通结果或可要求补充材料。')
        const from = operation.from === undefined ? undefined : string(operation.from, '交付来源', 128)
        target.graph_definition = configureWorkflowResultProtocol(target, operation.enabled, from).graph_definition
        changes.push(`${operation.enabled ? '启用' : '关闭'}团队结果分类：${target.name}`)
        break
      }
      case 'join': {
        const target = flow(operation.flow)
        const stepId = string(operation.step, '汇合步骤', 128)
        const node = target.graph_definition.nodes.find((item) => item.id === stepId)
        if (node?.type !== 'join') throw new Error('所选步骤不是并行汇合点')
        const policy = operation.policy
        if (!['all_success', 'fail_fast', 'quorum', 'deadline'].includes(String(policy))) throw new Error('汇合条件无效')
        const branches = target.graph_definition.edges.filter((edge) => edge.to_node_id === stepId).length
        const count = policy === 'quorum' ? Number(operation.successCount) : undefined
        const seconds = policy === 'deadline' ? Number(operation.deadlineSeconds) : undefined
        if (policy === 'quorum' && (!Number.isSafeInteger(count) || count! < 1 || count! > branches)) throw new Error('所需成功分支数无效')
        if (policy === 'deadline' && (!Number.isSafeInteger(seconds) || seconds! < 1 || seconds! > 86400)) throw new Error('最长等待秒数无效')
        target.graph_definition = { ...target.graph_definition, nodes: target.graph_definition.nodes.map((item) => item.id === stepId ? { ...item, config: { policy, ...(count ? { success_count: count } : {}), ...(seconds ? { deadline_seconds: seconds } : {}) } } : item) }
        changes.push('调整并行汇合条件')
        break
      }
      default: throw new Error('Pi 提出了当前编辑器不支持的团队修改')
    }
  }
  for (const workflow of document.workflows) {
    const issue = validateWorkflowResultProtocol(workflow)
    if (issue) throw new Error(`流程“${workflow.name || '未命名流程'}”：${issue}`)
  }
  return { document, changes }
}
