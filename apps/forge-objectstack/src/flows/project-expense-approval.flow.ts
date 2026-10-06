import { defineFlow } from '@objectstack/spec/automation';

/** Project expense decisions are held by the native Approval service and finalized by a project transaction node. */
export const ProjectExpenseApprovalFlow = defineFlow({
  name: 'project_expense_approval',
  label: '项目费用审批',
  description: '项目费用提交后由提交时项目负责人通过ObjectStack原生审批中心处理；通过后原子归集费用，驳回保留审计。',
  type: 'record_change',
  status: 'active',
  runAs: 'system',
  successMessage: '项目费用审批已处理',
  errorMessage: '项目费用审批未能继续，请检查项目负责人任职与审批状态',
  nodes: [
    {
      id: 'start', type: 'start', label: '费用申请已提交',
      config: {
        objectName: 'forge_project_expense',
        triggerType: 'record-after-update',
        condition: "record.status == 'pending_review' && previous.status == 'draft'",
      },
      position: { x: 80, y: 190 },
    },
    {
      id: 'expense_review', type: 'approval', label: '项目负责人审核费用',
      config: {
        approvers: [{ type: 'field', value: 'responsible_id', group: '项目负责人' }],
        behavior: 'per_group',
        lockRecord: true,
        approvalStatusField: 'approval_status',
        onEmptyApprovers: 'fail',
        maxRevisions: 0,
      },
      position: { x: 340, y: 190 },
    },
    {
      id: 'finalize_approved', type: 'forge_project_approval_finalize', label: '通过并原子归集费用',
      config: { objectName: 'forge_project_expense', approvalNodeId: 'expense_review', decision: 'approved' },
      position: { x: 690, y: 90 },
    },
    {
      id: 'finalize_rejected', type: 'forge_project_approval_finalize', label: '记录费用驳回',
      config: { objectName: 'forge_project_expense', approvalNodeId: 'expense_review', decision: 'rejected' },
      position: { x: 690, y: 300 },
    },
    { id: 'approved_end', type: 'end', label: '审核通过', position: { x: 1050, y: 90 } },
    { id: 'rejected_end', type: 'end', label: '审核驳回', position: { x: 1050, y: 300 } },
  ],
  edges: [
    { id: 'submit_to_review', source: 'start', target: 'expense_review' },
    { id: 'review_approved', source: 'expense_review', target: 'finalize_approved', label: 'approve' },
    { id: 'approved_to_end', source: 'finalize_approved', target: 'approved_end' },
    { id: 'review_rejected', source: 'expense_review', target: 'finalize_rejected', label: 'reject' },
    { id: 'rejected_to_end', source: 'finalize_rejected', target: 'rejected_end' },
  ],
});
