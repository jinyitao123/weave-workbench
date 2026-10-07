import assert from 'node:assert/strict';
import test from 'node:test';
import { projectActorScope, projectScopeFields, PROJECT_SCOPE_REQUIRED_FIELDS } from '../src/plugins/project-delivery-actor-projection.ts';

const actor={userId:'employee',tenantId:'org',isSystem:false};
const security={canReadObject:async()=>true,getReadableFields:async object=>[...PROJECT_SCOPE_REQUIRED_FIELDS[object],'unit_name']};
const rows={
  forge_sales_order:{id:'order',code:'可见订单',customer_id:'customer',contract_id:'contract',quotation_id:'quote',status:'active'},
  forge_sales_contract:{id:'contract',code:'可见合同',customer_id:'customer',quotation_id:'quote',status:'active',signed_on:'2026-10-07',signed_evidence_attachment:'file'},
  forge_quotation:{id:'quote',code:'可见报价',customer_id:'customer',status:'accepted',pricing_version:1,accepted_pricing_version:1,customer_acceptance_evidence_attachment:'file'},
  forge_sales_order_line:{id:'order-line',order_id:'order',contract_line_id:'contract-line',quotation_line_id:'quote-line',name:'可见设备',line_type:'material',quantity:2,taxed_unit_price:900,tax_rate:0,discount_rate:0,taxed_subtotal:1800,unit_name:'台'},
  forge_sales_contract_line:{id:'contract-line',contract_id:'contract',quotation_line_id:'quote-line',name:'可见设备',line_type:'material',quantity_limit:2,taxed_unit_price:900,tax_rate:0,discount_rate:0,taxed_subtotal:1800},
  forge_quotation_line:{id:'quote-line',quotation_id:'quote',name:'可见设备',line_type:'material',quantity:2,taxed_unit_price:900,tax_rate:0,discount_rate:0,taxed_subtotal:1800},
};
const binding={links:[{order_id:'order',contract_id:'contract',quotation_id:'quote'}],rows:[{order_id:'order',order_line_id:'order-line',contract_line_id:'contract-line',quotation_line_id:'quote-line',trace_consistent:true}]};
const reader={get:async object=>({...rows[object]}),query:async object=>({records:[{...rows[object]}],total:1})};
const trusted={sources:[{order_code:'HIDDEN-SNAPSHOT'}],lines:[{name:'HIDDEN-SYSTEM',quantity:999,taxed_unit_price:999,cost_price:777}],warnings:[]};

test('native no-answer is never an all-readable field set',async()=>{
  for(const value of [undefined,null,{},'all'])await assert.rejects(()=>projectScopeFields({...security,getReadableFields:async()=>value},actor,'forge_sales_order_line'),error=>error.code==='PROJECT_SCOPE_PERMISSION_UNAVAILABLE');
  await assert.rejects(()=>projectScopeFields({...security,getReadableFields:async()=>[]},actor,'forge_sales_order_line'),error=>error.code==='PROJECT_SCOPE_FIELDS_FORBIDDEN');
  await assert.rejects(()=>projectScopeFields(security,{...actor,isSystem:true},'forge_sales_order_line'),error=>error.code==='PROJECT_SCOPE_PERMISSION_UNAVAILABLE');
  await assert.rejects(()=>projectScopeFields({...security,canReadObject:async()=>undefined},actor,'forge_sales_order_line'),error=>error.code==='PROJECT_SCOPE_PERMISSION_UNAVAILABLE');
});

test('public header and rows come only from the actor-native values, never the trusted body snapshot',async()=>{
  const result=await projectActorScope(reader,security,actor,'customer',binding,trusted);
  assert.deepEqual(result.sources,[{contract_code:'可见合同',order_code:'可见订单',order_status:'active',source_version_valid:true,quotation_code:'可见报价',accepted_pricing_version:1}]);
  assert.equal(result.lines[0].name,'可见设备');assert.equal(result.lines[0].quantity,2);assert.equal(result.lines[0].taxed_unit_price,900);assert.equal(result.lines[0].unit_name,'台');
  assert.ok(!JSON.stringify(result).includes('HIDDEN'));assert.ok(!('cost_price'in result.lines[0]));assert.ok(!('_server_binding'in result));
});

test('any required scope field denial or missing actor value closes the entire projection',async()=>{
  for(const [object,fields]of Object.entries(PROJECT_SCOPE_REQUIRED_FIELDS))for(const field of fields){
    const masked={...security,getReadableFields:async current=>current===object?[...fields].filter(value=>value!==field):security.getReadableFields(current)};
    await assert.rejects(()=>projectActorScope(reader,masked,actor,'customer',binding,trusted),error=>error.code==='PROJECT_SCOPE_FIELDS_FORBIDDEN');
  }
  for(const [object,field]of [['forge_sales_order','code'],['forge_sales_contract','code'],['forge_quotation','code'],['forge_sales_order_line','quantity'],['forge_sales_contract_line','quantity_limit'],['forge_quotation_line','taxed_unit_price']]){
    const modified={...rows[object]};delete modified[field];
    const partial={get:async name=>name===object?modified:reader.get(name),query:async name=>name===object?{records:[modified],total:1}:reader.query(name)};
    await assert.rejects(()=>projectActorScope(partial,security,actor,'customer',binding,trusted),error=>error.code==='PROJECT_SCOPE_FIELDS_FORBIDDEN');
  }
});

test('diagnostics name only the precise failing stage, object and static fields',async()=>{
  const secret='DO-NOT-LOG-native-id-business-value-file-error';
  const failRead={...reader,get:async()=>{throw new Error(secret);}};
  const change=(object,patch)=>({get:async name=>({...rows[name],...(name===object?patch:{})}),query:async name=>({records:[{...rows[name],...(name===object?patch:{})}],total:1})});
  const cases=[
    ['field-service','forge_sales_order',503,[],{...security,getReadableFields:async object=>object==='forge_sales_order'?undefined:security.getReadableFields(object)},reader,binding],
    ['field-service','forge_sales_order',503,[],{...security,getReadableFields:object=>{if(object==='forge_sales_order')throw new Error(secret);return security.getReadableFields(object);}},reader,binding],
    ['field-service','forge_sales_order_line',403,['taxed_unit_price'],{...security,getReadableFields:async object=>(await security.getReadableFields(object)).filter(field=>object!=='forge_sales_order_line'||field!=='taxed_unit_price')},reader,binding],
    ['object-admission','forge_sales_order',403,[],{...security,canReadObject:async object=>object!=='forge_sales_order'},reader,binding],
    ['object-admission','forge_sales_order',503,[],{...security,canReadObject:async object=>object==='forge_sales_order'?undefined:true},reader,binding],
    ['header-read','forge_sales_order',403,[],security,failRead,binding],
    ['row-query-count','forge_quotation_line',403,[],security,{...reader,query:async object=>object==='forge_quotation_line'?{records:[],total:0}:reader.query(object)},binding],
    ['source-match','forge_sales_contract',403,['code'],security,change('forge_sales_contract',{code:null}),binding],
    ['source-match','forge_quotation',403,['customer_id'],security,change('forge_quotation',{customer_id:secret}),binding],
    ['line-fields','forge_quotation_line',403,['taxed_unit_price'],security,change('forge_quotation_line',{taxed_unit_price:secret}),binding],
    ['trace-match','forge_sales_order_line',403,['contract_line_id'],security,change('forge_sales_order_line',{contract_line_id:secret}),binding],
    ['trace-match','forge_sales_order_line',403,['contract_line_id','quotation_line_id'],security,reader,{...binding,rows:[{...binding.rows[0],quotation_line_id:secret}]}],
  ];
  for(const [stage,object,code,fields,currentSecurity,currentReader,currentBinding]of cases){
    const logs=[];
    await assert.rejects(()=>projectActorScope(currentReader,currentSecurity,actor,'customer',currentBinding,trusted,metadata=>logs.push(metadata)),error=>error.status===code);
    assert.ok(logs.some(log=>log.stage===stage&&log.object===object),stage);
    const expected=logs.find(log=>log.stage===stage&&log.object===object);
    assert.deepEqual(expected,{event:'project-scope-check-failed',stage,object,fields,code});
    for(const log of logs){assert.deepEqual(Object.keys(log).sort(),['code','event','fields','object','stage']);assert.ok(!JSON.stringify(log).includes(secret));}
  }
  const logs=[];await projectActorScope(reader,security,actor,'customer',binding,trusted,metadata=>logs.push(metadata));assert.deepEqual(logs,[]);
  await assert.rejects(()=>projectScopeFields({...security,getReadableFields:async()=>undefined},actor,'forge_sales_order',()=>{throw new Error(secret);}),error=>error.code==='PROJECT_SCOPE_PERMISSION_UNAVAILABLE');
});
