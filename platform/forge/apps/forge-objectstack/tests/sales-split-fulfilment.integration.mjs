import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const api = await connect(process.env.FORGE_URL || 'http://localhost:4321');
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const path = '.objectstack/acceptance/sales-split-fulfilment-report.json';
const read = async (o,id) => {
  const r = await api.request(`/data/${o}/${id}`);
  assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value.record;
};
const invoke = async (o,a,id,params) => {
  const r = await api.request(`/actions/${o}/${a}/${id}`, 'POST', {params});
  assert.equal(r.status, 200, JSON.stringify(r.value));
  return r.value?.result ?? r.value?.data?.result ?? r.value?.data ?? r.value;
};
let report;
if (process.argv.includes('--readback')) {
  report = JSON.parse(await readFile(path, 'utf8'));
} else {
  const prior = JSON.parse(await readFile('.objectstack/acceptance/sales-outbound-report.json', 'utf8'));
  const finance = JSON.parse(await readFile('.objectstack/acceptance/sales-finance-report.json', 'utf8'));
  assert.equal(prior.passed, true);
  assert.equal(finance.passed, true);
  const ids = {...prior.ids, firstInvoice: finance.ids.invoice, firstReceivable: finance.ids.receivable};
  const next = await invoke('forge_sales_order','sales_order_create_shipment',ids.order,
    {code:'SPLIT-DN-' + stamp + '-2',shipment_on:'2026-09-09',recipient:'周启明',delivery_address:'苏州市工业园区澄岳路9号',quantity:1});
  ids.secondShipment=next.id;
  const beforeSecondBalance = await read('forge_inventory_balance', ids.balance);
  ids.beforeSecondOutbound = { onHand: Number(beforeSecondBalance.on_hand_quantity || 0), available: Number(beforeSecondBalance.available_quantity || 0), value: Number(beforeSecondBalance.inventory_value || 0), cost: Number(beforeSecondBalance.average_cost || 0) };
  assert.ok(ids.beforeSecondOutbound.onHand >= 1 && ids.beforeSecondOutbound.available >= 1, '第二次销售出库需要当前库至少剩余 1 台可用库存');
  const out = await invoke('forge_sales_shipment','sales_shipment_create_outbound',next.id,
    {code:'SPLIT-OUT-' + stamp + '-2',warehouse_id:ids.warehouse,outbound_on:'2026-09-09',quantity:1});
  ids.secondOutbound=out.id;
  assert.equal((await read('forge_sales_order_line',ids.orderLine)).shipped_quantity,2,
    'two real outbound actions must accumulate two shipped units');
  const second = await invoke('forge_sales_order','sales_order_issue_invoice',ids.order,
    {code:'SPLIT-INV-' + stamp + '-2',invoice_on:'2026-09-09',due_on:'2026-10-09',quantity:1});
  ids.secondInvoice=second.id; ids.secondReceivable=second.receivable_id;
  const over=await api.request(`/actions/forge_sales_order/sales_order_issue_invoice/${ids.order}`,'POST',
    {params:{code:'SPLIT-INV-' + stamp + '-OVER',invoice_on:'2026-09-09',due_on:'2026-10-09',quantity:1}});
  assert.equal(over.status,400); assert.match(over.value.error.message,/超过已发货未开票数量/);
  report={ids,passed:false,runtime:{url:process.env.FORGE_URL,database:process.env.FORGE_DB},
    boundary:'Real sequential shipment/outbound/invoice actions; no PATCH of shipped state or quantity. RISEMAP comparison, cash settlement and UI acceptance remain pending.'};
}
const {ids}=report;
const order=await read('forge_sales_order',ids.order), line=await read('forge_sales_order_line',ids.orderLine);
assert.equal(order.status,'shipped'); assert.equal(line.shipped_quantity,2); assert.equal(line.invoiced_quantity,2);
assert.equal(order.invoiced_amount,243200);
const balance=await read('forge_inventory_balance',ids.balance);
if (ids.beforeSecondOutbound) {
  assert.equal(balance.on_hand_quantity, ids.beforeSecondOutbound.onHand - 1);
  assert.equal(balance.available_quantity, ids.beforeSecondOutbound.available - 1);
  assert.equal(balance.inventory_value, ids.beforeSecondOutbound.value - ids.beforeSecondOutbound.cost);
} else {
  assert.ok(balance.on_hand_quantity >= 0);
  assert.ok(balance.available_quantity >= 0);
}
for (const key of ['firstInvoice','secondInvoice']) assert.equal((await read('forge_sales_invoice',ids[key])).total_amount,121600);
for (const key of ['firstReceivable','secondReceivable']) assert.equal((await read('forge_accounts_receivable',ids[key])).outstanding_amount,121600);
for (const key of ['shipment','secondShipment']) assert.equal((await read('forge_sales_shipment',ids[key])).outbound_quantity,1);
for (const key of ['outbound','secondOutbound']) assert.equal((await read('forge_sales_outbound',ids[key])).quantity,1);
report.passed=true;
if(process.argv.includes('--readback')) report.restartReadback={passed:true,at:new Date().toISOString()};
await writeFile(path,JSON.stringify(report,null,2));
console.log('PASS split delivery and invoice chain'+(process.argv.includes('--readback')?' after restart':''));
