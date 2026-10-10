import { normalizeSalesPriceDraft, salesPriceBaselineToken } from './sales-pricing.logic.js';

export const salesPricingHelpers = `
const __name=value=>value;
const normalizeDraft=${normalizeSalesPriceDraft.toString()},baselineToken=${salesPriceBaselineToken.toString()};
const text=value=>typeof value==='string'?value.trim():'',rowId=value=>typeof value==='string'?value:value&&(value.id||value.record&&value.record.id),round=value=>Math.round((value+Number.EPSILON)*10000)/10000;
const api=ctx.api;
const all=async(object,where)=>{const records=[];for(let offset=0;offset<10000;offset+=200){const batch=await api.object(object).find({where,offset,limit:200,orderBy:[{field:'id',order:'asc'}]});records.push(...batch);if(batch.length<200)return records}throw new Error('记录较多，请缩小范围')};
const today=()=>{const value=String(ctx.session&&ctx.session.businessDate||'');if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(value))throw new Error('缺少组织业务日期，请重新办理');return value};
const targetKey=(kind,customer,sku)=>JSON.stringify([kind==='adjustment'?'catalog':'customer',customer||'',sku]);
const currentPrice=async(org,sku,customer,date)=>{const rows=await all('forge_sales_price_history',{organization_id:org,sku_id:sku.id,customer_id:customer}),requests=rows.length?await all('forge_sales_price_request',{organization_id:org,id:{$in:[...new Set(rows.map(row=>row.request_id))]}}):[],live=new Set(requests.filter(row=>row.status==='approved'&&row.effect_status==='applied').map(row=>row.id)),valid=rows.filter(row=>live.has(row.request_id)&&String(row.valid_from||'').slice(0,10)<=date&&(!row.valid_until||String(row.valid_until).slice(0,10)>=date));valid.sort((left,right)=>(right.kind==='special'?1:0)-(left.kind==='special'?1:0)||Number(right.price_revision)-Number(left.price_revision));return valid[0]?{price:Number(valid[0].price),kind:valid[0].kind,source:valid[0].request_code,valid_from:valid[0].valid_from,valid_until:valid[0].valid_until}:sku.sale_price==null?null:{price:Number(sku.sale_price),kind:'catalog',source:'目录价'};};
`;

export const salesPricingIdentity = salesPricingHelpers + `
const params=ctx.input||{},actor=text(ctx.user&&ctx.user.id||ctx.session&&ctx.session.userId),org=text(ctx.user&&ctx.user.organizationId||ctx.session&&ctx.session.organizationId);
if(!actor||!org||!await api.object('sys_member').findOne({where:{organization_id:org,user_id:actor}}))throw new Error('无法确认本组织员工身份');
const owned=row=>row&&row.organization_id===org&&[row.owner_id,row.responsible_id,row.created_by,row.submitted_by].includes(actor);
const receipt=async(key,signature)=>{if(!key||key.length>128)throw new Error('保存请求标识无效');const prior=await api.object('forge_sales_pricing_receipt').findOne({where:{organization_id:org,request_key:key}});if(!prior)return null;if(prior.actor_id!==actor||prior.signature!==signature)throw new Error('相同请求标识不能用于不同操作');return JSON.parse(prior.result_json)};
const saveReceipt=async(key,signature,result,name)=>{await api.object('forge_sales_pricing_receipt').insert({name,request_key:key,signature,result_json:JSON.stringify(result),actor_id:actor,owner_id:actor,organization_id:org});return result};
const eligibleReviewers=async()=>{const positions=await all('sys_position',{organization_id:org,name:'sales_order_reviewer'}),keys=new Set(positions.filter(row=>![false,0,'false'].includes(row.active)).flatMap(row=>[String(row.id),String(row.name)])),assignments=await all('sys_user_position',{organization_id:org}),now=Date.now(),ids=[...new Set(assignments.filter(row=>keys.has(String(row.position))&&(!row.valid_from||Date.parse(row.valid_from)<=now)&&(!row.valid_until||Date.parse(row.valid_until)>now)).map(row=>String(row.user_id)).filter(id=>id!==actor))],members=await all('sys_member',{organization_id:org}),memberIds=new Set(members.map(row=>String(row.user_id))),users=ids.length?await all('sys_user',{id:{$in:ids}}):[],eligible=users.filter(row=>memberIds.has(String(row.id))&&(![true,1,'true'].includes(row.banned)||Number.isFinite(Date.parse(row.ban_expires))&&Date.parse(row.ban_expires)<=now));return eligible;};
const chooseReviewer=async(preferred)=>{const eligible=(await eligibleReviewers()).map(row=>String(row.id));if(preferred){if(!eligible.includes(preferred))throw new Error('所选审批人没有有效的独立审批任职');return preferred}if(eligible.length!==1)throw new Error(eligible.length?'有多名审批人，请在高级设置中选择':'未配置有效的独立审批人');return eligible[0]};
`;
