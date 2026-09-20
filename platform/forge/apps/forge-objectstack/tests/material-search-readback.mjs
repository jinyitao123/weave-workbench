import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL||'http://localhost:4386',api=await connect(endpoint);
async function find(object){const result=await api.request('/data/'+object+'?$top=500');assert.equal(result.status,200,object);return result.value.records||[]}
const [materials,skus,balances,purchaseLines,salesLines]=await Promise.all(['forge_material','forge_material_sku','forge_inventory_balance','forge_purchase_order_line','forge_sales_order_line'].map(find));
const material=materials.find(x=>x.code==='RM-PLC-1215C');assert.ok(material,'PLC material search fixture must exist');
const sku=skus.find(x=>x.material_id===material.id);assert.ok(sku,'material must retain a searchable SKU');
const stock=balances.filter(x=>x.sku_id===sku.id).reduce((sum,x)=>sum+Number(x.available_quantity||0),0);assert.ok(stock>=0,'available stock must be readable');
assert.ok(purchaseLines.some(x=>x.sku_id===sku.id),'purchase history must be linked to the searchable SKU');
assert.ok(salesLines.every(x=>skus.some(s=>s.id===x.sku_id)),'sales history must retain searchable SKU sources');
console.log(JSON.stringify({suite:'material-search-readback',status:'passed',endpoint,material:material.code,sku:sku.code,available:stock,purchaseRecords:purchaseLines.filter(x=>x.sku_id===sku.id).length,salesRecords:salesLines.filter(x=>x.sku_id===sku.id).length},null,2));
