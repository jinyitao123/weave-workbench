import { defineAction } from "@objectstack/spec";

const locations = ["record_header", "record_more"] as const;
const base = (
  name: string,
  label: string,
  order: number,
  visible: string,
  source: string,
  successMessage: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any[],
) =>
  defineAction({
    name,
    label,
    objectName: "forge_inventory_operation",
    icon: "check-circle",
    locations: [...locations],
    order,
    visible,
    refreshAfter: true,
    successMessage,
    ...(params ? { params } : {}),
    body: { language: "js", capabilities: ["api.read", "api.write"], source },
  });

const helpers = `
const id=ctx.recordId||(ctx.record&&ctx.record.id),op=ctx.record,actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!op)throw new Error('库存作业单不存在或不可访问');
if(!actor)throw new Error('无法识别当前操作人');
const round=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000;
const balances=await ctx.api.object('forge_inventory_balance').find({where:{balance_key:op.source_warehouse_id+':'+op.sku_id}});
if(balances.length!==1)throw new Error('所在仓库库存余额不存在或重复');
const balance=balances[0],qty=Number(op.quantity||0),now=new Date().toISOString();
if(!(qty>0))throw new Error('作业数量必须大于0');
`;

export const InventoryLockActivate = base(
  "inventory_lock_activate",
  "确认锁库",
  10,
  "record.operation_type == 'lock' && record.status == 'draft'",
  `${helpers}
if(Number(balance.available_quantity||0)<qty)throw new Error('可用库存不足，无法锁定');
const reserved=round(Number(balance.reserved_quantity||0)+qty),available=round(Number(balance.on_hand_quantity||0)-reserved);
const beforeAvailable=Number(balance.available_quantity||0),unit=Number(balance.average_cost||0),amount=round(qty*unit);
await ctx.api.object('forge_inventory_balance').update({id:balance.id,reserved_quantity:reserved,available_quantity:available,last_movement_at:now});
await ctx.api.object('forge_inventory_ledger').insert({name:op.code+' 库存锁定',code:op.code+'-LOCK',warehouse_id:op.source_warehouse_id,sku_id:op.sku_id,direction:'outbound',movement_type:'inventory_lock',quantity:qty,before_on_hand:Number(balance.on_hand_quantity||0),after_on_hand:Number(balance.on_hand_quantity||0),before_available:beforeAvailable,after_available:available,unit_cost:unit,amount,occurred_at:now,source_object:'forge_inventory_operation',source_id:id,responsible_id:actor,remarks:op.reason});
await ctx.api.object('forge_inventory_operation').update({id,unit_cost:unit,amount,status:'active',approved_by:actor,completed_at:now});
return{id,status:'active',reserved_quantity:reserved,available_quantity:available};
`,
  "库存已锁定",
);

export const InventoryLockRenew = base(
  "inventory_lock_renew",
  "申请续期",
  30,
  "record.operation_type == 'lock' && (record.status == 'draft' || record.status == 'active')",
  `${helpers}
const days=Number(ctx.input.renew_days||7);if(!(days>0)||days>365)throw new Error('续期天数必须在 1-365 之间');
const currentDue=op.due_at?new Date(op.due_at):new Date(Date.now()),baseDate=currentDue.getTime()>Date.now()?currentDue:new Date(Date.now()),nextDue=new Date(baseDate.getTime()+days*86400000);
await ctx.api.object('forge_inventory_operation').update({id,due_at:nextDue.toISOString()});
await ctx.api.object('forge_inventory_ledger').insert({name:op.code+' 锁定续期',code:op.code+'-RENEW-'+String(Date.now()).slice(-6),warehouse_id:op.source_warehouse_id,sku_id:op.sku_id,direction:'inbound',movement_type:'inventory_lock',quantity:0,before_on_hand:Number(balance.on_hand_quantity||0),after_on_hand:Number(balance.on_hand_quantity||0),before_available:Number(balance.available_quantity||0),after_available:Number(balance.available_quantity||0),unit_cost:0,amount:0,occurred_at:now,source_object:'forge_inventory_operation',source_id:id,responsible_id:actor,remarks:'锁定续期 '+days+' 天，到期 '+nextDue.toISOString().slice(0,10)+(String(ctx.input.renew_reason||'').trim()?'：'+String(ctx.input.renew_reason).trim():'')});
return{id,due_at:nextDue.toISOString(),status:op.status};
`,
  "锁定已续期",
  [
    { name: "renew_days", label: "续期天数", type: "text", required: true },
    { name: "renew_reason", label: "续期原因", type: "text" },
  ],
);

export const InventoryLockVoid = base(
  "inventory_lock_void",
  "作废锁定单",
  40,
  "record.operation_type == 'lock' && (record.status == 'draft' || record.status == 'pending_approval' || record.status == 'active')",
  `${helpers}
const reason=String(ctx.input.void_reason||'').trim();if(!reason)throw new Error('请填写作废原因');
if(op.status==='active'){const remaining=round(qty-Number(op.released_quantity||0));
if(remaining>0){const reserved=round(Number(balance.reserved_quantity||0)-remaining),available=round(Number(balance.on_hand_quantity||0)-reserved);
await ctx.api.object('forge_inventory_balance').update({id:balance.id,reserved_quantity:Math.max(0,reserved),available_quantity:available,last_movement_at:now});
await ctx.api.object('forge_inventory_ledger').insert({name:op.code+' 锁定作废释放',code:op.code+'-VOID',warehouse_id:op.source_warehouse_id,sku_id:op.sku_id,direction:'inbound',movement_type:'inventory_release',quantity:remaining,before_on_hand:Number(balance.on_hand_quantity||0),after_on_hand:Number(balance.on_hand_quantity||0),before_available:Number(balance.available_quantity||0),after_available:available,unit_cost:Number(op.unit_cost||0),amount:round(remaining*Number(op.unit_cost||0)),occurred_at:now,source_object:'forge_inventory_operation',source_id:id,responsible_id:actor,remarks:'锁定作废：'+reason});
await ctx.api.object('forge_inventory_operation').update({id,released_quantity:Number(op.released_quantity||0)+remaining});}}
await ctx.api.object('forge_inventory_operation').update({id,status:'voided',remarks:(op.remarks?op.remarks+' / ':'')+'作废原因：'+reason});
return{id,status:'voided'};
`,
  "锁定单已作废",
  [{ name: "void_reason", label: "作废原因", type: "text", required: true }],
);

export const InventoryLockRelease = base(
  "inventory_lock_release",
  "释放库存",
  20,
  "record.operation_type == 'lock' && record.status == 'active'",
  `${helpers}
const remaining=round(qty-Number(op.released_quantity||0));if(!(remaining>0))throw new Error('该锁定已全部释放');const releaseReason=String(ctx.input.release_reason||'').trim();if(!releaseReason)throw new Error('请填写释放原因');
if(Number(balance.reserved_quantity||0)<remaining)throw new Error('当前锁定余额不足，请刷新后重试');
const reserved=round(Number(balance.reserved_quantity||0)-remaining),available=round(Number(balance.on_hand_quantity||0)-reserved);
const beforeAvailable=Number(balance.available_quantity||0),unit=Number(op.unit_cost||balance.average_cost||0),amount=round(remaining*unit);
await ctx.api.object('forge_inventory_balance').update({id:balance.id,reserved_quantity:reserved,available_quantity:available,last_movement_at:now});
await ctx.api.object('forge_inventory_ledger').insert({name:op.code+' 锁定释放',code:op.code+'-RELEASE',warehouse_id:op.source_warehouse_id,sku_id:op.sku_id,direction:'inbound',movement_type:'inventory_release',quantity:remaining,before_on_hand:Number(balance.on_hand_quantity||0),after_on_hand:Number(balance.on_hand_quantity||0),before_available:beforeAvailable,after_available:available,unit_cost:unit,amount,occurred_at:now,source_object:'forge_inventory_operation',source_id:id,responsible_id:actor,remarks:'释放原因：'+releaseReason});
await ctx.api.object('forge_inventory_operation').update({id,released_quantity:qty,status:'released',completed_at:now});
return{id,status:'released',released_quantity:qty,reserved_quantity:reserved};
`,
  "库存锁定已释放",
  [{ name: "release_reason", label: "释放原因", type: "text", required: true }],
);

export const InventoryCountComplete = base(
  "inventory_count_complete",
  "完成盘点",
  30,
  "record.operation_type == 'count' && record.status == 'draft'",
  `${helpers}
const actual=Number(op.actual_quantity);if(!(actual>=0))throw new Error('实盘数量不能为空且不能小于0');
const before=Number(balance.on_hand_quantity||0),reserved=Number(balance.reserved_quantity||0),delta=round(actual-before);
if(actual<reserved)throw new Error('实盘数量不能小于当前锁定数量');
const beforeAvailable=Number(balance.available_quantity||0),afterAvailable=round(actual-reserved),unit=Number(balance.average_cost||0),amount=round(Math.abs(delta)*unit),value=round(actual*unit);
await ctx.api.object('forge_inventory_balance').update({id:balance.id,on_hand_quantity:actual,available_quantity:afterAvailable,inventory_value:value,last_movement_at:now});
if(delta!==0)await ctx.api.object('forge_inventory_ledger').insert({name:op.code+' 盘点调整',code:op.code+'-001',warehouse_id:op.source_warehouse_id,sku_id:op.sku_id,direction:delta>0?'inbound':'outbound',movement_type:delta>0?'count_gain':'count_loss',quantity:Math.abs(delta),before_on_hand:before,after_on_hand:actual,before_available:beforeAvailable,after_available:afterAvailable,unit_cost:unit,amount,occurred_at:now,source_object:'forge_inventory_operation',source_id:id,responsible_id:actor,remarks:op.reason});
await ctx.api.object('forge_inventory_operation').update({id,system_quantity:before,variance_quantity:delta,unit_cost:unit,amount,status:'completed',approved_by:actor,completed_at:now});
return{id,status:'completed',system_quantity:before,actual_quantity:actual,variance_quantity:delta};
`,
  "盘点已完成并更新库存",
);

export const InventoryOperationSubmit = base(
  "inventory_operation_submit",
  "提交审批",
  40,
  "record.status == 'draft' && (record.operation_type == 'transfer' || record.operation_type == 'loan' || record.operation_type == 'damage')",
  `${helpers}
if(op.operation_type==='transfer'&&(!op.target_warehouse_id||op.target_warehouse_id===op.source_warehouse_id))throw new Error('调拨必须选择不同的接收仓库');
if(op.operation_type==='loan'&&!String(op.counterpart||'').trim())throw new Error('借出必须填写借用方');
if(Number(balance.available_quantity||0)<qty)throw new Error('可用库存不足，无法提交');
await ctx.api.object('forge_inventory_operation').update({id,status:'pending_approval'});return{id,status:'pending_approval'};
`,
  "库存作业已提交审批",
);

export const InventoryOperationApprove = base(
  "inventory_operation_approve",
  "审批并执行",
  50,
  "record.status == 'pending_approval'",
  `${helpers}
if(!['transfer','loan','damage'].includes(op.operation_type))throw new Error('当前作业类型不能执行该动作');
if(Number(balance.available_quantity||0)<qty)throw new Error('可用库存不足，无法执行');
let target=null,targets=[];if(op.operation_type==='transfer'){const key=op.target_warehouse_id+':'+op.sku_id;targets=await ctx.api.object('forge_inventory_balance').find({where:{balance_key:key}});if(targets.length>1)throw new Error('接收仓库库存余额重复');target=targets[0]||null;}
const before=Number(balance.on_hand_quantity||0),beforeAvailable=Number(balance.available_quantity||0),reserved=Number(balance.reserved_quantity||0),unit=Number(balance.average_cost||0),amount=round(qty*unit),after=round(before-qty),afterAvailable=round(after-reserved),afterValue=round(Math.max(0,Number(balance.inventory_value||0)-amount));
await ctx.api.object('forge_inventory_balance').update({id:balance.id,on_hand_quantity:after,available_quantity:afterAvailable,inventory_value:afterValue,last_movement_at:now});
const outType=op.operation_type==='transfer'?'transfer_out':op.operation_type==='loan'?'loan_out':'damage_out';
await ctx.api.object('forge_inventory_ledger').insert({name:op.code+' '+op.name+' 出库',code:op.code+'-OUT',warehouse_id:op.source_warehouse_id,sku_id:op.sku_id,direction:'outbound',movement_type:outType,quantity:qty,before_on_hand:before,after_on_hand:after,before_available:beforeAvailable,after_available:afterAvailable,unit_cost:unit,amount,occurred_at:now,source_object:'forge_inventory_operation',source_id:id,responsible_id:actor,remarks:op.reason});
if(op.operation_type==='transfer'){
 const key=op.target_warehouse_id+':'+op.sku_id,tBefore=Number(target&&target.on_hand_quantity||0),tReserved=Number(target&&target.reserved_quantity||0),tAvail=Number(target&&target.available_quantity||0),tValue=Number(target&&target.inventory_value||0),tAfter=round(tBefore+qty),tAfterAvail=round(tAfter-tReserved),tAfterValue=round(tValue+amount),tAvg=tAfter>0?round(tAfterValue/tAfter):0;
 if(target)await ctx.api.object('forge_inventory_balance').update({id:target.id,on_hand_quantity:tAfter,available_quantity:tAfterAvail,average_cost:tAvg,inventory_value:tAfterValue,last_movement_at:now});else await ctx.api.object('forge_inventory_balance').insert({name:op.code+' 调拨入库',balance_key:key,warehouse_id:op.target_warehouse_id,sku_id:op.sku_id,on_hand_quantity:tAfter,reserved_quantity:0,available_quantity:tAfterAvail,average_cost:unit,inventory_value:tAfterValue,last_movement_at:now,remarks:'由调拨单 '+op.code+' 建立'});
 await ctx.api.object('forge_inventory_ledger').insert({name:op.code+' '+op.name+' 入库',code:op.code+'-IN',warehouse_id:op.target_warehouse_id,sku_id:op.sku_id,direction:'inbound',movement_type:'transfer_in',quantity:qty,before_on_hand:tBefore,after_on_hand:tAfter,before_available:tAvail,after_available:tAfterAvail,unit_cost:unit,amount,occurred_at:now,source_object:'forge_inventory_operation',source_id:id,responsible_id:actor,remarks:op.reason});
}
await ctx.api.object('forge_inventory_operation').update({id,unit_cost:unit,amount,status:op.operation_type==='loan'?'active':'completed',approved_by:actor,completed_at:now});
return{id,status:op.operation_type==='loan'?'active':'completed',quantity:qty,amount};
`,
  "库存作业已审批并执行",
);

export const InventoryLoanReturn = base(
  "inventory_loan_return",
  "确认归还",
  60,
  "record.operation_type == 'loan' && record.status == 'active'",
  `${helpers}
const remaining=round(qty-Number(op.released_quantity||0));if(!(remaining>0))throw new Error('借出物料已全部归还');
const before=Number(balance.on_hand_quantity||0),reserved=Number(balance.reserved_quantity||0),beforeAvailable=Number(balance.available_quantity||0),unit=Number(op.unit_cost||balance.average_cost||0),amount=round(remaining*unit),after=round(before+remaining),afterAvailable=round(after-reserved),afterValue=round(Number(balance.inventory_value||0)+amount),average=after>0?round(afterValue/after):0;
await ctx.api.object('forge_inventory_balance').update({id:balance.id,on_hand_quantity:after,available_quantity:afterAvailable,average_cost:average,inventory_value:afterValue,last_movement_at:now});
await ctx.api.object('forge_inventory_ledger').insert({name:op.code+' 借出归还',code:op.code+'-RETURN',warehouse_id:op.source_warehouse_id,sku_id:op.sku_id,direction:'inbound',movement_type:'loan_return',quantity:remaining,before_on_hand:before,after_on_hand:after,before_available:beforeAvailable,after_available:afterAvailable,unit_cost:unit,amount,occurred_at:now,source_object:'forge_inventory_operation',source_id:id,responsible_id:actor,remarks:op.reason});
await ctx.api.object('forge_inventory_operation').update({id,released_quantity:qty,status:'returned',completed_at:now});return{id,status:'returned',returned_quantity:qty};
`,
  "借出物料已归还",
);

export const InventorySerialVerify = defineAction({
  name: "inventory_serial_verify",
  label: "验证SN码",
  objectName: "forge_inventory_serial_number",
  icon: "scan-line",
  locations: [...locations],
  order: 10,
  refreshAfter: true,
  successMessage: "SN码验证完成",
  body: {
    language: "js",
    capabilities: ["api.read", "api.write"],
    source: `const id=ctx.recordId||(ctx.record&&ctx.record.id),row=ctx.record;if(ctx.recordLoadDenied===true||!id||!row)throw new Error('SN码记录不存在或不可访问');const now=new Date().toISOString();await ctx.api.object('forge_inventory_serial_number').update({id,verified_at:now});return{id,status:row.status,verified_at:now};`,
  },
});
