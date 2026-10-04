import { defineFlow } from '@objectstack/spec/automation';

export const SalesOrderApprovalFlow = defineFlow({
  name: 'sales_order_approval', label: '销售订单复核', type: 'record_change', status: 'active', runAs: 'system',
  description: '订单经办人提交准确版本，由已解析的独立复核人办理原生审批；正式激活和合同累计由同一业务事务应用。',
  nodes: [
    { id: 'start', type: 'start', label: '订单已提交', position: { x: 80, y: 160 }, config: {
      objectName: 'forge_sales_order', triggerType: 'record-after-update', condition: "record.status == 'pending_approval' && previous.status == 'draft'",
    } },
    { id: 'review', type: 'approval', label: '独立订单复核', position: { x: 320, y: 160 }, config: {
      approvers: [{ type: 'field', value: 'review_owner_id' }], behavior: 'unanimous', lockRecord: true, onEmptyApprovers: 'fail', maxRevisions: 0,
    } },
    { id: 'approve', type: 'update_record', label: '应用订单审批结果', position: { x: 580, y: 80 }, config: {
      objectName: 'forge_sales_order', filter: { id: '{record.id}' }, fields: { approval_outcome: 'approved' },
    } },
    { id: 'reject', type: 'update_record', label: '取消未通过订单', position: { x: 580, y: 260 }, config: {
      objectName: 'forge_sales_order', filter: { id: '{record.id}' }, fields: { approval_outcome: 'rejected' },
    } },
    { id: 'notify_approved', type: 'notify', label: '通知订单经办人', position: { x: 830, y: 80 }, config: {
      recipients: ['{record.responsible_id}'], title: '订单 {record.code} 已复核通过', message: '订单已进入执行，合同下单数量和金额已更新。',
      topic: 'sales.order.approved', sourceObject: 'forge_sales_order', sourceId: '{record.id}', severity: 'info',
      actionUrl: '/_console/apps/com.inoforge.forge.sales/forge_sales_order/record/{record.id}',
    } },
    { id: 'notify_rejected', type: 'notify', label: '通知订单未通过', position: { x: 830, y: 260 }, config: {
      recipients: ['{record.responsible_id}'], title: '订单 {record.code} 已取消', message: '请核对原生审批处理原因；本订单已取消，合同下单累计未增加。',
      topic: 'sales.order.rejected', sourceObject: 'forge_sales_order', sourceId: '{record.id}', severity: 'warning',
      actionUrl: '/_console/apps/com.inoforge.forge.sales/forge_sales_order/record/{record.id}',
    } },
    { id: 'end', type: 'end', label: '办理完成', position: { x: 1080, y: 160 } },
  ],
  edges: [
    { id: 's', source: 'start', target: 'review' },
    { id: 'a', source: 'review', target: 'approve', label: 'approve' },
    { id: 'r', source: 'review', target: 'reject', label: 'reject' },
    { id: 'an', source: 'approve', target: 'notify_approved' },
    { id: 'rn', source: 'reject', target: 'notify_rejected' },
    { id: 'ae', source: 'notify_approved', target: 'end' },
    { id: 're', source: 'notify_rejected', target: 'end' },
  ],
});
