import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const PurchaseOrderRequestPrepayment = defineAction({
  name: 'purchase_order_request_prepayment', label: '发起预付款申请', objectName: 'forge_purchase_order', icon: 'send-horizontal', locations: [...locations], order: 55,
  visible: `record.status == 'approved' || record.status == 'partially_arrived' || record.status == 'arrived' || record.status == 'completed'`, refreshAfter: true,
  params: [
    { field: 'code', objectOverride: 'forge_payment_task', required: true }, { field: 'requested_amount', objectOverride: 'forge_payment_task', required: true },
    { field: 'payment_method', objectOverride: 'forge_payment_task', required: true, defaultValue: 'bank_transfer' },
    { field: 'recipient_name', objectOverride: 'forge_payment_task', required: true }, { field: 'recipient_account', objectOverride: 'forge_payment_task', required: true },
    { field: 'recipient_bank', objectOverride: 'forge_payment_task' }, { field: 'planned_on', objectOverride: 'forge_payment_task', required: true },
    { field: 'remarks', objectOverride: 'forge_payment_task' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.finance/page_purchase_payment?task=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),order=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!order)throw new Error('采购订单不存在或不可访问');if(!actor)throw new Error('无法识别当前申请人');if(!['approved','partially_arrived','arrived','completed'].includes(order.status))throw new Error('仅已审核且未取消采购订单可以申请预付款');const amount=Number(ctx.input.requested_amount||0);if(!(amount>0))throw new Error('预付款申请金额必须大于0');const tasks=await ctx.api.object('forge_payment_task').find({where:{order_id:id}}),committed=tasks.filter(x=>x.source_type==='purchase_prepayment'&&x.status!=='rejected').reduce((sum,x)=>sum+Number(x.requested_amount||0),0),available=Math.round((Number(order.total_amount||0)-committed+Number.EPSILON)*10000)/10000;if(amount>available)throw new Error('预付款申请金额超过采购订单未预付金额');const recipient=String(ctx.input.recipient_name||'').trim(),account=String(ctx.input.recipient_account||'').trim();if(!recipient||!account)throw new Error('收款户名和收款账号不能为空');const payables=await ctx.api.object('forge_accounts_payable').find({where:{order_id:id}}),payableAmount=payables.filter(x=>['unpaid','partially_paid','overdue'].includes(x.status)).reduce((sum,x)=>sum+Number(x.outstanding_amount||0),0),created=await ctx.api.object('forge_payment_task').insert({name:order.code+' 预付款申请',code:ctx.input.code,source_type:'purchase_prepayment',payable_id:null,inbound_id:null,invoice_id:null,order_id:id,supplier_id:order.supplier_id,requested_amount:amount,payable_amount:payableAmount,paid_amount:0,remaining_amount:amount,payment_method:ctx.input.payment_method||order.payment_method||'bank_transfer',recipient_name:recipient,recipient_account:account,recipient_bank:ctx.input.recipient_bank||null,planned_on:ctx.input.planned_on,applicant_id:actor,approver_id:null,approved_at:null,approval_comment:null,status:'pending_review',responsible_id:order.responsible_id,remarks:ctx.input.remarks||null}),taskId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!taskId)throw new Error('预付款任务创建后未返回ID');return{id:taskId,order_id:id,status:'pending_review',requested_amount:amount,payable_amount:payableAmount,available_after:Math.round((available-amount+Number.EPSILON)*10000)/10000};
` },
});

export const SupplierPrepaymentOffsetPayable = defineAction({
  name: 'supplier_prepayment_offset_payable', label: '冲抵应付', objectName: 'forge_supplier_prepayment', icon: 'badge-check', locations: [...locations], order: 20,
  visible: `record.status == 'active' || record.status == 'partially_used'`, refreshAfter: true,
  params: [
    { field: 'code', objectOverride: 'forge_supplier_prepayment_offset', required: true },
    { field: 'payable_id', objectOverride: 'forge_supplier_prepayment_offset', required: true },
    { field: 'amount', objectOverride: 'forge_supplier_prepayment_offset', required: true },
    { field: 'offset_on', objectOverride: 'forge_supplier_prepayment_offset', required: true },
    { field: 'review_comment', objectOverride: 'forge_supplier_prepayment_offset', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),prepayment=ctx.record,actor=ctx.session&&ctx.session.userId,comment=String(ctx.input.review_comment||'').trim();if(ctx.recordLoadDenied===true||!id||!prepayment)throw new Error('预付款不存在或不可访问');if(!actor)throw new Error('无法识别当前核销人');if(!comment)throw new Error('核销意见不能为空');if(!['active','partially_used'].includes(prepayment.status)||!(Number(prepayment.balance_amount)>0))throw new Error('当前预付款没有可冲抵余额');const amount=Number(ctx.input.amount||0);if(!(amount>0))throw new Error('冲抵金额必须大于0');const refunds=await ctx.api.object('forge_supplier_refund').find({where:{prepayment_id:id}}),reserved=refunds.filter(x=>['pending_review','approved','pending_writeoff'].includes(x.document_status)).reduce((sum,x)=>sum+Number(x.requested_amount||0),0),available=Math.round((Number(prepayment.balance_amount||0)-reserved+Number.EPSILON)*10000)/10000;if(amount>available)throw new Error('冲抵金额超过扣除退款占用后的预付款余额');const payable=await ctx.api.object('forge_accounts_payable').findOne({where:{id:ctx.input.payable_id}});if(!payable||payable.supplier_id!==prepayment.supplier_id||!['unpaid','partially_paid','overdue'].includes(payable.status)||amount>Number(payable.outstanding_amount||0))throw new Error('应付账款无效、供应商不一致或冲抵金额超出余额');const round4=v=>Math.round((v+Number.EPSILON)*10000)/10000,nextOutstanding=round4(Number(payable.outstanding_amount||0)-amount),nextOffset=round4(Number(payable.offset_amount||0)+amount),nextBalance=round4(Number(prepayment.balance_amount||0)-amount),totalOffset=round4(Number(prepayment.offset_amount||0)+amount),nextStatus=nextBalance>0?'partially_used':'settled',created=await ctx.api.object('forge_supplier_prepayment_offset').insert({name:prepayment.code+' 冲抵 '+payable.code,code:ctx.input.code,prepayment_id:id,payable_id:payable.id,supplier_id:prepayment.supplier_id,amount,offset_on:ctx.input.offset_on,reviewer_id:actor,reviewed_at:new Date().toISOString(),review_comment:comment,status:'approved',responsible_id:prepayment.responsible_id,remarks:'预付款冲抵应付'}),offsetId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!offsetId)throw new Error('预付款冲抵记录创建后未返回ID');await ctx.api.object('forge_accounts_payable').update({id:payable.id,offset_amount:nextOffset,outstanding_amount:nextOutstanding,status:nextOutstanding>0?'partially_paid':'settled'});await ctx.api.object('forge_supplier_prepayment').update({id,offset_amount:totalOffset,balance_amount:nextBalance,status:nextStatus});return{id:offsetId,prepayment_id:id,payable_id:payable.id,amount,prepayment_balance:nextBalance,payable_outstanding:nextOutstanding,status:'approved'};
` },
});

export const SupplierPrepaymentRequestRefund = defineAction({
  name: 'supplier_prepayment_request_refund', label: '申请供应商退款', objectName: 'forge_supplier_prepayment', icon: 'undo-2', locations: [...locations], order: 30,
  visible: `record.status == 'active' || record.status == 'partially_used'`, refreshAfter: true,
  params: [
    { field: 'code', objectOverride: 'forge_supplier_refund', required: true }, { field: 'requested_amount', objectOverride: 'forge_supplier_refund', required: true },
    { field: 'refund_method', objectOverride: 'forge_supplier_refund', required: true, defaultValue: 'bank_transfer' },
    { field: 'application_on', objectOverride: 'forge_supplier_refund', required: true }, { field: 'reason', objectOverride: 'forge_supplier_refund', required: true },
    { field: 'remarks', objectOverride: 'forge_supplier_refund' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.finance/page_supplier_refund?refund=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),prepayment=ctx.record,actor=ctx.session&&ctx.session.userId,reason=String(ctx.input.reason||'').trim();if(ctx.recordLoadDenied===true||!id||!prepayment)throw new Error('预付款不存在或不可访问');if(!actor)throw new Error('无法识别当前申请人');if(!reason)throw new Error('退款原因不能为空');if(!['active','partially_used'].includes(prepayment.status)||!(Number(prepayment.balance_amount)>0))throw new Error('当前预付款没有可退款余额');const amount=Number(ctx.input.requested_amount||0);if(!(amount>0))throw new Error('申请退款金额必须大于0');const refunds=await ctx.api.object('forge_supplier_refund').find({where:{prepayment_id:id}}),reserved=refunds.filter(x=>['pending_review','approved','pending_writeoff'].includes(x.document_status)).reduce((sum,x)=>sum+Number(x.requested_amount||0),0),available=Math.round((Number(prepayment.balance_amount||0)-reserved+Number.EPSILON)*10000)/10000;if(amount>available)throw new Error('申请退款金额超过预付款可退款余额');const created=await ctx.api.object('forge_supplier_refund').insert({name:prepayment.code+' 供应商退款',code:ctx.input.code,prepayment_id:id,order_id:prepayment.order_id,supplier_id:prepayment.supplier_id,currency:'cny',requested_amount:amount,actual_amount:0,refund_method:ctx.input.refund_method||'bank_transfer',application_on:ctx.input.application_on,reason,document_status:'pending_review',finance_status:'pending',receipt_status:'pending',writeoff_status:'pending',account_id:null,bank_reference:null,applicant_id:actor,approver_id:null,approved_at:null,approval_comment:null,reviewer_id:null,reviewed_at:null,review_comment:null,responsible_id:prepayment.responsible_id,remarks:ctx.input.remarks||null}),refundId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!refundId)throw new Error('供应商退款申请创建后未返回ID');return{id:refundId,prepayment_id:id,requested_amount:amount,status:'pending_review',available_after:Math.round((available-amount+Number.EPSILON)*10000)/10000};
` },
});

export const SupplierRefundApprove = defineAction({
  name: 'supplier_refund_approve', label: '财务审批通过', objectName: 'forge_supplier_refund', icon: 'badge-check', locations: [...locations], order: 20,
  visible: `record.document_status == 'pending_review'`, refreshAfter: true,
  params: [{ field: 'approval_comment', objectOverride: 'forge_supplier_refund', required: true }],
  body: { language: 'js', capabilities: ['api.write'], source: `const id=ctx.recordId||(ctx.record&&ctx.record.id),refund=ctx.record,actor=ctx.session&&ctx.session.userId,comment=String(ctx.input.approval_comment||'').trim();if(ctx.recordLoadDenied===true||!id||!refund)throw new Error('供应商退款不存在或不可访问');if(!actor)throw new Error('无法识别当前审批人');if(!comment)throw new Error('审批意见不能为空');if(refund.document_status!=='pending_review')throw new Error('仅待审批退款可以审批');await ctx.api.object('forge_supplier_refund').update({id,document_status:'approved',finance_status:'approved',approver_id:actor,approved_at:new Date().toISOString(),approval_comment:comment});return{id,status:'approved'};` },
});

export const SupplierRefundReject = defineAction({
  name: 'supplier_refund_reject', label: '财务驳回', objectName: 'forge_supplier_refund', icon: 'circle-x', locations: [...locations], order: 30,
  visible: `record.document_status == 'pending_review'`, refreshAfter: true,
  params: [{ field: 'approval_comment', objectOverride: 'forge_supplier_refund', required: true }],
  body: { language: 'js', capabilities: ['api.write'], source: `const id=ctx.recordId||(ctx.record&&ctx.record.id),refund=ctx.record,actor=ctx.session&&ctx.session.userId,comment=String(ctx.input.approval_comment||'').trim();if(ctx.recordLoadDenied===true||!id||!refund)throw new Error('供应商退款不存在或不可访问');if(!actor)throw new Error('无法识别当前审批人');if(!comment)throw new Error('驳回意见不能为空');if(refund.document_status!=='pending_review')throw new Error('仅待审批退款可以驳回');await ctx.api.object('forge_supplier_refund').update({id,document_status:'rejected',finance_status:'rejected',approver_id:actor,approved_at:new Date().toISOString(),approval_comment:comment});return{id,status:'rejected'};` },
});

export const SupplierRefundRegisterReceipt = defineAction({
  name: 'supplier_refund_register_receipt', label: '登记供应商退款', objectName: 'forge_supplier_refund', icon: 'badge-dollar-sign', locations: [...locations], order: 40,
  visible: `record.document_status == 'approved' && record.receipt_status == 'pending'`, refreshAfter: true,
  params: [
    { field: 'account_id', objectOverride: 'forge_supplier_refund', required: true },
    { field: 'actual_amount', objectOverride: 'forge_supplier_refund', required: true },
    { field: 'bank_reference', objectOverride: 'forge_supplier_refund', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),refund=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!refund)throw new Error('供应商退款不存在或不可访问');if(!actor)throw new Error('无法识别当前登记人');if(refund.document_status!=='approved'||refund.finance_status!=='approved'||refund.receipt_status!=='pending')throw new Error('仅财务已审批且待收款的退款可以登记');const amount=Number(ctx.input.actual_amount||0);if(!(amount>0)||Math.abs(amount-Number(refund.requested_amount||0))>0.0001)throw new Error('实退金额必须等于审批金额');const account=await ctx.api.object('forge_fund_account').findOne({where:{id:ctx.input.account_id}});if(!account||account.status!=='active')throw new Error('收款账户不存在或未启用');const balance=account.current_balance==null?Number(account.opening_balance||0):Number(account.current_balance),nextBalance=Math.round((balance+amount+Number.EPSILON)*10000)/10000;await ctx.api.object('forge_fund_account').update({id:account.id,current_balance:nextBalance});await ctx.api.object('forge_supplier_refund').update({id,actual_amount:amount,account_id:account.id,bank_reference:ctx.input.bank_reference,receipt_status:'received',document_status:'pending_writeoff'});return{id,status:'pending_writeoff',actual_amount:amount,account_balance:nextBalance};
` },
});

export const SupplierRefundApproveWriteoff = defineAction({
  name: 'supplier_refund_approve_writeoff', label: '审核退款核销', objectName: 'forge_supplier_refund', icon: 'badge-check', locations: [...locations], order: 50,
  visible: `record.document_status == 'pending_writeoff' && record.receipt_status == 'received'`, refreshAfter: true,
  params: [{ field: 'review_comment', objectOverride: 'forge_supplier_refund', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),refund=ctx.record,actor=ctx.session&&ctx.session.userId,comment=String(ctx.input.review_comment||'').trim();if(ctx.recordLoadDenied===true||!id||!refund)throw new Error('供应商退款不存在或不可访问');if(!actor)throw new Error('无法识别当前核销人');if(!comment)throw new Error('核销意见不能为空');if(refund.document_status!=='pending_writeoff'||refund.receipt_status!=='received'||refund.writeoff_status!=='pending')throw new Error('仅已收款且待核销的退款可以审核');const prepayment=await ctx.api.object('forge_supplier_prepayment').findOne({where:{id:refund.prepayment_id}}),amount=Number(refund.actual_amount||0);if(!prepayment||!(amount>0)||amount>Number(prepayment.balance_amount||0)+0.0001)throw new Error('预付款余额不足以核销退款');const round4=v=>Math.round((v+Number.EPSILON)*10000)/10000,nextBalance=round4(Number(prepayment.balance_amount||0)-amount),refunded=round4(Number(prepayment.refunded_amount||0)+amount),nextStatus=nextBalance>0?'partially_used':(Number(prepayment.offset_amount||0)>0?'settled':'refunded'),now=new Date().toISOString();await ctx.api.object('forge_supplier_prepayment').update({id:prepayment.id,refunded_amount:refunded,balance_amount:nextBalance,status:nextStatus});await ctx.api.object('forge_supplier_refund').update({id,document_status:'completed',writeoff_status:'approved',reviewer_id:actor,reviewed_at:now,review_comment:comment});return{id,status:'completed',prepayment_id:prepayment.id,amount,prepayment_balance:nextBalance};
` },
});
