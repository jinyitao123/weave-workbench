import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const endpoint=process.env.FORGE_URL||'http://localhost:4356',database=process.env.FORGE_DB||'.objectstack/data/objectstack.db',api=await connect(endpoint);
async function find(name,where={}){const q=new URLSearchParams({$filter:JSON.stringify(where),$top:'1000'}),r=await api.request(`/data/${name}?${q}`);assert.equal(r.status,200,name+': '+JSON.stringify(r.value));return(r.value.records||[]).filter(x=>Object.entries(where).every(([k,v])=>x[k]===v))}
async function read(name,id){const r=await api.request(`/data/${name}/${id}`);assert.equal(r.status,200,`${name}/${id}: ${JSON.stringify(r.value)}`);return r.value.record}

const inbounds=await find('forge_production_inbound',{status:'stocked'});assert.ok(inbounds.length);
const inbound=inbounds.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0],assembly=await read('forge_assembly_order',inbound.assembly_id);
assert.ok(assembly.code?.startsWith('ASM-'));await read('forge_material_sku',inbound.product_sku_id);await read('forge_warehouse',inbound.warehouse_id);
const inboundLedgers=await find('forge_inventory_ledger',{source_id:inbound.id});assert.equal(inboundLedgers.length,1);assert.equal(inboundLedgers[0].movement_type,'production_inbound');assert.equal(inboundLedgers[0].direction,'inbound');assert.equal(Number(inboundLedgers[0].quantity),Number(inbound.qualified_quantity));assert.equal(Number(inboundLedgers[0].before_on_hand),Number(inbound.before_on_hand));assert.equal(Number(inboundLedgers[0].after_on_hand),Number(inbound.after_on_hand));

const documents=await find('forge_production_material_document'),outboundDocuments=documents.filter(x=>['issue','supply'].includes(x.document_type));assert.ok(outboundDocuments.some(x=>x.status==='confirmed'));assert.ok(documents.some(x=>x.document_type==='return'));assert.ok(outboundDocuments.every(x=>x.document_type!=='return'));
const confirmed=outboundDocuments.find(x=>x.status==='confirmed'),documentLedgers=await find('forge_inventory_ledger',{source_id:confirmed.id});assert.ok(documentLedgers.length);assert.ok(documentLedgers.every(x=>x.direction==='outbound'&&['production_issue','production_supply'].includes(x.movement_type)));
const confirmedAssembly=await read('forge_assembly_order',confirmed.assembly_id);assert.ok(confirmedAssembly.code?.startsWith('ASM-'));

const subcontractOutbounds=await find('forge_subcontract_outbound',{status:'outbounded'});assert.ok(subcontractOutbounds.length);const subcontractOutbound=subcontractOutbounds[0],issue=await read('forge_subcontract_issue',subcontractOutbound.issue_id);assert.equal(issue.outbound_id,subcontractOutbound.id);await read('forge_supplier',subcontractOutbound.supplier_id);await read('forge_warehouse',subcontractOutbound.warehouse_id);const subcontractLedgers=await find('forge_inventory_ledger',{source_id:issue.id});assert.ok(subcontractLedgers.some(x=>x.direction==='outbound'&&x.movement_type==='subcontract_issue_outbound'));

const source=await readFile(new URL('../src/pages/production-inventory-workspace.page.ts',import.meta.url),'utf8');
for(const text of ['入库单号</th><th>类型</th><th>来源</th><th>入库类型</th><th>批次号</th><th>供应商/客户</th>','出库单号</th><th>关联单号</th><th>销售单号</th><th>客户单号</th><th>往来单位</th>','物流信息</th><th>收入确认</th><th>操作员','组装入库','组装出库','委外出库','来源组装单','下一步：生产入库','打印条码','导出','上一页','下一页'])assert.ok(source.includes(text),text);
assert.ok(!source.includes('相关记录 16'));

const report={recordedAt:new Date().toISOString(),kind:'production-inbound-outbound-workspace-readback',endpoint,database,ids:{inbound:inbound.id,inboundAssembly:assembly.id,assemblyOutbound:confirmed.id,assemblyOutboundSource:confirmedAssembly.id,subcontractOutbound:subcontractOutbound.id,subcontractIssue:issue.id},counts:{inbounds:inbounds.length,assemblyOutbounds:outboundDocuments.length,subcontractOutbounds:subcontractOutbounds.length},risemapObserved:{inboundPage:'https://risemap.cn/inventory/inbound/production',inboundColumns:['入库单号','类型','来源','入库类型','批次号','供应商/客户','仓库','入库日期','含税金额','状态','创建人','操作'],outboundPage:'https://risemap.cn/inventory/outbound/production',outboundColumns:['出库单号','关联单号','销售单号','客户单号','往来单位','物料明细','仓库','出库日期','状态','物流信息','收入确认','操作员','操作'],boundary:'当前 RISEMAP 两页均无业务数据；页面结构已实时核对，Forge 业务结果来自已验证的组装、领补料和委外来源单。'},passed:true};
await mkdir('.objectstack/acceptance',{recursive:true});await writeFile('.objectstack/acceptance/production-inventory-workspace-report.json',JSON.stringify(report,null,2));
console.log(`PASS production inventory workspaces: ${inbounds.length} inbounds, ${outboundDocuments.length} assembly outbound documents, ${subcontractOutbounds.length} subcontract outbounds`);
