import type { EnterpriseService, EnterpriseWorkContinuationContext, EnterpriseWorkNotificationSource } from '../enterprise'
import type { EnterpriseHumanTask, EnterpriseWorkChoice, EnterpriseWorkItem, EnterpriseWorkOverview, EnterpriseWorkReadStatus, EnterpriseRunObservation } from '../../../src/types/api'

interface WorkOverviewAccess {
  getTeamCatalog: EnterpriseService['getTeamCatalog']
  getTeamChoices: EnterpriseService['getTeamChoices']
  weaveJSON(path: string): Promise<unknown>
  forgeJSON(path: string, label: string): Promise<unknown>
  readWorkNotificationSource(id: string): Promise<EnterpriseWorkNotificationSource>
  readWorkContinuationMetadata(references: { workReference: string; runReference: string; sessionReference: string }): Promise<EnterpriseWorkContinuationContext>
  assertCurrent(): void
}
/** Read and project the current employee's original sources; this creates no work-item store. */
export async function readEmployeeWorkOverview(projectID: string, access: WorkOverviewAccess): Promise<EnterpriseWorkOverview> {
    const read = async <T>(operation: () => Promise<T>): Promise<{ value?: T; error?: string }> => {
      try { return { value: await operation() } }
      catch (error) { return { error: error instanceof Error ? error.message : '读取失败' } }
    }
    const [teamsRead, runsRead, weaveTasksRead, notificationsRead, approvalsRead] = await Promise.all([
      read(() => access.getTeamCatalog()),
      read(() => access.weaveJSON(`/v1/runs?project_id=${encodeURIComponent(projectID)}&limit=50`)),
      read(() => access.weaveJSON('/v1/human-tasks?limit=50')),
      read(async () => {
        const { readInboxPages } = await import('./inbox-pages')
        return readInboxPages((path) => access.forgeJSON(path, '通知'))
      }),
      read(async () => {
        const { readApprovalPages } = await import('./inbox-pages')
        return readApprovalPages((path) => access.forgeJSON(path, '审批事项'))
      }),
    ])
    const choices: EnterpriseWorkChoice[] = []
    let teamChoicesError = teamsRead.error
    if (teamsRead.value) {
      const workflowReads = await Promise.all(teamsRead.value.map((team) => read(() => access.getTeamChoices(team))))
      for (const result of workflowReads) {
        if (result.value) choices.push(...result.value)
        else if (result.error) teamChoicesError ??= result.error
      }
    }
    const taskList = record(weaveTasksRead.value)
    const tasks = (Array.isArray(taskList?.tasks) ? taskList.tasks : []).flatMap((value): EnterpriseHumanTask[] => {
      const task = record(value)
      const interactionId = textValue(task?.interaction_id), runId = textValue(task?.run_id), teamId = textValue(task?.team_id)
      const workflowId = textValue(task?.workflow_id), title = textValue(task?.title), instructions = textValue(task?.instructions), updatedAt = textValue(task?.updated_at)
      const workflowVersion = numberValue(task?.workflow_version)
      if (!interactionId || !runId || !teamId || !workflowId || !workflowVersion || !title || !instructions || !updatedAt) return []
      return [{ interactionId, runId, teamId, workflowId, workflowVersion, title, instructions, updatedAt, ...(textValue(task?.audience_ref) ? { audience: textValue(task?.audience_ref) } : {}) }]
    })
    const rawApprovals = approvalsRead.value
    const approvalEnvelope = record(rawApprovals)
    const approvalValues = Array.isArray(rawApprovals) ? rawApprovals
      : Array.isArray(approvalEnvelope?.requests) ? approvalEnvelope.requests
        : Array.isArray(approvalEnvelope?.data) ? approvalEnvelope.data : []
    const approvalDetailsErrors: string[] = []
    for (const value of approvalValues) {
      const approval = record(value), viewer = record(approval?.viewer), payload = record(approval?.payload)
      const id = textValue(approval?.id), status = textValue(approval?.status), updatedAt = textValue(approval?.updated_at) ?? textValue(approval?.created_at)
      const canDecide = status === 'pending' && viewer?.can_act === true
      const canResubmit = status === 'returned' && viewer?.is_submitter === true
      if (!id || !updatedAt || (!canDecide && !canResubmit)) continue
      let returnReason: string | undefined
      if (canResubmit) {
        try {
          const actionEnvelope = record(await access.forgeJSON(`/api/v1/approvals/requests/${encodeURIComponent(id)}/actions`, '审批意见'))
          const actions = Array.isArray(actionEnvelope?.data) ? actionEnvelope.data : []
          if (approvalReturnSupersededByResubmit(actions)) continue
          const latestRevision = [...actions].reverse().map(record).find((action) => action?.action === 'revise')
          returnReason = textValue(latestRevision?.comment)
        } catch (error) {
          approvalDetailsErrors.push(error instanceof Error ? error.message : '审批意见读取失败')
        }
      }
      const processName = textValue(approval?.process_label) ?? textValue(approval?.process_name) ?? '业务审批'
      const stepName = textValue(approval?.step_label) ?? textValue(approval?.current_step)
      const recordTitle = textValue(approval?.record_title)
      tasks.push({
        interactionId: id, runId: `forge:${canResubmit ? 'revision' : 'approval'}:${id}`,
        teamId: 'forge', workflowId: 'business-approval', workflowVersion: 1,
        title: canResubmit ? `${recordTitle ?? processName}需要修改` : (recordTitle ? `${recordTitle} · ${stepName ?? processName}` : stepName ?? processName),
        instructions: canResubmit ? returnReason ? `退回原因：${returnReason}` : '请根据审批意见协助员工修改业务材料。' : '请核对业务材料并给出审批意见。',
        updatedAt, source: 'forge', mode: canResubmit ? 'revision' : 'approval',
        ...(textValue(payload?.submitted_material_name) ?? textValue(approval?.object_label) ? { materialLabel: textValue(payload?.submitted_material_name) ?? textValue(approval?.object_label) } : {}),
      })
    }
    const notificationEnvelope = record(notificationsRead.value)
    const notificationList = record(notificationEnvelope?.data) ?? notificationEnvelope
    const items = (Array.isArray(notificationList?.notifications) ? notificationList.notifications : []).flatMap((value): EnterpriseWorkItem[] => {
      const notification = record(value), data = record(notification?.data), continuation = record(data?.continuation), material = record(data?.material)
      const eventSource = record(data?.weaveEvent) ?? record(record(notification?.payload)?.weaveEvent)
      const source = record(data?.source) ?? eventSource ?? record(notification?.source)
      const id = textValue(notification?.id), title = textValue(notification?.title), createdAt = textValue(notification?.createdAt) ?? textValue(notification?.created_at)
      if (!id || !title || !createdAt) return []
      const requestedKind = textValue(data?.kind)
      const notificationType = textValue(notification?.type) ?? ''
      const nativeTeamRunKind = /^weave\.team_run\.(result|failure|revision_required|cancelled)$/.exec(notificationType)?.[1]
      const kind: EnterpriseWorkItem['kind'] = requestedKind === 'revision_required' || requestedKind === 'human_review' || requestedKind === 'failure' || requestedKind === 'result' || requestedKind === 'cancelled'
        ? requestedKind : nativeTeamRunKind === 'revision_required' ? 'revision_required'
          : nativeTeamRunKind === 'failure' ? 'failure'
            : nativeTeamRunKind === 'cancelled' ? 'cancelled'
              : notificationType.includes('revision_required') ? 'revision_required' : notificationType.includes('failure') || notificationType.includes('error') ? 'failure' : 'result'
      const actionable = kind === 'revision_required' || kind === 'human_review'
      const displayTitle = /[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(title)
        ? kind === 'failure' ? '团队处理失败' : kind === 'revision_required' ? '团队工作需要修改' : kind === 'human_review' ? '需要人工处理' : '团队工作已完成'
        : title
      const statusValue = textValue(data?.status)
      const status: EnterpriseWorkItem['status'] = statusValue === 'pending' || statusValue === 'in_progress' || statusValue === 'completed' || statusValue === 'cancelled'
        ? statusValue : actionable ? 'pending' : 'unknown'
      const returnTarget = textValue(continuation?.returnTarget)
      const reviewScope = textValue(continuation?.reviewScope)
      return [{
        id, kind, title: displayTitle, status, actionable, read: notification?.read === true,
        source: (textValue(source?.system) ?? textValue(data?.source)) === 'weave' || notificationType.startsWith('weave.') ? 'weave' : 'forge',
        notificationType, createdAt,
        ...(textValue(notification?.body) ? { summary: textValue(notification?.body) } : {}),
        ...(textValue(data?.instructions) ? { instructions: textValue(data?.instructions) } : {}),
        ...(textValue(notification?.actionUrl) ?? textValue(notification?.action_url) ? { actionUrl: textValue(notification?.actionUrl) ?? textValue(notification?.action_url) } : {}),
        ...(textValue(source?.workReference) ?? textValue(data?.workReference) ? { workReference: textValue(source?.workReference) ?? textValue(data?.workReference) } : {}),
        ...(textValue(source?.runReference) ?? textValue(data?.runReference) ? { runReference: textValue(source?.runReference) ?? textValue(data?.runReference) } : {}),
        ...(textValue(source?.sessionReference) ?? textValue(data?.sessionReference) ? { sessionReference: textValue(source?.sessionReference) ?? textValue(data?.sessionReference) } : {}),
        ...(textValue(material?.label) ? { materialLabel: textValue(material?.label) } : {}),
        ...(textValue(continuation?.reason) ? { returnReason: textValue(continuation?.reason) } : {}),
        ...(returnTarget === 'origin_review' || returnTarget === 'team' || returnTarget === 'member' || returnTarget === 'human_step' ? { returnTarget } : {}),
        ...(reviewScope === 'whole_team' || reviewScope === 'affected_members' || reviewScope === 'human_step' ? { reviewScope } : {}),
      }]
    }).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    const sources = new Map<string, { workReference: string; runReference: string; sessionReference: string }>()
    const sourceFor = async (item: EnterpriseWorkItem) => {
      const cached = sources.get(item.id)
      if (cached) return cached
      try {
        const verified = await access.readWorkNotificationSource(item.id)
        if (verified.kind === 'business' || item.notificationType !== `weave.team_run.${verified.kind}`
          || item.workReference && item.workReference !== verified.source.workReference
          || item.runReference && item.runReference !== verified.source.runReference
          || item.sessionReference && item.sessionReference !== verified.source.sessionReference) return undefined
        const source = { workReference: verified.source.workReference, runReference: verified.source.runReference, sessionReference: verified.source.sessionReference }
        sources.set(item.id, source)
        return source
      } catch { return undefined }
    }
    const superseded = new Set<string>()
    const hasSucceededAction = new Set<string>()
    const businessResults = new Map<string, NonNullable<EnterpriseWorkContinuationContext['run']['businessResult']>>()
    for (const pending of items) {
      if (pending.source !== 'weave' || pending.kind !== 'revision_required' || !pending.actionable
        || !/^weave\.team_run\.revision_required$/.test(pending.notificationType ?? '')) continue
      const parent = await sourceFor(pending)
      if (!parent) continue
      try {
        const context = await access.readWorkContinuationMetadata(parent)
        if (context.source.inputStatus === 'superseded' && context.source.supersededByInputRevisionID
          && context.source.supersededByInputRevisionID !== context.source.inputRevisionID
          && (context.run.businessResult === 'needs_input' || context.run.businessResult === undefined && context.run.finalResult?.disposition === 'needs_input')) superseded.add(pending.id)
        if (context.run.businessResult) businessResults.set(pending.id, context.run.businessResult)
        if (!context.run.businessResult && context.run.status === 'succeeded' && context.run.finalResult?.disposition === 'needs_input'
          && context.run.actionOutcomes?.some((outcome) => outcome.status === 'succeeded')) hasSucceededAction.add(pending.id)
      } catch {
        // A missing or unreadable action receipt must never be treated as a successful business action.
      }
    }
    const projectedItems = items.map((item) => ({
      ...item, ...(sources.get(item.id) ?? {}),
      ...(hasSucceededAction.has(item.id) ? {
        title: '团队结果与业务回执',
        summary: 'Forge 业务动作已确认成功。团队列出的缺项是检查意见，后续办理事项以 Forge 当前正式事项为准。',
      } : {}),
      ...(businessResults.get(item.id) === 'completed' ? {
        title: '团队结果与业务回执', summary: '本轮团队工作已完成。后续办理事项和审批状态以 Forge 当前正式事项为准。',
      } : businessResults.get(item.id) === 'action_failed' ? {
        title: '业务动作失败', summary: '本轮业务动作失败，请核对 Forge 回执和当前业务状态；不要重放原请求。',
      } : businessResults.get(item.id) === 'action_unknown' ? {
        title: '业务动作结果待核对', summary: '本轮业务动作结果未知，请先核对 Forge 回执；不要重放原请求。',
      } : {}),
      ...(superseded.has(item.id) || hasSucceededAction.has(item.id) || businessResults.has(item.id) && businessResults.get(item.id) !== 'needs_input' ? { actionable: false, status: 'completed' as const } : {}),
    }))
    const runList = record(runsRead.value)
    access.assertCurrent()
    const readStatus = (error?: string): EnterpriseWorkReadStatus => error ? { status: 'failed', error } : { status: 'loaded' }
    return {
      loadedAt: new Date().toISOString(), choices, tasks, items: projectedItems,
      runs: (Array.isArray(runList?.runs) ? runList.runs : []).flatMap((run) => runObservation(run) ?? []),
      reads: {
        runs: readStatus(runsRead.error), teamChoices: readStatus(teamChoicesError),
        weaveTasks: readStatus(weaveTasksRead.error),
        forgeApprovals: readStatus(approvalsRead.error ?? approvalsRead.value?.error ?? (approvalDetailsErrors.length ? [...new Set(approvalDetailsErrors)].join('；') : undefined)),
        notifications: readStatus(notificationsRead.error ?? notificationsRead.value?.error),
      },
    }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}


function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}


function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}


function approvalReturnSupersededByResubmit(actions: unknown[]): boolean {
  let latestReturnIndex = -1
  let latestResubmitIndex = -1
  actions.forEach((value, index) => {
    const action = record(value)?.action
    if (action === 'revise') latestReturnIndex = index
    if (action === 'resubmit') latestResubmitIndex = index
  })
  return latestResubmitIndex > latestReturnIndex
}


function runObservation(value: unknown): EnterpriseRunObservation | undefined {
  const source = record(value)
  const id = textValue(source?.run_id)
  const status = textValue(source?.status)
  if (!id || !status) return undefined
  return {
    id, status, durationMs: Math.max(0, numberValue(source?.duration_ms) ?? 0), tokensIn: Math.max(0, numberValue(source?.tokens_in) ?? 0),
    tokensOut: Math.max(0, numberValue(source?.tokens_out) ?? 0), costUsd: Math.max(0, numberValue(source?.cost_usd) ?? 0),
    ...(textValue(source?.agent) ? { agent: textValue(source?.agent) } : {}), ...(textValue(source?.step) ? { step: textValue(source?.step) } : {}),
    ...(textValue(source?.started_at) ? { startedAt: textValue(source?.started_at) } : {}),
  }
}

