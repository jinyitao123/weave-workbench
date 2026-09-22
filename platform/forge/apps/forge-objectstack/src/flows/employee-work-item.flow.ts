import { defineFlow } from '@objectstack/spec/automation';

const workItemWebhookSecret = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FORGE_WORK_ITEM_WEBHOOK_SECRET;

export const EmployeeWorkItemNotificationFlow = defineFlow({
  name: 'employee_work_item_notification',
  label: '员工工作事项通知',
  description: '通用工作事项创建后通知被指派员工，不依赖具体业务对象或审批流。',
  type: 'record_change',
  status: 'active',
  runAs: 'system',
  nodes: [
    {
      id: 'start', type: 'start', label: '工作事项已创建',
      config: { objectName: 'forge_employee_work_item', triggerType: 'record-after-create', condition: { dialect: 'cel', source: 'record.assignee_id != null' } },
      position: { x: 80, y: 120 },
    },
    {
      id: 'notify_assignee', type: 'notify', label: '通知处理员工',
      config: {
        recipients: ['{record.assignee_id}'], title: '{record.title}', message: '{record.summary}',
        topic: 'employee.work_item.created', severity: 'info', sourceObject: 'forge_employee_work_item', sourceId: '{record.id}',
        payload: {
          kind: '{record.kind}', source: '{record.source_system}', status: '{record.status}',
          workReference: '{record.source_work_ref}', runReference: '{record.source_run_ref}', instructions: '{record.instructions}',
          material: { version: '{record.material_version}', reference: '{record.material_ref}', label: '{record.material_label}' },
          continuation: { reason: '{record.return_reason}', returnTarget: '{record.return_target}', targetReference: '{record.target_ref}', reviewScope: '{record.review_scope}' },
        },
      },
      position: { x: 360, y: 120 },
    },
    { id: 'end', type: 'end', label: '已通知', position: { x: 640, y: 120 } },
  ],
  edges: [
    { id: 'created_to_notification', source: 'start', target: 'notify_assignee' },
    { id: 'notification_to_end', source: 'notify_assignee', target: 'end' },
  ],
});

/**
 * Signed, queue-backed capability for Weave and other trusted runtimes.
 * The deployment owns the secret; omitting it keeps local authoring possible
 * but production must set FORGE_WORK_ITEM_WEBHOOK_SECRET.
 */
export const CreateEmployeeWorkItemFlow = defineFlow({
  name: 'create_employee_work_item',
  label: '创建员工工作事项',
  description: '接收外部系统的通用工作结果或退回决定，并在 Forge 中建立员工事项。',
  type: 'api',
  status: 'active',
  runAs: 'system',
  nodes: [
    {
      id: 'start', type: 'start', label: '接收工作事项',
      config: { hookId: 'weave-work-items-v1', ...(workItemWebhookSecret ? { secret: workItemWebhookSecret } : {}) },
      position: { x: 80, y: 120 },
    },
    {
      id: 'create_item', type: 'create_record', label: '保存员工工作事项',
      config: {
        objectName: 'forge_employee_work_item', outputVariable: 'created_item',
        fields: {
          title: '{record.title}', kind: '{record.kind}', status: '{record.status}', assignee_id: '{record.assigneeAccountId}',
          initiator_id: '{record.initiatorAccountId}', summary: '{record.summary}', instructions: '{record.instructions}',
          source_system: '{record.source.system}', source_work_ref: '{record.source.workReference}',
          source_run_ref: '{record.source.runReference}', source_session_ref: '{record.source.sessionReference}',
          idempotency_key: '{record.source.idempotencyKey}', material_version: '{record.material.version}',
          material_ref: '{record.material.reference}', material_sha256: '{record.material.sha256}', material_label: '{record.material.label}',
          parent_item_ref: '{record.continuation.parentItemId}', return_reason: '{record.continuation.reason}',
          return_target: '{record.continuation.returnTarget}', target_ref: '{record.continuation.targetReference}',
          review_scope: '{record.continuation.reviewScope}', due_at: '{record.dueAt}',
        },
      },
      position: { x: 360, y: 120 },
    },
    { id: 'end', type: 'end', label: '事项已建立', position: { x: 640, y: 120 } },
  ],
  edges: [
    { id: 'received_to_create', source: 'start', target: 'create_item' },
    { id: 'created_to_end', source: 'create_item', target: 'end' },
  ],
});
