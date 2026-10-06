import { defineAction } from '@objectstack/spec';

/**
 * Save the editable fields of an existing service quotation draft through its
 * manager-gated Action. Generic CRUD remains closed for service quotations.
 */
export const ServiceQuotationSaveDraft = defineAction({
  name: 'service_quotation_save_draft',
  label: '保存报价草稿',
  objectName: 'forge_service_quotation',
  icon: 'save',
  locations: [],
  requiredPermissions: ['forge_service_manager'],
  visible: `record.status == 'draft'`,
  refreshAfter: true,
  successMessage: '服务报价草稿已保存',
  params: [
    { name: 'draft_json', label: '报价草稿', type: 'textarea', required: true },
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求标识', type: 'text', required: true },
  ],
  body: {
    language: 'js',
    capabilities: ['api.read', 'api.write', 'api.transaction'],
    source: `
const id=String(ctx.recordId||ctx.record&&ctx.record.id||'').trim();
if(ctx.recordLoadDenied===true||!id||!ctx.record||String(ctx.record.id||'')!==id)throw new Error('当前服务报价不存在或不可访问');
const actor=String(ctx.session&&ctx.session.userId||'').trim();
const organizationId=String(ctx.session&&ctx.session.organizationId||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前服务主管及组织');
if(ctx.user&&ctx.user.id!=null&&String(ctx.user.id)!==actor)throw new Error('当前员工身份不一致，请重新登录');
if(ctx.user&&ctx.user.organizationId!=null&&String(ctx.user.organizationId)!==organizationId)throw new Error('当前组织身份不一致，请重新登录');
if(String(ctx.record.organization_id||'')!==organizationId)throw new Error('当前服务报价不属于当前组织');

const rawExpected=ctx.input&&ctx.input.expected_revision;
if(typeof rawExpected!=='number')throw new Error('读取报价修订号无效，请刷新后重试');
const expected=rawExpected;
if(!Number.isSafeInteger(expected)||expected<1)throw new Error('读取报价修订号无效，请刷新后重试');
const rawKey=ctx.input&&ctx.input.idempotency_key;
if(typeof rawKey!=='string')throw new Error('报价保存请求标识无效');
const key=rawKey.trim();
if(!key||key.length>128)throw new Error('报价保存请求标识无效');

let draft;
if(typeof (ctx.input&&ctx.input.draft_json)!=='string')throw new Error('报价草稿格式无效');
try{draft=JSON.parse(ctx.input.draft_json);}catch{throw new Error('报价草稿格式无效');}
if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('报价草稿格式无效');
const allowed=['total_amount','valid_until','remarks'];
if(Object.keys(draft).some(field=>!allowed.includes(field)))throw new Error('报价草稿包含不允许修改的字段');
if(!Object.prototype.hasOwnProperty.call(draft,'total_amount'))throw new Error('报价金额不能为空');
const rawAmount=draft.total_amount;
if(rawAmount==null||(typeof rawAmount==='string'&&!rawAmount.trim()))throw new Error('报价金额不能为空');
if(typeof rawAmount!=='number'&&typeof rawAmount!=='string')throw new Error('报价金额格式无效');
const parsedAmount=Number(rawAmount);
if(!Number.isFinite(parsedAmount))throw new Error('报价金额无效');
if(parsedAmount<0)throw new Error('报价金额不能为负数');
const amountText=String(rawAmount).trim();
if(!/^\\d+(?:\\.\\d+)?$/.test(amountText))throw new Error('报价金额格式无效');
const amountParts=amountText.split('.');
if((amountParts[1]||'').length>2)throw new Error('报价金额最多保留两位小数');
const cents=Number(amountParts[0]+(amountParts[1]||'').padEnd(2,'0'));
if(!Number.isSafeInteger(cents))throw new Error('报价金额超出可保存范围');
const amount=cents/100;
const roundTripAmount=String(amount).split('.');
const roundTripCents=Number(roundTripAmount[0]+(roundTripAmount[1]||'').padEnd(2,'0'));
if(!Number.isSafeInteger(roundTripCents)||roundTripCents!==cents)throw new Error('报价金额超出可保存范围');

const rawDate=draft.valid_until;
if(typeof rawDate!=='string'||!rawDate.trim())throw new Error('报价有效期不能为空');
const validUntil=rawDate.trim();
if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(validUntil))throw new Error('报价有效期必须是有效日期');
const dateValue=new Date(validUntil+'T00:00:00.000Z');
if(!Number.isFinite(dateValue.getTime())||dateValue.toISOString().slice(0,10)!==validUntil)throw new Error('报价有效期必须是有效日期');

let remarks=null;
if(Object.prototype.hasOwnProperty.call(draft,'remarks')&&draft.remarks!=null){
  if(typeof draft.remarks!=='string')throw new Error('报价备注格式无效');
  const text=draft.remarks.trim();
  remarks=text||null;
}
const signature=JSON.stringify([actor,organizationId,id,expected,[cents,validUntil,remarks]]);
const quotations=ctx.api.object('forge_service_quotation');
const receipts=ctx.api.object('forge_service_quotation_draft_receipt');
const receiptWhere={quotation_id:id,idempotency_key:key,organization_id:organizationId};
const replay=prior=>{
  if(String(prior.actor_id||'')!==actor||String(prior.request_signature||'')!==signature||Number(prior.expected_revision)!==expected)throw new Error('同一请求标识已用于不同员工或内容');
  let result;
  try{result=JSON.parse(String(prior.result_json||''));}catch{throw new Error('原报价保存回执无效，请联系管理员');}
  const resultingRevision=Number(prior.resulting_revision),expectedResultingRevision=expected+1;
  const resultKeys=result&&typeof result==='object'&&!Array.isArray(result)?Object.keys(result).sort():[];
  const requiredResultKeys=['code','id','remarks','repeated','revision','status','total_amount','valid_until'];
  if(!Number.isSafeInteger(expectedResultingRevision)||!Number.isSafeInteger(resultingRevision)||resultingRevision!==expectedResultingRevision
    ||String(prior.quotation_id||'')!==id||!result||typeof result!=='object'||Array.isArray(result)
    ||resultKeys.length!==requiredResultKeys.length||resultKeys.some((field,index)=>field!==requiredResultKeys[index])
    ||String(result.id||'')!==id||typeof result.code!=='string'||result.status!=='draft'
    ||typeof result.total_amount!=='number'||!Number.isFinite(result.total_amount)||result.total_amount!==amount
    ||result.valid_until!==validUntil||result.remarks!==remarks||result.revision!==resultingRevision||result.repeated!==false){
    throw new Error('原报价保存回执无效，请联系管理员');
  }
  return{...result,repeated:true};
};

let prior;
try{prior=await receipts.findOne({where:receiptWhere});}catch{throw new Error('报价保存记录暂不可读取，请稍后重试');}
if(prior)return replay(prior);

try{
  return await ctx.api.transaction(async()=>{
    const concurrent=await receipts.findOne({where:receiptWhere});
    if(concurrent)return replay(concurrent);
    const current=await quotations.findOne({where:{id,organization_id:organizationId}});
    if(!current||String(current.organization_id||'')!==organizationId)throw new Error('当前服务报价不存在或不属于当前组织');
    if(current.status!=='draft')throw new Error('当前服务报价已不处于草稿状态，不能修改');
    const revision=current.revision==null?1:Number(current.revision);
    if(!Number.isSafeInteger(revision)||revision<1)throw new Error('服务报价修订号无效，请刷新后重试');
    if(revision!==expected)throw new Error('服务报价已被修改，请刷新后重试');
    const nextRevision=revision+1;
    if(!Number.isSafeInteger(nextRevision)||nextRevision<=revision)throw new Error('服务报价修订号已达到可保存上限');
    const changed=await quotations.update({total_amount:amount,valid_until:validUntil,remarks,revision:nextRevision},{multi:true,where:{id,organization_id:organizationId,status:'draft',revision:current.revision==null?null:revision}});
    if(changed!==1)throw new Error('服务报价已被修改，请刷新后重试');
    const saved={id,code:String(current.code||''),status:'draft',total_amount:amount,valid_until:validUntil,remarks,revision:nextRevision,repeated:false};
    await receipts.insert({
      name:'服务报价草稿保存',quotation_id:id,actor_id:actor,expected_revision:revision,
      resulting_revision:nextRevision,idempotency_key:key,request_signature:signature,
      result_json:JSON.stringify(saved),organization_id:organizationId,
    });
    return saved;
  });
}catch(error){
  let committedReceipt=null;
  try{committedReceipt=await receipts.findOne({where:receiptWhere});}catch{}
  if(committedReceipt)return replay(committedReceipt);
  const message=String(error&&error.message||'');
  const safeMessages=[
    '当前服务报价不存在或不属于当前组织',
    '当前服务报价已不处于草稿状态，不能修改',
    '服务报价修订号无效，请刷新后重试',
    '服务报价修订号已达到可保存上限',
    '服务报价已被修改，请刷新后重试',
  ];
  if(safeMessages.includes(message))throw new Error(message);
  throw new Error('服务报价保存失败或当前报价已变化，请刷新后重试');
}
`,
  },
});
