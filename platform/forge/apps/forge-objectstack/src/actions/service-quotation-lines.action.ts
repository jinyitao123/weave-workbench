import { defineAction } from '@objectstack/spec';
import { serviceQuotationLinesHelpersSource } from './service-quotation-lines.logic.js';

export const ServiceQuotationReadLines = defineAction({
  name: 'service_quotation_read_lines', label: '读取服务报价项目', objectName: 'forge_service_quotation', locations: [],
  requiredPermissions: ['forge_service_manager'],
  body: { language: 'js', capabilities: ['api.read'], source: `
${serviceQuotationLinesHelpersSource}
const id=String(ctx.recordId||ctx.record&&ctx.record.id||'').trim(),actor=String(ctx.session&&ctx.session.userId||'').trim(),org=String(ctx.session&&ctx.session.organizationId||ctx.user&&ctx.user.organizationId||'').trim();
if(ctx.recordLoadDenied===true||!id||!ctx.record||String(ctx.record.id||'')!==id||!actor||!org||String(ctx.record.organization_id||'')!==org)throw new Error('当前服务报价不存在或不可访问');
if(ctx.user&&ctx.user.id!=null&&String(ctx.user.id)!==actor)throw new Error('当前员工身份不一致');
if(ctx.user&&ctx.user.organizationId!=null&&String(ctx.user.organizationId)!==org)throw new Error('当前组织身份不一致');
const current=await ctx.api.object('forge_service_quotation').findOne({where:{id,organization_id:org}});
if(!current||String(current.organization_id||'')!==org||Number(current.revision??1)!==Number(ctx.record.revision??1))throw new Error('服务报价已变化，请重新打开核对');
const lines=await ctx.api.object('forge_service_quotation_line').find({where:{quotation_id:id,organization_id:org},limit:501,orderBy:[{field:'sort_order',order:'asc'}]});
if(!Array.isArray(lines)||lines.length>500)throw new Error('报价项目读取不完整');
if(Number(current.item_count||0)!==lines.length)throw new Error('报价项目合计不完整');
if(lines.length&&[current.subtotal,current.discount_amount,current.total_amount].some(value=>value==null||value===''||!Number.isFinite(Number(value))||Number(value)<0))throw new Error('报价项目合计不可用');
const rows=lines.map(row=>{
  if(String(row.quotation_id||'')!==id||String(row.organization_id||'')!==org||!['service','part'].includes(row.line_type)||!row.name||!row.unit_name||[row.quantity,row.taxed_unit_price,row.line_amount].some(value=>value==null||value===''||!Number.isFinite(Number(value))||Number(value)<0))throw new Error('报价项目范围或数据不完整');
  return{id:String(row.id),line_type:row.line_type,item_id:row.line_type==='service'?row.service_item_id:row.sku_id,name:row.name,item_code:row.item_code,description:row.description||'',unit_name:row.unit_name,quantity:row.quantity,taxed_unit_price:row.taxed_unit_price,line_amount:row.line_amount,sort_order:row.sort_order};
});
if(rows.length){
  const date=current.valid_until instanceof Date?current.valid_until.toISOString().slice(0,10):String(current.valid_until||'').slice(0,10);
  const checked=normalizeServiceQuotationDraft(JSON.stringify({valid_until:date,remarks:current.remarks||'',pricing_mode:current.pricing_mode,payment_mode:current.payment_mode,discount_rate:current.discount_rate,lines:rows.map(row=>({id:row.id,line_type:row.line_type,item_id:row.item_id,description:row.description,unit_name:row.unit_name,quantity:row.quantity,taxed_unit_price:row.taxed_unit_price}))}));
  if(checked.subtotal!==Number(current.subtotal)||checked.discount_amount!==Number(current.discount_amount)||checked.total_amount!==Number(current.total_amount)||checked.lines.some((row,index)=>row.line_amount!==Number(rows[index].line_amount)))throw new Error('报价项目与合计不一致');
}
const after=await ctx.api.object('forge_service_quotation').findOne({where:{id,organization_id:org}});
if(!after||Number(after.revision??1)!==Number(current.revision??1))throw new Error('服务报价已变化，请重新打开核对');
return{quotation_id:id,lines:rows,revision:current.revision==null?1:Number(current.revision),pricing_mode:current.pricing_mode||'',payment_mode:current.payment_mode||'',discount_rate:current.discount_rate==null?0:Number(current.discount_rate),subtotal:current.subtotal,discount_amount:current.discount_amount,total_amount:current.total_amount};
` },
});
