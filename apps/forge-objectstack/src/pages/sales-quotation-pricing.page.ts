import { SalesQuotationsPage as quotationPage } from './sales-crm-service-pages.page.js';

const originalPatch = "function patchLine(key,field,value){setForm(current=>({...current,lines:current.lines.map(line=>line.key===key?{...line,[field]:value,...(field==='sku_id'?{taxed_unit_price:(s.skus.find(item=>item.id===value)?.sale_price??'')+'',name:''}:{})}:line)}))}";
const effectivePatch = String.raw`
const quotePriceQueries=React.useRef(new Map());
const quotePriceForm=React.useRef(form);quotePriceForm.current=form;
async function resolveQuotePrice(key,skuId,customerId,date){
 const generation=(quotePriceQueries.current.get(key)||0)+1;quotePriceQueries.current.set(key,generation);
 setForm(current=>!current?current:{...current,lines:current.lines.map(line=>line.key===key&&!line.manual_price?{...line,taxed_unit_price:''}:line)});
 try{const response=await request('/actions/forge_quotation/sales_quotation_price_resolve',{method:'POST',body:JSON.stringify({params:{customer_id:customerId,sku_id:skuId,date}})}),price=response.result?.result||response.result||response.data?.result||response.data||response;
 if(price.price===null||price.price===undefined||!Number.isFinite(Number(price.price)))throw new Error('客户价格结果不完整。');
 setForm(current=>!current||current.customer_id!==customerId||current.quotation_date!==date||quotePriceQueries.current.get(key)!==generation?current:{...current,lines:current.lines.map(line=>line.key===key&&line.sku_id===skuId&&!line.manual_price?{...line,taxed_unit_price:String(price.price)}:line)});
 }catch(error){const current=quotePriceForm.current;if(current?.customer_id===customerId&&current?.quotation_date===date&&current.lines.some(line=>line.key===key&&line.sku_id===skuId)&&quotePriceQueries.current.get(key)===generation)setFormError('客户有效价格暂时无法读取，请重试或明确填写含税单价。');}
}
function patchLine(key,field,value){
 if(field==='sku_id')quotePriceQueries.current.set(key,(quotePriceQueries.current.get(key)||0)+1);
 setForm(current=>({...current,lines:current.lines.map(line=>line.key===key?{...line,[field]:value,...(field==='sku_id'?{taxed_unit_price:'',manual_price:false,name:''}:field==='taxed_unit_price'?{manual_price:true}:{})}:line)}));
 if(field==='sku_id'&&value&&form?.customer_id&&form?.quotation_date)void resolveQuotePrice(key,value,form.customer_id,form.quotation_date);
}
React.useEffect(()=>{if(!form?.customer_id||!form?.quotation_date)return;for(const line of form.lines){if(line.line_type==='material'&&line.sku_id&&!line.manual_price)void resolveQuotePrice(line.key,line.sku_id,form.customer_id,form.quotation_date)}},[form?.customer_id,form?.quotation_date]);
`;

if (!quotationPage.source.includes(originalPatch)) throw new Error('Quotation price selection integration anchor changed');
export const SalesQuotationsPage = { ...quotationPage, source: quotationPage.source.replace(originalPatch, effectivePatch) };
