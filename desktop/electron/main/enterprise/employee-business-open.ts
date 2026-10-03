import type { EnterpriseService } from '../enterprise'
import type { EmployeeBusinessRecord, EmployeeBusinessSelection } from '../../../src/types/employee-business'
import { digest } from './handoff-store'
import { canonicalBusinessJSON } from './employee-business-contract'

export interface PendingEmployeeBusinessContext {
  accountKey: string; selection: EmployeeBusinessSelection; contextVersion: string; recordVersion: string
  snapshotDigest: string; promptDigest: string; createdAt: number
}
type Access = Pick<EnterpriseService, 'accountKey' | 'getEmployeeBusinessContext' | 'readBusinessRecord'>
function snapshotDigest(value: Awaited<ReturnType<Access['readBusinessRecord']>>) {
  const { capturedAt: _time, ...snapshot } = value.snapshot
  return digest(canonicalBusinessJSON({ candidate: value.candidate, snapshot }))
}
export async function prepareEmployeeBusinessOpen(service: Access, record: EmployeeBusinessRecord) {
  const accountKey = await service.accountKey()
  const selection: EmployeeBusinessSelection = { record, source: { kind: 'record' } }
  const context = await service.getEmployeeBusinessContext(selection)
  const read = await service.readBusinessRecord(record.objectName, record.recordId)
  if (read.candidate.objectName !== record.objectName || read.candidate.recordId !== record.recordId || await service.accountKey() !== accountKey) throw new Error('员工账号或业务来源已变化，请重新打开')
  const fields = read.snapshot.record.map((field) => `- ${field.label}：${typeof field.value === 'string' ? field.value : JSON.stringify(field.value)}`).join('\n')
  const prompt = `当前本人业务事项：${context.record.label}\n\n当前记录字段：\n${fields}\n\n读取完整性：${read.snapshot.completeness}。${read.snapshot.completenessNotes.join('；')}\n\n本次打开仅授权只读查看与整理，不执行业务动作、不交给团队。只有员工之后新消息明确要求办理，才读取当前事项动作目录，并按声明参数与本轮选定原件办理。来源由Host固定，不从标题或历史聊天推断。`
  const pending: PendingEmployeeBusinessContext = { accountKey, selection: { record: context.record, source: context.source }, contextVersion: context.contextVersion, recordVersion: context.recordVersion, snapshotDigest: snapshotDigest(read), promptDigest: digest(prompt), createdAt: Date.now() }
  return { pending, prompt }
}
export async function verifyEmployeeBusinessOpen(service: Access, pending: PendingEmployeeBusinessContext, prompt: string) {
  if (Date.now() - pending.createdAt > 10 * 60_000 || digest(prompt.trim()) !== pending.promptDigest || await service.accountKey() !== pending.accountKey) throw new Error('本人业务事项上下文已失效，请重新打开')
  const context = await service.getEmployeeBusinessContext(pending.selection)
  const read = await service.readBusinessRecord(pending.selection.record.objectName, pending.selection.record.recordId)
  if (context.contextVersion !== pending.contextVersion || context.recordVersion !== pending.recordVersion || snapshotDigest(read) !== pending.snapshotDigest
    || await service.accountKey() !== pending.accountKey) throw new Error('当前业务记录或可办理范围已变化，请重新打开')
}
