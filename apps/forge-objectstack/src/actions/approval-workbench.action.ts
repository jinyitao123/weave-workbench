import { defineAction } from '@objectstack/spec/ui';

export const CONTRACT_APPROVAL_MCP_APPROVE_TARGET = 'contractApprovalMcpApprove';
export const CONTRACT_APPROVAL_MCP_SEND_BACK_TARGET = 'contractApprovalMcpSendBack';
export const QUOTATION_APPROVAL_MCP_APPROVE_TARGET = 'quotationApprovalMcpApprove';
export const QUOTATION_APPROVAL_MCP_REJECT_TARGET = 'quotationApprovalMcpReject';

const nativeApprovalInputs: Array<{ name: string; label: string; type: 'text'; required: boolean }> = [
  { name: 'approvalRequestId', label: '原生审批请求', type: 'text', required: true },
  { name: 'itemVersion', label: '当前审批事项版本', type: 'text', required: true },
  { name: 'sourceMaterialVersion', label: '原生审批材料版本', type: 'text', required: true },
  { name: 'comment', label: '办理意见', type: 'text', required: true },
];

export const ContractApprovalMcpApprove = defineAction({
  name: 'contract_approval_mcp_approve',
  label: '同意审批事项',
  objectName: 'forge_sales_contract',
  target: CONTRACT_APPROVAL_MCP_APPROVE_TARGET,
  locations: ['record_header'],
  visible: false,
  description: '记录当前员工对已绑定原生审批事项的同意意见，并由原生审批服务按流程推进。',
  ai: {
    exposed: true,
    description: '在审批请求仍由当前员工待办且事项版本未变化时记录原生同意意见，并由 ObjectStack ApprovalService 按原流程推进。',
    category: 'action',
    requiresConfirmation: true,
  },
  params: nativeApprovalInputs,
});

export const ContractApprovalMcpSendBack = defineAction({
  name: 'contract_approval_mcp_send_back',
  label: '退回修改审批事项',
  objectName: 'forge_sales_contract',
  target: CONTRACT_APPROVAL_MCP_SEND_BACK_TARGET,
  locations: ['record_header'],
  visible: false,
  description: '记录当前员工要求补充材料的意见，并由原生审批服务沿既有修订分支退回。',
  ai: {
    exposed: true,
    description: '在审批请求仍由当前员工待办且事项版本未变化时记录退回意见，并由 ObjectStack ApprovalService 沿原生修订分支退回。',
    category: 'action',
    requiresConfirmation: true,
  },
  params: nativeApprovalInputs,
});

export const QuotationApprovalMcpApprove = defineAction({
  name: 'quotation_approval_mcp_approve',
  label: '同意报价审批',
  objectName: 'forge_quotation',
  target: QUOTATION_APPROVAL_MCP_APPROVE_TARGET,
  locations: ['record_header'],
  visible: false,
  requiredPermissions: ['sales_quotation_reviewer'],
  description: '记录当前员工对已绑定原生报价审批事项的同意意见，并由原生审批服务推进现有流程。',
  ai: {
    exposed: true,
    description: '仅已分配的报价审批员工可对准确原生审批请求、冻结报价版本及材料发表同意意见，并由原生审批服务推进既有流程。',
    category: 'action',
    requiresConfirmation: true,
  },
  params: nativeApprovalInputs,
});

export const QuotationApprovalMcpReject = defineAction({
  name: 'quotation_approval_mcp_reject',
  label: '驳回报价审批',
  objectName: 'forge_quotation',
  target: QUOTATION_APPROVAL_MCP_REJECT_TARGET,
  locations: ['record_header'],
  visible: false,
  requiredPermissions: ['sales_quotation_reviewer'],
  description: '记录当前员工对已绑定原生报价审批事项的驳回意见，并由原生审批服务推进现有流程。',
  ai: {
    exposed: true,
    description: '仅已分配的报价审批员工可对准确原生审批请求和冻结报价版本记录驳回意见；本流程不支持退回修改。',
    category: 'action',
    requiresConfirmation: true,
  },
  params: nativeApprovalInputs,
});

export const ORDER_APPROVAL_MCP_APPROVE_TARGET = 'orderApprovalMcpApprove';
export const ORDER_APPROVAL_MCP_REJECT_TARGET = 'orderApprovalMcpReject';
export const ORDER_APPROVAL_MCP_RECALL_TARGET = 'orderApprovalMcpRecall';
export const OrderApprovalMcpApprove = defineAction({
  name: 'order_approval_mcp_approve', label: '同意订单复核', objectName: 'forge_sales_order',
  target: ORDER_APPROVAL_MCP_APPROVE_TARGET, locations: ['record_header'], visible: false,
  requiredPermissions: ['sales_order_reviewer'],
  ai: { exposed: true, category: 'action', requiresConfirmation: true,
    description: '已分配的独立订单复核员工对准确原生审批请求和冻结版本发表同意意见，由原生审批推进并原子应用订单状态及合同累计。' },
  params: nativeApprovalInputs,
});
export const OrderApprovalMcpReject = defineAction({
  name: 'order_approval_mcp_reject', label: '拒绝订单复核', objectName: 'forge_sales_order',
  target: ORDER_APPROVAL_MCP_REJECT_TARGET, locations: ['record_header'], visible: false,
  requiredPermissions: ['sales_order_reviewer'],
  ai: { exposed: true, category: 'action', requiresConfirmation: true,
    description: '已分配的独立订单复核员工对准确原生审批请求记录拒绝意见，原生流程取消未通过订单，保留原因且不增加合同下单累计。' },
  params: nativeApprovalInputs,
});

export const OrderApprovalMcpRecall = defineAction({
  name: 'order_approval_mcp_recall', label: '撤回订单审批', objectName: 'forge_sales_order',
  target: ORDER_APPROVAL_MCP_RECALL_TARGET, locations: ['record_header'], visible: false,
  requiredPermissions: ['sales_order_operator'],
  ai: { exposed: true, category: 'action', requiresConfirmation: true,
    description: '订单审批的本人发起人在仍待审批且冻结版本未变化时填写撤回原因，通过原生审批取消本订单并释放预收绑定，保留原审批及财务台账。' },
  params: nativeApprovalInputs,
});
