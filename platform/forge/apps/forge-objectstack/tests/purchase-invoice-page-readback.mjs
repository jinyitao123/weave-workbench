import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL||'http://localhost:4386',api=await connect(endpoint);
async function find(object){const result=await api.request('/data/'+object+'?$top=500');assert.equal(result.status,200,object);return result.value.records||[]}
const [invoices,lines,inbounds,orders,payables]=await Promise.all(['forge_purchase_invoice','forge_purchase_invoice_line','forge_purchase_inbound','forge_purchase_order','forge_accounts_payable'].map(find));
const invoice=invoices.find(x=>x.code==='PI-PIN-2026-0001');assert.ok(invoice,'browser-created purchase invoice must survive restart');
const line=lines.find(x=>x.invoice_id===invoice.id),inbound=inbounds.find(x=>x.id===invoice.inbound_id),order=orders.find(x=>x.id===invoice.order_id),payable=payables.find(x=>x.invoice_id===invoice.id);
assert.ok(line&&inbound&&order&&payable,'invoice must retain line, inbound, order and payable sources');
assert.deepEqual({status:invoice.status,deduction:invoice.deduction_status,amount:Number(invoice.total_amount),lineAmount:Number(line.taxed_subtotal),payableAmount:Number(payable.outstanding_amount)},{status:'normal',deduction:'pending',amount:6800,lineAmount:6800,payableAmount:6800});
console.log(JSON.stringify({suite:'purchase-invoice-page-readback',status:'passed',endpoint,invoice:invoice.code,invoiceNumber:invoice.invoice_number,inbound:inbound.code,order:order.code,amount:invoice.total_amount,deductionStatus:invoice.deduction_status,payable:payable.code},null,2));
