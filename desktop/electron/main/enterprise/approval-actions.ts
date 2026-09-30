import type { EnterpriseApprovalAction, EnterpriseApprovalContext } from '../../../src/types/api'

const RESERVED_ACTION_INPUTS = new Set(['actionName', 'approvalRequestId', 'itemVersion', 'sourceMaterialVersion', 'actorId', 'objectName', 'recordId'])

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum && !value.includes('\0')
    ? value : undefined
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

export function parseCurrentApprovalActions(
  value: unknown, context: Pick<EnterpriseApprovalContext, 'requestId' | 'businessObject' | 'sourceMaterialVersion'>,
): EnterpriseApprovalAction[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('Forge 当前事项动作目录格式无效')
  const seen = new Set<string>()
  return value.map((entry) => {
    const source = record(entry), execution = record(source?.execution), params = record(execution?.params)
    const semantic = source?.semantic === undefined ? undefined : text(source.semantic, 64)
    const label = text(source?.label, 160), description = text(source?.description, 1000)
    const tool = execution?.tool
    const actionName = text(execution?.actionName, 128), objectName = text(execution?.objectName, 160)
    const recordId = text(execution?.recordId, 128)
    const approvalRequestId = text(params?.approvalRequestId, 128)
    const nativeItemVersion = text(params?.itemVersion, 128)
    const sourceMaterialVersion = text(params?.sourceMaterialVersion, 64)
    const rawInputs = source?.inputs
    if (!source || !execution || !params || !label || !description
      || source.semantic !== undefined && !semantic
      || !onlyKeys(source, ['semantic', 'label', 'description', 'execution', 'inputs'])
      || !onlyKeys(execution, ['tool', 'actionName', 'objectName', 'recordId', 'params'])
      || !onlyKeys(params, ['approvalRequestId', 'itemVersion', 'sourceMaterialVersion'])
      || tool !== 'run_action' || !actionName || !objectName || !recordId
      || !approvalRequestId || approvalRequestId !== context.requestId
      || nativeItemVersion === undefined || !sourceMaterialVersion || sourceMaterialVersion !== context.sourceMaterialVersion
      || objectName !== context.businessObject.objectName || recordId !== context.businessObject.recordId
      || !Array.isArray(rawInputs) || rawInputs.length !== 1) {
      throw new Error('Forge 当前事项动作与本人打开的事项不匹配，请刷新待办')
    }
    const input = record(rawInputs[0])
    const inputName = text(input?.name, 128), inputLabel = text(input?.label, 160)
    if (!input || !onlyKeys(input, ['name', 'type', 'label', 'required'])
      || !inputName || RESERVED_ACTION_INPUTS.has(inputName) || input.type !== 'string' || !inputLabel || input.required !== true) {
      throw new Error('Forge 当前事项动作输入声明暂不支持')
    }
    const identity = `${actionName}\0${objectName}\0${recordId}\0${approvalRequestId}\0${nativeItemVersion}\0${sourceMaterialVersion}`
    if (seen.has(identity)) throw new Error('Forge 当前事项动作目录包含重复项')
    seen.add(identity)
    return {
      ...(semantic ? { semantic } : {}), label, description,
      execution: {
        tool: 'run_action', actionName, objectName, recordId,
        params: { approvalRequestId, itemVersion: nativeItemVersion, sourceMaterialVersion },
      },
      inputs: [{ name: inputName, type: 'string', label: inputLabel, required: true }],
    }
  })
}

export interface CurrentItemActionReceipt {
  decision: string
  status: string
  requestId: string
  recordId: string
  itemVersion: string
  sourceMaterialVersion: string
  resumed: boolean
  autoRejected: boolean
  alreadyApplied: boolean
}

export interface CurrentItemActionObservation {
  status: 'history_observed'
  decision: 'unknown'
  observedStatus: string
  requestId: string
  recordId: string
  itemVersion: string
  sourceMaterialVersion: string
  history: Array<{ action: string; actorId: string; comment: string; createdAt?: string }>
}

export function parseCurrentItemActionObservation(value: unknown, action: EnterpriseApprovalAction): CurrentItemActionObservation | undefined {
  const envelope = record(value), result = record(envelope?.data) ?? envelope
  const decision = text(result?.decision, 128), status = text(result?.status, 128), observedStatus = text(result?.observedStatus, 128)
  const requestId = text(result?.requestId, 128), recordId = text(result?.recordId, 128)
  const nativeItemVersion = text(result?.itemVersion, 128), sourceMaterialVersion = text(result?.sourceMaterialVersion, 64)
  if (!result || status !== 'history_observed' || decision !== 'unknown' || !observedStatus
    || requestId !== action.execution.params.approvalRequestId || recordId !== action.execution.recordId
    || nativeItemVersion !== action.execution.params.itemVersion
    || sourceMaterialVersion !== action.execution.params.sourceMaterialVersion || !Array.isArray(result.history)) return undefined
  const history = result.history.map((entry) => {
    const row = record(entry), actionName = text(row?.action, 128), actorId = text(row?.actorId, 128)
    const comment = typeof row?.comment === 'string' ? row.comment : undefined
    const createdAt = row?.createdAt === undefined ? undefined : text(row.createdAt, 128)
    if (!row || !onlyKeys(row, ['action', 'actorId', 'comment', 'createdAt']) || !actionName || !actorId
      || comment === undefined || row.createdAt !== undefined && !createdAt) return undefined
    return { action: actionName, actorId, comment, ...(createdAt ? { createdAt } : {}) }
  })
  if (history.some((row) => row === undefined)) return undefined
  return {
    status: 'history_observed', decision: 'unknown', observedStatus, requestId, recordId,
    itemVersion: nativeItemVersion!, sourceMaterialVersion, history: history as CurrentItemActionObservation['history'],
  }
}

export function parseCurrentItemActionReceipt(value: unknown, action: EnterpriseApprovalAction): CurrentItemActionReceipt | undefined {
  const envelope = record(value), result = record(envelope?.data) ?? envelope
  const decision = text(result?.decision, 128), status = text(result?.status, 128)
  const requestId = text(result?.requestId, 128), recordId = text(result?.recordId, 128)
  const nativeItemVersion = text(result?.itemVersion, 128), sourceMaterialVersion = text(result?.sourceMaterialVersion, 64)
  if (!result || !decision || decision !== 'approve' && decision !== 'revise' && decision !== 'reject'
    || status === 'history_observed' || !status || requestId !== action.execution.params.approvalRequestId
    || recordId !== action.execution.recordId || nativeItemVersion !== action.execution.params.itemVersion
    || sourceMaterialVersion !== action.execution.params.sourceMaterialVersion
    || typeof result.resumed !== 'boolean' || typeof result.autoRejected !== 'boolean' || typeof result.alreadyApplied !== 'boolean') {
    return undefined
  }
  return {
    decision, status, requestId, recordId, itemVersion: nativeItemVersion!, sourceMaterialVersion,
    resumed: result.resumed, autoRejected: result.autoRejected, alreadyApplied: result.alreadyApplied,
  }
}
