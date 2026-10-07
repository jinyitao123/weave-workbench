import { definePermissionSet } from '@objectstack/spec';
import type { PermissionSet as PermissionSetInput } from '@objectstack/spec/security';
import { salesQuotationCostFieldMask } from './sales-quotation.permission.js';
import {
  PROJECT_POSITION_RLS_POLICY_PREFIX,
  PROJECT_POSITION_SCOPED_OBJECTS,
  projectPositionDeleteScopeKey,
  projectPositionEditScopeKey,
  projectPositionReadScopeKey,
} from '../plugins/project-rls-membership.plugin.js';

const orgRead = { allowRead: true, readScope: 'org' as const };
const projectImportJobFields = [
  'id', 'object_name', 'status', 'total_rows', 'processed_rows', 'created_count', 'updated_count',
  'skipped_count', 'error_count', 'write_mode', 'dry_run', 'run_automations', 'treat_as_historical',
  'error', 'results', 'reverted_at', 'started_at', 'completed_at', 'created_by', 'created_at',
].map(field => 'sys_import_job.' + field);
const projectWriteScope = 'owner_id == current_user.id || (owner_id == null && created_by == current_user.id) || manager_id == current_user.id';
const projectReadScope = `${projectWriteScope} || id in current_user.active_project_ids`;

const projectPositionScopedObjects = new Set<string>(PROJECT_POSITION_SCOPED_OBJECTS);
// These are structural master-detail rows, not assigned work. Native
// controlled_by_parent applies the exact parent project read/RLS/share boundary.
const parentControlledStructureReads = new Set(['forge_project_member', 'forge_project_sales_link']);

/** Adds record-id scope only for project-capability PermissionSets and objects they already grant. */
export function projectPositionRowIdPolicies(definition: Pick<PermissionSetInput, 'objects' | 'systemPermissions'>) {
  const projectScoped = (definition.systemPermissions || []).some(capability => capability.startsWith('forge_project_'));
  if (!projectScoped) return [];
  const objects = definition.objects || {};
  const policies: Array<{ name: string; object: string; operation: 'select' | 'update' | 'delete'; using: string; check?: string }> = [];
  for (const [objectName, value] of Object.entries(objects)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const grant = value as Record<string, unknown>;
    if (objectName === 'forge_project') {
      if (grant.allowRead === true) policies.push({
        name: PROJECT_POSITION_RLS_POLICY_PREFIX + 'select_forge_project',
        object: objectName, operation: 'select',
        using: 'id in current_user.active_project_ids || owner_id == current_user.id || manager_id == current_user.id',
      });
      continue;
    }
    if (!projectPositionScopedObjects.has(objectName)) continue;
    if (grant.allowRead === true && !parentControlledStructureReads.has(objectName)) {
      const positionScope = `id in current_user.${projectPositionReadScopeKey(objectName)}`;
      const managerAttachmentScope = objectName === 'forge_project_attachment'
        && definition.systemPermissions?.includes('forge_project_manager');
      policies.push({
        name: PROJECT_POSITION_RLS_POLICY_PREFIX + 'select_' + objectName,
        object: objectName, operation: 'select',
        using: managerAttachmentScope
          ? `${positionScope} || project_id in current_user.managed_project_ids`
          : positionScope,
      });
    }
    if (grant.allowEdit === true) {
      const using = `id in current_user.${projectPositionEditScopeKey(objectName)}`;
      policies.push({
        name: PROJECT_POSITION_RLS_POLICY_PREFIX + 'update_' + objectName,
        object: objectName, operation: 'update', using, check: using,
      });
    }
    if (grant.allowDelete === true) policies.push({
      name: PROJECT_POSITION_RLS_POLICY_PREFIX + 'delete_' + objectName,
      object: objectName, operation: 'delete', using: `id in current_user.${projectPositionDeleteScopeKey(objectName)}`,
    });
  }
  return policies;
}

export function withProjectPositionRowScopes<T extends PermissionSetInput>(definition: T, nativeOwnSharedObjects: readonly string[] = []): T {
  const policies = projectPositionRowIdPolicies(definition).filter(policy => !nativeOwnSharedObjects.includes(policy.object));
  return policies.length ? {
    ...definition,
    rowLevelSecurity: [...(definition.rowLevelSecurity || []), ...policies],
  } as T : definition;
}

/** Project writes are limited to the record owner or named manager; reads also include active project members. */
export const projectOperatorPermission = definePermissionSet(withProjectPositionRowScopes({
  name: 'forge_project_operator',
  label: '项目创建与交接办理',
  description: '仅查看本人拥有、本人负责或有效项目成员关系覆盖的项目；维护范围限项目所有者、负责人或历史创建人。',
  systemPermissions: ['forge_project_operator'],
  objects: {
    forge_project: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'org', writeScope: 'org' },
    forge_project_type: orgRead,
    forge_business_setting_option: orgRead,
    sys_user: orgRead,
    forge_project_member: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'org' as const, writeScope: 'org' as const },
    forge_project_sales_link: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'org' as const, writeScope: 'org' as const },
  },
  rowLevelSecurity: [
    {
      name: 'project_operator_task_type_read',
      object: 'forge_business_setting_option',
      operation: 'select',
      using: "scope == 'project' && setting_type == 'task_type'",
    },
    {
      name: 'owner_manager_or_active_member_project_read',
      object: 'forge_project',
      operation: 'select',
      using: projectReadScope,
    },
    {
      name: 'project_owner_create',
      object: 'forge_project',
      operation: 'insert',
      check: 'owner_id == current_user.id',
    },
    {
      name: 'owner_or_assigned_project_manager_delete',
      object: 'forge_project',
      operation: 'delete',
      using: projectWriteScope,
    },
    {
      name: 'owner_or_assigned_project_manager_update',
      object: 'forge_project',
      operation: 'update',
      using: projectWriteScope,
      check: projectWriteScope,
    },
  ],
}));

/** Execution-state transitions and cost reads belong to the assigned manager. */
export const projectManagerPermission = definePermissionSet(withProjectPositionRowScopes({
  name: 'forge_project_manager',
  label: '项目经理执行办理',
  description: '项目经理办理本人负责项目的执行状态，并只读该项目成本；项目创建和订单来源关联另受各自权限控制。',
  systemPermissions: ['forge_project_manager'],
  fields: Object.fromEntries([
    ...Object.entries(salesQuotationCostFieldMask),
    ...projectImportJobFields.map(field => [field, { readable: true, editable: false }]),
    ['sys_import_job.undo_log', { readable: false, editable: false }],
  ]),
  objects: {
    forge_customer: { allowRead: true, readScope: 'own' },
    forge_sales_contract: { allowRead: true, readScope: 'own' },
    forge_sales_contract_line: { allowRead: true, readScope: 'own' },
    forge_sales_order: { allowRead: true, readScope: 'own' },
    forge_sales_order_line: { allowRead: true, readScope: 'own' },
    forge_quotation: { allowRead: true, readScope: 'own' },
    forge_quotation_line: { allowRead: true, readScope: 'own' },
    forge_project_member: { allowRead: true, readScope: 'org' },
    forge_project_cost_entry: { allowRead: true, allowExport: true, readScope: 'org' },
    forge_project_daily_report: orgRead,
    forge_project_settlement: { allowRead: true, allowExport: true, readScope: 'org' },
    forge_project_plan: { allowRead: true, readScope: 'org' },
    forge_project_work_item: { allowCreate: true, allowRead: true, allowExport: true, allowTransfer: true, readScope: 'org' },
    forge_project_timesheet: { allowRead: true, allowExport: true, readScope: 'org' },
    forge_project_expense: { allowRead: true, allowExport: true, readScope: 'org' },
    forge_project_expense_line: { allowRead: true, allowExport: true, readScope: 'org' },
    forge_project_attachment: orgRead,
    sys_file: { allowRead: true, readScope: 'own' },
    forge_project_plan_template: orgRead,
    sys_import_job: { allowRead: true, readScope: 'own' },
  },
  rowLevelSecurity: [{
    name: 'assigned_project_manager_team_read',
    object: 'forge_project_member',
    operation: 'select',
    using: 'project_id in current_user.managed_project_ids',
  }, {
    name: 'assigned_project_manager_daily_report_read',
    object: 'forge_project_daily_report',
    operation: 'select',
    using: 'project_id in current_user.managed_project_ids',
  }, {
    name: 'assigned_project_manager_settlement_read',
    object: 'forge_project_settlement',
    operation: 'select',
    using: 'project_id in current_user.managed_project_ids',
  }, {
    name: 'assigned_project_manager_cost_read',
    object: 'forge_project_cost_entry',
    operation: 'select',
    using: 'project_id in current_user.managed_project_ids',
  }, {
    name: 'assigned_project_manager_plan_read',
    object: 'forge_project_plan',
    operation: 'select',
    using: 'project_id in current_user.managed_project_ids',
  }, {
    name: 'assigned_project_manager_work_item_read',
    object: 'forge_project_work_item',
    operation: 'select',
    using: 'project_id in current_user.managed_project_ids',
  }, {
    name: 'assigned_project_manager_work_item_create',
    object: 'forge_project_work_item',
    operation: 'insert',
    check: 'project_id in current_user.managed_project_ids',
  }, {
    name: 'project_manager_import_job_creator_read',
    object: 'sys_import_job',
    operation: 'select',
    using: 'created_by == current_user.id',
  }, {
    name: 'assigned_project_manager_timesheet_read',
    object: 'forge_project_timesheet',
    operation: 'select',
    using: 'project_id in current_user.managed_project_ids',
  }, {
    name: 'assigned_project_manager_expense_read',
    object: 'forge_project_expense',
    operation: 'select',
    using: 'project_id in current_user.managed_project_ids',
  }],
}, ['forge_customer', 'forge_sales_contract', 'forge_sales_contract_line', 'forge_sales_order', 'forge_sales_order_line', 'forge_quotation', 'forge_quotation_line']));
