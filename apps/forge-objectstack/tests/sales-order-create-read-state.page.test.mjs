import assert from 'node:assert/strict';
import test from 'node:test';
import { SalesOrderCreatePage } from '../src/pages/sales-order-create.page.ts';
import { createServicePageHarness, serviceText } from './service-page-react-harness.mjs';

const contractA={id:'contract-a',name:'来源甲',code:'SC-A',customer_id:'customer-a',status:'active',signed_on:'2026-10-01',signed_evidence_attachment:['synthetic']};
const contractB={...contractA,id:'contract-b',name:'来源乙',code:'SC-B',customer_id:'customer-b'};
const line=(contract,index=0)=>({id:contract.id+'-line-'+index,contract_id:contract.id,name:contract.name+'设备'+index,line_type:'service',quantity_limit:3,ordered_quantity:2,taxed_unit_price:1,taxed_subtotal:1,tax_rate:0,discount_rate:0});
function nodes(value,predicate,seen=new Set()){if(!value||typeof value!=='object'||seen.has(value))return[];seen.add(value);return[...(predicate(value)?[value]:[]),...Object.values(value).flatMap(item=>Array.isArray(item)?item.flatMap(child=>nodes(child,predicate,seen)):nodes(item,predicate,seen))]}
function named(tree,label){return nodes(tree,node=>node.props?.['aria-label']===label)[0]}
function button(tree,label){return nodes(tree,node=>node.type==='button'&&serviceText(node).trim()===label)[0]}
function choose(h,id){named(h.render(),'选择有效销售合同').props.onChange({target:{value:id}});return h.render()}
const response=(value,status=200)=>({ok:status<400,status,headers:new Headers(),json:async()=>value});
function fixture({contracts=[contractA,contractB],lines=[line(contractA),line(contractB)],read,permissions=['sales_order_operator']}={}){
 const location={href:''};
 const h=createServicePageHarness(SalesOrderCreatePage,{globals:{window:{location}},transport:async(url,options={})=>{
  const parsed=new URL(url),route=parsed.pathname.replace('/api/v1','');
  if(route==='/auth/me/permissions')return response({systemPermissions:permissions});
  const custom=await read?.({route,query:parsed.searchParams,options});if(custom)return custom;
  if(route==='/data/forge_sales_contract'){const skip=Number(parsed.searchParams.get('$skip')||0),top=Number(parsed.searchParams.get('$top')||100);return response({records:contracts.slice(skip,skip+top),totalCount:contracts.length})}
  if(route.startsWith('/data/forge_customer/'))return response({id:route.split('/').at(-1),name:'所选客户'});
  if(route==='/data/forge_customer'){const ids=JSON.parse(parsed.searchParams.get('$filter')||'{}').id?.$in,rows=[{id:'customer-a',name:'客户甲'},{id:'customer-b',name:'客户乙'}].filter(row=>!ids||ids.includes(row.id));return response({records:rows,totalCount:rows.length})}
  if(route==='/data/forge_sales_contract_line'){const where=JSON.parse(parsed.searchParams.get('$filter')||'{}'),matched=where.contract_id?lines.filter(row=>row.contract_id===where.contract_id):lines,skip=Number(parsed.searchParams.get('$skip')||0),top=Number(parsed.searchParams.get('$top')||100);return response({records:matched.slice(skip,skip+top),totalCount:matched.length})}
  if(route.startsWith('/actions/'))return response({error:'write not permitted in read-state test'},403);
  return response({});
 }});return{h,location};
}
function table(h){return nodes(h.render(),node=>node.type==='RecordTable')[0]}
function readonlyCalls(h){assert.equal(h.calls.some(call=>call.path.startsWith('/actions/')),false)}

test('initial read loads all eligible contracts and only their customer labels without loading lines',async()=>{
 const contracts=Array.from({length:601},(_,i)=>({...contractA,id:'contract-'+i}));
 const {h}=fixture({contracts});await h.flushEffects();
 assert.equal(h.calls.some(call=>call.path==='/data/forge_sales_contract_line'),false,'line reads must wait for selection');
 for(const call of h.calls.filter(call=>call.path==='/data/forge_customer')){const query=new URL('http://test'+call.url).searchParams;assert.deepEqual(JSON.parse(query.get('$filter')).id.$in,['customer-a']);assert.equal(query.get('$select'),'id,name')}
 const options=nodes(h.render(),node=>node.type==='option'&&node.props.value);
 assert.equal(options.length,601,'contracts beyond the old 500-row ceiling remain selectable');readonlyCalls(h);
});

test('the selected contract is read completely, rendered through the public table and totaled over all pages',async()=>{
 const lines=Array.from({length:601},(_,i)=>line(contractA,i));const {h}=fixture({lines});await h.flushEffects();choose(h,contractA.id);await h.flushEffects();
 const reads=h.calls.filter(call=>call.path==='/data/forge_sales_contract_line');assert.equal(reads.length,7);
 for(const call of reads)assert.equal(JSON.parse(new URL('http://test'+call.url).searchParams.get('$filter')).contract_id,contractA.id);
 assert.ok(h.calls.filter(call=>call.path==='/data/forge_customer').every(call=>new URL('http://test'+call.url).searchParams.get('$select')==='id,name'));
 const schema=table(h)?.props.schema;assert.ok(schema);assert.equal(schema.rowCount,601);assert.equal(schema.data.length,20);
 assert.ok(serviceText(h.render()).includes('200.3133'),'amount uses the existing native four-decimal cumulative rule over the full source');
 schema.onPageChange(31);assert.equal(table(h).props.schema.data.at(-1).id,lines.at(-1).id);readonlyCalls(h);
});

test('a current source rejection or incomplete page never becomes empty lines or zero totals and can be retried',async()=>{
 for(const mode of ['denied','expired','incomplete','masked']){
  let failing=true;
  const {h}=fixture({read:({route,query})=>{
   if(route!=='/data/forge_sales_contract_line'||!failing)return;
   if(mode==='denied')return response({error:'rejected'},403);
   if(mode==='expired')return response({error:'expired'},401);
   if(mode==='incomplete')return response({records:[],totalCount:1});
   const masked={...line(contractA)};delete masked.taxed_subtotal;return response({records:[masked],totalCount:1});
  }});await h.flushEffects();choose(h,contractA.id);await h.flushEffects();
  assert.equal(table(h),undefined);assert.equal(button(h.render(),'创建订单草稿').props.disabled,true);
  const text=serviceText(h.render());assert.ok(text.includes(mode==='denied'?'无权':mode==='expired'?'登录':mode==='masked'?'价税':'完整'));
  assert.ok(!text.includes('合同明细已全部下单'));readonlyCalls(h);
  failing=false;button(h.render(),'重新读取来源').props.onClick();await h.flushEffects();assert.equal(table(h).props.schema.rowCount,1);readonlyCalls(h);
 }
});

test('clearing a source removes stale rows and prevents creation while a source is loading',async()=>{
 let finish,started;const ready=new Promise(resolve=>{started=resolve});
 const {h}=fixture({read:({route,query})=>{if(route==='/data/forge_sales_contract_line'&&JSON.parse(query.get('$filter')||'{}').contract_id===contractA.id){started();return new Promise(resolve=>{finish=resolve})}}});
 await h.flushEffects();choose(h,contractA.id);const loading=h.flushEffects();
 await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('selected source was not requested')),1000))]);
 assert.equal(button(h.render(),'创建订单草稿').props.disabled,true);
 choose(h,'');const clearing=h.flushEffects();finish(response({records:[line(contractA)],totalCount:1}));await Promise.all([loading,clearing]);
 assert.equal(table(h),undefined);assert.ok(!serviceText(h.render()).includes('来源甲设备'));readonlyCalls(h);
});

test('a late source success or denial cannot replace the currently selected contract', {timeout:5000},async()=>{
  for(const status of [200,403]){
   let finish,started,latestStarted;
   const oldReady=new Promise(resolve=>{started=resolve}),newReady=new Promise(resolve=>{latestStarted=resolve});
   const {h}=fixture({read:({route,query})=>{
    if(route!=='/data/forge_sales_contract_line')return;
    const id=JSON.parse(query.get('$filter')||'{}').contract_id;
    if(id===contractA.id){started();return new Promise(resolve=>{finish=resolve})}
    if(id===contractB.id){latestStarted();return response({records:[line(contractB)],totalCount:1})}
   }});await h.flushEffects();choose(h,contractA.id);const oldLoad=h.flushEffects();await oldReady;
   choose(h,contractB.id);const newLoad=h.flushEffects();await newReady;
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(table(h).props.schema.data[0].contract_id,contractB.id);
   finish(status===200?response({records:[line(contractA)],totalCount:1}):response({error:'old denial'},403));
   await Promise.all([oldLoad,newLoad]);
   assert.equal(table(h).props.schema.data[0].contract_id,contractB.id);
   assert.ok(!serviceText(h.render()).includes('无权'));readonlyCalls(h);
  }
 });

test('unavailable permissions prevent source reads and oversized contracts never mount a partial table',async()=>{
  const {h:denied}=fixture({permissions:[]});await denied.flushEffects();assert.equal(denied.calls.some(call=>call.path.startsWith('/data/')),false);
  const {h}=fixture({lines:Array.from({length:1001},(_,i)=>line(contractA,i))});await h.flushEffects();choose(h,contractA.id);await h.flushEffects();
  assert.equal(table(h),undefined);assert.equal(button(h.render(),'创建订单草稿').props.disabled,true);assert.ok(serviceText(h.render()).includes('上限'));readonlyCalls(h);
 });
