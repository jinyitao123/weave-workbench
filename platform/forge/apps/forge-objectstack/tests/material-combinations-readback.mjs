import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';
const endpoint=process.env.FORGE_URL||'http://localhost:4386',api=await connect(endpoint);
async function find(o){const r=await api.request('/data/'+o+'?$top=500');assert.equal(r.status,200,o);return r.value.records||[]}
const [bundles,lines,materials,skus]=await Promise.all(['forge_product_bundle','forge_product_bundle_line','forge_material','forge_material_sku'].map(find));
const bundle=bundles.find(x=>x.code==='BND-FORGE-20260915-001');assert.ok(bundle,'browser-created material bundle must survive');
const bundleLines=lines.filter(x=>x.bundle_id===bundle.id);assert.equal(bundle.status,'active');assert.equal(bundleLines.length,2);assert.deepEqual(bundleLines.map(x=>Number(x.quantity)).sort((a,b)=>a-b),[1,2]);
assert.ok(bundleLines.every(x=>materials.some(m=>m.id===x.material_id)&&skus.some(s=>s.id===x.sku_id)),'every bundle line must retain material and SKU sources');
assert.equal(Number(bundle.taxed_sale_price),58000);assert.ok(Math.abs(Number(bundle.untaxed_sale_price)-51327.43362831859)<0.0001);
console.log(JSON.stringify({suite:'material-combinations-readback',status:'passed',endpoint,bundle:bundle.code,lines:bundleLines.length},null,2));
