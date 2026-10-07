import { defineFlow } from '@objectstack/spec/automation';

/**
 * Sales performance confirmation is a separate business decision from
 * finance RevenueRecognition. The confirmation can be posted only after the
 * original performance entry has an approved native Finance decision.
 */
export const SalesPerformanceConfirmationFlow = defineFlow({
  name: 'sales_performance_confirmation_approval', label: '销售业绩确认审批', type: 'record_change', status: 'active', runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: '业绩确认已提交', config: { objectName: 'forge_sales_performance_confirmation', triggerType: 'record-after-update', condition: "record.status == 'pending_approval' && previous.status == 'draft'" } },
    { id: 'review', type: 'approval', label: '财务业绩复核', config: { approvers: [{ type: 'position', value: 'finance_reviewer', group: '销售业绩确认' }], behavior: 'per_group', lockRecord: true, approvalStatusField: 'approval_status', onEmptyApprovers: 'fail', maxRevisions: 3 } },
    { id: 'approve', type: 'forge_sales_performance_finalize', label: '核验并确认业绩', config: { objectName: 'forge_sales_performance_confirmation', approvalNodeId: 'review', decision: 'approved' } },
    { id: 'revise', type: 'approval_revise', label: '退回修改', config: {} },
    { id: 'reject', type: 'forge_sales_performance_finalize', label: '记录确认驳回', config: { objectName: 'forge_sales_performance_confirmation', approvalNodeId: 'review', decision: 'rejected' } },
    { id: 'end', type: 'end', label: '业绩确认结束' },
  ],
  edges: [
    { id: 'start-review', source: 'start', target: 'review' },
    { id: 'review-approve', source: 'review', target: 'approve', label: 'approve' },
    { id: 'review-revise', source: 'review', target: 'revise', label: 'revise' },
    { id: 'revise-review', source: 'revise', target: 'review', label: 'resubmit', type: 'back' },
    { id: 'review-reject', source: 'review', target: 'reject', label: 'reject' },
    { id: 'approve-end', source: 'approve', target: 'end' }, { id: 'reject-end', source: 'reject', target: 'end' },
  ],
});

/** Rebook always reuses native ApprovalService and posts only on its approval result. */
export const SalesPerformanceRebookFlow = defineFlow({
  name: 'sales_performance_rebook_approval', label: 'Rebook业绩分配审批', type: 'record_change', status: 'active', runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Rebook申请已提交', config: { objectName: 'forge_sales_performance_rebook', triggerType: 'record-after-update', condition: "record.status == 'pending_approval' && previous.status == 'draft'" } },
    { id: 'review', type: 'approval', label: '财务Rebook复核', config: { approvers: [{ type: 'position', value: 'finance_reviewer', group: '销售业绩分配' }], behavior: 'per_group', lockRecord: true, approvalStatusField: 'approval_status', onEmptyApprovers: 'fail', maxRevisions: 3 } },
    { id: 'approve', type: 'forge_sales_performance_finalize', label: '核验并转记Rebook', config: { objectName: 'forge_sales_performance_rebook', approvalNodeId: 'review', decision: 'approved' } },
    { id: 'revise', type: 'approval_revise', label: '退回修改', config: {} },
    { id: 'reject', type: 'forge_sales_performance_finalize', label: '释放预留并记录驳回', config: { objectName: 'forge_sales_performance_rebook', approvalNodeId: 'review', decision: 'rejected' } },
    { id: 'end', type: 'end', label: 'Rebook审批结束' },
  ],
  edges: [
    { id: 'start-review', source: 'start', target: 'review' },
    { id: 'review-approve', source: 'review', target: 'approve', label: 'approve' },
    { id: 'review-revise', source: 'review', target: 'revise', label: 'revise' },
    { id: 'revise-review', source: 'revise', target: 'review', label: 'resubmit', type: 'back' },
    { id: 'review-reject', source: 'review', target: 'reject', label: 'reject' },
    { id: 'approve-end', source: 'approve', target: 'end' }, { id: 'reject-end', source: 'reject', target: 'end' },
  ],
});
