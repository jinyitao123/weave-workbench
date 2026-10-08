import { serviceQuotationLinesHelpersSource } from './service-quotation-lines.logic.js';

/** Serialized into the existing parent-bound draft Action, never exposed as generic child writes. */
export const serviceQuotationMultilineSource = `${serviceQuotationLinesHelpersSource}
async function saveServiceQuotationMultiline(ctx,id,actor,organizationId,expected,key){
  const draft=normalizeServiceQuotationDraft(ctx.input.draft_json);
  const signature=JSON.stringify(['lines-v1',actor,organizationId,id,expected,draft]);
  const quotes=ctx.api.object('forge_service_quotation'),linesApi=ctx.api.object('forge_service_quotation_line'),receipts=ctx.api.object('forge_service_quotation_draft_receipt');
  const whereReceipt={quotation_id:id,idempotency_key:key,organization_id:organizationId};
  const replay=prior=>{
    if(String(prior.actor_id||'')!==actor||prior.request_signature!==signature||Number(prior.expected_revision)!==expected)throw new Error('同一请求标识已用于不同员工或内容');
    let result;try{result=JSON.parse(String(prior.result_json||''))}catch{throw new Error('原报价保存回执无效')}
    if(!result||result.id!==id||result.status!=='draft'||result.repeated!==false||typeof result.code!=='string'||result.revision!==expected+1||Number(prior.resulting_revision)!==result.revision||result.valid_until!==draft.valid_until||result.remarks!==draft.remarks||result.pricing_mode!==draft.pricing_mode||result.payment_mode!==draft.payment_mode||result.discount_rate!==draft.discount_rate||result.total_amount!==draft.total_amount||result.subtotal!==draft.subtotal||result.discount_amount!==draft.discount_amount||result.item_count!==draft.item_count)throw new Error('原报价保存回执无效');
    return{...result,repeated:true};
  };
  let first;try{first=await receipts.findOne({where:whereReceipt})}catch{throw new Error('报价保存记录暂不可读取，请稍后重试')}if(first)return replay(first);
  try{return await ctx.api.transaction(async()=>{
    const prior=await receipts.findOne({where:whereReceipt});if(prior)return replay(prior);
    const quote=await quotes.findOne({where:{id,organization_id:organizationId}});
    if(!quote||String(quote.organization_id||'')!==organizationId)throw new Error('当前服务报价不存在或不可访问');
    if(quote.status!=='draft')throw new Error('当前服务报价已不处于草稿状态，不能修改');
    const revision=quote.revision==null?1:Number(quote.revision),next=revision+1;
    if(revision!==expected||!Number.isSafeInteger(next))throw new Error('服务报价已变化，请重新打开核对');
    const previous=await linesApi.find({where:{quotation_id:id,organization_id:organizationId},limit:501});
    if(!Array.isArray(previous)||previous.length>500||previous.some(row=>!row.id||String(row.quotation_id||'')!==id||String(row.organization_id||'')!==organizationId||!Number.isInteger(Number(row.sort_order))||Number(row.sort_order)<0||Number(row.sort_order)>499))throw new Error('报价项目读取不完整');
    const previousIds=new Set(previous.map(row=>String(row.id)));
    const rows=[],catalogCache=new Map(),materialCache=new Map();
    for(let index=0;index<draft.lines.length;index++){
      const input=draft.lines[index];
      if(input.id&&!previousIds.has(input.id))throw new Error('报价项目不属于当前报价');
      let source,name,code;
      if(input.line_type==='service'){
        source=catalogCache.get('service:'+input.item_id);
        if(!source){source=await ctx.api.object('forge_service_config_item').findOne({where:{id:input.item_id,organization_id:organizationId,category:'fee_type',status:'active'},fields:['id','name','code','category','status','organization_id']});if(source)catalogCache.set('service:'+input.item_id,source)}
        if(!source||String(source.organization_id||'')!==organizationId||source.category!=='fee_type'||source.status!=='active')throw new Error('收费项目不存在、已停用或不属于当前组织');
        name=String(source.name||'').trim();code=String(source.code||'').trim();
      }else{
        source=catalogCache.get('part:'+input.item_id);
        if(!source){source=await ctx.api.object('forge_material_sku').findOne({where:{id:input.item_id,organization_id:organizationId,enabled:true},fields:['id','name','code','material_id','enabled','organization_id']});if(source)catalogCache.set('part:'+input.item_id,source)}
        if(!source||String(source.organization_id||'')!==organizationId||source.enabled!==true)throw new Error('备件规格不存在、已停用或不属于当前组织');
        let material=materialCache.get(String(source.material_id));
        if(!material){material=await ctx.api.object('forge_material').findOne({where:{id:source.material_id,organization_id:organizationId,status:'active'},fields:['id','name','status','organization_id']});if(material)materialCache.set(String(source.material_id),material)}
        if(!material||String(material.organization_id||'')!==organizationId||material.status!=='active')throw new Error('备件物料不存在、已停用或不属于当前组织');
        name=[String(material.name||'').trim(),String(source.name||'').trim()].filter(Boolean).join(' / ');code=String(source.code||'').trim();
      }
      if(!name||name.length>255||!code||code.length>100)throw new Error('报价项目名称或编码不完整');
      rows.push({id:input.id||null,name,quotation_id:id,line_type:input.line_type,service_item_id:input.line_type==='service'?input.item_id:null,sku_id:input.line_type==='part'?input.item_id:null,item_code:code,description:input.description,unit_name:input.unit_name,quantity:input.quantity,taxed_unit_price:input.taxed_unit_price,line_amount:input.line_amount,sort_order:index,organization_id:organizationId});
    }
    const changed=await quotes.update({total_amount:draft.total_amount,valid_until:draft.valid_until,remarks:draft.remarks,pricing_mode:draft.pricing_mode,payment_mode:draft.payment_mode,discount_rate:draft.discount_rate,subtotal:draft.subtotal,discount_amount:draft.discount_amount,item_count:draft.item_count,revision:next},{multi:true,where:{id,organization_id:organizationId,status:'draft',revision:quote.revision==null?null:revision}});
    if(changed!==1)throw new Error('服务报价已变化，请重新打开核对');
    const keptIds=new Set(rows.map(row=>row.id).filter(Boolean));
    let temporaryOrder=1000;
    for(const old of previous){
      if(!keptIds.has(String(old.id))){const removed=await linesApi.delete({multi:true,where:{id:old.id,quotation_id:id,organization_id:organizationId}});if(removed!==1)throw new Error('报价项目已变化，请重新打开核对')}
      else{const moved=await linesApi.update({sort_order:temporaryOrder++},{multi:true,where:{id:old.id,quotation_id:id,organization_id:organizationId}});if(moved!==1)throw new Error('报价项目已变化，请重新打开核对')}
    }
    for(const row of rows){
      const rowId=row.id;delete row.id;
      if(rowId){const changedLine=await linesApi.update(row,{multi:true,where:{id:rowId,quotation_id:id,organization_id:organizationId}});if(changedLine!==1)throw new Error('报价项目已变化，请重新打开核对')}
      else await linesApi.insert(row);
    }
    const result={id,code:String(quote.code||''),status:'draft',revision:next,valid_until:draft.valid_until,remarks:draft.remarks,pricing_mode:draft.pricing_mode,payment_mode:draft.payment_mode,discount_rate:draft.discount_rate,subtotal:draft.subtotal,discount_amount:draft.discount_amount,total_amount:draft.total_amount,item_count:draft.item_count,repeated:false};
    await receipts.insert({name:'服务报价项目保存',quotation_id:id,actor_id:actor,expected_revision:revision,resulting_revision:next,idempotency_key:key,request_signature:signature,result_json:JSON.stringify(result),organization_id:organizationId});
    return result;
  });}catch(error){
    let prior=null;try{prior=await receipts.findOne({where:whereReceipt})}catch{}if(prior)return replay(prior);
    const text=String(error&&error.message||'');
    const safe=['当前服务报价不存在或不可访问','当前服务报价已不处于草稿状态，不能修改','服务报价已变化，请重新打开核对','报价项目读取不完整','报价项目不属于当前报价','收费项目不存在、已停用或不属于当前组织','备件规格不存在、已停用或不属于当前组织','备件物料不存在、已停用或不属于当前组织','报价项目名称或编码不完整','报价项目已变化，请重新打开核对'];
    if(safe.includes(text))throw new Error(text);
    throw new Error('服务报价项目保存失败，请重新打开核对');
  }
}
`;
