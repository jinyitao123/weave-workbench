import { randomUUID } from 'node:crypto'
import type { EmployeeBusinessContext, EmployeeBusinessOperation, EmployeeBusinessParameter, EmployeeBusinessRequest, EmployeeBusinessSelection } from '../../../src/types/employee-business'
import type { EnterpriseService } from '../enterprise'
import type { WorkspaceMaterialPromptReference } from '../../../src/types/api'
import { type HandoffStore, digest } from './handoff-store'
import { freezeMaterials, type FrozenMaterial } from './materials'
import { canonicalBusinessJSON, employeeBusinessRequestDigest, validateEmployeeBusinessValues } from './employee-business-contract'
import { rejectUnknownKeys, requireRecord } from '../validation'

export interface EmployeeBusinessTurn {
  accountKey: string; sessionPath: string; messageId: string; employeePrompt: string; cwd: string
  materials: WorkspaceMaterialPromptReference[]; readOnly: boolean
  assertCurrent(): Promise<void>
}
type Service = Pick<EnterpriseService, 'getEmployeeBusinessContext' | 'executeEmployeeBusinessAction' | 'getEmployeeBusinessOperation' | 'stageWorkMaterials'>
interface BoundDirectory { messageId: string; context: EmployeeBusinessContext }
interface Intent {
  selection: EmployeeBusinessSelection; accountKey: string; messageId: string; request: EmployeeBusinessRequest
  materials: FrozenMaterial[]; phase: 'prepared' | 'sent'; operation?: EmployeeBusinessOperation; actionLabel?: string
}
interface PendingOperation { intentKey: string }

function sessionKey(account: string, path: string) { return `employee-business-source:${account}:${digest(path)}` }
function scopeKey(account: string, source: EmployeeBusinessSelection) { return `employee-business-operation:${account}:${source.record.objectName}:${source.record.recordId}` }
function terminal(operation?: EmployeeBusinessOperation) { return operation?.status === 'succeeded' || operation?.status === 'failed' }
function publicOperation(operation?: EmployeeBusinessOperation, actionLabel?: string, previous = false) {
  const action = actionLabel ? `「${actionLabel}」` : '业务动作（旧记录未保存动作名称）'
  return operation ? {
    status: operation.status, repeated: operation.repeated, no_effect: operation.noEffect === true,
    ...(actionLabel ? { action_label: actionLabel } : {}),
    message: operation.status === 'succeeded' ? previous
      ? `Forge 已确认此前${action}成功；此回执不代表当前目录中的其他动作已办理，请核对当前业务状态。`
      : `Forge 已确认本次${action}成功，请按当前业务记录核对后续状态。`
      : operation.status === 'failed' ? 'Forge 已确认本次业务动作失败。' : '原操作结果仍待核对，没有重新执行。',
    records: operation.recordReferences?.map((record) => ({ name: record.label })),
  } : { status: 'unknown', message: '原操作结果暂无法核对，没有重新执行；请稍后从当前事项查询。' }
}
function affirmativeEnumLiteral(prompt: string, literal: string): boolean {
  if (!literal || /(如果|假如|除非|(?:^|[，。；\n])若)/.test(prompt)) return false
  return prompt.split(/[，。；,;\n]/).some((clause) => {
    const index = clause.indexOf(literal)
    if (index < 0) return false
    const surrounding = clause.slice(0, index) + clause.slice(index + literal.length)
    return !/(不|未|没|别|禁止|拒绝|取消)/.test(surrounding)
  })
}
function faithfulValues(prompt: string, values: EmployeeBusinessRequest['values'], parameters: EmployeeBusinessParameter[]) {
  for (const [name, value] of Object.entries(values)) {
    const parameter = parameters.find((item) => item.name === name)!
    const literal = String(value)
    const present = typeof value === 'number' ? new RegExp(`(^|[^\\d.\\-])${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d.])`).test(prompt) : prompt.includes(literal)
    const mapped = parameter.enumLabels?.find((entry) => entry.value === value)
    const uniqueLabel = mapped && parameter.enumLabels?.filter((entry) => entry.label === mapped.label).length === 1
    const selected = parameter.enum
      ? present && affirmativeEnumLiteral(prompt, literal) || uniqueLabel && affirmativeEnumLiteral(prompt, mapped.label)
      : present
    if (!selected) throw new Error('办理参数必须来自本轮员工明确原文；请明确提供准确日期、名称、金额和业务选项')
  }
}
/** Current employee actions share the native action entry point, with durable unknown-result fencing. */
export class EmployeeBusinessActions {
  private readonly directories = new Map<string, BoundDirectory>()
  private readonly running = new Map<string, Promise<unknown>>()
  constructor(private readonly service: Service, private readonly store: HandoffStore) {}

  async bind(account: string, sessionPath: string, selection: EmployeeBusinessSelection): Promise<void> {
    const key = sessionKey(account, sessionPath)
    await this.store.checkpoint(key, digest(key), structuredClone(selection))
    this.directories.delete(key)
  }
  async selection(account: string, sessionPath: string): Promise<EmployeeBusinessSelection | undefined> {
    return (await this.store.inspect<EmployeeBusinessSelection>(sessionKey(account, sessionPath)))?.value
  }
  private async lookup(intentKey: string, turn: EmployeeBusinessTurn): Promise<Intent> {
    const saved = await this.store.inspect<Intent>(intentKey)
    if (!saved || saved.value.accountKey !== turn.accountKey) throw new Error('原操作不属于当前员工，不能继续')
    const intent = saved.value
    if (intent.phase === 'sent' && !terminal(intent.operation)) {
      try {
        const result = await this.service.getEmployeeBusinessOperation(intent.request.opKey)
        await turn.assertCurrent()
        this.match(result, intent.request)
        intent.operation = result
        await this.store.checkpoint(intentKey, saved.fingerprint, intent)
      } catch { await turn.assertCurrent() }
    }
    return intent
  }
  private match(operation: EmployeeBusinessOperation, request: EmployeeBusinessRequest) {
    if (operation.operationId !== request.opKey || operation.contextId !== request.contextId || operation.requestDigest !== employeeBusinessRequestDigest(request)) {
      throw new Error('业务动作回执与原请求不匹配，结果仍待核对')
    }
  }
  async list(turn: EmployeeBusinessTurn) {
    const selection = await this.selection(turn.accountKey, turn.sessionPath)
    if (!selection) throw new Error('请先从本人业务事项、业务消息或业务记录读取中选择当前记录')
    await turn.assertCurrent()
    const pending = await this.store.inspect<PendingOperation>(scopeKey(turn.accountKey, selection))
    let previousIntent: Intent | undefined
    if (pending) {
      const prior = await this.lookup(pending.value.intentKey, turn)
      previousIntent = prior
      if (prior.phase === 'sent' && !terminal(prior.operation)) return { actions: [], operation: publicOperation(prior.operation, prior.actionLabel, true) }
    }
    const context = await this.service.getEmployeeBusinessContext(selection)
    await turn.assertCurrent()
    if (Date.parse(context.expiresAt) <= Date.now()) throw new Error('本人业务动作上下文已过期，请重新打开')
    this.directories.set(sessionKey(turn.accountKey, turn.sessionPath), { messageId: turn.messageId, context })
    return {
      status: context.actions.length ? 'available' : 'none', record: context.record.label,
      ...(previousIntent?.operation ? { previous_operation: publicOperation(previousIntent.operation, previousIntent.actionLabel, true) } : {}),
      actions: context.actions.map(({ action_ref, label, description, parameters }) => ({ action_ref, label, description, inputs: parameters })),
      message: '目录只说明当前可用动作。初始打开只读；办理须有员工本轮明确要求。文件仅取本轮实际选定的一件原件。',
    }
  }
  async run(turn: EmployeeBusinessTurn, raw: Record<string, unknown>): Promise<unknown> {
    rejectUnknownKeys(raw, ['turn_key', 'action_ref', 'values'], 'employee business action')
    if (turn.readOnly) throw new Error('打开业务事项只授权查看，请在新的员工消息中明确办理')
    if (!/(办理|登记|提交|创建|转换|转为|转成|生成.*订单|确认|同意|批准|保存|更新|执行|启动)/.test(turn.employeePrompt)
      || /(只读|仅查看|只看看|只分析|不授权|(?:不要|暂不|禁止)(?:办理|登记|提交|创建|转换|确认|保存|更新|执行|启动))/.test(turn.employeePrompt)) throw new Error('请在本轮明确要求办理当前业务动作')
    const selection = await this.selection(turn.accountKey, turn.sessionPath)
    if (!selection) throw new Error('当前没有已读取的业务记录')
    const key = scopeKey(turn.accountKey, selection)
    const prior = this.running.get(key)
    if (prior) { await prior; return this.run(turn, raw) }
    const operation = this.execute(turn, raw, selection, key)
    this.running.set(key, operation)
    try { return await operation } finally { this.running.delete(key) }
  }
  private async execute(turn: EmployeeBusinessTurn, raw: Record<string, unknown>, selection: EmployeeBusinessSelection, key: string) {
    const assertCurrent = async () => {
      await turn.assertCurrent()
      if (canonicalBusinessJSON(await this.selection(turn.accountKey, turn.sessionPath)) !== canonicalBusinessJSON(selection)) throw new Error('当前业务来源已变化，旧办理请求已停止')
    }
    await assertCurrent()
    const pending = await this.store.inspect<PendingOperation>(key)
    if (pending) {
      const prior = await this.lookup(pending.value.intentKey, turn)
      const sameMessage = prior.messageId === turn.messageId && prior.request.employeeMessage.sessionId === digest(turn.sessionPath)
      if (sameMessage && (prior.request.action_ref !== raw.action_ref || canonicalBusinessJSON(prior.request.values) !== canonicalBusinessJSON(raw.values))) throw new Error('本轮操作内容已固定，不能替换参数或动作')
      if (prior.phase === 'sent' && (!terminal(prior.operation) || sameMessage)) return publicOperation(prior.operation, prior.actionLabel, !sameMessage)
    }
    const directory = this.directories.get(sessionKey(turn.accountKey, turn.sessionPath))
    if (!directory || directory.messageId !== turn.messageId) throw new Error('请先读取本轮当前事项动作目录')
    const context = directory.context
    const action = context.actions.find((item) => item.action_ref === raw.action_ref)
    if (!action) throw new Error('动作引用不属于本轮目录')
    const values = validateEmployeeBusinessValues(action.parameters, requireRecord(raw.values, 'values'))
    faithfulValues(turn.employeePrompt, values, action.parameters)
    const current = await this.service.getEmployeeBusinessContext(selection)
    await turn.assertCurrent()
    if (current.contextVersion !== context.contextVersion || current.recordVersion !== context.recordVersion
      || canonicalBusinessJSON(current.actions) !== canonicalBusinessJSON(context.actions) || Date.parse(context.expiresAt) <= Date.now()) {
      throw new Error('当前业务记录或参数声明已变化，请重新读取后由员工提出新的办理要求')
    }
    const fileParameter = action.parameters.find((p) => p.type === 'file')
    if (fileParameter && (turn.materials.length > 1 || fileParameter.required && turn.materials.length !== 1)) throw new Error('请在本轮只选择一份明确用于本动作的原件')
    const intentKey = `employee-business-intent:${turn.accountKey}:${digest(turn.sessionPath)}:${turn.messageId}`
    const fingerprint = digest(canonicalBusinessJSON({ selection, contextVersion: context.contextVersion, action: action.action_ref, values, materials: turn.materials }))
    let intent = await this.store.freeze<Intent>(intentKey, fingerprint, async () => ({
      selection, accountKey: turn.accountKey, messageId: turn.messageId, phase: 'prepared', actionLabel: action.label,
      materials: fileParameter && turn.materials.length ? await freezeMaterials(turn.cwd, turn.materials.map(({ path, sha256 }) => ({ path, sha256 }))) : [],
      request: { version: '1', contextId: context.contextId, contextVersion: context.contextVersion, opKey: randomUUID(),
        employeeMessage: { sessionId: digest(turn.sessionPath), messageId: turn.messageId, sha256: digest(turn.employeePrompt) }, action_ref: action.action_ref, values },
    }))
    await this.store.checkpoint(key, digest(key), { intentKey })
    if (intent.phase === 'sent') return publicOperation((await this.lookup(intentKey, turn)).operation, intent.actionLabel)
    if (intent.materials.length && !intent.request.file) {
      const resources = await this.service.stageWorkMaterials(intent.materials, assertCurrent)
      await assertCurrent()
      if (resources.length !== 1 || !fileParameter) throw new Error('本轮业务原件上传回执无效')
      const resource = resources[0], material = intent.materials[0]
      if (!resource.id || resource.sha256 !== material.sha256 || resource.bytes !== material.bytes || resource.name !== material.name) throw new Error('本轮原件上传回执与冻结材料不一致')
      intent.request.file = { parameter: fileParameter.name, fileId: resource.id, name: material.name, mediaType: material.mediaType, bytes: material.bytes, sha256: material.sha256 }
      intent = await this.store.checkpoint(intentKey, fingerprint, intent)
    }
    await assertCurrent()
    intent.phase = 'sent'
    await this.store.checkpoint(intentKey, fingerprint, intent)
    try {
      const result = await this.service.executeEmployeeBusinessAction(intent.request)
      await turn.assertCurrent()
      this.match(result, intent.request)
      intent.operation = result
      await this.store.checkpoint(intentKey, fingerprint, intent)
    } catch { await turn.assertCurrent() }
    return publicOperation(intent.operation, intent.actionLabel)
  }
}
