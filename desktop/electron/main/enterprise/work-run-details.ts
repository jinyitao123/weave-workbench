import type { EnterpriseWorkRunDetails } from '../../../src/types/api'
import type { WorkbenchRunLookup } from './work-sources'
import { parseWorkContinuationContext } from './work-continuation'

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
// Public cards receive prose/names only. Runtime configuration, IDs, paths,
// tool inputs/outputs, and raw failure strings never leave this projection.
const internal = /[0-9a-f]{8}-[0-9a-f-]{27,}|\b[0-9a-f]{24,}\b|https?:\/\/|(?:^|[\s("'（：:])(?:\/[\w.-]+(?:\/|$)|[a-z]:\\)|\/(?:Users|home|tmp|private|var|etc|opt|Volumes|mnt|root|srv)\/|(?:^|[\s("'（：:])(?:\.{1,2}\/)?[\w.-]+\/[\w./-]+\.[a-z0-9]{1,8}\b|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\$\./i
function prose(value: unknown, max = 500): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max && !internal.test(value) && !value.includes('\\') && !Array.from(value).some((char) => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0))) ? value.trim() : undefined
}
function filename(value: string): string | undefined {
  return value.trim() && value.length <= 255 && !value.includes('/') && !value.includes('\\')
    && !/[0-9a-f]{8}-[0-9a-f-]{27,}|\b[0-9a-f]{24,}\b/i.test(value)
    && !Array.from(value).some((char) => char.charCodeAt(0) < 32) ? value : undefined
}
function time(value: unknown): string | undefined { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined }
const statuses = new Set(['pending', 'queued', 'running', 'waiting', 'parked', 'completed', 'succeeded', 'failed', 'cancelled', 'stopped', 'not_recorded', 'partially_completed', 'skipped'])
const state = (value: unknown): string => typeof value === 'string' && statuses.has(value) ? value : 'not_recorded'

export function workRunDetails(owned: WorkbenchRunLookup, rawActivity: unknown, rawContext: unknown): EnterpriseWorkRunDetails {
  const activity = record(rawActivity), context = parseWorkContinuationContext(rawContext)
  if (activity?.run_id !== owned.runId || context.source.runID !== owned.runId
    || context.source.inputRevisionID !== owned.inputRevisionID || context.source.workbenchSessionID !== owned.workbenchSessionID
    || activity.status !== context.run.status || owned.status !== context.run.status) throw new Error('执行详情正在更新，请稍后核对')
  const completeness = record(activity.completeness)
  const rawMembers = Array.isArray(activity.members) ? activity.members : []
  const failureKinds: string[] = []
  let incomplete = !Array.isArray(activity.members) || rawMembers.length > 32
  const members = rawMembers.slice(0, 32).flatMap((value, index): EnterpriseWorkRunDetails['members'] => {
    const member = record(value)
    if (!member) { incomplete = true; return [] }
    const rawStages = Array.isArray(member.stages) ? member.stages : []
    if (!Array.isArray(member.stages) || rawStages.length > 24) incomplete = true
    const stages = rawStages.slice(0, 24).flatMap((value, stageIndex) => {
      const stage = record(value)
      if (!stage) { incomplete = true; return [] }
      if (stage.status === 'failed' && typeof stage.failure_class === 'string') failureKinds.push(stage.failure_class)
      return [{ name: prose(stage.name, 200) ?? `执行步骤 ${stageIndex + 1}`, status: state(stage.status),
        ...(typeof stage.duration_ms === 'number' && Number.isFinite(stage.duration_ms) && stage.duration_ms >= 0 ? { durationMs: stage.duration_ms } : {}) }]
    })
    return [{ name: prose(member.name, 200) ?? `团队成员 ${index + 1}`, status: state(member.status), stages }]
  })
  const final = context.run.finalResult
  const summary = prose(final?.summary, 1000)
  const missingItems = (final?.missingItems ?? []).flatMap((item) => prose(item, 200) ? [prose(item, 200)!] : [])
  const authorizationRequired = context.run.authorization?.status === 'renewal_required'
  let explanation = ''
  if (authorizationRequired) explanation = '继续执行需要更新本次工作的授权，请从“我的工作”核对后办理。'
  else if (context.run.businessResult === 'action_failed') explanation = '业务动作未成功，正式业务状态仍需在业务系统中核对。'
  else if (context.run.businessResult === 'action_unknown') explanation = '业务动作的回执尚未确认，请先核对原工作，避免重复提交。'
  else if (context.run.status === 'failed') {
    explanation = failureKinds.includes('configuration') ? '流程配置未通过检查，执行未能继续。请联系团队维护人员检查配置。'
      : failureKinds.some((kind) => ['verification', 'validation', 'schema'].includes(kind)) ? '步骤结果未通过要求，尚未形成有效结论。请查看工作记录后安排后续处理。'
      : failureKinds.includes('infrastructure') ? '执行服务暂时无法完成处理。请从“我的工作”查看记录后安排后续处理。'
        : '本次团队执行未完成，尚未形成有效结论。请查看工作记录，核对原因后再安排后续处理。'
  } else if (context.run.status === 'cancelled') explanation = '本次团队执行已停止。已发生的业务动作仍以业务系统中的记录为准。'
  else if (context.run.status === 'succeeded' && context.run.businessResult !== 'needs_input') explanation = '团队执行已完成；正式业务结果以业务系统中的记录为准。'
  else if (context.run.businessResult === 'needs_input') explanation = '本次检查需要补充材料或说明，补齐后可从原工作继续。'
  else if (context.run.status === 'parked') explanation = '团队正在等待处理，请从“我的工作”查看具体事项。'
  return {
    runId: owned.runId, status: context.run.status,
    acceptedAt: time(activity.created_at), finishedAt: time(activity.finished_at), observedAt: time(activity.observed_at),
    members, activityComplete: !incomplete && completeness?.members === 'complete' && completeness?.activity_events === 'complete',
    materials: context.input.materials.map((item, index) => ({ name: filename(item.name) ?? `材料 ${index + 1}`,
      format: item.mediaType === 'application/pdf' ? 'PDF' : item.mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'DOCX'
        : item.mediaType === 'text/markdown' ? 'MD' : item.mediaType === 'text/csv' ? 'CSV' : item.mediaType === 'application/json' ? 'JSON' : 'TXT', bytes: item.bytes })),
    ...(summary ? { result: { title: prose(final?.title, 300) ?? '团队结果', summary, missingItems } } : {}),
    explanation, authorizationRequired, ...(owned.actionCounts ? { actionCounts: owned.actionCounts } : {}),
  }
}
