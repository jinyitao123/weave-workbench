import { defineFlow } from '@objectstack/spec/automation';
const approval = (name: string, label: string, object: string, statusField: string, approvedState: string) => defineFlow({
  name, label, type: 'record_change', status: 'active', runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: '申请已提交', config: { objectName: object, triggerType: 'record-after-update', condition: `record.${statusField} == 'pending_approval' && previous.${statusField} == 'draft'` } },
    { id: 'review', type: 'approval', label: '独立业务复核', config: { approvers: [{ type: 'field', value: 'review_owner_id' }], behavior: 'unanimous', lockRecord: true, approvalStatusField: 'approval_status', onEmptyApprovers: 'fail', maxRevisions: 0 } },
    { id: 'approve', type: 'update_record', label: '记录通过结果', config: { objectName: object, filter: { id: '{record.id}', organization_id: '{record.organization_id}' }, multi:true,fields: { [statusField]: approvedState } } },
    { id: 'reject', type: 'update_record', label: '记录驳回结果', config: { objectName: object, filter: { id: '{record.id}', organization_id: '{record.organization_id}' }, multi:true,fields: { [statusField]: object==='forge_sales_discount_request'?'rejected':'draft' } } },
    { id: 'approved_notice', type: 'notify', label: '通知申请人', config: { recipients: ['{record.submitted_by}'], title: label+'已通过', message: object==='forge_sales_discount_request'?'优惠申请已通过，请按批准结果人工调整订单。':'费用申请已通过，可由财务承接办理。', topic: name+'.approved', sourceObject: object, sourceId: '{record.id}', actionUrl: '/_console/apps/com.inoforge.forge.sales/'+object+'/record/{record.id}' } },
    { id: 'end', type: 'end', label: '审批结束' },
  ],
  edges: [{ id:'s',source:'start',target:'review' },{ id:'a',source:'review',target:'approve',label:'approve' },{ id:'r',source:'review',target:'reject',label:'reject' },{ id:'n',source:'approve',target:'approved_notice' },{ id:'e',source:'approved_notice',target:'end' },{ id:'re',source:'reject',target:'end' }],
});
export const SalesDiscountApprovalFlow = approval('sales_discount_approval','销售优惠审批','forge_sales_discount_request','status','approved');
export const SalesAdditionalFeeApprovalFlow = approval('sales_additional_fee_approval','销售附加费用审批','forge_sales_additional_fee','document_status','active');
