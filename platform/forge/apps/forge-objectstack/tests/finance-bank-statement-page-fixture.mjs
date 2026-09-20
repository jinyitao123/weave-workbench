import assert from 'node:assert/strict';
import {connect} from '../scripts/api-client.mjs';
const endpoint=process.env.FORGE_URL;assert.equal(endpoint,'http://localhost:4442');
const api=await connect(endpoint),prefix='BS-PAGE-20260920',readback=process.argv.includes('--readback');
const find=async(object,where={})=>{const q=new URLSearchParams({$filter:JSON.stringify(where),$top:'200'}),r=await api.request('/data/'+object+'?'+q);assert.equal(r.status,200);return r.value.records||[]};
const invoke=async(object,action,id,params)=>{const r=await api.request('/actions/'+object+'/'+action+'/'+id,'POST',{params});assert.equal(r.status,200,JSON.stringify(r.value));return r.value.result??r.value.data?.result??r.value.data??r.value};
let account=(await find('forge_fund_account',{code:prefix}))[0];
if(!account&&!readback){const r=await api.request('/data/forge_fund_account','POST',{name:'对照银行余额对账账户',code:prefix,account_type:'bank',bank_name:'对照银行',account_number:prefix,currency:'cny',opening_balance:100,opening_on:'2026-09-01',status:'active',responsible_id:api.userId});assert.equal(r.status,201,JSON.stringify(r.value));account=(await find('forge_fund_account',{code:prefix}))[0]}
assert.ok(account);
if(!readback)for(const kind of ['CANCEL','REVERSE','BLOCKED']){
 const code=prefix+'-'+kind;
 if((await find('forge_bank_statement_import_batch',{code})).length)continue;
 const csv='transaction_time,direction,amount,counterparty_name,bank_reference,flow_type\n2026-09-20T08:00:00+08:00,income,10,对照单位,'+code+'-IN,other\n2026-09-20T09:00:00+08:00,expense,10,对照单位,'+code+'-OUT,other';
 const staged=await invoke('forge_fund_account','fund_account_stage_bank_statement',account.id,{code,file_name:code+'.csv',period_start:'2026-09-01',period_end:'2026-09-30',statement_opening_balance:100,statement_closing_balance:100,csv_content:csv});
 if(kind!=='CANCEL'){
  const posted=await invoke('forge_bank_statement_import_batch','bank_statement_batch_post',staged.id,{posting_comment:'对照页面材料生成银行证据'});
  if(kind==='BLOCKED')await invoke('forge_bank_balance_reconciliation','bank_reconciliation_confirm',posted.reconciliation_id,{confirmation_comment:'对照余额一致，验证撤回阻断'});
 }
}
const batches=await find('forge_bank_statement_import_batch',{account_id:account.id}),recons=await find('forge_bank_balance_reconciliation',{account_id:account.id});
assert.equal(batches.length,3);assert.equal(recons.length,2);
assert.ok(recons.some(row=>row.status==='confirmed'));
const liveAccount=(await find('forge_fund_account',{id:account.id}))[0];assert.equal(liveAccount.current_balance??liveAccount.opening_balance,100);
console.log(JSON.stringify({kind:readback?'restart-readback':'browser-fixture',endpoint,accountId:account.id,batches:batches.map(({id,code,status})=>({id,code,status})),reconciliations:recons.map(({id,status})=>({id,status})),bookBalance:100,passed:true},null,2));
