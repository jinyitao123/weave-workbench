import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const artifact=JSON.parse(await readFile(new URL('../dist/objectstack.json',import.meta.url),'utf8'));
const source=artifact.pages.find(page=>page.name==='page_bank_statement').source;
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness({fail=false,empty=false}={}){
  const data={loading:false,accounts:[{id:'account',name:'对照银行',status:'active',account_type:'bank'}],batches:empty?[]:[{id:'batch',code:'BS-TEST',account_id:'account',status:'staged',ready_count:1}],rows:[],recons:[],error:''};
  const state=[data];let cursor=0,requests=[];
  const react={Fragment:Symbol('fragment'),createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(initial){const index=cursor++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return[state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value}]},useRef(initial){const index=cursor++;if(!(index in state))state[index]={current:initial};return state[index]},useEffect(){}};
  const objects={forge_fund_account:data.accounts,forge_bank_statement_import_batch:[],forge_bank_statement_import_row:[],forge_bank_balance_reconciliation:[]};
  const fetchImpl=async(path,options)=>{if(path.includes('/actions/')){requests.push({path,...JSON.parse(options.body)});return{ok:!fail,json:async()=>fail?{error:'批次流水已勾兑，不能撤回'}:{success:true}}}return{ok:true,json:async()=>({records:objects[path.split('/data/')[1]?.split('?')[0]]||[]})}};
  const context={exports:{},React:react,useAdapter:()=>({fetchImpl}),URL,Blob,setTimeout,clearTimeout,location:{pathname:'/_console/apps/forge/page/page_bank_statement'}};
  vm.runInNewContext(compiled,context);
  return{state,render(){cursor=0;return context.exports.default()},requests};
}
function nodes(node,predicate,result=[]){if(!node||typeof node!=='object')return result;if(Array.isArray(node)){for(const child of node)nodes(child,predicate,result);return result}if(predicate(node))result.push(node);nodes(node.props?.children,predicate,result);return result}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
const button=(tree,label)=>nodes(tree,node=>node.type==='button'&&text(node)===label)[0];
const dialog=tree=>nodes(tree,node=>typeof node.type==='function'&&node.type.name==='ForgeDialog')[0];

test('empty tables retain headers and give distinct next-step guidance',()=>{
  const tree=harness({empty:true}).render();
  assert.equal(nodes(tree,node=>node.type==='th').length,20);
  assert.deepEqual(nodes(tree,node=>typeof node.type==='function'&&node.type.name==='ForgeEmpty').map(node=>node.props.title),['暂无导入批次','暂无余额对账记录']);
});
test('cancel opens object-specific confirmation without a write; empty reason is blocked',async()=>{
  const app=harness();button(app.render(),'取消').props.onClick();
  assert.equal(app.requests.length,0);const confirm=dialog(app.render());
  assert.equal(confirm.props.danger,true);assert.match(confirm.props.subtitle,/BS-TEST.*对照银行/);
  assert.match(text(confirm),/不能恢复/);await confirm.props.onConfirm();
  assert.equal(app.requests.length,0);assert.equal(dialog(app.render()).props.error,'请填写操作原因');
  dialog(app.render()).props.onCancel();assert.equal(dialog(app.render()),undefined);
});
test('a rejected reversal keeps its object, reason and visible error',async()=>{
  const app=harness({fail:true});app.state[0].batches[0].status='posted';button(app.render(),'撤回导入').props.onClick();
  let tree=app.render();nodes(tree,node=>node.type==='textarea'&&node.props['aria-label']==='银行批次操作原因')[0].props.onChange({target:{value:'对照撤回原因'}});
  await dialog(app.render()).props.onConfirm();
  assert.equal(app.state[3].id,'batch');assert.equal(app.state[3].reason,'对照撤回原因');assert.equal(dialog(app.render()).props.error,'批次流水已勾兑，不能撤回');
  assert.equal(app.requests[0].params.reversal_reason,'对照撤回原因');
});
test('confirmed cancellation submits once then closes after refreshing',async()=>{
  const app=harness();button(app.render(),'取消').props.onClick();
  nodes(app.render(),node=>node.type==='textarea'&&node.props['aria-label']==='银行批次操作原因')[0].props.onChange({target:{value:'取消测试'}});
  const confirm=dialog(app.render());await Promise.all([confirm.props.onConfirm(),confirm.props.onConfirm()]);
  assert.equal(app.requests.length,1);assert.equal(app.requests[0].params.reversal_reason,'取消测试');
  assert.equal(dialog(app.render()),undefined);assert.match(text(app.render()),/操作成功，列表与状态已更新/);
});
