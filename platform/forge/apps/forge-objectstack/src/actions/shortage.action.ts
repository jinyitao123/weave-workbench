import { defineAction } from '@objectstack/spec';

export const BomAnalyzeShortage = defineAction({
  name: 'bom_analyze_shortage', label: '开始分析', objectName: 'forge_bom', icon: 'chart-no-axes-column-increasing',
  locations: ['record_header', 'record_more'], order: 40, visible: `record.status == 'active'`, refreshAfter: true,
  params: [{ name: 'planned_quantity', label: '计划生产数量', type: 'number', required: true, defaultValue: 1 }],
  description: '按计划生产数量展开当前 BOM，汇总各仓库库存与锁定量，保存可追溯的缺料快照。', successMessage: '缺料分析已完成',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id); const bom=ctx.record;
if(ctx.recordLoadDenied===true||!id||!bom) throw new Error('当前BOM不存在或不可访问');
if(bom.status!=='active') throw new Error('仅已生效BOM可以进行缺料分析');
const planned=Number(ctx.input.planned_quantity); if(!(planned>0)) throw new Error('计划生产数量必须大于0');
const actor=ctx.session&&ctx.session.userId; if(!actor) throw new Error('无法识别当前操作人');
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
const round2=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const nodes=await ctx.api.object('forge_bom_node').find({where:{bom_id:id}});
const components=nodes.filter(node=>node.parent_id&&node.sku_id);
if(!components.length) throw new Error('BOM没有可分析的物料子项');
const rows=[]; let totalRequired=0,totalFulfilled=0,purchaseAmount=0,maxProducible=null;
for(const node of components){
  const sku=await ctx.api.object('forge_material_sku').findOne({where:{id:node.sku_id}}); if(!sku) throw new Error('BOM包含不存在的物料规格');
  const material=await ctx.api.object('forge_material').findOne({where:{id:sku.material_id}}); if(!material) throw new Error('物料规格缺少物料主数据');
  const unit=material.unit_id?await ctx.api.object('forge_unit').findOne({where:{id:material.unit_id}}):null;
  const balances=await ctx.api.object('forge_inventory_balance').find({where:{sku_id:sku.id}});
  const onHand=round4(balances.reduce((sum,item)=>sum+Number(item.on_hand_quantity||0),0));
  const reserved=round4(balances.reduce((sum,item)=>sum+Number(item.reserved_quantity||0),0));
  const available=round4(balances.reduce((sum,item)=>sum+Number(item.available_quantity||0),0));
  const perUnit=Number(node.quantity||0); const required=round4(perUnit*planned); const virtual=material.source_type==='virtual';
  const shortage=virtual?0:round4(Math.max(0,required-available)); const fulfilled=virtual?required:Math.min(required,available);
  const untaxed=round4(Number(sku.cost_price||0)/(1+Number(bom.tax_rate||13)/100)); const subtotal=round4(shortage*untaxed);
  totalRequired+=required; totalFulfilled+=fulfilled; if(material.source_type==='purchased') purchaseAmount+=subtotal;
  if(!virtual&&perUnit>0){const producible=Math.floor(available/perUnit); maxProducible=maxProducible===null?producible:Math.min(maxProducible,producible);}
  rows.push({node,sku,material,unit,onHand,reserved,available,perUnit,required,shortage,untaxed,subtotal});
}
const shortageCount=rows.filter(row=>row.shortage>0).length; const kitRate=totalRequired>0?round2(totalFulfilled/totalRequired*100):100;
const now=new Date().toISOString(); const stamp=Date.now();
const purchaseTotal=round2(purchaseAmount);
const created=await ctx.api.object('forge_bom_shortage_analysis').insert({name:bom.name+' 缺料分析',code:bom.code+'-MRP-'+stamp,bom_id:id,project_id:bom.project_id||null,planned_quantity:planned,component_count:rows.length,shortage_count:shortageCount,kit_rate:kitRate,max_producible_quantity:maxProducible===null?0:maxProducible,estimated_purchase_amount:purchaseTotal,analyzed_at:now,analyzed_by:actor,status:'completed'});
const analysisId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id)); if(!analysisId) throw new Error('缺料分析未返回记录ID');
for(const row of rows) await ctx.api.object('forge_bom_shortage_line').insert({name:row.material.name,analysis_id:analysisId,bom_id:id,bom_node_id:row.node.id,sku_id:row.sku.id,material_id:row.material.id,item_code:row.material.code,specification:row.sku.name,model:row.material.model,unit_name:row.unit?row.unit.name:null,source_type:row.material.source_type,required_per_unit:row.perUnit,total_required:row.required,on_hand_quantity:row.onHand,reserved_quantity:row.reserved,available_quantity:row.available,shortage_quantity:row.shortage,supplier_id:row.material.supplier_id||null,untaxed_unit_price:row.untaxed,subtotal:row.subtotal,fulfillment_status:row.shortage>0?'shortage':'sufficient'});
return {id:analysisId,bom_id:id,planned_quantity:planned,component_count:rows.length,shortage_count:shortageCount,kit_rate:kitRate,max_producible_quantity:maxProducible===null?0:maxProducible,estimated_purchase_amount:purchaseTotal,analyzed_at:now};
` },
});
