import { defineAction } from '@objectstack/spec/ui';

const locations = ['record_header', 'record_more'] as const;

export const SalesOrderIssueInvoice = defineAction({
  name: 'sales_order_issue_invoice', label: '登记销售发票', objectName: 'forge_sales_order', icon: 'receipt-text',
  locations: [...locations], order: 30, visible: `record.status == 'partially_shipped' || record.status == 'shipped'`, refreshAfter: true,
  description: '按已发货且尚未开票的数量登记销项发票，并同步生成一笔未收应收账款。',
  successMessage: '销项发票与应收账款已登记',
  params: [
    { field: 'code', objectOverride: 'forge_sales_invoice', required: true },
    { field: 'invoice_on', objectOverride: 'forge_sales_invoice', required: true },
    { field: 'due_on', objectOverride: 'forge_sales_invoice', required: true },
    { field: 'quantity', objectOverride: 'forge_sales_invoice_line', required: true },
    { field: 'remarks', objectOverride: 'forge_sales_invoice' },
  ],
  onSuccess: { navigate: '/_console/apps/forge/forge_sales_invoice/record/${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const order = ctx.record;
if (ctx.recordLoadDenied === true || !id || !order) throw new Error('当前销售订单不存在或不可访问');
if (!['partially_shipped', 'shipped'].includes(order.status)) throw new Error('仅部分发货或已发货订单可以登记销售发票');
const lines = await ctx.api.object('forge_sales_order_line').find({ where: { order_id: id } });
if (lines.length !== 1) throw new Error('当前切片仅支持单条物料明细订单开票');
const line = lines[0], requested = Number(ctx.input.quantity || 0);
if (!(requested > 0)) throw new Error('本次开票数量必须大于0');
const invoiceable = Number(line.shipped_quantity || 0) - Number(line.invoiced_quantity || 0);
if (requested > invoiceable) throw new Error('本次开票数量超过已发货未开票数量');
if (String(ctx.input.due_on) < String(ctx.input.invoice_on)) throw new Error('应收日期不得早于开票日期');
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const invoiceUnitPrice = round4(Number(line.taxed_subtotal || 0) / Number(line.quantity || 0));
const total = round4(requested * invoiceUnitPrice);
const nextInvoicedAmount = round4(Number(order.invoiced_amount || 0) + total);
if (nextInvoicedAmount > Number(order.total_amount || 0)) throw new Error('累计开票金额不得超过订单含税金额');
const created = await ctx.api.object('forge_sales_invoice').insert({
  name: order.code + ' 销项发票 ' + ctx.input.code, code: ctx.input.code, order_id: id,
  contract_id: order.contract_id || null, customer_id: order.customer_id, invoice_on: ctx.input.invoice_on,
  due_on: ctx.input.due_on, total_amount: total, collected_amount: 0, outstanding_amount: total,
  status: 'issued', invoice_type: 'normal', responsible_id: order.responsible_id, remarks: ctx.input.remarks || ('由销售订单 ' + order.code + ' 登记'),
});

const invoiceId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!invoiceId) throw new Error('销项发票创建后未返回记录ID');
await ctx.api.object('forge_sales_invoice_line').insert({
  name: line.name, invoice_id: invoiceId, order_id: id, order_line_id: line.id, sku_id: line.sku_id,
  item_code: line.item_code || null, model: line.model || null, specification: line.specification || null,
  unit_name: line.unit_name || null, quantity: requested, taxed_unit_price: invoiceUnitPrice,
  tax_rate: Number(line.tax_rate || 0), taxed_subtotal: total, remarks: line.remarks || null,
});
const receivableCode = 'AR-' + ctx.input.code;
const receivableCreated = await ctx.api.object('forge_accounts_receivable').insert({
  name: order.code + ' 应收 ' + ctx.input.code, code: receivableCode, invoice_id: invoiceId, order_id: id,
  contract_id: order.contract_id || null, customer_id: order.customer_id, recognized_on: ctx.input.invoice_on,
  due_on: ctx.input.due_on, original_amount: total, collected_amount: 0, outstanding_amount: total,
  status: 'unpaid', responsible_id: order.responsible_id, remarks: '由销项发票 ' + ctx.input.code + ' 自动生成',
});
const receivableId = typeof receivableCreated === 'string' ? receivableCreated : receivableCreated && (receivableCreated.id || (receivableCreated.record && receivableCreated.record.id));
if (!receivableId) throw new Error('应收账款创建后未返回记录ID');
const nextInvoicedQuantity = round4(Number(line.invoiced_quantity || 0) + requested);
await ctx.api.object('forge_sales_order_line').update({ id: line.id, invoiced_quantity: nextInvoicedQuantity });
await ctx.api.object('forge_sales_order').update({ id, invoiced_amount: nextInvoicedAmount });
if (order.contract_id) {
  const contract = await ctx.api.object('forge_sales_contract').findOne({ where: { id: order.contract_id } });
  if (contract) await ctx.api.object('forge_sales_contract').update({ id: contract.id, invoiced_amount: round4(Number(contract.invoiced_amount || 0) + total) });
}
return { id: invoiceId, receivable_id: receivableId, order_id: id, quantity: requested, total_amount: total, remaining_invoiceable_quantity: round4(invoiceable - requested) };
` },
});
export const ProjectIssueAcceptanceInvoice = defineAction({
  name: 'project_issue_acceptance_invoice', label: '验收开票', objectName: 'forge_project', icon: 'receipt-text',
  locations: [...locations], order: 80, visible: `record.status == 'completed'`, refreshAfter: true,
  description: '项目客户验收通过后，按关联订单的未开票金额登记销项发票和应收。', successMessage: '验收开票与应收已登记',
  params: [
    { field: 'order_id', objectOverride: 'forge_sales_invoice', required: true }, { field: 'code', objectOverride: 'forge_sales_invoice', required: true },
    { field: 'invoice_on', objectOverride: 'forge_sales_invoice', required: true }, { field: 'due_on', objectOverride: 'forge_sales_invoice', required: true },
    { field: 'remarks', objectOverride: 'forge_sales_invoice' },
  ],
  onSuccess: { navigate: '/_console/apps/forge/page/page_collection_settlement_workspace?invoice=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const projectId=ctx.recordId||(ctx.record&&ctx.record.id),project=ctx.record;if(ctx.recordLoadDenied===true||!projectId||!project)throw new Error('当前项目不存在或不可访问');if(project.status!=='completed')throw new Error('仅已完成交付验收的项目可以验收开票');if(String(ctx.input.due_on)<String(ctx.input.invoice_on))throw new Error('应收日期不得早于开票日期');const acceptances=await ctx.api.object('forge_customer_acceptance').find({where:{project_id:projectId,status:'accepted'}});if(!acceptances.length)throw new Error('项目尚无客户确认通过的验收单');const link=await ctx.api.object('forge_project_sales_link').findOne({where:{project_id:projectId,order_id:ctx.input.order_id}});if(!link)throw new Error('所选订单未关联到当前项目');const order=await ctx.api.object('forge_sales_order').findOne({where:{id:ctx.input.order_id}});if(!order||['draft','cancelled'].includes(order.status))throw new Error('所选销售订单不可开票');const lines=await ctx.api.object('forge_sales_order_line').find({where:{order_id:order.id}});if(lines.length!==1)throw new Error('当前验收开票仅支持单条物料明细订单');const line=lines[0],round4=v=>Math.round((v+Number.EPSILON)*10000)/10000,remainingAmount=round4(Number(order.total_amount||0)-Number(order.invoiced_amount||0)),remainingQuantity=round4(Number(line.quantity||0)-Number(line.invoiced_quantity||0));if(!(remainingAmount>0)||!(remainingQuantity>0))throw new Error('当前订单没有未开票金额');const created=await ctx.api.object('forge_sales_invoice').insert({name:order.code+' 验收发票 '+ctx.input.code,code:ctx.input.code,order_id:order.id,contract_id:order.contract_id||null,customer_id:order.customer_id,invoice_on:ctx.input.invoice_on,due_on:ctx.input.due_on,total_amount:remainingAmount,collected_amount:0,outstanding_amount:remainingAmount,status:'issued',invoice_type:'normal',responsible_id:order.responsible_id,remarks:ctx.input.remarks||('基于项目 '+project.code+' 客户验收登记')}),invoiceId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!invoiceId)throw new Error('销项发票创建后未返回记录ID');const unitPrice=round4(remainingAmount/remainingQuantity);await ctx.api.object('forge_sales_invoice_line').insert({name:line.name,invoice_id:invoiceId,order_id:order.id,order_line_id:line.id,sku_id:line.sku_id,item_code:line.item_code||null,model:line.model||null,specification:line.specification||null,unit_name:line.unit_name||null,quantity:remainingQuantity,taxed_unit_price:unitPrice,tax_rate:Number(line.tax_rate||0),taxed_subtotal:remainingAmount,remarks:'项目验收开票'});const receivableCreated=await ctx.api.object('forge_accounts_receivable').insert({name:order.code+' 验收应收 '+ctx.input.code,code:'AR-'+ctx.input.code,invoice_id:invoiceId,order_id:order.id,contract_id:order.contract_id||null,customer_id:order.customer_id,recognized_on:ctx.input.invoice_on,due_on:ctx.input.due_on,original_amount:remainingAmount,collected_amount:0,outstanding_amount:remainingAmount,status:'unpaid',responsible_id:order.responsible_id,remarks:'由验收发票 '+ctx.input.code+' 自动生成'}),receivableId=typeof receivableCreated==='string'?receivableCreated:receivableCreated&&(receivableCreated.id||(receivableCreated.record&&receivableCreated.record.id));if(!receivableId)throw new Error('应收账款创建后未返回记录ID');const nextInvoiced=round4(Number(order.invoiced_amount||0)+remainingAmount);await ctx.api.object('forge_sales_order_line').update({id:line.id,invoiced_quantity:Number(line.quantity||0)});await ctx.api.object('forge_sales_order').update({id:order.id,invoiced_amount:nextInvoiced});if(order.contract_id){const contract=await ctx.api.object('forge_sales_contract').findOne({where:{id:order.contract_id}});if(contract)await ctx.api.object('forge_sales_contract').update({id:contract.id,invoiced_amount:round4(Number(contract.invoiced_amount||0)+remainingAmount)});}await ctx.api.object('forge_project_sales_link').update({id:link.id,invoice_amount:nextInvoiced});const projectLinks=await ctx.api.object('forge_project_sales_link').find({where:{project_id:projectId}}),projectInvoiced=round4(projectLinks.reduce((sum,x)=>sum+Number(x.id===link.id?nextInvoiced:x.invoice_amount||0),0));await ctx.api.object('forge_project').update({id:projectId,invoice_amount:projectInvoiced});return{id:invoiceId,receivable_id:receivableId,project_id:projectId,order_id:order.id,total_amount:remainingAmount,quantity:remainingQuantity,project_invoice_amount:projectInvoiced};
` },
});

export const ReceivableRegisterCollection = defineAction({
  name: 'receivable_register_collection', label: '登记收款', objectName: 'forge_accounts_receivable', icon: 'badge-dollar-sign',
  locations: [...locations], order: 20, visible: `record.status == 'unpaid' || record.status == 'partially_collected'`, refreshAfter: true,
  description: '登记实际到账流水。到账先进入待分配余额，核销审核后才回写应收和订单。',
  successMessage: '收款流水已登记，等待分配核销',
  params: [
    { field: 'code', objectOverride: 'forge_cash_receipt', required: true },
    { field: 'account_id', objectOverride: 'forge_cash_receipt', required: true },
    { field: 'received_on', objectOverride: 'forge_cash_receipt', required: true },
    { field: 'payment_method', objectOverride: 'forge_cash_receipt', required: true, defaultValue: 'bank_transfer' },
    { field: 'amount', objectOverride: 'forge_cash_receipt', required: true },
    { field: 'counterpart_reference', objectOverride: 'forge_cash_receipt' },
    { field: 'remarks', objectOverride: 'forge_cash_receipt' },
  ],
  onSuccess: { navigate: '/_console/apps/forge/forge_cash_receipt/record/${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const receivable = ctx.record;
if (ctx.recordLoadDenied === true || !id || !receivable) throw new Error('当前应收账款不存在或不可访问');
if (!['unpaid', 'partially_collected'].includes(receivable.status)) throw new Error('仅未收款或部分收款应收可以登记收款');
const amount = Number(ctx.input.amount || 0); if (!(amount > 0)) throw new Error('收款金额必须大于0');
if (amount > Number(receivable.outstanding_amount || 0)) throw new Error('收款金额不得超过当前应收余额');
const account = await ctx.api.object('forge_fund_account').findOne({ where: { id: ctx.input.account_id } });
if (!account || account.status !== 'active') throw new Error('收款账户不存在或未启用');
const periods=await ctx.api.object('forge_financial_period').find({where:{account_id:account.id}});if(periods.length&&!periods.some(x=>x.status==='open'&&String(ctx.input.received_on)>=x.period_start&&String(ctx.input.received_on)<=x.period_end))throw new Error('收款日期不在开放财务期间内');
const created = await ctx.api.object('forge_cash_receipt').insert({
  name: receivable.code + ' 收款 ' + ctx.input.code, code: ctx.input.code, customer_id: receivable.customer_id,
  account_id: ctx.input.account_id, received_on: ctx.input.received_on, payment_method: ctx.input.payment_method,
  amount, allocated_amount: 0, unallocated_amount: amount, status: 'unallocated',
  counterpart_reference: ctx.input.counterpart_reference || null, responsible_id: receivable.responsible_id,
  remarks: ctx.input.remarks || ('为应收 ' + receivable.code + ' 登记到账'),
});
const receiptId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!receiptId) throw new Error('收款流水创建后未返回记录ID');
const currentBalance=account.current_balance==null?Number(account.opening_balance||0):Number(account.current_balance);await ctx.api.object('forge_fund_account').update({ id: account.id, current_balance: currentBalance + amount });
return { id: receiptId, receivable_id: id, amount, unallocated_amount: amount };
` },
});

export const CashReceiptAllocate = defineAction({
  name: 'cash_receipt_allocate', label: '分配到应收', objectName: 'forge_cash_receipt', icon: 'split',
  locations: [...locations], order: 20, visible: `record.status == 'unallocated' || record.status == 'partially_allocated'`, refreshAfter: true,
  description: '把待分配到账金额关联到一笔同客户应收，提交后等待核销审核。',
  successMessage: '收款已分配，等待核销审核',
  params: [
    { field: 'code', objectOverride: 'forge_collection_allocation', required: true },
    { field: 'receivable_id', objectOverride: 'forge_collection_allocation', required: true },
    { field: 'allocated_on', objectOverride: 'forge_collection_allocation', required: true },
    { field: 'amount', objectOverride: 'forge_collection_allocation', required: true },
    { field: 'remarks', objectOverride: 'forge_collection_allocation' },
  ],
  onSuccess: { navigate: '/_console/apps/forge/forge_collection_allocation/record/${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const receipt = ctx.record;
if (ctx.recordLoadDenied === true || !id || !receipt) throw new Error('当前收款流水不存在或不可访问');
if (!['unallocated', 'partially_allocated'].includes(receipt.status)) throw new Error('当前收款流水没有可分配余额');
const receivable = await ctx.api.object('forge_accounts_receivable').findOne({ where: { id: ctx.input.receivable_id } });
if (!receivable || !['unpaid', 'partially_collected'].includes(receivable.status)) throw new Error('目标应收不存在或已结清');
if (receivable.customer_id !== receipt.customer_id) throw new Error('收款客户与应收客户不一致');
const amount = Number(ctx.input.amount || 0), available = Number(receipt.unallocated_amount || 0);
if (!(amount > 0)) throw new Error('分配金额必须大于0');
if (amount > available) throw new Error('分配金额不得超过收款未分配余额');
if (amount > Number(receivable.outstanding_amount || 0)) throw new Error('分配金额不得超过应收余额');
const created = await ctx.api.object('forge_collection_allocation').insert({
  name: receipt.code + ' 核销 ' + receivable.code, code: ctx.input.code, receipt_id: id, receivable_id: receivable.id,
  invoice_id: receivable.invoice_id, order_id: receivable.order_id, contract_id: receivable.contract_id || null,
  customer_id: receivable.customer_id, allocated_on: ctx.input.allocated_on, amount, status: 'pending_review',
  responsible_id: receipt.responsible_id, remarks: ctx.input.remarks || ('收款 ' + receipt.code + ' 分配到 ' + receivable.code),
});
const allocationId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!allocationId) throw new Error('收款核销创建后未返回记录ID');
const nextAllocated = Number(receipt.allocated_amount || 0) + amount, nextUnallocated = available - amount;
await ctx.api.object('forge_cash_receipt').update({ id, allocated_amount: nextAllocated, unallocated_amount: nextUnallocated, status: nextUnallocated > 0 ? 'partially_allocated' : 'pending_review' });
return { id: allocationId, receipt_id: id, receivable_id: receivable.id, amount, status: 'pending_review' };
` },
});

export const CashReceiptApprovePendingAllocations = defineAction({
  name: 'cash_receipt_approve_pending_allocations', label: '审核待核销', objectName: 'forge_cash_receipt', icon: 'badge-check',
  locations: [...locations], order: 30, visible: `record.status == 'pending_review'`, refreshAfter: true,
  description: '从收款流水页审核本流水下全部待审核分配，审核后回写应收、发票、订单和项目回款。',
  successMessage: '收款流水下的待核销分配已审核',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const receiptId=ctx.recordId||(ctx.record&&ctx.record.id),receipt=ctx.record;
if(ctx.recordLoadDenied===true||!receiptId||!receipt)throw new Error('当前收款流水不存在或不可访问');
if(receipt.status!=='pending_review')throw new Error('仅待审核收款流水可以审核核销');
const pending=(await ctx.api.object('forge_collection_allocation').find({where:{receipt_id:receiptId}})).filter(x=>x.status==='pending_review');
if(!pending.length)throw new Error('当前收款流水没有待审核核销');
const round4=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000,now=new Date().toISOString();
let approvedAmount=0;
for(const allocation of pending){
  const receivable=await ctx.api.object('forge_accounts_receivable').findOne({where:{id:allocation.receivable_id}});
  const invoice=await ctx.api.object('forge_sales_invoice').findOne({where:{id:allocation.invoice_id}});
  const order=await ctx.api.object('forge_sales_order').findOne({where:{id:allocation.order_id}});
  if(!receivable||!invoice||!order)throw new Error('核销 '+allocation.code+' 关联的应收、发票或订单不存在');
  const amount=round4(allocation.amount),arCollected=round4(receivable.collected_amount||0),invoiceCollected=round4(invoice.collected_amount||0),arOutstanding=receivable.outstanding_amount==null?round4(Number(receivable.original_amount||0)-arCollected):round4(receivable.outstanding_amount),invoiceOutstanding=invoice.outstanding_amount==null?round4(Number(invoice.total_amount||0)-invoiceCollected):round4(invoice.outstanding_amount);
  if(!(amount>0)||amount>arOutstanding+0.0001||amount>invoiceOutstanding+0.0001)throw new Error('核销 '+allocation.code+' 金额超过当前余额');
  const nextArOutstanding=round4(arOutstanding-amount),nextInvoiceOutstanding=round4(invoiceOutstanding-amount),nextOrderCollected=round4(Number(order.collected_amount||0)+amount);
  await ctx.api.object('forge_accounts_receivable').update({id:receivable.id,collected_amount:round4(arCollected+amount),outstanding_amount:nextArOutstanding,status:nextArOutstanding>0?'partially_collected':'settled'});
  await ctx.api.object('forge_sales_invoice').update({id:invoice.id,collected_amount:round4(invoiceCollected+amount),outstanding_amount:nextInvoiceOutstanding,status:nextInvoiceOutstanding>0?(Number(invoice.red_reversed_amount||0)>0?'partially_red_reversed':'issued'):'settled'});
  await ctx.api.object('forge_sales_order').update({id:order.id,collected_amount:nextOrderCollected});
  if(allocation.contract_id){const contract=await ctx.api.object('forge_sales_contract').findOne({where:{id:allocation.contract_id}});if(contract)await ctx.api.object('forge_sales_contract').update({id:contract.id,collected_amount:round4(Number(contract.collected_amount||0)+amount)});}
  await ctx.api.object('forge_collection_allocation').update({id:allocation.id,status:'approved',approved_at:now});
  const links=await ctx.api.object('forge_project_sales_link').find({where:{order_id:order.id}});
  for(const link of links){await ctx.api.object('forge_project_sales_link').update({id:link.id,collected_amount:nextOrderCollected});const projectLinks=await ctx.api.object('forge_project_sales_link').find({where:{project_id:link.project_id}}),projectCollected=round4(projectLinks.reduce((sum,x)=>sum+Number(x.id===link.id?nextOrderCollected:x.collected_amount||0),0)),projectInvoiced=round4(projectLinks.reduce((sum,x)=>sum+Number(x.invoice_amount||0),0));await ctx.api.object('forge_project').update({id:link.project_id,collected_amount:projectCollected,invoice_amount:projectInvoiced});}
  approvedAmount=round4(approvedAmount+amount);
}
const active=(await ctx.api.object('forge_collection_allocation').find({where:{receipt_id:receiptId}})).filter(x=>!['cancelled','reversed'].includes(x.status)),receiptAmount=round4(receipt.amount||0),allocatedAmount=round4(active.reduce((sum,x)=>sum+Number(x.amount||0),0));
if(allocatedAmount>receiptAmount+0.0001)throw new Error('有效核销总额超过收款金额');
const unallocatedAmount=round4(receiptAmount-allocatedAmount),hasPending=active.some(x=>x.status==='pending_review'),nextStatus=unallocatedAmount>0?'partially_allocated':hasPending?'pending_review':'allocated';
await ctx.api.object('forge_cash_receipt').update({id:receiptId,allocated_amount:allocatedAmount,unallocated_amount:unallocatedAmount,status:nextStatus});
return{id:receiptId,status:nextStatus,approved_count:pending.length,approved_amount:approvedAmount};
` },
});

export const CollectionAllocationCancel = defineAction({
  name: 'collection_allocation_cancel', label: '取消分配', objectName: 'forge_collection_allocation', icon: 'unlink',
  locations: [...locations], order: 20, visible: `record.status == 'pending_review'`, refreshAfter: true,
  description: '核销审核前解除收款与应收的分配关系，并释放收款待分配余额。', successMessage: '收款分配已取消',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const allocation = ctx.record;
if (ctx.recordLoadDenied === true || !id || !allocation) throw new Error('当前收款核销不存在或不可访问');
if (allocation.status !== 'pending_review') throw new Error('仅待审核核销可以取消分配');
const receipt = await ctx.api.object('forge_cash_receipt').findOne({ where: { id: allocation.receipt_id } });
if (!receipt) throw new Error('核销关联的收款流水不存在');
const amount = Number(allocation.amount || 0), nextAllocated = Math.max(0, Number(receipt.allocated_amount || 0) - amount), nextUnallocated = Number(receipt.unallocated_amount || 0) + amount;
await ctx.api.object('forge_cash_receipt').update({ id: receipt.id, allocated_amount: nextAllocated, unallocated_amount: nextUnallocated, status: nextAllocated > 0 ? 'partially_allocated' : 'unallocated' });
await ctx.api.object('forge_collection_allocation').update({ id, status: 'cancelled' });
return { id, receipt_id: receipt.id, status: 'cancelled', released_amount: amount };
` },
});

export const CollectionAllocationApprove = defineAction({
  name: 'collection_allocation_approve', label: '审核核销', objectName: 'forge_collection_allocation', icon: 'badge-check',
  locations: [...locations], order: 30, visible: `record.status == 'pending_review'`, refreshAfter: true,
  description: '审核通过后回写应收、发票、订单和合同的已收金额。', successMessage: '核销已审核，应收与订单回款已更新',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const allocation = ctx.record;
if (ctx.recordLoadDenied === true || !id || !allocation) throw new Error('当前收款核销不存在或不可访问');
if (allocation.status !== 'pending_review') throw new Error('仅待审核核销可以审核');
const receivable = await ctx.api.object('forge_accounts_receivable').findOne({ where: { id: allocation.receivable_id } });
const invoice = await ctx.api.object('forge_sales_invoice').findOne({ where: { id: allocation.invoice_id } });
const order = await ctx.api.object('forge_sales_order').findOne({ where: { id: allocation.order_id } });
if (!receivable || !invoice || !order) throw new Error('核销关联的应收、发票或订单不存在');
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const amount = Number(allocation.amount || 0), arOutstanding = Number(receivable.outstanding_amount || 0), invoiceOutstanding = Number(invoice.outstanding_amount || 0);
if (!(amount > 0) || amount > arOutstanding || amount > invoiceOutstanding) throw new Error('核销金额超过当前应收或发票未收余额');
const nextArOutstanding = round4(arOutstanding - amount), nextInvoiceOutstanding = round4(invoiceOutstanding - amount);
await ctx.api.object('forge_accounts_receivable').update({ id: receivable.id, collected_amount: round4(Number(receivable.collected_amount || 0) + amount), outstanding_amount: nextArOutstanding, status: nextArOutstanding > 0 ? 'partially_collected' : 'settled' });
await ctx.api.object('forge_sales_invoice').update({ id: invoice.id, collected_amount: round4(Number(invoice.collected_amount || 0) + amount), outstanding_amount: nextInvoiceOutstanding, status: nextInvoiceOutstanding > 0 ? (Number(invoice.red_reversed_amount || 0) > 0 ? 'partially_red_reversed' : 'issued') : 'settled' });
await ctx.api.object('forge_sales_order').update({ id: order.id, collected_amount: round4(Number(order.collected_amount || 0) + amount) });
if (allocation.contract_id) {
  const contract = await ctx.api.object('forge_sales_contract').findOne({ where: { id: allocation.contract_id } });
  if (contract) await ctx.api.object('forge_sales_contract').update({ id: contract.id, collected_amount: round4(Number(contract.collected_amount || 0) + amount) });
}
await ctx.api.object('forge_collection_allocation').update({ id, status: 'approved', approved_at: new Date().toISOString() });
const receipt=await ctx.api.object('forge_cash_receipt').findOne({where:{id:allocation.receipt_id}});if(receipt){const allocations=await ctx.api.object('forge_collection_allocation').find({where:{receipt_id:receipt.id}}),hasPending=allocations.some(x=>x.id!==id&&x.status==='pending_review'),receiptStatus=Number(receipt.unallocated_amount||0)>0?'partially_allocated':hasPending?'pending_review':'allocated';await ctx.api.object('forge_cash_receipt').update({id:receipt.id,status:receiptStatus});}
const links=await ctx.api.object('forge_project_sales_link').find({where:{order_id:order.id}});for(const link of links){const orderCollected=round4(Number(order.collected_amount||0)+amount);await ctx.api.object('forge_project_sales_link').update({id:link.id,collected_amount:orderCollected});const projectLinks=await ctx.api.object('forge_project_sales_link').find({where:{project_id:link.project_id}}),projectCollected=round4(projectLinks.reduce((sum,x)=>sum+Number(x.id===link.id?orderCollected:x.collected_amount||0),0)),projectInvoiced=round4(projectLinks.reduce((sum,x)=>sum+Number(x.invoice_amount||0),0));await ctx.api.object('forge_project').update({id:link.project_id,collected_amount:projectCollected,invoice_amount:projectInvoiced});}
return { id, receivable_id: receivable.id, invoice_id: invoice.id, order_id: order.id, amount, status: 'approved', outstanding_amount: nextArOutstanding };
` },
});

export const CollectionAllocationReverse = defineAction({
  name: 'collection_allocation_reverse', label: '反核销', objectName: 'forge_collection_allocation', icon: 'rotate-ccw',
  locations: [...locations], order: 40, visible: `record.status == 'approved'`, refreshAfter: true,
  description: '撤回已审核收款核销，恢复应收、发票和订单余额，并把金额退回原收款流水的未分配余额。', successMessage: '收款核销已撤回',
  params: [{ name: 'reversal_reason', label: '反核销原因', type: 'textarea', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),allocation=ctx.record,actor=ctx.session&&ctx.session.userId,reason=String(ctx.input.reversal_reason||'').trim();
if(ctx.recordLoadDenied===true||!id||!allocation)throw new Error('当前收款核销不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(allocation.status!=='approved')throw new Error('仅已审核核销可以反核销');if(!reason)throw new Error('反核销原因不能为空');
const [receivable,invoice,order,receipt]=await Promise.all([ctx.api.object('forge_accounts_receivable').findOne({where:{id:allocation.receivable_id}}),ctx.api.object('forge_sales_invoice').findOne({where:{id:allocation.invoice_id}}),ctx.api.object('forge_sales_order').findOne({where:{id:allocation.order_id}}),ctx.api.object('forge_cash_receipt').findOne({where:{id:allocation.receipt_id}})]);if(!receivable||!invoice||!order||!receipt)throw new Error('反核销关联账目不完整');
const links=await ctx.api.object('forge_project_sales_link').find({where:{order_id:order.id}});for(const link of links){const settled=await ctx.api.object('forge_project_settlement').find({where:{project_id:link.project_id,status:'settled'}});if(settled.length)throw new Error('订单所属项目已结算，需先执行结算调整');}
const peers=await ctx.api.object('forge_collection_allocation').find({where:{receivable_id:receivable.id}}),later=peers.filter(x=>x.id!==id&&x.status==='approved'&&String(x.approved_at||x.created_at||'')>String(allocation.approved_at||allocation.created_at||''));if(later.length)throw new Error('请按审核时间从后向前反核销');
const round4=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000,amount=round4(allocation.amount),arCollected=round4(Number(receivable.collected_amount||0)-amount),invoiceCollected=round4(Number(invoice.collected_amount||0)-amount),orderCollected=round4(Number(order.collected_amount||0)-amount);if(arCollected<0||invoiceCollected<0||orderCollected<0)throw new Error('当前已收金额不足以反核销');const now=new Date().toISOString();
await ctx.api.object('forge_accounts_receivable').update({id:receivable.id,collected_amount:arCollected,outstanding_amount:round4(Number(receivable.outstanding_amount||0)+amount),status:arCollected>0?'partially_collected':'unpaid'});await ctx.api.object('forge_sales_invoice').update({id:invoice.id,collected_amount:invoiceCollected,outstanding_amount:round4(Number(invoice.outstanding_amount||0)+amount),status:Number(invoice.red_reversed_amount||0)>0?'partially_red_reversed':'issued'});await ctx.api.object('forge_sales_order').update({id:order.id,collected_amount:orderCollected});if(allocation.contract_id){const contract=await ctx.api.object('forge_sales_contract').findOne({where:{id:allocation.contract_id}});if(contract)await ctx.api.object('forge_sales_contract').update({id:contract.id,collected_amount:round4(Number(contract.collected_amount||0)-amount)});}
const receiptAllocated=round4(Number(receipt.allocated_amount||0)-amount),receiptUnallocated=round4(Number(receipt.unallocated_amount||0)+amount);if(receiptAllocated<0)throw new Error('收款流水已分配金额不足');await ctx.api.object('forge_cash_receipt').update({id:receipt.id,allocated_amount:receiptAllocated,unallocated_amount:receiptUnallocated,status:receiptAllocated>0?'partially_allocated':'unallocated'});await ctx.api.object('forge_collection_allocation').update({id,status:'reversed',reversed_by:actor,reversed_at:now,reversal_reason:reason});
for(const link of links){await ctx.api.object('forge_project_sales_link').update({id:link.id,collected_amount:orderCollected});const projectLinks=await ctx.api.object('forge_project_sales_link').find({where:{project_id:link.project_id}}),projectCollected=round4(projectLinks.reduce((s,x)=>s+Number(x.id===link.id?orderCollected:x.collected_amount||0),0));await ctx.api.object('forge_project').update({id:link.project_id,collected_amount:projectCollected});}
await ctx.api.object('forge_collection_reversal_log').insert({name:allocation.code+' 反核销',event_key:allocation.code+'-REVERSE',receipt_id:receipt.id,allocation_id:id,action:'writeoff_reversed',amount,reason,occurred_at:now,operator_id:actor});return{id,status:'reversed',receipt_id:receipt.id,amount,receivable_outstanding:round4(Number(receivable.outstanding_amount||0)+amount),receipt_unallocated:receiptUnallocated};
` },
});

export const CashReceiptReverse = defineAction({
  name: 'cash_receipt_reverse', label: '撤销到账', objectName: 'forge_cash_receipt', icon: 'undo-2', locations: [...locations], order: 50,
  visible: `record.status == 'unallocated' || record.status == 'partially_allocated'`, refreshAfter: true,
  description: '在全部分配已取消或反核销后撤销实际到账，并从原资金账户扣回同额余额。', successMessage: '收款到账已撤销',
  params: [{ name: 'reversal_reason', label: '撤销原因', type: 'textarea', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),receipt=ctx.record,actor=ctx.session&&ctx.session.userId,reason=String(ctx.input.reversal_reason||'').trim();if(ctx.recordLoadDenied===true||!id||!receipt)throw new Error('当前收款流水不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(!['unallocated','partially_allocated'].includes(receipt.status))throw new Error('仅无有效分配的收款流水可以撤销');if(!reason)throw new Error('撤销原因不能为空');
const allocations=await ctx.api.object('forge_collection_allocation').find({where:{receipt_id:id}});if(allocations.some(x=>['pending_review','approved'].includes(x.status))||Number(receipt.allocated_amount||0)>0)throw new Error('请先取消分配或反核销');const account=await ctx.api.object('forge_fund_account').findOne({where:{id:receipt.account_id}}),amount=Number(receipt.amount||0);if(!account)throw new Error('收款账户不存在');const periods=await ctx.api.object('forge_financial_period').find({where:{account_id:account.id}});if(periods.length&&!periods.some(x=>x.status==='open'&&String(receipt.received_on)>=x.period_start&&String(receipt.received_on)<=x.period_end))throw new Error('原收款日期所在财务期间未开放，不能撤销');const current=account.current_balance==null?Number(account.opening_balance||0):Number(account.current_balance);if(current+0.0001<amount)throw new Error('资金账户余额不足，无法撤销到账');const now=new Date().toISOString();await ctx.api.object('forge_fund_account').update({id:account.id,current_balance:Math.round((current-amount+Number.EPSILON)*10000)/10000});await ctx.api.object('forge_cash_receipt').update({id,status:'reversed',allocated_amount:0,unallocated_amount:0,reversed_by:actor,reversed_at:now,reversal_reason:reason});await ctx.api.object('forge_collection_reversal_log').insert({name:receipt.code+' 撤销到账',event_key:receipt.code+'-REVERSE',receipt_id:id,allocation_id:null,action:'receipt_reversed',amount,reason,occurred_at:now,operator_id:actor});return{id,status:'reversed',amount,account_id:account.id,account_balance:Math.round((current-amount+Number.EPSILON)*10000)/10000};
` },
});

export const ProjectSettle = defineAction({
  name: 'project_settle', label: '项目结算', objectName: 'forge_project', icon: 'chart-no-axes-combined',
  locations: [...locations], order: 90, visible: `record.status == 'completed'`, refreshAfter: true,
  description: '在交付验收、全额开票和全额回款后固化项目收入、分类成本和毛利快照。', successMessage: '项目已结算',
  params: [{ field: 'code', objectOverride: 'forge_project_settlement', required: true }, { field: 'settled_on', objectOverride: 'forge_project_settlement', required: true }, { field: 'remarks', objectOverride: 'forge_project_settlement' }],
  onSuccess: { navigate: '/_console/apps/forge/page/page_collection_settlement_workspace?settlement=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const projectId=ctx.recordId||(ctx.record&&ctx.record.id),project=ctx.record;if(ctx.recordLoadDenied===true||!projectId||!project)throw new Error('当前项目不存在或不可访问');if(project.status!=='completed')throw new Error('仅已完工项目可以结算');const existing=await ctx.api.object('forge_project_settlement').find({where:{project_id:projectId,status:'settled'}});if(existing.length)throw new Error('当前项目已经结算');const acceptances=await ctx.api.object('forge_customer_acceptance').find({where:{project_id:projectId,status:'accepted'}});if(!acceptances.length)throw new Error('项目尚无客户确认通过的验收单');const links=await ctx.api.object('forge_project_sales_link').find({where:{project_id:projectId}});if(!links.length)throw new Error('项目尚未关联销售订单');const round4=v=>Math.round((v+Number.EPSILON)*10000)/10000;let contractAmount=0,invoicedAmount=0,collectedAmount=0;for(const link of links){const order=await ctx.api.object('forge_sales_order').findOne({where:{id:link.order_id}});if(!order)throw new Error('项目关联订单不存在');const total=Number(order.total_amount||0),invoiced=Number(order.invoiced_amount||0),collected=Number(order.collected_amount||0);if(invoiced+0.0001<total)throw new Error('项目尚未全额开票：'+order.code);if(collected+0.0001<total)throw new Error('项目尚未全额回款：'+order.code);const receivables=await ctx.api.object('forge_accounts_receivable').find({where:{order_id:order.id}}),activeReceivables=receivables.filter(x=>x.status!=='red_reversed');if(!activeReceivables.length||activeReceivables.some(x=>x.status!=='settled'||Number(x.outstanding_amount||0)>0))throw new Error('项目仍有未结清应收：'+order.code);contractAmount+=total;invoicedAmount+=invoiced;collectedAmount+=collected;await ctx.api.object('forge_project_sales_link').update({id:link.id,order_amount:total,invoice_amount:invoiced,collected_amount:collected});}const assemblies=new Map();for(const acceptance of acceptances){const pack=await ctx.api.object('forge_delivery_package').findOne({where:{id:acceptance.package_id}}),commissioning=pack&&await ctx.api.object('forge_commissioning_record').findOne({where:{id:pack.commissioning_id}}),assembly=commissioning&&await ctx.api.object('forge_assembly_order').findOne({where:{id:commissioning.assembly_id}});if(assembly)assemblies.set(assembly.id,assembly);}const productionCost=round4([...assemblies.values()].reduce((sum,x)=>sum+Number(x.material_cost||0),0));if(!(productionCost>0))throw new Error('验收对应的生产材料成本尚未归集');const costEntries=(await ctx.api.object('forge_project_cost_entry').find({where:{project_id:projectId}})).filter(x=>x.status==='allocated'),sumType=type=>round4(costEntries.filter(x=>x.cost_type===type).reduce((sum,x)=>sum+Number(x.allocated_amount||0),0)),laborCost=sumType('labor'),manufacturingCost=sumType('manufacturing'),travelCost=sumType('travel'),subcontractCost=sumType('subcontract'),otherCost=sumType('other'),totalCost=round4(productionCost+laborCost+manufacturingCost+travelCost+subcontractCost+otherCost);contractAmount=round4(contractAmount);invoicedAmount=round4(invoicedAmount);collectedAmount=round4(collectedAmount);const margin=round4(contractAmount-totalCost),marginRate=contractAmount?round4(margin/contractAmount*100):0,created=await ctx.api.object('forge_project_settlement').insert({name:project.code+' 项目结算',code:ctx.input.code,project_id:projectId,settled_on:ctx.input.settled_on,contract_amount:contractAmount,invoiced_amount:invoicedAmount,collected_amount:collectedAmount,production_cost:productionCost,labor_cost:laborCost,manufacturing_cost:manufacturingCost,travel_cost:travelCost,subcontract_cost:subcontractCost,other_cost:otherCost,total_cost:totalCost,gross_margin:margin,gross_margin_rate:marginRate,status:'settled',responsible_id:project.manager_id,remarks:ctx.input.remarks||'项目交付、开票和回款全部完成'}),settlementId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!settlementId)throw new Error('项目结算记录创建后未返回ID');await ctx.api.object('forge_project').update({id:projectId,status:'settled',contract_amount:contractAmount,invoice_amount:invoicedAmount,collected_amount:collectedAmount,total_cost:totalCost});return{id:settlementId,project_id:projectId,status:'settled',contract_amount:contractAmount,invoiced_amount:invoicedAmount,collected_amount:collectedAmount,production_cost:productionCost,labor_cost:laborCost,manufacturing_cost:manufacturingCost,travel_cost:travelCost,subcontract_cost:subcontractCost,other_cost:otherCost,total_cost:totalCost,gross_margin:margin,gross_margin_rate:marginRate};
` },
});

export const PurchaseInboundRegisterInvoice = defineAction({
  name: 'purchase_inbound_register_invoice', label: '登记采购发票', objectName: 'forge_purchase_inbound', icon: 'receipt',
  locations: [...locations], order: 30, visible: `record.status == 'stocked'`, refreshAfter: true,
  description: '按本次采购入库数量和金额登记一张进项发票，并关联或生成应付账款。',
  successMessage: '进项发票已登记并关联应付账款',
  params: [
    { field: 'code', objectOverride: 'forge_purchase_invoice', required: true },
    { field: 'invoice_number', objectOverride: 'forge_purchase_invoice', required: true },
    { field: 'invoice_on', objectOverride: 'forge_purchase_invoice', required: true },
    { field: 'due_on', objectOverride: 'forge_purchase_invoice', required: true },
    { field: 'remarks', objectOverride: 'forge_purchase_invoice' },
  ],
  onSuccess: { navigate: '/_console/apps/forge/forge_purchase_invoice/record/${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const inbound = ctx.record;
if (ctx.recordLoadDenied === true || !id || !inbound) throw new Error('当前采购入库单不存在或不可访问');
if (inbound.status !== 'stocked') throw new Error('仅已入库采购单可以登记采购发票');
if (String(ctx.input.due_on) < String(ctx.input.invoice_on)) throw new Error('应付日期不得早于开票日期');
const existing = await ctx.api.object('forge_purchase_invoice').find({ where: { inbound_id: id } });
if (existing.some(item => item.status === 'normal')) throw new Error('当前采购入库单已经登记有效进项发票');
const order = await ctx.api.object('forge_purchase_order').findOne({ where: { id: inbound.order_id } });
const line = await ctx.api.object('forge_purchase_order_line').findOne({ where: { id: inbound.order_line_id } });
if (!order || !line) throw new Error('采购入库单关联的采购订单或明细不存在');
const total = Number(inbound.inventory_amount || 0), quantity = Number(inbound.quantity || 0), unitPrice = Number(inbound.unit_cost || 0);
if (!(total > 0) || !(quantity > 0)) throw new Error('采购入库数量和金额必须大于0');
const created = await ctx.api.object('forge_purchase_invoice').insert({
  name: order.code + ' 进项发票 ' + ctx.input.invoice_number, code: ctx.input.code, invoice_number: ctx.input.invoice_number,
  inbound_id: id, order_id: order.id, supplier_id: order.supplier_id, invoice_on: ctx.input.invoice_on,
  due_on: ctx.input.due_on, total_amount: total, tax_rate: Number(line.tax_rate || 0), status: 'normal', invoice_type: 'normal',
  responsible_id: order.responsible_id, remarks: ctx.input.remarks || ('由采购入库单 ' + inbound.code + ' 登记'),
});

const invoiceId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!invoiceId) throw new Error('进项发票创建后未返回记录ID');
await ctx.api.object('forge_purchase_invoice_line').insert({
  name: line.name, invoice_id: invoiceId, inbound_id: id, order_id: order.id, order_line_id: line.id,
  sku_id: inbound.sku_id, item_code: inbound.item_code || line.item_code || null, quantity,
  taxed_unit_price: unitPrice, tax_rate: Number(line.tax_rate || 0), taxed_subtotal: total,
  remarks: ctx.input.remarks || null,
});
let payable = await ctx.api.object('forge_accounts_payable').findOne({ where: { inbound_id: id } });
let payableId = payable && payable.id;
if (payable) {
  if(payable.status==='red_reversed') await ctx.api.object('forge_accounts_payable').update({ id: payable.id, source_type:'purchase_invoice', invoice_id: invoiceId, recognized_on:ctx.input.invoice_on, due_on: ctx.input.due_on, original_amount:total, paid_amount:0, offset_amount:0, red_reversed_amount:0, outstanding_amount:total, status:'unpaid', remarks:'由重开发票 '+ctx.input.invoice_number+' 恢复' });
  else await ctx.api.object('forge_accounts_payable').update({ id: payable.id, invoice_id: invoiceId, due_on: ctx.input.due_on });
} else {
  const createdPayable = await ctx.api.object('forge_accounts_payable').insert({
    name: order.code + ' 应付 ' + inbound.code, code: 'AP-' + inbound.code, source_type: 'purchase_invoice',
    inbound_id: id, invoice_id: invoiceId, order_id: order.id, supplier_id: order.supplier_id,
    recognized_on: ctx.input.invoice_on, due_on: ctx.input.due_on, original_amount: total,
    paid_amount: 0, offset_amount: 0, outstanding_amount: total, status: 'unpaid',
    responsible_id: order.responsible_id, remarks: '由进项发票 ' + ctx.input.invoice_number + ' 自动生成',
  });
  payableId = typeof createdPayable === 'string' ? createdPayable : createdPayable && (createdPayable.id || (createdPayable.record && createdPayable.record.id));
}
if (!payableId) throw new Error('应付账款关联后未返回记录ID');
return { id: invoiceId, payable_id: payableId, inbound_id: id, quantity, total_amount: total };
` },
});
export const SalesInvoiceRedReverse = defineAction({
  name: 'sales_invoice_red_reverse', label: '红冲发票', objectName: 'forge_sales_invoice', icon: 'receipt-text',
  locations: [...locations], order: 40, visible: `record.status == 'issued' && (record.invoice_type == 'normal' || record.invoice_type == null)`, refreshAfter: true,
  description: '生成红字销项发票，关闭原应收并回退订单、合同和项目的已开票累计。', successMessage: '销项发票已红冲',
  params: [
    { field: 'code', objectOverride: 'forge_sales_invoice', required: true },
    { field: 'invoice_on', objectOverride: 'forge_sales_invoice', required: true },
    { field: 'reversal_reason', objectOverride: 'forge_sales_invoice', required: true },
  ],
  onSuccess: { navigate: '/_console/apps/forge/page/page_invoice_reversal?red=${result.red_invoice_id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),invoice=ctx.record,actor=ctx.session&&ctx.session.userId,reason=String(ctx.input.reversal_reason||'').trim();
if(ctx.recordLoadDenied===true||!id||!invoice)throw new Error('销项发票不存在或不可访问');if(!actor)throw new Error('无法识别当前红冲操作人');if(!reason)throw new Error('红冲原因不能为空');if(invoice.status!=='issued'||(invoice.invoice_type&&invoice.invoice_type!=='normal'))throw new Error('仅未收款的蓝字销项发票可以红冲');
const round4=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000,total=round4(invoice.total_amount),receivables=await ctx.api.object('forge_accounts_receivable').find({where:{invoice_id:id}});if(!receivables.length)throw new Error('销项发票缺少应收账款，不能红冲');if(receivables.some(x=>Number(x.collected_amount||0)!==0||Math.abs(Number(x.outstanding_amount||0)-Number(x.original_amount||0))>0.0001||!['unpaid','overdue'].includes(x.status)))throw new Error('销项发票已发生回款或应收余额变化，请先完成反核销');
const allocations=await ctx.api.object('forge_collection_allocation').find({where:{invoice_id:id}});if(allocations.some(x=>!['cancelled','reversed'].includes(x.status)))throw new Error('销项发票存在待审核或已审核收款核销，请先取消或反核销');const offsets=await ctx.api.object('forge_customer_prepayment_offset').find({where:{invoice_id:id}});if(offsets.some(x=>x.status==='approved'))throw new Error('销项发票已被客户预收款冲抵，当前不能红冲');const recognitions=await ctx.api.object('forge_revenue_recognition').find({where:{invoice_id:id}});if(recognitions.some(x=>!['rejected','voided'].includes(x.status)))throw new Error('销项发票存在有效收入确认，请先驳回或作废收入确认');
const order=await ctx.api.object('forge_sales_order').findOne({where:{id:invoice.order_id}});if(!order)throw new Error('销项发票关联销售订单不存在');const links=await ctx.api.object('forge_project_sales_link').find({where:{order_id:order.id}});for(const link of links){const project=await ctx.api.object('forge_project').findOne({where:{id:link.project_id}}),settlements=await ctx.api.object('forge_project_settlement').find({where:{project_id:link.project_id,status:'settled'}});if(project&&project.status==='settled'||settlements.length)throw new Error('关联项目已经结算，不能红冲发票');}
const invoiceLines=await ctx.api.object('forge_sales_invoice_line').find({where:{invoice_id:id}});if(!invoiceLines.length)throw new Error('销项发票缺少明细，不能红冲');const previous=await ctx.api.object('forge_sales_invoice').find({where:{original_invoice_id:id}});if(previous.length)throw new Error('当前销项发票已经生成红字发票');const nextOrder=round4(Number(order.invoiced_amount||0)-total);if(nextOrder<0)throw new Error('订单已开票金额不足，不能红冲');const lineStates=[];for(const line of invoiceLines){const orderLine=await ctx.api.object('forge_sales_order_line').findOne({where:{id:line.order_line_id}});if(!orderLine||Number(orderLine.invoiced_quantity||0)+0.0001<Number(line.quantity||0))throw new Error('订单明细已开票数量不足，不能红冲');lineStates.push({line,orderLine,nextQuantity:round4(Number(orderLine.invoiced_quantity||0)-Number(line.quantity||0))});}const contract=order.contract_id&&await ctx.api.object('forge_sales_contract').findOne({where:{id:order.contract_id}});if(order.contract_id&&(!contract||Number(contract.invoiced_amount||0)+0.0001<total))throw new Error('合同已开票金额不足，不能红冲');const now=new Date().toISOString(),created=await ctx.api.object('forge_sales_invoice').insert({name:'红字 '+invoice.name,code:ctx.input.code,order_id:invoice.order_id,contract_id:invoice.contract_id||null,customer_id:invoice.customer_id,invoice_on:ctx.input.invoice_on,due_on:ctx.input.invoice_on,total_amount:total,collected_amount:0,outstanding_amount:0,red_reversed_amount:0,invoice_type:'red',original_invoice_id:id,status:'red_invoice',revenue_status:'not_applicable',responsible_id:invoice.responsible_id,remarks:'红冲 '+invoice.code+'：'+reason}),redId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!redId)throw new Error('红字销项发票创建后未返回ID');
for(const state of lineStates){const line=state.line;await ctx.api.object('forge_sales_invoice_line').insert({name:line.name,invoice_id:redId,order_id:line.order_id,order_line_id:line.order_line_id,sku_id:line.sku_id,item_code:line.item_code||null,model:line.model||null,specification:line.specification||null,unit_name:line.unit_name||null,quantity:Number(line.quantity),taxed_unit_price:Number(line.taxed_unit_price||0),tax_rate:Number(line.tax_rate||0),taxed_subtotal:Number(line.taxed_subtotal||0),red_reversed_quantity:0,remarks:'红冲原发票 '+invoice.code});await ctx.api.object('forge_sales_invoice_line').update({id:line.id,red_reversed_quantity:Number(line.quantity||0)});await ctx.api.object('forge_sales_order_line').update({id:state.orderLine.id,invoiced_quantity:state.nextQuantity});}
await ctx.api.object('forge_sales_order').update({id:order.id,invoiced_amount:nextOrder});if(contract)await ctx.api.object('forge_sales_contract').update({id:contract.id,invoiced_amount:round4(Number(contract.invoiced_amount||0)-total)});for(const link of links){await ctx.api.object('forge_project_sales_link').update({id:link.id,invoice_amount:nextOrder});const projectLinks=await ctx.api.object('forge_project_sales_link').find({where:{project_id:link.project_id}}),projectAmount=round4(projectLinks.reduce((sum,x)=>sum+Number(x.id===link.id?nextOrder:x.invoice_amount||0),0));await ctx.api.object('forge_project').update({id:link.project_id,invoice_amount:projectAmount});}
for(const receivable of receivables)await ctx.api.object('forge_accounts_receivable').update({id:receivable.id,red_reversed_amount:total,outstanding_amount:0,status:'red_reversed',remarks:(receivable.remarks||'')+'；原发票已红冲 '+ctx.input.code});await ctx.api.object('forge_sales_invoice').update({id,status:'red_reversed',red_reversed_amount:total,outstanding_amount:0,reversed_by:actor,reversed_at:now,reversal_reason:reason});await ctx.api.object('forge_invoice_reversal_log').insert({name:invoice.code+' 销项红冲',event_key:invoice.code+'-RED-REVERSE',direction:'sales',reversal_kind:'full',original_sales_invoice_id:id,red_sales_invoice_id:redId,original_purchase_invoice_id:null,red_purchase_invoice_id:null,amount:total,remaining_amount:0,reason,occurred_at:now,operator_id:actor});return{id,red_invoice_id:redId,status:'red_reversed',order_id:order.id,amount:total,order_invoiced_amount:nextOrder};
` },
});

export const PurchaseInvoiceRedReverse = defineAction({
  name: 'purchase_invoice_red_reverse', label: '红冲发票', objectName: 'forge_purchase_invoice', icon: 'receipt',
  locations: [...locations], order: 40, visible: `record.status == 'normal' && (record.invoice_type == 'normal' || record.invoice_type == null)`, refreshAfter: true,
  description: '仅在应付从未付款、冲抵或形成有效付款任务时生成红字进项发票并关闭原应付。', successMessage: '进项发票已红冲',
  params: [
    { field: 'code', objectOverride: 'forge_purchase_invoice', required: true }, { field: 'invoice_number', objectOverride: 'forge_purchase_invoice', required: true },
    { field: 'invoice_on', objectOverride: 'forge_purchase_invoice', required: true }, { field: 'reversal_reason', objectOverride: 'forge_purchase_invoice', required: true },
  ],
  onSuccess: { navigate: '/_console/apps/forge/page/page_invoice_reversal?red=${result.red_invoice_id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),invoice=ctx.record,actor=ctx.session&&ctx.session.userId,reason=String(ctx.input.reversal_reason||'').trim();if(ctx.recordLoadDenied===true||!id||!invoice)throw new Error('进项发票不存在或不可访问');if(!actor)throw new Error('无法识别当前红冲操作人');if(!reason)throw new Error('红冲原因不能为空');if(invoice.status!=='normal'||(invoice.invoice_type&&invoice.invoice_type!=='normal'))throw new Error('仅正常蓝字进项发票可以红冲');const payables=await ctx.api.object('forge_accounts_payable').find({where:{invoice_id:id}});if(payables.length!==1)throw new Error('进项发票关联应付账款不完整');const payable=payables[0],total=Number(invoice.total_amount||0);if(Number(payable.paid_amount||0)!==0||Number(payable.offset_amount||0)!==0||Math.abs(Number(payable.outstanding_amount||0)-Number(payable.original_amount||0))>0.0001||!['unpaid','overdue'].includes(payable.status))throw new Error('进项发票对应应付已付款或冲抵，请先恢复应付原值');const tasks=await ctx.api.object('forge_payment_task').find({where:{payable_id:payable.id}});if(tasks.some(x=>x.status!=='rejected'))throw new Error('进项发票存在有效付款任务，不能红冲');const offsets=await ctx.api.object('forge_supplier_prepayment_offset').find({where:{payable_id:payable.id}});if(offsets.some(x=>x.status==='approved'))throw new Error('进项发票对应应付已被预付款冲抵，不能红冲');const payments=await ctx.api.object('forge_cash_payment').find({where:{payable_id:payable.id}});if(payments.some(x=>x.status!=='reversed'))throw new Error('进项发票存在未撤销付款流水，不能红冲');const previous=await ctx.api.object('forge_purchase_invoice').find({where:{original_invoice_id:id}});if(previous.length)throw new Error('当前进项发票已经生成红字发票');const lines=await ctx.api.object('forge_purchase_invoice_line').find({where:{invoice_id:id}});if(!lines.length)throw new Error('进项发票缺少明细，不能红冲');const now=new Date().toISOString(),created=await ctx.api.object('forge_purchase_invoice').insert({name:'红字 '+invoice.name,code:ctx.input.code,invoice_number:ctx.input.invoice_number,inbound_id:invoice.inbound_id,order_id:invoice.order_id,supplier_id:invoice.supplier_id,invoice_on:ctx.input.invoice_on,due_on:ctx.input.invoice_on,total_amount:total,red_reversed_amount:0,tax_rate:Number(invoice.tax_rate||0),invoice_type:'red',original_invoice_id:id,status:'red_invoice',responsible_id:invoice.responsible_id,remarks:'红冲 '+invoice.invoice_number+'：'+reason}),redId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!redId)throw new Error('红字进项发票创建后未返回ID');for(const line of lines){await ctx.api.object('forge_purchase_invoice_line').insert({name:line.name,invoice_id:redId,inbound_id:line.inbound_id,order_id:line.order_id,order_line_id:line.order_line_id,sku_id:line.sku_id,item_code:line.item_code||null,quantity:Number(line.quantity),taxed_unit_price:Number(line.taxed_unit_price||0),tax_rate:Number(line.tax_rate||0),taxed_subtotal:Number(line.taxed_subtotal||0),red_reversed_quantity:0,remarks:'红冲原发票 '+invoice.invoice_number});await ctx.api.object('forge_purchase_invoice_line').update({id:line.id,red_reversed_quantity:Number(line.quantity||0)});}await ctx.api.object('forge_accounts_payable').update({id:payable.id,red_reversed_amount:total,outstanding_amount:0,status:'red_reversed',remarks:(payable.remarks||'')+'；原发票已红冲 '+ctx.input.invoice_number});await ctx.api.object('forge_purchase_invoice').update({id,status:'red_reversed',red_reversed_amount:total,reversed_by:actor,reversed_at:now,reversal_reason:reason});await ctx.api.object('forge_invoice_reversal_log').insert({name:invoice.code+' 进项红冲',event_key:invoice.code+'-RED-REVERSE',direction:'purchase',reversal_kind:'full',original_sales_invoice_id:null,red_sales_invoice_id:null,original_purchase_invoice_id:id,red_purchase_invoice_id:redId,amount:total,remaining_amount:0,reason,occurred_at:now,operator_id:actor});return{id,red_invoice_id:redId,status:'red_reversed',payable_id:payable.id,amount:total,payable_outstanding:0};
` },
});
