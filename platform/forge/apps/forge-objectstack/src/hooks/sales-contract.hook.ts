import { defineHook } from '@objectstack/spec/data';

/** Drafts may have no agreed signing or effective dates. The native record
 * editor sends a cleared date as an empty string, which PostgreSQL rejects. */
export const SalesContractEmptyDates = defineHook({
  name: 'sales_contract_empty_dates',
  object: 'forge_sales_contract',
  events: ['beforeInsert', 'beforeUpdate'],
  priority: 90,
  description: '空白合同日期按未确定保存，避免把界面清空操作当作无效日期。',
  body: {
    language: 'js',
    capabilities: [],
    source: `
for (const field of ['signed_on', 'starts_on', 'ends_on']) {
  if (ctx.input[field] === '') ctx.input[field] = null;
}
`,
  },
});

/**
 * A contract line may only reference a currently selectable SKU. This hook
 * protects every insert path, including the custom contract form's Data API
 * writes and quotation-to-contract conversion.
 */
export const SalesContractLineSkuGuard = defineHook({
  name: 'sales_contract_line_sku_guard',
  object: 'forge_sales_contract_line',
  events: ['beforeInsert'],
  priority: 100,
  description: '新建合同物料明细时，拒绝停用或不可用的物料规格。',
  body: {
    language: 'js',
    capabilities: ['api.read'],
    source: `
const skuId = String(ctx.input.sku_id || '').trim();
if (!skuId) throw new Error('合同物料必须选择可用的物料规格');
const organizationId = String(
  (ctx.user && ctx.user.organizationId) ||
  (ctx.session && ctx.session.organizationId) ||
  '',
).trim();
if (!organizationId) throw new Error('无法确认当前销售组织，请重新登录后再试');
const belongsToOrganization = row => row && String(row.organization_id || '') === organizationId;
const sku = await ctx.api.object('forge_material_sku').findOne({ where: { id: skuId } });
if (!belongsToOrganization(sku) || sku.enabled === false) {
  throw new Error('所选物料规格不存在、已停用或不属于当前组织');
}
const material = await ctx.api.object('forge_material').findOne({ where: { id: sku.material_id } });
if (!belongsToOrganization(material) || material.status === 'inactive') {
  throw new Error('所选物料不存在、已停用或不属于当前组织');
}
const unit = material.unit_id
  ? await ctx.api.object('forge_unit').findOne({ where: { id: material.unit_id } })
  : null;
if (!belongsToOrganization(unit) || unit.status === 'inactive') {
  throw new Error('所选物料的计量单位不可用');
}
`,
  },
});
