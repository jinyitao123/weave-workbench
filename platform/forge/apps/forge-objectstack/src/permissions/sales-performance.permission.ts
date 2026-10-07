import { definePermissionSet } from '@objectstack/spec';

/**
 * Read authority for the sales-performance DTO Actions. The Actions perform
 * the native BU/user/entry scope checks and return a whitelist DTO; this set
 * intentionally does not grant direct table reads on source finance records.
 */
export const salesPerformanceReaderPermission = definePermissionSet({
  name: 'sales_performance_reader', label: '销售业绩读取',
  description: '通过受控销售业绩查询读取当前原生销售范围内的业绩信息。',
  systemPermissions: ['sales_performance_read'],
  objects: {},
});

/** Permission required to submit one performance confirmation from a completed order. */
export const salesPerformanceConfirmationPermission = definePermissionSet({
  name: 'sales_performance_confirm', label: '销售业绩确认经办',
  description: '提交本人或本原生业务单元有权办理的销售业绩确认，实际源数据由服务端复核。',
  systemPermissions: ['sales_performance_confirm'],
  objects: {},
});

/** Permission required to request a Rebook transfer for an eligible performance entry. */
export const salesPerformanceRebookPermission = definePermissionSet({
  name: 'sales_performance_rebook', label: 'Rebook业绩分配经办',
  description: '按当前原生业务单元权限提交Rebook申请，金额和受让人由服务端校验。',
  systemPermissions: ['sales_performance_rebook'],
  objects: {},
});
