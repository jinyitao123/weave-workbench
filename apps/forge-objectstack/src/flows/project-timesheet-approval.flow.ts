import { defineFlow } from '@objectstack/spec/automation';

/** Time entries use the native Approval node; labor allocation happens only after its recorded decision. */
export const ProjectTimesheetApprovalFlow = defineFlow({
  name: 'project_timesheet_approval',
  label: '项目工时审批',
  description: '项目工时提交后由提交时项目负责人通过ObjectStack原生审批中心处理；通过或驳回均保留审批审计。',
  type: 'record_change',
  status: 'active',
  runAs: 'system',
  successMessage: '项目工时审批已处理',
  errorMessage: '项目工时审批未能继续，请检查项目负责人任职与审批状态',
  nodes: [
    {
      id: 'start', type: 'start', label: '工时已提交',
      config: {
        objectName: 'forge_project_timesheet',
        triggerType: 'record-after-update',
        condition: "record.status == 'pending_review' && previous.status == 'draft'",
      },
      position: { x: 80, y: 190 },
    },
    {
      id: 'timesheet_review', type: 'approval', label: '项目负责人审核工时',
      config: {
        approvers: [{ type: 'field', value: 'approval_manager_id' }],
        behavior: 'first_response',
        lockRecord: true,
        approvalStatusField: 'approval_status',
        onEmptyApprovers: 'auto_approve',
        maxRevisions: 0,
      },
      position: { x: 340, y: 190 },
    },
    {
      id: 'finalize_approved', type: 'forge_project_approval_finalize', label: '通过并归集人工成本',
      config: { objectName: 'forge_project_timesheet', approvalNodeId: 'timesheet_review', decision: 'approved' },
      position: { x: 690, y: 90 },
    },
    {
      id: 'finalize_rejected', type: 'forge_project_approval_finalize', label: '记录工时驳回',
      config: { objectName: 'forge_project_timesheet', approvalNodeId: 'timesheet_review', decision: 'rejected' },
      position: { x: 690, y: 300 },
    },
    { id: 'approved_end', type: 'end', label: '审核通过', position: { x: 1050, y: 90 } },
    { id: 'rejected_end', type: 'end', label: '审核驳回', position: { x: 1050, y: 300 } },
  ],
  edges: [
    { id: 'submit_to_review', source: 'start', target: 'timesheet_review' },
    { id: 'review_approved', source: 'timesheet_review', target: 'finalize_approved', label: 'approve' },
    { id: 'approved_to_end', source: 'finalize_approved', target: 'approved_end' },
    { id: 'review_rejected', source: 'timesheet_review', target: 'finalize_rejected', label: 'reject' },
    { id: 'rejected_to_end', source: 'finalize_rejected', target: 'rejected_end' },
  ],
});
