import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
import { seedReferenceData } from '../scripts/seed-reference-data.mjs';

const { ids: fixture } = await seedReferenceData();
const api = await connect();
const stamp = Date.now();
const ids = { sku: fixture.plc_sku, warehouse: fixture.warehouse, supplier1: fixture.supplier };
const cases = [];
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log('PASS '+name); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error('FAIL '+name+': '+error.message); } }
async function create(object, body) { const r=await api.request('/data/'+object,'POST',body); assert.equal(r.status,201,JSON.stringify(r.value)); return r.value.id||r.value.record?.id; }
async function patch(object,id,body) { const r=await api.request('/data/'+object+'/'+id,'PATCH',body); assert.equal(r.status,200,JSON.stringify(r.value)); }
async function read(object,id) { const r=await api.request('/data/'+object+'/'+id); assert.equal(r.status,200,JSON.stringify(r.value)); return r.value.record; }
async function invoke(object,action,id,params={}) { const r=await api.request('/actions/'+object+'/'+action+'/'+id,'POST',{params}); assert.equal(r.status,200,JSON.stringify(r.value)); return r.value; }
try { const old=JSON.parse(await readFile('.objectstack/acceptance/purchase-inquiry-report.json','utf8')); for (const [object,key] of [['forge_purchase_order_line','orderLine'],['forge_purchase_order','order'],['forge_purchase_inquiry_quote_line','quoteLine2'],['forge_purchase_inquiry_quote_line','quoteLine1'],['forge_purchase_inquiry_quote','quote2'],['forge_purchase_inquiry_quote','quote1'],['forge_purchase_inquiry_line','line'],['forge_purchase_inquiry','inquiry'],['forge_supplier','supplier2']]) if(old.ids?.[key]) await api.request('/data/'+object+'/'+old.ids[key],'DELETE'); } catch {}

await test('creates a manual inquiry with durable material and two supplier invitations', async()=>{
  const baseSupplier=await read('forge_supplier',ids.supplier1);
  ids.supplier2=await create('forge_supplier',{name:'询价备选供应商 '+stamp,code:'RFQ-SUP-'+stamp,category_id:baseSupplier.category_id,level_id:baseSupplier.level_id,contact_name:'采购联系人',phone:'13900009999',status:'active',responsible_id:api.userId});
  for (const supplierId of [ids.supplier1,ids.supplier2]) { const supplier=await read('forge_supplier',supplierId); if(['draft','rejected'].includes(supplier.approval_status)) await invoke('forge_supplier','supplier_submit_approval',supplierId); if((await read('forge_supplier',supplierId)).approval_status==='pending_approval') await invoke('forge_supplier','supplier_review',supplierId,{decision:'approve',comment:'询价验收供应商资料完整'}); }
  ids.inquiry=await create('forge_purchase_inquiry',{name:'PLC 双供应商比价 '+stamp,code:'RFQ-ACC-'+stamp,source_type:'manual',responsible_id:api.userId,due_on:'2026-09-30',supplier_count:2,line_count:1,status:'draft'});
  ids.line=await create('forge_purchase_inquiry_line',{name:'PLC CPU 1215C',inquiry_id:ids.inquiry,sku_id:ids.sku,item_code:'RM-PLC-1215C',unit_name:'件',quantity:2,required_on:'2026-10-05'});
  ids.quote1=await create('forge_purchase_inquiry_quote',{name:'主供应商报价',code:'RFQQ-A-'+stamp,inquiry_id:ids.inquiry,supplier_id:ids.supplier1,currency:'cny',total_amount:0,lead_days:0,status:'invited'});
  ids.quote2=await create('forge_purchase_inquiry_quote',{name:'备选供应商报价',code:'RFQQ-B-'+stamp,inquiry_id:ids.inquiry,supplier_id:ids.supplier2,currency:'cny',total_amount:0,lead_days:0,status:'invited'});
  const saved=await read('forge_purchase_inquiry',ids.inquiry); assert.deepEqual({status:saved.status,line_count:saved.line_count,supplier_count:saved.supplier_count},{status:'draft',line_count:1,supplier_count:2});
});
await test('publishes and records two line-level quotes for comparison', async()=>{
  await patch('forge_purchase_inquiry',ids.inquiry,{status:'published',published_at:new Date().toISOString()});
  ids.quoteLine1=await create('forge_purchase_inquiry_quote_line',{name:'PLC CPU 1215C',quote_id:ids.quote1,inquiry_line_id:ids.line,sku_id:ids.sku,quantity:2,taxed_unit_price:6800,tax_rate:13,taxed_subtotal:13600});
  ids.quoteLine2=await create('forge_purchase_inquiry_quote_line',{name:'PLC CPU 1215C',quote_id:ids.quote2,inquiry_line_id:ids.line,sku_id:ids.sku,quantity:2,taxed_unit_price:6500,tax_rate:13,taxed_subtotal:13000});
  await patch('forge_purchase_inquiry_quote',ids.quote1,{total_amount:13600,lead_days:7,valid_until:'2026-09-30',payment_term:'到货30天',status:'submitted',submitted_at:new Date().toISOString()});
  await patch('forge_purchase_inquiry_quote',ids.quote2,{total_amount:13000,lead_days:10,valid_until:'2026-09-30',payment_term:'到货45天',status:'submitted',submitted_at:new Date().toISOString()});
  assert.equal((await read('forge_purchase_inquiry_quote',ids.quote2)).total_amount,13000);
});
await test('selects a quote and converts the exact line into a submitted purchase order', async()=>{
  await patch('forge_purchase_inquiry_quote',ids.quote1,{status:'declined'}); await patch('forge_purchase_inquiry_quote',ids.quote2,{status:'selected'});
  await patch('forge_purchase_inquiry',ids.inquiry,{selected_quote_id:ids.quote2,status:'compared',compared_at:new Date().toISOString()});
  ids.order=await create('forge_purchase_order',{name:'PLC 双供应商比价采购订单',code:'PO-RFQ-'+stamp,supplier_id:ids.supplier2,source_type:'inventory_replenishment',warehouse_id:ids.warehouse,expected_arrival_on:'2026-10-05',order_on:'2026-09-16',payment_term:'到货45天',payment_method:'bank_transfer',currency:'cny',exchange_rate:1,payable_trigger:'inbound',responsible_id:api.userId,total_amount:13000,status:'draft'});
  ids.orderLine=await create('forge_purchase_order_line',{name:'PLC CPU 1215C',order_id:ids.order,sku_id:ids.sku,item_code:'RM-PLC-1215C',unit_name:'件',quantity:2,taxed_unit_price:6500,untaxed_unit_price:5752.2124,tax_rate:13,taxed_subtotal:13000,expected_arrival_on:'2026-10-05'});
  await invoke('forge_purchase_order','purchase_order_submit',ids.order);
  await patch('forge_purchase_inquiry',ids.inquiry,{status:'converted',converted_order_id:ids.order,converted_at:new Date().toISOString()});
  const saved=await read('forge_purchase_inquiry',ids.inquiry),order=await read('forge_purchase_order',ids.order),line=await read('forge_purchase_order_line',ids.orderLine);
  assert.deepEqual({status:saved.status,selected_quote_id:saved.selected_quote_id,converted_order_id:saved.converted_order_id},{status:'converted',selected_quote_id:ids.quote2,converted_order_id:ids.order});
  assert.deepEqual({supplier_id:order.supplier_id,total_amount:order.total_amount,status:order.status,line_count:order.line_count,total_quantity:order.total_quantity},{supplier_id:ids.supplier2,total_amount:13000,status:'pending_approval',line_count:1,total_quantity:2}); assert.deepEqual({order_id:line.order_id,quantity:line.quantity,taxed_unit_price:line.taxed_unit_price},{order_id:ids.order,quantity:2,taxed_unit_price:6500});
});
await test('rejects anonymous inquiry reads and writes',async()=>{assert.equal((await api.request('/data/forge_purchase_inquiry','GET',undefined,false)).status,401);assert.equal((await api.request('/data/forge_purchase_inquiry','POST',{name:'Unauthorized'},false)).status,401)});
await mkdir('.objectstack/acceptance',{recursive:true}); const report={recordedAt:new Date().toISOString(),kind:'purchase-inquiry-api-acceptance',ids,cases,passed:cases.every(x=>x.status==='passed'),runtime:{url:process.env.FORGE_URL||'http://localhost:4310',database:'file:.objectstack/purchase-inquiry.sqlite'}}; await writeFile('.objectstack/acceptance/purchase-inquiry-report.json',JSON.stringify(report,null,2)); if(!report.passed)process.exitCode=1;
