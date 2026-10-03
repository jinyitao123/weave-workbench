import type { EnterpriseService } from '../enterprise'
import { currentItemContextFingerprint } from './approval-context-binding'
import { parseCurrentItemActionReceipt } from './approval-actions'
import { digest } from './handoff-store'
import { rejectUnknownKeys, requireString } from '../validation'

export interface ApprovalUiAttempt { fingerprint: string; result: Promise<{ runId: string; repeated: boolean }> }
export { approvalUiChoices } from './approval-context-binding'

/** Human clicks use the same native MCP action and receipt boundary as Pi approvals. */
export async function completeViewedApproval(
  service: Pick<EnterpriseService, 'getApprovalContext' | 'runNativeMcpAction'>,
  requestId: string, runId: string, accountKey: string, payload: Record<string, unknown>,
  attempts: Map<string, ApprovalUiAttempt>, assertCurrent: () => void,
): Promise<{ runId: string; repeated: boolean }> {
  rejectUnknownKeys(payload, ['actionRef', 'actionVersion', 'comment'], 'approval action')
  const actionRef = requireString(payload.actionRef, 'actionRef', { min: 64, max: 64 })
  const version = requireString(payload.actionVersion, 'actionVersion', { min: 64, max: 64 })
  const comment = requireString(payload.comment, 'comment', { min: 1, max: 4000, trim: false })
  if (!/^[0-9a-f]{64}$/.test(actionRef) || !/^[0-9a-f]{64}$/.test(version) || !comment.trim() || comment.includes('\0')) throw new Error('请重新读取当前审批并填写办理意见')
  const key = digest(JSON.stringify([accountKey, requestId, version]))
  const fingerprint = digest(JSON.stringify([actionRef, comment]))
  assertCurrent()
  const prior = attempts.get(key)
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new Error('当前审批版本已有办理请求，请先核对原回执，不能替换动作或意见')
    return prior.result
  }
  const context = await service.getApprovalContext(requestId)
  assertCurrent()
  if (context.status !== 'pending' || context.viewer !== 'current_approver' || currentItemContextFingerprint(context) !== version) throw new Error('当前审批版本已变化，请重新查看材料与办理目录')
  const action = context.availableActions?.find((item) => item.semantic && digest(JSON.stringify(item)) === actionRef)
  if (action?.inputs.length !== 1) throw new Error('该动作不属于当前审批的可办理目录')
  // A concurrent read may have yielded to another click before this reservation.
  const raced = attempts.get(key)
  if (raced) {
    if (raced.fingerprint !== fingerprint) throw new Error('当前审批版本已有另一项办理请求，请先核对原回执')
    return raced.result
  }
  const result = Promise.resolve().then(async () => {
    assertCurrent()
    const attempt = await service.runNativeMcpAction({ actionName: action.execution.actionName, objectName: action.execution.objectName,
      recordId: action.execution.recordId, params: { ...action.execution.params, [action.inputs[0].name]: comment } }, async () => { assertCurrent() })
    assertCurrent()
    if (attempt.status === 'rejected') throw new Error(attempt.message ?? 'Forge 拒绝了本次办理')
    const receipt = attempt.status === 'returned' ? parseCurrentItemActionReceipt(attempt.result, action) : undefined
    if (!receipt) throw new Error('本次审批办理结果仍待核对，没有重发。请从当前事项核对原生回执')
    return { runId, repeated: receipt.alreadyApplied }
  })
  attempts.set(key, { fingerprint, result })
  return result
}
