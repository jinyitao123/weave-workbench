import assert from 'node:assert/strict';
import test from 'node:test';
import {SalesOrderWorkspacePage} from '../src/pages/sales-order-workspace.page.ts';
import {createServicePageHarness,serviceText} from './service-page-react-harness.mjs';
const order={id:'order-a',code:'SO-A',name:'可读草稿订单',status:'draft',customer_id:'customer-a',contract_id:'contract-a',responsible_id:'actor-a',created_by:'actor-a',contact_id:'contact-a',total_amount:2500,invoiced_amount:0,shipped_amount:0,collected_amount:0,shipment_count:0,created_at:'2026-10-07T00:00:00Z'};
const records={forge_sales_order:[order],forge_sales_order_line:[{id:'line-a',order_id:order.id,name:'可读来源明细',line_type:'service',quantity:1,taxed_subtotal:2500}],forge_sales_contract:[{id:'contract-a',code:'SC-A',name:'可读合同'}],forge_customer:[{id:'customer-a',name:'可读客户'}],forge_contact:[{id:'contact-a',name:'关联联系人'}],sys_user:[{id:'actor-a',name:'原经办人'}],forge_project:[],forge_project_sales_link:[],forge_sales_shipment:[],forge_sales_shipment_line:[]};
function nodes(value,predicate,seen=new Set()){if(!value||typeof value!=='object'||seen.has(value))return[];seen.add(value);return[...(predicate(value)?[value]:[]),...Object.values(value).flatMap(item=>Array.isArray(item)?item.flatMap(child=>nodes(child,predicate,seen)):nodes(item,predicate,seen))]}
const button=(tree,name)=>nodes(tree,n=>n.type==='button'&&serviceText(n).trim()===name)[0];
const response=(value,status=200)=>({ok:status<400,status,headers:new Headers(),json:async()=>value});
function fixture(failures={},source=records,permissions=['sales_order_reviewer']){return createServicePageHarness(SalesOrderWorkspacePage,{globals:{window:{location:{href:'',origin:'http://service-page.test'}}},transport:async(url,options={})=>{assert.equal(options.method||'GET','GET');const parsed=new URL(url),path=parsed.pathname.replace('/api/v1','');if(path==='/auth/me/permissions')return response({systemPermissions:permissions});const object=path.split('/').at(-1);if(failures[object])return response({error:'denied'},failures[object]);const rows=source[object]||[],skip=Number(parsed.searchParams.get('$skip')||0),top=Number(parsed.searchParams.get('$top')||100);return response({records:rows.slice(skip,skip+top),totalCount:rows.length})}})}

test('auxiliary contact and user denial keeps readable reviewer orders and marks unavailable names and filters',async()=>{const h=fixture({forge_contact:403,sys_user:403});const tree=await h.flushEffects();const text=serviceText(tree);assert.ok(text.includes('可读草稿订单'));assert.ok(text.includes('联系人不可读取'));assert.ok(text.includes('人员不可读取'));for(const label of ['负责人','客户联系人'])assert.equal(nodes(tree,n=>n.props?.label===label)[0].props.disabled,true);assert.equal(h.calls.some(call=>call.path.startsWith('/actions/')),false)});

test('primary order denial and any expired auxiliary session invalidate the entire list',async()=>{for(const failure of [{forge_sales_order:403},{sys_user:401}]){const h=fixture(failure);const tree=await h.flushEffects();assert.ok(serviceText(tree).includes(failure.sys_user?'登录':'无权'));assert.ok(!serviceText(tree).includes('可读草稿订单'));assert.equal(nodes(tree,n=>n.type==='ForgeEmpty').length,0)}});

test('unread lines remain unavailable rather than zero and unavailable shipment reads cannot enable shipment creation',async()=>{const h=fixture({forge_sales_order_line:403,forge_sales_shipment:403,forge_sales_shipment_line:403},records,['sales_order_fulfillment_operator']);const tree=await h.flushEffects();assert.ok(serviceText(tree).includes('可读草稿订单'));assert.match(serviceText(tree),/订单明细\s*不可读取/);assert.equal(button(tree,'订单明细 0'),undefined);assert.ok(nodes(tree,n=>n.type==='button'&&serviceText(n).startsWith('订单明细'))[0].props.disabled)});

test('masked finance values stay unknown and true zero stays readable in totals and progress',async()=>{const masked={...order};delete masked.total_amount;delete masked.invoiced_amount;const h=fixture({}, {...records,forge_sales_order:[masked]});const tree=await h.flushEffects();assert.ok(serviceText(tree).includes('金额不可读取'));assert.ok(!serviceText(tree).includes('本页金额 ¥ 0.00'));assert.ok(serviceText(tree).includes('不可读取'));const zero=fixture({}, {...records,forge_sales_order:[{...order,total_amount:0}]});assert.ok(serviceText(await zero.flushEffects()).includes('¥ 0.00'))});

test('no order role prevents data reads, while legitimate empty lists remain distinguishable from failures',async()=>{const none=fixture({},records,[]);const tree=await none.flushEffects();assert.ok(serviceText(tree).includes('没有销售订单查看权限'));assert.equal(none.calls.some(call=>call.path.startsWith('/data/')),false);const empty=fixture({}, {...records,forge_sales_order:[]});assert.ok(nodes(await empty.flushEffects(),n=>n.type==='ForgeEmpty'&&n.props.title==='暂无符合条件的销售订单').length)});

test('shipment planning stays disabled when shipment data is unavailable and readable order lines remain displayed',async()=>{
 const source={...records,forge_sales_order:[{...order,status:'active'}],forge_sales_order_line:[{...records.forge_sales_order_line[0],line_type:'material',sku_id:'sku-a',quantity:10}]};
 const h=fixture({forge_sales_shipment:403},source,['sales_order_fulfillment_operator']);const tree=await h.flushEffects();assert.ok(serviceText(tree).includes('可读草稿订单'));assert.equal(button(tree,'发货建单').props.disabled,true);
});

test('auxiliary service failure and incomplete contract labels remain explicit while authorized order records survive',async()=>{
 const h=fixture({forge_sales_contract:503});const tree=await h.flushEffects();assert.ok(serviceText(tree).includes('可读草稿订单'));assert.ok(serviceText(tree).includes('合同不可读取'));
});
