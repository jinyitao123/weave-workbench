import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const PurchaseInvoiceCertifyDeduction = defineAction({
  name: 'purchase_invoice_certify_deduction', label: '认证抵扣', objectName: 'forge_purchase_invoice', icon: 'badge-check',
  locations: [...locations], order: 40, visible: `record.status == 'normal' && record.deduction_status == 'pending'`, refreshAfter: true,
  params: [{ field: 'deduction_reason', objectOverride: 'forge_purchase_invoice' }],
  body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),invoice=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!invoice)throw new Error('进项发票不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(invoice.status!=='normal'||(invoice.deduction_status||'pending')!=='pending')throw new Error('仅正常且待认证的进项发票可以认证抵扣');if(!(Number(invoice.tax_rate)>0))throw new Error('零税率发票不能登记抵扣');const now=new Date().toISOString();await ctx.api.object('forge_purchase_invoice').update({id,deduction_status:'certified',deducted_at:now,deduction_operator_id:actor,deduction_reason:String(ctx.input.deduction_reason||'').trim()||'进项税额认证抵扣'});return{id,deduction_status:'certified',deducted_at:now};
` },
});

export const PurchaseInvoiceMarkNotDeductible = defineAction({
  name: 'purchase_invoice_mark_not_deductible', label: '标记不抵扣', objectName: 'forge_purchase_invoice', icon: 'circle-slash-2',
  locations: [...locations], order: 45, visible: `record.status == 'normal' && record.deduction_status == 'pending'`, refreshAfter: true,
  params: [{ field: 'deduction_reason', objectOverride: 'forge_purchase_invoice', required: true }],
  body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),invoice=ctx.record,actor=ctx.session&&ctx.session.userId,reason=String(ctx.input.deduction_reason||'').trim();if(ctx.recordLoadDenied===true||!id||!invoice)throw new Error('进项发票不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(!reason)throw new Error('不抵扣原因不能为空');if(invoice.status!=='normal'||(invoice.deduction_status||'pending')!=='pending')throw new Error('仅正常且待认证的进项发票可以标记不抵扣');const now=new Date().toISOString();await ctx.api.object('forge_purchase_invoice').update({id,deduction_status:'not_deductible',deducted_at:now,deduction_operator_id:actor,deduction_reason:reason});return{id,deduction_status:'not_deductible',deducted_at:now};
` },
});
