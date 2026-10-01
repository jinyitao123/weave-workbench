import { createHash } from 'node:crypto'
import type { EnterpriseWorkContinuationContext } from '../enterprise'
import type { WorkspaceMaterialMimeType } from '../../../src/types/api'
import { MAX_WORKSPACE_MATERIAL_BYTES } from './materials'

const CONTINUATION_RUN_STATUSES = new Set(['queued', 'running', 'parked', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'abandoned'])
const CONTINUATION_SHA256 = /^[0-9a-f]{64}$/
const CONTINUATION_SOURCE_SHA256 = /^[0-9a-fA-F]{64}$/
const CONTINUATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTINUATION_MATERIAL_TYPES = new Set<WorkspaceMaterialMimeType>([
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const CONTINUATION_ORIGINAL_TYPES = new Set<WorkspaceMaterialMimeType>([
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
function boundedIdentity(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && value.trim() === value && !value.includes('\0') ? value : undefined
}

export function parseWorkContinuationContext(value: unknown): EnterpriseWorkContinuationContext {
  const envelope = record(value), source = record(envelope?.source), input = record(envelope?.input), run = record(envelope?.run)
  const inputRevisionID = boundedIdentity(source?.input_revision_id, 128)
  const runID = boundedIdentity(source?.run_id, 128)
  const workbenchSessionID = boundedIdentity(source?.workbench_session_id, 256)
  const task = typeof input?.task === 'string' ? input.task : undefined
  const taskSHA256 = typeof input?.task_sha256 === 'string' ? input.task_sha256 : undefined
  const teamID = boundedIdentity(input?.team_id, 128)
  const workflowID = boundedIdentity(input?.workflow_id, 128)
  const workflowVersion = numberValue(input?.workflow_version)
  const status = typeof run?.status === 'string' ? run.status : undefined
  const businessResult = run?.business_result as EnterpriseWorkContinuationContext['run']['businessResult']
  if (businessResult !== undefined && !['completed', 'needs_input', 'action_failed', 'action_unknown'].includes(businessResult)) {
    throw new Error('团队业务结果格式无效，请刷新工作消息')
  }
  if (envelope?.version !== '1' || !inputRevisionID || !CONTINUATION_UUID.test(inputRevisionID) || !runID || !workbenchSessionID
    || !task || !task.trim() || task.length > 1_048_576 || task.includes('\0')
    || !taskSHA256 || !CONTINUATION_SHA256.test(taskSHA256)
    || createHash('sha256').update(task, 'utf8').digest('hex') !== taskSHA256
    || !teamID || !workflowID || !Number.isInteger(workflowVersion) || workflowVersion! < 1
    || !run || !status || !CONTINUATION_RUN_STATUSES.has(status)
    || !Array.isArray(input?.materials)
    || !Array.isArray(input?.source_messages) || input.source_messages.length < 1 || input.source_messages.length > 256) {
    throw new Error('团队工作上下文不完整或摘要校验失败，请刷新工作消息')
  }
  const materials = input.materials.flatMap((entry): EnterpriseWorkContinuationContext['input']['materials'] => {
    const item = record(entry), id = boundedIdentity(item?.id, 128), name = boundedIdentity(item?.name, 255)
    const bytes = numberValue(item?.bytes), sha256 = typeof item?.sha256 === 'string' ? item.sha256 : undefined
    const mediaType = item?.mediaType === undefined ? undefined : boundedIdentity(item.mediaType, 160) as WorkspaceMaterialMimeType | undefined
    const materialId = item?.materialId === undefined ? undefined : boundedIdentity(item.materialId, 24)
    const sourceKind = item?.sourceKind === 'owner' || item?.sourceKind === 'approval' ? item.sourceKind : undefined
    const requestId = item?.requestId === undefined ? undefined : boundedIdentity(item.requestId, 128)
    const binary = mediaType !== undefined && CONTINUATION_ORIGINAL_TYPES.has(mediaType)
    const binaryNamedWithoutType = !mediaType && /\.(?:pdf|docx)$/i.test(name ?? '')
    const fieldsValid = (item?.mediaType === undefined || Boolean(mediaType && CONTINUATION_MATERIAL_TYPES.has(mediaType)))
      && (item?.materialId === undefined || Boolean(materialId && /^[0-9a-f]{24}$/.test(materialId)))
      && (item?.sourceKind === undefined || sourceKind !== undefined)
      && (item?.requestId === undefined || requestId !== undefined)
    const sourceIsValid = fieldsValid && (binary
      ? Boolean(materialId && /^[0-9a-f]{24}$/.test(materialId) && sourceKind
        && (sourceKind === 'approval' ? requestId : !requestId))
      : !binaryNamedWithoutType && sourceKind === undefined && requestId === undefined
        && (materialId === undefined || /^[0-9a-f]{24}$/.test(materialId)))
    const maxBytes = binary ? MAX_WORKSPACE_MATERIAL_BYTES : 700_000
    return item?.type === 'forge-file' && id && name && Number.isInteger(bytes) && bytes! >= 1 && bytes! <= maxBytes
      && sha256 && CONTINUATION_SHA256.test(sha256)
      && sourceIsValid
      ? [{ id, name, bytes: bytes!, sha256, ...(materialId ? { materialId } : {}), ...(mediaType ? { mediaType } : {}), ...(sourceKind ? { sourceKind } : {}), ...(requestId ? { requestId } : {}) }]
      : []
  })
  if (materials.length !== input.materials.length) throw new Error('团队固定材料清单不完整，请刷新工作消息')
  const sourceMessages = input.source_messages.flatMap((entry): EnterpriseWorkContinuationContext['input']['sourceMessages'] => {
    const message = record(entry), messageID = boundedIdentity(message?.message_id, 256)
    const eventSeq = numberValue(message?.event_seq)
    const sha256 = typeof message?.sha256 === 'string' ? message.sha256 : undefined
    return messageID && eventSeq !== undefined && Number.isInteger(eventSeq) && eventSeq >= 0 && sha256 && CONTINUATION_SOURCE_SHA256.test(sha256)
      ? [{ messageID, eventSeq, sha256 }]
      : []
  })
  if (sourceMessages.length !== input.source_messages.length) throw new Error('团队原始消息摘要不完整，请刷新工作消息')
  let businessRecord: EnterpriseWorkContinuationContext['input']['businessRecord']
  if (input.business_record !== undefined) {
    const recordValue = record(input.business_record)
    const objectName = boundedIdentity(recordValue?.object_name, 128), recordID = boundedIdentity(recordValue?.record_id, 128)
    const recordVersion = recordValue?.record_version === undefined ? undefined : boundedIdentity(recordValue.record_version, 128)
    if (!objectName || !recordID || recordValue?.record_version !== undefined && !recordVersion) throw new Error('团队工作绑定的业务记录不完整，请刷新工作消息')
    businessRecord = { objectName, recordID, ...(recordVersion ? { recordVersion } : {}) }
  }
  let parent: EnterpriseWorkContinuationContext['input']['parent']
  if (input.parent !== undefined) {
    const parentValue = record(input.parent)
    const rootInputRevisionID = boundedIdentity(parentValue?.root_input_revision_id, 128)
    const parentInputRevisionID = parentValue?.parent_input_revision_id === undefined ? undefined : boundedIdentity(parentValue.parent_input_revision_id, 128)
    const parentRunID = parentValue?.parent_run_id === undefined ? undefined : boundedIdentity(parentValue.parent_run_id, 128)
    if (!rootInputRevisionID || !CONTINUATION_UUID.test(rootInputRevisionID)
      || parentInputRevisionID !== undefined && !CONTINUATION_UUID.test(parentInputRevisionID)
      || parentRunID !== undefined && !parentRunID) throw new Error('团队原工作关联不完整，请刷新工作消息')
    parent = { rootInputRevisionID, ...(parentInputRevisionID ? { parentInputRevisionID } : {}), ...(parentRunID ? { parentRunID } : {}) }
  }
  let finalResult: EnterpriseWorkContinuationContext['run']['finalResult']
  if (run.final_result !== undefined) {
    const result = record(run.final_result), id = boundedIdentity(result?.id, 128), title = boundedIdentity(result?.title, 300)
    const contentType = boundedIdentity(result?.content_type, 160), content = typeof result?.content === 'string' ? result.content : undefined
    const sha256 = typeof result?.sha256 === 'string' ? result.sha256 : undefined
    if (!id || !title || !contentType || content === undefined || content.length > 100_000 || !sha256 || !CONTINUATION_SHA256.test(sha256)
      || createHash('sha256').update(content, 'utf8').digest('hex') !== sha256) throw new Error('团队最终交付摘要校验失败，请刷新工作消息')
    const hasDisposition = result?.disposition !== undefined
    const hasSummary = result?.summary !== undefined
    const hasMissingItems = result?.missing_items !== undefined
    let disposition: 'complete' | 'needs_input' | undefined
    let summary: string | undefined
    let missingItems: string[] | undefined
    if (hasDisposition || hasSummary || hasMissingItems) {
      if ((result?.disposition !== 'complete' && result?.disposition !== 'needs_input')
        || typeof result?.summary !== 'string' || !result.summary.trim() || Array.from(result.summary).length > 1000
        || !Array.isArray(result?.missing_items) || result.missing_items.length > 8
        || result.missing_items.some((item) => typeof item !== 'string' || !item.trim() || Array.from(item).length > 200)
        || result.disposition === 'needs_input' && result.missing_items.length < 1
        || result.disposition === 'complete' && result.missing_items.length !== 0) {
        throw new Error('团队结果分类格式无效，请刷新工作消息')
      }
      disposition = result.disposition
      summary = result.summary.trim()
      missingItems = (result.missing_items as string[]).map((item) => item.trim())
    }
    finalResult = { id, title, contentType, content, sha256, ...(disposition ? { disposition, summary, missingItems } : {}) }
  }
  let actionOutcomes: NonNullable<EnterpriseWorkContinuationContext['run']['actionOutcomes']> | undefined
  if (run.action_outcomes !== undefined) {
    if (!Array.isArray(run.action_outcomes) || run.action_outcomes.length > 100) throw new Error('团队业务动作事实格式无效，请刷新工作消息')
    actionOutcomes = run.action_outcomes.flatMap((entry): NonNullable<EnterpriseWorkContinuationContext['run']['actionOutcomes']> => {
      const outcome = record(entry)
      const nodeID = boundedIdentity(outcome?.node_id, 128), callID = boundedIdentity(outcome?.call_id, 256)
      const actionName = boundedIdentity(outcome?.action_name, 128), objectName = boundedIdentity(outcome?.object_name, 128)
      const recordID = outcome?.record_id === undefined ? undefined : boundedIdentity(outcome.record_id, 128)
      const outcomeStatus = textValue(outcome?.status), summary = boundedIdentity(outcome?.summary, 500)
      if (!nodeID || !callID || !actionName || !objectName || !summary
        || outcome?.record_id !== undefined && !recordID
        || outcomeStatus !== 'succeeded' && outcomeStatus !== 'failed' && outcomeStatus !== 'unknown') return []
      return [{ nodeID, callID, actionName, objectName, ...(recordID ? { recordID } : {}), status: outcomeStatus, summary }]
    })
    if (actionOutcomes.length !== run.action_outcomes.length) throw new Error('团队业务动作事实不完整，请刷新工作消息')
  }
  return {
    version: '1',
    source: { inputRevisionID, runID, workbenchSessionID },
    input: { task, taskSHA256, teamID, workflowID, workflowVersion: workflowVersion!, materials, sourceMessages, ...(businessRecord ? { businessRecord } : {}), ...(parent ? { parent } : {}) },
    run: { status: status as EnterpriseWorkContinuationContext['run']['status'], ...(businessResult ? { businessResult } : {}), ...(finalResult ? { finalResult } : {}), ...(actionOutcomes !== undefined ? { actionOutcomes } : {}) },
  }
}

