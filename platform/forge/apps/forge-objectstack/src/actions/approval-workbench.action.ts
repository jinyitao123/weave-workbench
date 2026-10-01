import { defineAction } from '@objectstack/spec/ui';

export const CONTRACT_APPROVAL_MCP_APPROVE_TARGET = 'contractApprovalMcpApprove';
export const CONTRACT_APPROVAL_MCP_SEND_BACK_TARGET = 'contractApprovalMcpSendBack';

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
