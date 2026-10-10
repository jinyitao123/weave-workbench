import { defineFlow } from '@objectstack/spec/automation';

export const SalesPricingApprovalFlow = defineFlow({
  name: 'sales_pricing_approval', label: '销售价格审批', type: 'record_change', status: 'active', runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: '价格申请已提交', config: { objectName: 'forge_sales_price_request', triggerType: 'record-after-update', condition: "previous.status == 'draft' && record.status == 'pending_approval'" } },
    { id: 'review', type: 'approval', label: '独立价格复核', config: { approvers: [{ type: 'field', value: 'review_owner_id' }], behavior: 'unanimous', lockRecord: true, approvalStatusField: 'approval_status', onEmptyApprovers: 'fail', maxRevisions: 0 } },
    { id: 'approve', type: 'update_record', label: '记录通过并自动执行价格', config: { objectName: 'forge_sales_price_request', filter: { id: '{record.id}', organization_id: '{record.organization_id}' }, fields: { status: 'approved' } } },
    { id: 'reject', type: 'update_record', label: '记录驳回', config: { objectName: 'forge_sales_price_request', filter: { id: '{record.id}', organization_id: '{record.organization_id}' }, fields: { status: 'rejected' } } },
    { id: 'notify', type: 'notify', label: '通知申请人查看执行结果', config: { recipients: ['{record.submitted_by}'], title: '销售价格申请已通过', message: '请查看申请中的价格执行结果与价格历史。', topic: 'sales_pricing_approval.approved', sourceObject: 'forge_sales_price_request', sourceId: '{record.id}', actionUrl: '/apps/com.inoforge.forge.sales/forge_sales_price_request/record/{record.id}' } },
    { id: 'end', type: 'end', label: '审批结束' },
  ],
  edges: [{ id: 'start_review', source: 'start', target: 'review' }, { id: 'approved', source: 'review', target: 'approve', label: 'approve' }, { id: 'rejected', source: 'review', target: 'reject', label: 'reject' }, { id: 'notify_approved', source: 'approve', target: 'notify' }, { id: 'done', source: 'notify', target: 'end' }, { id: 'rejected_end', source: 'reject', target: 'end' }],
});
