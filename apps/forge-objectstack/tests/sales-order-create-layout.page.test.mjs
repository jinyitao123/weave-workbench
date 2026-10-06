import assert from 'node:assert/strict';
import test from 'node:test';
import { SalesOrderCreatePage } from '../src/pages/sales-order-create.page.ts';
import { createServicePageHarness,serviceText } from './service-page-react-harness.mjs';

const contract={id:'contract-a',name:'有效合同',code:'SC-A',customer_id:'customer-a',status:'active',signed_on:'2026-10-01',signed_evidence_attachment:['synthetic'],total_amount:25};
function nodes(value,predicate,seen=new Set()){if(!value||typeof value!=='object'||seen.has(value))return[];seen.add(value);return[...(predicate(value)?[value]:[]),...Object.values(value).flatMap(item=>Array.isArray(item)?item.flatMap(child=>nodes(child,predicate,seen)):nodes(item,predicate,seen))]}
function fixture(){return createServicePageHarness(SalesOrderCreatePage,{permissions:['sales_order_operator'],globals:{window:{location:{href:''}}},records:{forge_sales_contract:[contract],forge_customer:[{id:'customer-a',name:'来源客户'}],forge_sales_contract_line:[{id:'line-a',contract_id:contract.id,name:'服务',line_type:'service',quantity_limit:1,ordered_quantity:0,taxed_unit_price:25,taxed_subtotal:25,tax_rate:0,discount_rate:0}]}})}
async function selected(){const h=fixture();await h.flushEffects();nodes(h.render(),n=>n.props?.['aria-label']==='选择有效销售合同')[0].props.onChange({target:{value:contract.id}});await h.flushEffects();return h}

test('the actual order page uses public header, document sections and a single host-owned bottom action group',async()=>{
 const h=await selected(),tree=h.render(),workspace=nodes(tree,n=>n.type==='DocumentWorkspace')[0];
 assert.ok(workspace,'actual exported Page must consume the shared document workspace');assert.equal(workspace.props.sidebar,undefined);assert.equal(workspace.props.footerLabel,'订单操作');
 assert.deepEqual(nodes(workspace.props.main,n=>n.type==='DocumentSection').map(n=>n.props.title),['订单来源','订单信息','合同剩余明细']);
 const header=nodes(tree,n=>n.type==='WorkspaceHeader')[0];assert.equal(header.props.title,'新建销售订单');assert.equal(header.props.subtitle,undefined);
 const buttons=nodes(workspace.props.footer,n=>n.type==='button').map(n=>serviceText(n));assert.deepEqual([...new Set(buttons)],['取消','创建订单草稿']);
 assert.equal(nodes(workspace.props.main,n=>n.type==='button'&&serviceText(n)==='创建订单草稿').length,0);
 assert.ok(serviceText(workspace.props.footer).includes('25.00'));assert.equal(h.calls.some(call=>call.path.startsWith('/actions/')),false);
});

test('the public frame contains exactly one native form with only the existing editable order fields',async()=>{
 const h=await selected(),tree=h.render();assert.match(tree.props.className,/forge-sales-order-create/);
 const forms=nodes(tree,n=>n.type==='ObjectForm');assert.equal(forms.length,1);assert.equal(forms[0].props.objectName,'forge_sales_order');assert.equal(forms[0].props.columns,2);
 assert.deepEqual([...forms[0].props.fields],['name','code','planned_delivery_on','payment_term','payment_method','delivery_address']);
 assert.equal(forms[0].props.showSubmit,false);assert.equal(forms[0].props.showCancel,false);assert.equal(nodes(tree,n=>n.type==='fieldset').length,1);
});
