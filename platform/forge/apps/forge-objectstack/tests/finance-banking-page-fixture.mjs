import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL;
assert.equal(endpoint,'http://localhost:4442','This fixture is restricted to the isolated banking page environment');
const api=await connect(endpoint),prefix='BF-PAGE-20260920';
const find=async(object,where={})=>{
  const query=new URLSearchParams({$top:'200',$filter:JSON.stringify(where)});
  const response=await api.request('/data/'+object+'?'+query);
  assert.equal(response.status,200);
  return response.value.records||[];
};
const create=async(object,fields)=>{
  const response=await api.request('/data/'+object,'POST',fields);
  assert.equal(response.status,201,JSON.stringify(response.value));
  return response.value.id||response.value.record?.id;
};
let account=(await find('forge_fund_account',{code:prefix}))[0];
if(!account&&!process.argv.includes('--readback')){
  const id=await create('forge_fund_account',{name:'对照资金流水分页账户',code:prefix,account_type:'bank',bank_name:'对照银行',account_number:prefix,currency:'cny',opening_balance:0,opening_on:'2026-09-01',status:'active',responsible_id:api.userId});
  account=(await find('forge_fund_account',{id}))[0];
}
assert.ok(account,'Fixture account must survive restart');
let rows=await find('forge_bank_transaction',{account_id:account.id});
if(!process.argv.includes('--readback'))for(let i=1;i<=25;i++){
  const code=prefix+'-'+String(i).padStart(2,'0');
  if(rows.some(row=>row.code===code))continue;
  const result=await api.request('/actions/forge_fund_account/fund_account_register_bank_transaction/'+account.id,'POST',{params:{code,transacted_at:'2026-09-20T08:00:00+08:00',direction:i%2?'income':'expense',flow_type:i%2?'sales':'purchase',counterparty_name:'对照分页单位 '+i,amount:i*10,bank_reference:code}});
  assert.equal(result.status,200,JSON.stringify(result.value));
}
rows=await find('forge_bank_transaction',{account_id:account.id});
assert.equal(rows.length,25);
assert.ok(rows.every(row=>row.status==='unmatched'));
const totals=rows.reduce((out,row)=>{out[row.direction]+=Number(row.amount);return out},{income:0,expense:0});
assert.deepEqual(totals,{income:1690,expense:1560});
console.log(JSON.stringify({kind:process.argv.includes('--readback')?'restart-readback':'browser-fixture',endpoint,accountId:account.id,rows:rows.length,totals,expectedPages:[20,5],passed:true},null,2));
