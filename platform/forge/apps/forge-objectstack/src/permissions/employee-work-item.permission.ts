import { definePermissionSet } from '@objectstack/spec';

export const employeeWorkItemPermission = definePermissionSet({
  name: 'employee_work_item',
  label: '员工工作事项',
  description: '允许员工读取和办理指派给自己的通用工作事项。',
  objects: {
    forge_employee_work_item: {
      allowCreate: true,
      allowRead: true,
      allowEdit: true,
      readScope: 'own',
      writeScope: 'own',
    },
  },
});
