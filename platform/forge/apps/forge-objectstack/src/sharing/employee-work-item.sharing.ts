import { defineSharingRule } from '@objectstack/spec/security';

export const employeeWorkItemAssigneeSharing = defineSharingRule({
  name: 'employee_work_item_assignee',
  label: '工作事项共享给处理员工',
  object: 'forge_employee_work_item',
  type: 'criteria',
  condition: { dialect: 'cel', source: 'record.assignee_id != null' },
  accessLevel: 'edit',
  sharedWith: { type: 'field', value: 'assignee_id' },
});
