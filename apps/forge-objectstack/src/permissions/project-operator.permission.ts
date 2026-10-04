import { definePermissionSet } from '@objectstack/spec';

const orgRead = { allowRead: true, readScope: 'org' as const };
const projectScope = 'owner_id == current_user.id || (owner_id == null && created_by == current_user.id) || manager_id == current_user.id';

/** Project access is limited to the record owner or named manager; legacy ownerless rows fall back to their creator. */
export const projectOperatorPermission = definePermissionSet({
  name: 'forge_project_operator',
  label: '项目创建与交接办理',
  description: '仅查看和维护本人拥有或本人负责的项目；历史记录未写入所有者时，创建人可按系统创建人字段继续办理。',
  systemPermissions: ['forge_project_operator'],
  objects: {
    forge_project: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'org', writeScope: 'org' },
    forge_project_type: orgRead,
    sys_user: orgRead,
    forge_project_member: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'org' as const, writeScope: 'org' as const },
    forge_project_sales_link: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'org' as const, writeScope: 'org' as const },
  },
  rowLevelSecurity: [{
    name: 'owner_or_assigned_project_manager',
    object: 'forge_project',
    operation: 'all',
    using: projectScope,
    check: projectScope,
  }],
});

/** Execution-state transitions belong to the assigned project manager only. */
export const projectManagerPermission = definePermissionSet({
  name: 'forge_project_manager',
  label: '项目经理执行办理',
  description: '仅项目经理开始、暂停、恢复或终止本人负责的项目；项目创建和订单来源关联另受各自权限控制。',
  systemPermissions: ['forge_project_manager'],
  objects: {},
});
