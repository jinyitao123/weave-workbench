import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const artifact=JSON.parse(await readFile(new URL('../dist/objectstack.json',import.meta.url),'utf8'));
const source=artifact.pages.find(page=>page.name==='page_bank_flow').source;
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function harness({fail=false}={}){
  const transactions=Array.from({length:25},(_,index)=>({id:'tx-'+index,code:'TX-'+String(index+1).padStart(2,'0'),account_id:'account',amount:(index+1)*10,matched_amount:0,direction:index%2?'expense':'income',flow_type:'sales',status:'unmatched',transacted_at:'2026-09-20T08:00:00Z'}));
  const data={loading:false,accounts:[{id:'account',name:'对照账户',status:'active'}],transactions,matches:[],receipts:[{id:'receipt',code:'RC-1',amount:10,account_id:'account',status:'unallocated'}],payments:[],periods:[],error:''};
  const state=[data,{account_id:'account',code:'',transacted_at:'',direction:'income',flow_type:'sales',counterparty_name:'',amount:'',bank_reference:'',book_id:'receipt',match_code:'MATCH-1',matched_on:'2026-09-20',review_comment:'',reason:'',period_code:'',period_name:'',period_start:'',period_end:'',period_comment:''}];
  let cursor=0,requests=0;
  const react={Fragment:Symbol('fragment'),createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(initial){const index=cursor++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;return[state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value}]},useRef(initial){const index=cursor++;if(!(index in state))state[index]={current:initial};return state[index]},useEffect(){}};
  const objects={forge_fund_account:data.accounts,forge_bank_transaction:transactions,forge_bank_transaction_match:[],forge_cash_receipt:data.receipts,forge_cash_payment:[],forge_financial_period:[]};
  const fetchImpl=async path=>{if(path.includes('/actions/')){requests++;return{ok:!fail,json:async()=>fail?{error:'勾兑编号已存在'}:{success:true}}}const object=path.split('/data/')[1]?.split('?')[0];return{ok:true,json:async()=>({records:objects[object]||[]})}};
  const context={exports:{},React:react,useAdapter:()=>({fetchImpl}),URL,Blob,setTimeout,clearTimeout,location:{pathname:'/_console/apps/forge/page/page_bank_flow'}};
  vm.runInNewContext(compiled,context);
  return{state,render(){cursor=0;return context.App()},requests:()=>requests};
}
function nodes(node,predicate,result=[]){if(!node||typeof node!=='object')return result;if(Array.isArray(node)){for(const child of node)nodes(child,predicate,result);return result}if(predicate(node))result.push(node);nodes(node.props?.children,predicate,result);return result}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';

test('25 rows paginate 20 + 5, retaining full-filter totals and a valid last page',()=>{
  const app=harness();let tree=app.render();
  const body=()=>nodes(tree,node=>node.type==='tbody')[0];
  assert.equal(nodes(body(),node=>node.type==='tr').length,20);
  assert.match(text(tree),/收入 ¥1,690.00/);assert.match(text(tree),/支出 ¥1,560.00/);
  nodes(tree,node=>node.props?.['aria-label']==='资金流水下一页')[0].props.onClick();tree=app.render();
  assert.equal(nodes(body(),node=>node.type==='tr').length,5);assert.match(text(tree),/第 2 \/ 2 页/);
  assert.equal(nodes(tree,node=>node.props?.['aria-label']==='资金流水下一页')[0].props.disabled,true);
  app.state[0]={...app.state[0],transactions:app.state[0].transactions.slice(0,3)};tree=app.render();
  assert.equal(nodes(body(),node=>node.type==='tr').length,3);assert.match(text(tree),/第 1 \/ 1 页/);
});

test('failed matching retains both selected transaction and book receipt',async()=>{
  const app=harness({fail:true});app.render();app.state[4]='transactions';app.state[11]='tx-0';
  const submit=nodes(app.render(),node=>node.type==='button'&&text(node)==='发起勾兑')[0];
  await submit.props.onClick();
  assert.equal(app.state[11],'tx-0');assert.equal(app.state[1].book_id,'receipt');
  assert.equal(app.state[0].error,'勾兑编号已存在');assert.equal(app.state[2],false);
});

test('successful matching clears selection once and blocks repeated concurrent submission',async()=>{
  const app=harness();app.render();app.state[4]='transactions';app.state[11]='tx-0';
  const submit=nodes(app.render(),node=>node.type==='button'&&text(node)==='发起勾兑')[0];
  await Promise.all([submit.props.onClick(),submit.props.onClick()]);
  assert.equal(app.requests(),1);assert.equal(app.state[11],'');assert.equal(app.state[1].book_id,'');
});
