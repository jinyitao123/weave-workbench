import assert from 'node:assert/strict';
import test from 'node:test';
import {SalesOrderCreatePage} from '../src/pages/sales-order-create.page.ts';
import {createServicePageHarness,serviceText} from './service-page-react-harness.mjs';
const contract={id:'contract-a',name:'有效合同',code:'SC-A',customer_id:'customer-a',status:'active',signed_on:'2026-10-01',signed_evidence_attachment:['synthetic']};
function nodes(value,predicate,seen=new Set()){if(!value||typeof value!=='object'||seen.has(value))return[];seen.add(value);return[...(predicate(value)?[value]:[]),...Object.values(value).flatMap(item=>Array.isArray(item)?item.flatMap(child=>nodes(child,predicate,seen)):nodes(item,predicate,seen))]}
async function selected(){const h=createServicePageHarness(SalesOrderCreatePage,{permissions:['sales_order_operator'],globals:{window:{location:{href:''}}},records:{forge_sales_contract:[contract],forge_customer:[{id:'customer-a',name:'客户'}],forge_sales_contract_line:[{id:'line-a',contract_id:contract.id,name:'服务',line_type:'service',quantity_limit:1,ordered_quantity:0,taxed_unit_price:1,taxed_subtotal:1,tax_rate:0,discount_rate:0}]}});await h.flushEffects();nodes(h.render(),n=>n.props?.['aria-label']==='选择有效销售合同')[0].props.onChange({target:{value:contract.id}});await h.flushEffects();return h}
const create=tree=>nodes(tree,n=>n.type==='button'&&serviceText(n)==='创建订单草稿')[0];

test('order information consumes the existing native validation controller with action-specific required overrides',async()=>{
 const h=await selected();const form=h.forms.at(-1);assert.ok(form,'ObjectForm must own field errors');assert.equal(form.objectName,'forge_sales_order');assert.equal(form.mode,'create');assert.equal(form.showSubmit,false);assert.equal(form.showCancel,false);assert.equal(form.showReset,false);
 assert.deepEqual([...form.fields],['name','code','planned_delivery_on','payment_term','payment_method','delivery_address']);
 assert.equal(form.customFields.find(field=>field.name==='code').required,false);assert.equal(form.customFields.find(field=>field.name==='payment_method').required,true);
 assert.equal(form.customFields.find(field=>field.name==='code').label,'订单编号');assert.equal(form.customFields.find(field=>field.name==='payment_method').type,'select');assert.ok(form.customFields.find(field=>field.name==='payment_method').options.length);
 assert.equal(form.values.contract_id,contract.id);
});

test('a native invalid or unavailable controller preserves the form and never reaches the creation action',async()=>{
 for(const controller of [null,{validate:async()=>({valid:false,errors:{payment_term:'required'},values:{}})}]){
  const h=await selected();const form=h.forms.at(-1);assert.ok(form);form.onValuesChange({...form.values,name:'中文填写保留'});h.render();const tree=h.render();h.forms.at(-1).onControllerReady(controller);
  await create(tree).props.onClick();assert.equal(h.calls.some(call=>call.path.startsWith('/actions/')),false);assert.equal(h.forms.at(-1).values.name,'中文填写保留');
 }
});

test('validated native values are used for the original action, and extra native defaults cannot leak into local dirty state',async()=>{
 const h=await selected();const form=h.forms.at(-1);assert.ok(form);
 form.onValuesChange({...form.values,status:'draft',owner_id:'internal-default',revision:1});h.render();
 assert.equal(Object.hasOwn(h.forms.at(-1).values,'owner_id'),false);assert.equal(Object.hasOwn(h.forms.at(-1).values,'revision'),false);
 const tree=h.render();h.forms.at(-1).onControllerReady({validate:async()=>({valid:true,errors:{},values:{name:'校验后的名称',code:'',planned_delivery_on:'2026-10-20',payment_term:'已确认条款',payment_method:'bank_transfer',delivery_address:'校验后的地址'}})});
 await create(tree).props.onClick();const call=h.calls.find(call=>call.path.includes('/contract_convert_to_sales_order/'));assert.ok(call);assert.equal(call.body.params.name,'校验后的名称');assert.equal(call.body.params.delivery_address,'校验后的地址');
});
