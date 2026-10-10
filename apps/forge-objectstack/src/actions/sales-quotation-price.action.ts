import { defineAction } from '@objectstack/spec';
import { salesPricingIdentity } from './sales-pricing.source.js';

/** Quote clerks use their existing capability to resolve a customer's effective price. */
export const SalesQuotationPriceResolve = defineAction({
  name: 'sales_quotation_price_resolve', label: '读取报价适用销售价格', objectName: 'forge_quotation', locations: [], requiredPermissions: ['sales_quotation_draft_create'],
  params: [{ name: 'customer_id', label: '客户', type: 'text', required: true }, { name: 'sku_id', label: '物料规格', type: 'text', required: true }, { name: 'date', label: '报价日期', type: 'text', required: true }],
  body: { language: 'js', capabilities: ['api.read'], timeoutMs: 30000, source: salesPricingIdentity + String.raw`
const customerId=text(params.customer_id),skuId=text(params.sku_id),date=text(params.date),instant=new Date(date+'T00:00:00Z');if(!customerId||!skuId||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(instant.getTime())||instant.toISOString().slice(0,10)!==date)throw new Error('客户、物料或报价日期无效');const customer=await api.object('forge_customer').findOne({where:{id:customerId,organization_id:org}});if(!customer||![customer.owner_id,customer.responsible_id].includes(actor))throw new Error('只能读取本人可办理客户的报价价格');const sku=await api.object('forge_material_sku').findOne({where:{id:skuId,organization_id:org}});if(!sku||sku.enabled===false)throw new Error('物料规格不可读取');const result=await currentPrice(org,sku,customerId,date);if(!result)throw new Error('物料尚未配置销售价格');return{...result,date};
` },
});
