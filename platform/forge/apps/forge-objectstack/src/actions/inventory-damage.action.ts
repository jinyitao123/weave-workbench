import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;
const action = (name: string, label: string, order: number, visible: string, source: string, successMessage: string) => defineAction({
  name, label, objectName: 'forge_inventory_damage', icon: 'file-warning', locations: [...locations], order,
  visible, refreshAfter: true, successMessage,
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source },
});

const context = `
const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!record)throw new Error('报损单不存在或不可访问');
if(!actor)throw new Error('无法识别当前操作人');
const round=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000;
const lines=await ctx.api.object('forge_inventory_damage_line').find({where:{damage_id:id}});
`;

export const InventoryDamageSubmit = action(
  'inventory_damage_submit', '提交审核', 10, `record.status == 'draft'`,
  `${context}
if(!record.warehouse_id)throw new Error('请选择报损仓库');
if(!record.damage_type_id)throw new Error('请选择报损类型');
if(!lines.length)throw new Error('请添加报损物料');
const seen=new Set();let total=0,amount=0;
for(const line of lines){if(!line.sku_id||!(Number(line.quantity)>0))throw new Error('报损明细的物料和数量必须完整');if(line.warehouse_id!==record.warehouse_id)throw new Error('报损明细仓库与报损单不一致');if(seen.has(line.sku_id))throw new Error('同一物料不能重复添加');seen.add(line.sku_id);const balances=await ctx.api.object('forge_inventory_balance').find({where:{balance_key:record.warehouse_id+':'+line.sku_id}});if(balances.length!==1)throw new Error('报损物料库存余额不存在或重复');if(Number(balances[0].available_quantity||0)<Number(line.quantity))throw new Error(line.name+' 可用库存不足');total=round(total+Number(line.quantity));amount=round(amount+Number(line.quantity)*Number(balances[0].average_cost||0));}
const now=new Date().toISOString();await ctx.api.object('forge_inventory_damage').update({id,line_count:lines.length,total_quantity:total,total_amount:amount,status:'pending_approval',submitted_at:now});for(const line of lines)await ctx.api.object('forge_inventory_damage_line').update({id:line.id,unit_cost:Number((await ctx.api.object('forge_inventory_balance').findOne({where:{balance_key:record.warehouse_id+':'+line.sku_id}})).average_cost||0),amount:round(Number(line.quantity)*Number((await ctx.api.object('forge_inventory_balance').findOne({where:{balance_key:record.warehouse_id+':'+line.sku_id}})).average_cost||0)),status:'pending_approval'});return{id,status:'pending_approval',line_count:lines.length,total_quantity:total,total_amount:amount};`,
  '报损单已提交审核',
);

export const InventoryDamageApprove = action(
  'inventory_damage_approve', '审核并扣库', 20, `record.status == 'pending_approval'`,
  `${context}
if(record.status!=='pending_approval')throw new Error('仅待审批报损单可以审核');if(!lines.length)throw new Error('报损单没有物料明细');
const balancesBySku={},requiredBySku={};for(const line of lines){requiredBySku[line.sku_id]=round(Number(requiredBySku[line.sku_id]||0)+Number(line.quantity||0));}
for(const skuId of Object.keys(requiredBySku)){const found=await ctx.api.object('forge_inventory_balance').find({where:{balance_key:record.warehouse_id+':'+skuId}});if(found.length!==1)throw new Error('报损物料库存余额不存在或重复');if(Number(found[0].available_quantity||0)<requiredBySku[skuId])throw new Error('可用库存不足，无法审核扣库');balancesBySku[skuId]=found[0];}
const now=new Date().toISOString(),note=String(ctx.input&&ctx.input.approval_note||'').trim();if(!note)throw new Error('请填写审批意见');let total=0,totalAmount=0;
for(const skuId of Object.keys(requiredBySku)){const balance=balancesBySku[skuId],qty=requiredBySku[skuId],before=Number(balance.on_hand_quantity||0),reserved=Number(balance.reserved_quantity||0),beforeAvailable=Number(balance.available_quantity||0),unit=Number(balance.average_cost||0),amount=round(qty*unit),after=round(before-qty),afterAvailable=round(after-reserved),afterValue=round(Math.max(0,Number(balance.inventory_value||0)-amount));await ctx.api.object('forge_inventory_balance').update({id:balance.id,on_hand_quantity:after,available_quantity:afterAvailable,inventory_value:afterValue,last_movement_at:now});total=round(total+qty);totalAmount=round(totalAmount+amount);}
let index=0;for(const line of lines){index+=1;const balance=balancesBySku[line.sku_id],unit=Number(balance.average_cost||0),lineAmount=round(Number(line.quantity)*unit),afterBalance=await ctx.api.object('forge_inventory_balance').findOne({where:{id:balance.id}});await ctx.api.object('forge_inventory_ledger').insert({name:record.code+' '+line.name+' 报损出库',code:record.code+'-'+String(index).padStart(3,'0'),warehouse_id:record.warehouse_id,sku_id:line.sku_id,direction:'outbound',movement_type:'damage_out',quantity:Number(line.quantity),before_on_hand:round(Number(afterBalance.on_hand_quantity)+requiredBySku[line.sku_id]),after_on_hand:Number(afterBalance.on_hand_quantity),before_available:round(Number(afterBalance.available_quantity)+requiredBySku[line.sku_id]),after_available:Number(afterBalance.available_quantity),unit_cost:unit,amount:lineAmount,occurred_at:now,source_object:'forge_inventory_damage',source_id:id,source_line_id:line.id,responsible_id:actor,remarks:record.remarks||note});await ctx.api.object('forge_inventory_damage_line').update({id:line.id,unit_cost:unit,amount:lineAmount,status:'completed'});}
await ctx.api.object('forge_inventory_damage').update({id,line_count:lines.length,total_quantity:total,total_amount:totalAmount,status:'completed',approved_by:actor,approved_at:now,approval_note:note});return{id,status:'completed',line_count:lines.length,total_quantity:total,total_amount:totalAmount};`,
  '报损审核完成，库存已扣减',
);

export const InventoryDamageReject = action(
  'inventory_damage_reject', '驳回报损单', 30, `record.status == 'pending_approval'`,
  `${context}const note=String(ctx.input&&ctx.input.approval_note||'').trim();if(!note)throw new Error('请填写驳回原因');const now=new Date().toISOString();await ctx.api.object('forge_inventory_damage').update({id,status:'rejected',approved_by:actor,approved_at:now,approval_note:note});for(const line of lines)await ctx.api.object('forge_inventory_damage_line').update({id:line.id,status:'rejected'});return{id,status:'rejected'};`,
  '报损单已驳回',
);

export const InventoryDamageVoid = action(
  'inventory_damage_void', '作废报损单', 40, `record.status == 'draft' || record.status == 'rejected'`,
  `${context}const reason=String(ctx.input&&ctx.input.void_reason||'').trim();if(!reason)throw new Error('请填写作废原因');if(!['draft','rejected'].includes(record.status))throw new Error('仅草稿或已驳回报损单可以作废');const now=new Date().toISOString();await ctx.api.object('forge_inventory_damage').update({id,status:'voided',void_reason:reason,voided_by:actor,voided_at:now});for(const line of lines)await ctx.api.object('forge_inventory_damage_line').update({id:line.id,status:'voided'});return{id,status:'voided'};`,
  '报损单已作废',
);
