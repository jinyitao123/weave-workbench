import { createHash } from 'node:crypto'
import type { EnterpriseHumanTask, EnterpriseWorkItem, EnterpriseWorkResource } from '../../../src/types/api'

// Parsers for the server projections behind "我的工作" and the Forge task
// delegation (weave-workbench decision 002). They validate shape only; the
// servers own the meaning (current input, business result, approval work).

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export interface WorkbenchRunLookup {
  runId: string
  status: string
  isCurrent: boolean
  businessResult?: 'completed' | 'needs_input' | 'action_failed' | 'action_unknown'
}

export interface ApprovalWorkItem {
  requestId: string
  mode: 'approval' | 'revision'
  title: string
  updatedAt: string
  returnReason?: string
  materialLabel?: string
}

export function parseApprovalWorkPage(value: unknown): { items: ApprovalWorkItem[]; nextCursor?: string } {
  const body = record(value)
  if (body?.version !== '1' || !Array.isArray(body.items)) throw new Error('Forge 返回了无法识别的审批事项')
  const items = body.items.map((entry): ApprovalWorkItem => {
    const item = record(entry)
    const requestId = text(item?.requestId), mode = item?.mode, title = text(item?.title), updatedAt = text(item?.updatedAt)
    if (!requestId || (mode !== 'approval' && mode !== 'revision') || !title || !updatedAt) throw new Error('Forge 返回了无法识别的审批事项')
    return { requestId, mode, title, updatedAt,
      ...(text(item?.returnReason) ? { returnReason: text(item?.returnReason) } : {}),
      ...(text(item?.materialLabel) ? { materialLabel: text(item?.materialLabel) } : {}) }
  })
  return { items, ...(text(body.nextCursor) ? { nextCursor: text(body.nextCursor) } : {}) }
}

export function parseRunLookup(value: unknown): WorkbenchRunLookup[] {
  const body = record(value)
  if (body?.version !== '1' || !Array.isArray(body.runs)) throw new Error('Weave 返回了无法识别的团队运行状态')
  return body.runs.map((entry): WorkbenchRunLookup => {
    const run = record(entry)
    const runId = text(run?.runId), status = text(run?.status), businessResult = text(run?.businessResult)
    if (!runId || !status || typeof run?.isCurrent !== 'boolean' || !record(run.actionCounts)) throw new Error('Weave 返回了无法识别的团队运行状态')
    return { runId, status, isCurrent: run.isCurrent,
      ...(businessResult === 'completed' || businessResult === 'needs_input' || businessResult === 'action_failed' || businessResult === 'action_unknown' ? { businessResult } : {}) }
  })
}

/** A Weave human step named by an inbox message, or undefined when the run now waits on another interaction. */
export function parseWeaveHumanTask(value: unknown, runId: string, interactionId: string): EnterpriseHumanTask | undefined {
  const task = record(value)
  if (text(task?.interaction_id) !== interactionId || text(task?.run_id) !== runId) return undefined
  const teamId = text(task?.team_id), workflowId = text(task?.workflow_id)
  const workflowVersion = typeof task?.workflow_version === 'number' && Number.isInteger(task.workflow_version) ? task.workflow_version : undefined
  const title = text(task?.title), instructions = text(task?.instructions), updatedAt = text(task?.updated_at)
  if (!teamId || !workflowId || !workflowVersion || !title || !instructions || !updatedAt) return undefined
  return { interactionId, runId, teamId, workflowId, workflowVersion, title, instructions, updatedAt, source: 'weave', mode: 'human_step',
    ...(text(task?.audience_ref) ? { audience: text(task?.audience_ref) } : {}) }
}

export type TaskDelegationScope =
  | { kind: 'none' }
  | { kind: 'invalid-action' }
  | { kind: 'too-many-files' }
  | { kind: 'scoped'; body: Record<string, unknown> }

/** The Forge task-delegation request for one frozen Weave registration. */
export function taskDelegationRequest(
  workId: string, registrationBody: unknown,
  source: { resources: EnterpriseWorkResource[]; businessContext?: { objectName: string; recordId: string }; authorizedBusinessCapabilityIds: string[] } | undefined,
): TaskDelegationScope {
  const actions: Array<{ objectName: string; actionName: string }> = []
  for (const id of source?.authorizedBusinessCapabilityIds ?? []) {
    const match = /^forge:action:([a-z][a-z0-9_]{1,127})\.(.{1,128})$/.exec(id)
    if (!match) return { kind: 'invalid-action' }
    actions.push({ objectName: match[1]!, actionName: match[2]! })
  }
  const files = (source?.resources ?? []).map((resource) => ({
    fileId: resource.id, sha256: resource.sha256, sourceKind: resource.sourceKind ?? 'owner',
    ...(resource.sourceKind === 'approval' && resource.requestId ? { requestId: resource.requestId } : {}),
  }))
  const scopedRecord = source?.businessContext ? { objectName: source.businessContext.objectName, recordId: source.businessContext.recordId } : undefined
  if (!actions.length && !files.length && !scopedRecord) return { kind: 'none' }
  if (files.length > 10) return { kind: 'too-many-files' }
  return { kind: 'scoped', body: {
    version: '1', idempotencyKey: workId,
    inputDigest: createHash('sha256').update(JSON.stringify(registrationBody)).digest('hex'),
    actions, ...(scopedRecord ? { record: scopedRecord } : {}), files,
  } }
}

/** Headers that carry the task credential to Weave; the credential is never stored or logged. */
export function taskDelegationHeaders(value: unknown): Record<string, string> | undefined {
  const result = record(value)
  const credential = text(result?.credential), delegationId = text(result?.delegationId), expiresAt = text(result?.expiresAt)
  if (result?.version !== '1' || !credential || !delegationId || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) return undefined
  return {
    'X-Weave-Forge-Authorization': `Bearer ${credential}`,
    'X-Weave-Forge-Delegation-Id': delegationId,
    'X-Weave-Forge-Delegation-Expires': expiresAt,
  }
}

/**
 * Native inbox rows as work items. Kinds come only from the exact native topic
 * or an explicit data kind; words inside a type are never read as a failure or
 * a task, and inline message data never becomes a continuation reference.
 */
export function inboxWorkItems(rawNotifications: unknown[]): EnterpriseWorkItem[] {
  return rawNotifications.flatMap((value): EnterpriseWorkItem[] => {
    const notification = record(value), data = record(notification?.data), continuation = record(data?.continuation), material = record(data?.material)
    const id = text(notification?.id), title = text(notification?.title), createdAt = text(notification?.createdAt) ?? text(notification?.created_at)
    if (!id || !title || !createdAt) return []
    const notificationType = text(notification?.type) ?? ''
    const weaveKind = /^weave\.team_run\.(result|failure|revision_required|cancelled|human_review)$/.exec(notificationType)?.[1] as EnterpriseWorkItem['kind'] | undefined
    const requestedKind = text(data?.kind)
    const kind: EnterpriseWorkItem['kind'] = weaveKind
      ?? (requestedKind === 'revision_required' || requestedKind === 'human_review' || requestedKind === 'failure' || requestedKind === 'result' || requestedKind === 'cancelled' ? requestedKind : 'result')
    const actionable = kind === 'revision_required' || kind === 'human_review'
    const displayTitle = /[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(title)
      ? kind === 'failure' ? '团队处理失败' : kind === 'revision_required' ? '团队工作需要修改' : kind === 'human_review' ? '团队工作等待处理' : '团队工作已完成'
      : title
    const statusValue = text(data?.status)
    const status: EnterpriseWorkItem['status'] = statusValue === 'pending' || statusValue === 'in_progress' || statusValue === 'completed' || statusValue === 'cancelled'
      ? statusValue : actionable ? 'pending' : 'unknown'
    const returnTarget = text(continuation?.returnTarget)
    const reviewScope = text(continuation?.reviewScope)
    return [{
      id, kind, title: displayTitle, status, actionable, read: notification?.read === true,
      source: weaveKind || text(data?.source) === 'weave' || text(record(data?.source)?.system) === 'weave' ? 'weave' : 'forge',
      notificationType, createdAt,
      ...(text(notification?.body) ? { summary: text(notification?.body) } : {}),
      ...(text(data?.instructions) ? { instructions: text(data?.instructions) } : {}),
      ...(text(notification?.actionUrl) ?? text(notification?.action_url) ? { actionUrl: text(notification?.actionUrl) ?? text(notification?.action_url) } : {}),
      ...(text(material?.label) ? { materialLabel: text(material?.label) } : {}),
      ...(text(continuation?.reason) ? { returnReason: text(continuation?.reason) } : {}),
      ...(returnTarget === 'origin_review' || returnTarget === 'team' || returnTarget === 'member' || returnTarget === 'human_step' ? { returnTarget } : {}),
      ...(reviewScope === 'whole_team' || reviewScope === 'affected_members' || reviewScope === 'human_step' ? { reviewScope } : {}),
    }]
  }).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
}
