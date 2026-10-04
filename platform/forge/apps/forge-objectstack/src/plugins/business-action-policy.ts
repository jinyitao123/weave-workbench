export type BusinessActionExecutionMode = 'employee_only' | 'team_delegable';
export type BusinessActionEffect = 'read' | 'write';

export interface BusinessActionPolicy {
  effect: BusinessActionEffect;
  executionMode: BusinessActionExecutionMode;
}

// Caller policy belongs to Forge, not Action.ai (whose native schema is strict).
// Full object/action keys prevent one domain's personal action from masking an
// unrelated action with the same short name. Native permissions still apply.
const EMPLOYEE_ONLY = new Set([
  'forge_sales_contract.contract_register_signature',
  'forge_sales_contract.contract_set_order_conditions',
  'forge_sales_contract.contract_convert_to_sales_order',
  'forge_sales_contract.contract_register_customer_prepayment',
  'forge_sales_contract.contract_approval_mcp_approve',
  'forge_sales_contract.contract_approval_mcp_send_back',
  'forge_sales_order.sales_order_submit',
  'forge_sales_order.sales_order_apply_completed_approval',
  'forge_sales_order.order_approval_mcp_approve',
  'forge_sales_order.order_approval_mcp_reject',
  'forge_sales_order.order_approval_mcp_recall',
  'forge_sales_order.sales_order_approve',
  'forge_sales_order.approval_work_item_approve',
  'forge_sales_order.approval_work_item_send_back',
  'forge_customer_prepayment.customer_prepayment_confirm',
]);

const READ_ONLY = new Set(['forge_sales_contract.contract_submit_frozen_material']);

export function businessActionPolicy(objectName: string, actionName: string): BusinessActionPolicy {
  const key = `${objectName}.${actionName}`;
  return {
    effect: READ_ONLY.has(key) ? 'read' : 'write',
    executionMode: EMPLOYEE_ONLY.has(key) ? 'employee_only' : 'team_delegable',
  };
}

export function isTeamDelegableAction(action: Record<string, unknown>): boolean {
  return typeof action.objectName === 'string' && typeof action.name === 'string'
    && businessActionPolicy(action.objectName, action.name).executionMode === 'team_delegable';
}

export function projectBusinessActionPolicy(action: Record<string, unknown>): Record<string, unknown> {
  if (typeof action.objectName !== 'string' || typeof action.name !== 'string') return action;
  return { ...action, ...businessActionPolicy(action.objectName, action.name) };
}
