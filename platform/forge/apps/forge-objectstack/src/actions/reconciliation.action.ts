import { defineAction } from '@objectstack/spec/ui';

const locations = ['record_header', 'record_more'] as const;

const generationSource = (partyType: 'customer' | 'supplier') => `
const partyId=ctx.recordId||(ctx.record&&ctx.record.id),party=ctx.record,actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!partyId||!party)throw new Error('${partyType === 'customer' ? '客户' : '供应商'}不存在或不可访问');
if(!actor)throw new Error('无法识别当前制单人');
const start=String(ctx.input.period_start||''),end=String(ctx.input.period_end||''),dimension=ctx.input.dimension||'balance',basis=ctx.input.basis||'balance',includePrepayment=ctx.input.include_prepayment!==false;
if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(start)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(end)||end<start)throw new Error('对账期间无效');
const today=new Date().toISOString().slice(0,10);if(end>=today)throw new Error('对账期间尚未结束，仅能生成结束日期早于今天的对账单');
if(!['party','contract','order','shipment_receipt','invoice','cash','balance'].includes(dimension)||basis!=='balance')throw new Error('对账维度或生成口径无效');
if(ctx.input.audited_only===false)throw new Error('当前切片仅支持已审核业务口径');
const round4=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000,entries=[],requestedKeys=Array.isArray(ctx.input.source_keys)?ctx.input.source_keys.map(String):String(ctx.input.source_keys||'').split(',').map(x=>x.trim()).filter(Boolean);
${partyType === 'customer' ? `
const charges=(await ctx.api.object('forge_accounts_receivable').find({where:{customer_id:partyId}})).filter(x=>x.status!=='red_reversed');
const settlements=(await ctx.api.object('forge_collection_allocation').find({where:{customer_id:partyId}})).filter(x=>x.status==='approved');
const offsets=includePrepayment?(await ctx.api.object('forge_customer_prepayment_offset').find({where:{customer_id:partyId}})).filter(x=>x.status==='approved'):[];
for(const x of charges){const outbound=(await ctx.api.object('forge_sales_outbound').find({where:{order_id:x.order_id}}))[0];entries.push({date:String(x.recognized_on||''),type:'receivable',direction:'increase',sourceKey:'receivable:'+x.id,receivable_id:x.id,contract_id:x.contract_id||null,order_id:x.order_id||null,invoice_id:x.invoice_id||null,contract_key:x.contract_id||'',order_key:x.order_id||'',shipment_key:outbound&&outbound.id||'',invoice_key:x.invoice_id||'',cash_key:'',amount:round4(Number(x.original_amount||0)-Number(x.red_reversed_amount||0)),description:'应收 '+x.code});}
for(const x of settlements){const receipt=await ctx.api.object('forge_cash_receipt').findOne({where:{id:x.receipt_id}}),outbound=(await ctx.api.object('forge_sales_outbound').find({where:{order_id:x.order_id}}))[0];entries.push({date:String(x.allocated_on||''),type:'collection',direction:'decrease',sourceKey:'collection:'+x.id,collection_id:x.id,contract_id:x.contract_id||null,order_id:x.order_id||null,invoice_id:x.invoice_id||null,cash_receipt_id:x.receipt_id||null,contract_key:x.contract_id||'',order_key:x.order_id||'',shipment_key:outbound&&outbound.id||'',invoice_key:x.invoice_id||'',cash_key:receipt&&receipt.id||'',amount:Number(x.amount||0),description:'收款核销 '+x.code});}
for(const x of offsets)entries.push({date:String(x.offset_on||''),type:'customer_prepayment_offset',direction:'decrease',sourceKey:'customer-offset:'+x.id,contract_key:x.contract_id||'',order_key:x.order_id||'',shipment_key:'',invoice_key:x.invoice_id||'',cash_key:'prepayment:'+x.prepayment_id,amount:Number(x.amount||0),description:'客户预收冲抵 '+x.code});
` : `
const charges=(await ctx.api.object('forge_accounts_payable').find({where:{supplier_id:partyId}})).filter(x=>x.status!=='red_reversed');
const settlements=(await ctx.api.object('forge_payment_writeoff').find({where:{supplier_id:partyId}})).filter(x=>x.status==='approved');
const offsets=includePrepayment?(await ctx.api.object('forge_supplier_prepayment_offset').find({where:{supplier_id:partyId}})).filter(x=>x.status==='approved'):[];
for(const x of charges)entries.push({date:String(x.recognized_on||''),type:'payable',direction:'increase',sourceKey:'payable:'+x.id,payable_id:x.id,contract_key:'',order_key:x.order_id||'',shipment_key:x.inbound_id||'',invoice_key:x.invoice_id||'',cash_key:'',amount:round4(Number(x.original_amount||0)-Number(x.red_reversed_amount||0)),description:'应付 '+x.code});
for(const x of settlements){const payment=await ctx.api.object('forge_cash_payment').findOne({where:{id:x.payment_id}}),payable=await ctx.api.object('forge_accounts_payable').findOne({where:{id:x.payable_id}});entries.push({date:String(payment&&payment.paid_on||String(x.reviewed_at||'').slice(0,10)),type:'payment',direction:'decrease',sourceKey:'payment-writeoff:'+x.id,payment_writeoff_id:x.id,cash_payment_id:x.payment_id||null,contract_key:'',order_key:payable&&payable.order_id||'',shipment_key:payable&&payable.inbound_id||'',invoice_key:payable&&payable.invoice_id||'',cash_key:x.payment_id||'',amount:Number(x.amount||0),description:'付款核销 '+x.code});}
for(const x of offsets)entries.push({date:String(x.offset_on||''),type:'supplier_prepayment_offset',direction:'decrease',sourceKey:'supplier-offset:'+x.id,contract_key:'',order_key:x.order_id||'',shipment_key:'',invoice_key:'',cash_key:'prepayment:'+x.prepayment_id,amount:Number(x.amount||0),description:'供应商预付冲抵 '+x.code});
`}
if(entries.some(x=>!x.date||!(x.amount>0)))throw new Error('往来明细存在无日期或无金额记录，不能生成对账单');
const statements=await ctx.api.object('forge_counterparty_statement').find({where:{party_type:'${partyType}'}}),partyStatements=statements.filter(x=>${partyType === 'customer' ? 'x.customer_id===partyId' : 'x.supplier_id===partyId'}),statementIds=new Set(partyStatements.map(x=>x.id)),statementLines=await ctx.api.object('forge_counterparty_statement_line').find({where:{}}),occupied=new Set(statementLines.filter(x=>statementIds.has(x.statement_id)).map(x=>x.source_key));
const before=entries.filter(x=>x.date<start),eligible=entries.filter(x=>x.date>=start&&x.date<=end&&!occupied.has(x.sourceKey)),period=eligible.filter(x=>!requestedKeys.length||requestedKeys.includes(x.sourceKey)).sort((a,b)=>a.date.localeCompare(b.date)||a.sourceKey.localeCompare(b.sourceKey));
if(!period.length)throw new Error('当前期间没有满足条件且未被有效对账单占用的来源数据');if(requestedKeys.length&&period.length!==requestedKeys.length)throw new Error('所选待对账来源已变化，请刷新后重新选择');
const balanceOf=list=>round4(list.reduce((sum,x)=>sum+(x.direction==='increase'?x.amount:-x.amount),0)),opening=balanceOf(before),periodCharge=round4(period.filter(x=>x.direction==='increase').reduce((s,x)=>s+x.amount,0)),periodSettlement=round4(period.filter(x=>x.direction==='decrease').reduce((s,x)=>s+x.amount,0)),closing=round4(opening+periodCharge-periodSettlement);
if(opening<0||closing<0)throw new Error('对账余额计算为负，请先核对往来明细完整性');
const created=await ctx.api.object('forge_counterparty_statement').insert({name:party.name+' '+start+' 至 '+end+' 对账单',code:ctx.input.code,party_type:'${partyType}',customer_id:${partyType === 'customer' ? 'partyId' : 'null'},supplier_id:${partyType === 'supplier' ? 'partyId' : 'null'},period_start:start,period_end:end,dimension,basis,audited_only:true,include_prepayment:includePrepayment,opening_balance:opening,period_charge:periodCharge,period_settlement:periodSettlement,closing_balance:closing,line_count:period.length,currency:'cny',status:'draft',responsible_id:actor,remarks:ctx.input.remarks||'按已审核往来余额生成'}),statementId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));
if(!statementId)throw new Error('对账单创建后未返回ID');let running=opening,lineNo=0;
for(const x of period){running=round4(running+(x.direction==='increase'?x.amount:-x.amount));lineNo+=1;await ctx.api.object('forge_counterparty_statement_line').insert({name:String(lineNo).padStart(3,'0')+' '+x.description,statement_id:statementId,line_no:lineNo,occurred_on:x.date,entry_type:x.type,direction:x.direction,source_key:x.sourceKey,receivable_id:x.receivable_id||null,payable_id:x.payable_id||null,collection_id:x.collection_id||null,payment_writeoff_id:x.payment_writeoff_id||null,contract_id:x.contract_id||null,order_id:x.order_id||null,invoice_id:x.invoice_id||null,cash_receipt_id:x.cash_receipt_id||null,cash_payment_id:x.cash_payment_id||null,contract_key:x.contract_key||'',order_key:x.order_key||'',shipment_key:x.shipment_key||'',invoice_key:x.invoice_key||'',cash_key:x.cash_key||'',amount:x.amount,running_balance:running,description:x.description});}
const now=new Date().toISOString();await ctx.api.object('forge_counterparty_statement_log').insert({name:ctx.input.code+' 生成',event_key:ctx.input.code+'-GENERATED',statement_id:statementId,action:'generated',from_status:'',to_status:'draft',comment:'按已审核往来余额生成',occurred_at:now,operator_id:actor});
return{id:statementId,party_type:'${partyType}',opening_balance:opening,period_charge:periodCharge,period_settlement:periodSettlement,closing_balance:closing,line_count:period.length,status:'draft'};
`;

const generateParams = [
  { field: 'code', objectOverride: 'forge_counterparty_statement', required: true },
  { field: 'period_start', objectOverride: 'forge_counterparty_statement', required: true },
  { field: 'period_end', objectOverride: 'forge_counterparty_statement', required: true },
  { field: 'dimension', objectOverride: 'forge_counterparty_statement', required: true, defaultValue: 'balance' },
  { field: 'basis', objectOverride: 'forge_counterparty_statement', required: true, defaultValue: 'balance' },
  { field: 'audited_only', objectOverride: 'forge_counterparty_statement', defaultValue: true },
  { field: 'include_prepayment', objectOverride: 'forge_counterparty_statement', defaultValue: true },
  { name: 'source_keys', label: '待对账来源键', type: 'textarea' as const },
  { field: 'remarks', objectOverride: 'forge_counterparty_statement' },
];

export const CustomerGenerateStatement = defineAction({
  name: 'customer_generate_statement', label: '生成客户对账单', objectName: 'forge_customer', icon: 'file-check-2',
  locations: [...locations], order: 80, refreshAfter: true, description: '按已审核应收、收款核销和预收冲抵生成期间余额快照。',
  params: generateParams, successMessage: '客户对账单已生成',
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.finance/page_counterparty_reconciliation?statement=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: generationSource('customer') },
});

export const SupplierGenerateStatement = defineAction({
  name: 'supplier_generate_statement', label: '生成供应商对账单', objectName: 'forge_supplier', icon: 'file-check-2',
  locations: [...locations], order: 80, refreshAfter: true, description: '按已审核应付、付款核销和预付冲抵生成期间余额快照。',
  params: generateParams, successMessage: '供应商对账单已生成',
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.finance/page_counterparty_reconciliation?statement=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: generationSource('supplier') },
});

export const CounterpartyStatementSend = defineAction({
  name: 'counterparty_statement_send', label: '登记发送', objectName: 'forge_counterparty_statement', icon: 'send', locations: [...locations], order: 20,
  visible: `record.status == 'draft'`, refreshAfter: true, params: [{ field: 'recipient', objectOverride: 'forge_counterparty_statement', required: true }],
  successMessage: '对账单已登记发送', body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId,recipient=String(ctx.input.recipient||'').trim();if(ctx.recordLoadDenied===true||!id||!record)throw new Error('对账单不存在或不可访问');if(!actor)throw new Error('无法识别当前发送人');if(record.status!=='draft')throw new Error('仅草稿对账单可以发送');if(!recipient)throw new Error('发送对象不能为空');const now=new Date().toISOString();await ctx.api.object('forge_counterparty_statement').update({id,status:'sent',recipient,sent_by:actor,sent_at:now});await ctx.api.object('forge_counterparty_statement_log').insert({name:record.code+' 发送',event_key:record.code+'-SENT',statement_id:id,action:'sent',from_status:'draft',to_status:'sent',comment:'发送给 '+recipient,occurred_at:now,operator_id:actor});return{id,status:'sent',recipient};` },
});

export const CounterpartyStatementConfirm = defineAction({
  name: 'counterparty_statement_confirm', label: '登记对方确认', objectName: 'forge_counterparty_statement', icon: 'badge-check', locations: [...locations], order: 30,
  visible: `record.status == 'sent'`, refreshAfter: true, params: [
    { field: 'confirmed_balance', objectOverride: 'forge_counterparty_statement', required: true },
    { name: 'confirmation_note', label: '确认说明', type: 'textarea' },
  ], successMessage: '对方确认结果已登记', body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!record)throw new Error('对账单不存在或不可访问');if(!actor)throw new Error('无法识别当前确认登记人');if(record.status!=='sent')throw new Error('仅已发送待确认对账单可以登记确认');const confirmed=Number(ctx.input.confirmed_balance);if(!Number.isFinite(confirmed)||confirmed<0)throw new Error('对方确认余额无效');const difference=Math.round((Math.abs(confirmed-Number(record.closing_balance||0))+Number.EPSILON)*10000)/10000,note=String(ctx.input.confirmation_note||'').trim();if(difference>0&&!note)throw new Error('存在差异时必须填写差异说明');const status=difference>0?'disputed':'confirmed',now=new Date().toISOString();await ctx.api.object('forge_counterparty_statement').update({id,status,confirmed_balance:confirmed,discrepancy_amount:difference,discrepancy_reason:difference>0?note:null,confirmed_by:actor,confirmed_at:now});await ctx.api.object('forge_counterparty_statement_log').insert({name:record.code+(difference>0?' 差异':' 确认'),event_key:record.code+(difference>0?'-DISPUTED-':'-CONFIRMED-')+now,statement_id:id,action:difference>0?'disputed':'confirmed',from_status:'sent',to_status:status,comment:note||'对方确认余额一致',occurred_at:now,operator_id:actor});return{id,status,confirmed_balance:confirmed,discrepancy_amount:difference};` },
});

export const CounterpartyStatementClose = defineAction({
  name: 'counterparty_statement_close', label: '关闭差异', objectName: 'forge_counterparty_statement', icon: 'circle-check', locations: [...locations], order: 40,
  visible: `record.status == 'disputed'`, refreshAfter: true, params: [{ field: 'resolution_note', objectOverride: 'forge_counterparty_statement', required: true }],
  successMessage: '差异对账单已关闭', body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId,note=String(ctx.input.resolution_note||'').trim();if(ctx.recordLoadDenied===true||!id||!record)throw new Error('对账单不存在或不可访问');if(!actor)throw new Error('无法识别当前关闭人');if(record.status!=='disputed')throw new Error('仅有差异对账单可以关闭');if(!note)throw new Error('差异处理说明不能为空');const now=new Date().toISOString();await ctx.api.object('forge_counterparty_statement').update({id,status:'closed',resolution_note:note,closed_by:actor,closed_at:now});await ctx.api.object('forge_counterparty_statement_log').insert({name:record.code+' 关闭',event_key:record.code+'-CLOSED-'+now,statement_id:id,action:'closed',from_status:'disputed',to_status:'closed',comment:note,occurred_at:now,operator_id:actor});return{id,status:'closed',discrepancy_amount:Number(record.discrepancy_amount||0)};` },
});

export const CounterpartyStatementReopen = defineAction({
  name: 'counterparty_statement_reopen', label: '重新发起确认', objectName: 'forge_counterparty_statement', icon: 'rotate-ccw', locations: [...locations], order: 50,
  visible: `record.status == 'confirmed' || record.status == 'closed'`, refreshAfter: true,
  params: [{ field: 'resolution_note', objectOverride: 'forge_counterparty_statement', required: true }],
  successMessage: '对账单已重新进入待确认', body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId,note=String(ctx.input.resolution_note||'').trim();if(ctx.recordLoadDenied===true||!id||!record)throw new Error('对账单不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(!['confirmed','closed'].includes(record.status))throw new Error('仅已确认或已关闭的对账单可以重新发起确认');if(!note)throw new Error('重新发起原因不能为空');const now=new Date().toISOString(),from=record.status;await ctx.api.object('forge_counterparty_statement').update({id,status:'sent',confirmed_balance:null,discrepancy_amount:0,discrepancy_reason:null,resolution_note:null,confirmed_by:null,confirmed_at:null,closed_by:null,closed_at:null});await ctx.api.object('forge_counterparty_statement_log').insert({name:record.code+' 重新发起确认',event_key:record.code+'-REOPENED-'+now,statement_id:id,action:'reopened',from_status:from,to_status:'sent',comment:note,occurred_at:now,operator_id:actor});return{id,status:'sent',from_status:from};` },
});
