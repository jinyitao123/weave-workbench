import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL||'http://localhost:4386',api=await connect(endpoint);
async function find(object){const result=await api.request('/data/'+object+'?$top=500');assert.equal(result.status,200,object);return result.value.records||[]}
const [materials,skus,serials,balances,warehouses]=await Promise.all(['forge_material','forge_material_sku','forge_inventory_serial_number','forge_inventory_balance','forge_warehouse'].map(find));
const serial=serials.find(x=>x.name==='SN2609092289-00001');assert.ok(serial,'traceable product instance must survive restart');
const sku=skus.find(x=>x.id===serial.sku_id);assert.ok(sku,'product instance must retain its SKU source');
const material=materials.find(x=>x.id===sku.material_id);assert.ok(material,'SKU must retain its material source');
const balance=balances.find(x=>x.sku_id===sku.id);assert.ok(balance,'product instance SKU must retain inventory balance');
const warehouse=warehouses.find(x=>x.id===balance.warehouse_id);assert.ok(warehouse,'inventory balance must retain warehouse source');
assert.equal(serial.batch_number,'BATCH-20260909-01');assert.equal(serial.inbound_code,'IN-2026-0001');assert.equal(serial.status,'in_stock');
console.log(JSON.stringify({suite:'product-trace-readback',status:'passed',endpoint,traceCode:serial.name,material:material.code,sku:sku.code,batch:serial.batch_number,inbound:serial.inbound_code,warehouse:warehouse.name,instanceStatus:serial.status},null,2));
