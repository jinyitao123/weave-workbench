import { defineHook } from '@objectstack/spec/data';
export const SalesManagedFeeGuard = defineHook({
  name: 'sales_managed_fee_guard', object: 'forge_sales_additional_fee', events: ['beforeUpdate'], priority: 100,
  body: { language: 'js', capabilities: [], source: `
const current=ctx.previous;if(!current)throw new Error('无法确认费用单原状态');if(!current.request_key)return;
const protectedFields=['source_type','order_id','contract_id','shipment_id','customer_id','project_id','project_name','responsible_id','owner_id','bearing_type','fee_item','occurred_on','untaxed_amount','tax_amount','total_amount','settlement_type','expected_settlement_on','remarks'];
const amounts=new Set(['untaxed_amount','tax_amount','total_amount']);const changed=protectedFields.some(field=>Object.prototype.hasOwnProperty.call(ctx.input,field)&&(amounts.has(field)?Number(ctx.input[field])!==Number(current[field]):String(ctx.input[field]??'')!==String(current[field]??'')));
if(!changed)return;if(current.document_status!=='draft')throw new Error('已提交的费用单不能修改来源、金额或结算信息');
if(!ctx.input.save_receipts||Number(ctx.input.revision)!==Number(current.revision)+1)throw new Error('请从费用草稿页面保存完整明细，不能单独修改单头');
` },
});
