import {
  forgeProductUiCss,
  forgeProductUiRuntime,
  forgeProcurementUiCss,
} from "./product-ui.js";

const sharedCss =
  forgeProductUiCss +
  forgeProcurementUiCss +
  `
.forge-iqc .hero{max-width:1520px;margin:0 auto;padding:18px 22px 8px;display:flex;justify-content:space-between;align-items:center}.forge-iqc .hero h1{margin:0;font-size:24px}.forge-iqc .hero p{margin:4px 0 0;color:var(--fp-muted);font-size:12px}.forge-iqc .hero .flow{display:block;margin:0;padding:7px 10px;background:var(--fp-primary-soft);color:var(--fp-primary);border:0}.forge-iqc .toolbar{margin-bottom:12px}.forge-iqc .toolbar input{width:min(420px,100%)}
`;

const pendingInspectionPageSource = `
function App(){const adapter=useAdapter();
 const [state,setState]=React.useState({loading:true,rows:[],suppliers:{},orders:{},error:''}),[query,setQuery]=React.useState(''),[statusFilter,setStatusFilter]=React.useState(''),[page,setPage]=React.useState(1),[methods,setMethods]=React.useState({}),[dialog,setDialog]=React.useState(null),[taskOpen,setTaskOpen]=React.useState(false),[toast,setToast]=React.useState(''),[busy,setBusy]=React.useState('');
 async function request(path,options){const response=await ForgeApiResponse(adapter,path,{credentials:'include',headers:{'Content-Type':'application/json'},...options});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error((typeof payload.error==='string'?payload.error:payload.error?.message)||(Array.isArray(payload.fields)&&payload.fields.length?payload.fields.map(f=>f.message||f.label).filter(Boolean).join('；'):'')||payload.message||'请求失败');return payload;}
 async function find(object,where){const filter=where?('&$filter='+encodeURIComponent(JSON.stringify(where))):'';return (await request('/data/'+object+'?$top=100'+filter)).records||[];}
 async function load(){try{const [rows,suppliers,orders,inspections]=await Promise.all([find('forge_pending_inspection'),find('forge_supplier'),find('forge_purchase_order'),find('forge_purchase_inspection')]);setState({loading:false,rows,suppliers:Object.fromEntries(suppliers.map(x=>[x.id,x])),orders:Object.fromEntries(orders.map(x=>[x.id,x])),inspections:Object.fromEntries(inspections.map(x=>[x.id,x])),error:''});}catch(error){setState(s=>({...s,loading:false,error:String(error.message||error)}));}}
 React.useEffect(()=>{load();const retry=setTimeout(load,500);return()=>clearTimeout(retry);},[]);
 async function runCreate(row){setBusy(row.id);try{const payload=await request('/actions/forge_pending_inspection/pending_inspection_create_order/'+row.id,{method:'POST',body:JSON.stringify({params:{inspection_method:methods[row.id]||'full'}})});const result=payload.result||payload.data?.result||payload.data||payload;if(!result.id)throw new Error('检验单创建后未返回记录ID');window.location.href='/_console/apps/com.inoforge.forge.supply-chain/page_purchase_inspection_workspace?id='+encodeURIComponent(result.id);}catch(error){setDialog(d=>d?({...d,error:String(error.message||error)}):d);setState(s=>({...s,error:String(error.message||error)}));setBusy('');}}
 function create(row){setDialog({row,title:'确认生成检验单',subtitle:row.code+' · '+row.item_code,impact:'确认后将为该待检物料生成检验单，并进入检验办理。',error:''});}
 const filteredRows=state.rows.filter(row=>(!statusFilter||row.status===statusFilter)&&(!query||[row.code,row.item_code,row.name,state.suppliers[row.supplier_id]?.name,row.batch_number].some(v=>String(v||'').includes(query)))),pageSize=20,totalPages=Math.max(1,Math.ceil(filteredRows.length/pageSize)),safePage=Math.min(page,totalPages),rows=filteredRows.slice((safePage-1)*pageSize,safePage*pageSize),inspectResult=row=>{const inspection=row.inspection_id&&state.inspections?state.inspections[row.inspection_id]:null;if(inspection&&inspection.status==='completed')return inspection.result==='passed'?'合格':inspection.result==='rejected'?'不合格':inspection.result==='partial'?'部分合格':'已检验';if(row.status==='stocked')return '已入库';if(row.status==='inspected')return '已检验';return row.inspection_id?(inspection&&inspection.status==='pending'?'检验中':'检验中'):'—'};
 function exportRows(){const headers=['待检单号','物料编码','物料名称','规格型号','到货数量','单位','批次号','供应商/客户','采购合同','到货日期','状态','关联检验单','检验结果'],values=filteredRows.map(row=>[row.code,row.item_code,row.name.replace(/^([A-Z]{2,4}-\\d{4}(-\\d+)?\\s+)+/,''),[row.specification,row.model].filter(Boolean).join(' / '),row.arrival_quantity,row.unit_name,row.batch_number||'',state.suppliers[row.supplier_id]?.name||'',state.orders[row.order_id]?.code||'',row.arrived_on||'',row.status,row.inspection_id||'',inspectResult(row)]),csv=[headers,...values].map(line=>line.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\\n'),blob=new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='待检验库存.csv';a.click();URL.revokeObjectURL(url);setToast('已导出 '+filteredRows.length+' 条待检记录');}
 return <div className="forge-product forge-procurement forge-iqc">
<style>{${JSON.stringify(sharedCss)}}</style>
<div className="body"><ForgeHero section="供应链 / 到货检验 / 待检验库存" title="待检验库存" description="每个物料独立一条待检记录，关联来料检验流程" icon="▤" tone="green" art="blueprint" next={{label:"检验单",href:'/_console/apps/com.inoforge.forge.supply-chain/page_purchase_inspection_workspace',title:"下一步操作 · 检验单"}}/>{state.error&&<div className="notice">{state.error}</div>}{toast&&<div className="notice">{toast}</div>}<div className="card">
<div className="toolbar">
<button className="btn" disabled={!filteredRows.length} onClick={exportRows}>导出</button>
<button className="fp-button" onClick={()=>setTaskOpen(true)}>导入/导出任务</button>
<ForgeListSettings/><button className="fp-icon-button" aria-label="刷新" title="刷新" onClick={()=>{setToast('');load();}}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></button>
</div>
<div className="toolbar">
<input aria-label="搜索待检记录" placeholder="搜索待检单号、物料编码、物料名称、供应商、批次号..." value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/>
<ForgeSelectControl aria-label="状态筛选" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);}}>
<option value="">全部状态</option>
<option value="pending">待检验</option>
<option value="inspection_created">检验中</option>
<option value="inspected">已检验</option>
<option value="exempt">免检</option>
</ForgeSelectControl>
</div>
<div className="table">
<table>
<thead>
<tr>
<th>待检单号</th>
<th>物料编码</th>
<th>物料名称</th>
<th>规格型号</th>
<th>到货数量</th>
<th>单位</th>
<th>批次号</th>
<th>供应商/客户</th>
<th>采购合同</th>
<th>到货日期</th>
<th>状态</th>
<th>关联检验单</th>
<th>检验结果</th>
<th>操作</th>
</tr>
</thead>
<tbody>{rows.map(row=>
<tr key={row.id}>
<td>{row.code}</td>
<td>{row.item_code}</td>
<td>{row.name.replace(/^([A-Z]{2,4}-\\d{4}(-\\d+)?\\s+)+/,'')}</td>
<td>{row.specification} / {row.model}</td>
<td>{row.arrival_quantity}</td>
<td>{row.unit_name}</td>
<td>{row.batch_number||'—'}</td>
<td>{state.suppliers[row.supplier_id]?.name||'—'}</td>
<td>{state.orders[row.order_id]?.code||'—'}</td>
<td>{row.arrived_on||'—'}</td>
<td>
<span className="pill">{row.status==='pending'?'待检验':row.status==='inspection_created'?'检验中':row.status==='inspected'?'已检验':row.status==='stocked'?'已入库':'免检'}</span>
</td>
<td>{row.inspection_id?(state.inspections&&state.inspections[row.inspection_id]?state.inspections[row.inspection_id].code:row.inspection_id):'—'}</td>
<td>{inspectResult(row)}</td>
<td>{row.status==='pending'?<span>
<ForgeSelectControl aria-label={row.item_code+' 检验方式'} value={methods[row.id]||'full'} onChange={e=>setMethods(m=>({...m,[row.id]:e.target.value}))}>
<option value="full">全检</option>
<option value="sampling">抽检</option>
</ForgeSelectControl> <button className="btn primary" disabled={busy===row.id} onClick={()=>create(row)}>生成检验单</button>
</span>:row.inspection_id?<button className="fp-icon-button row-action" aria-label="查看检验单" title="查看检验单" onClick={()=>window.location.href='/_console/apps/com.inoforge.forge.supply-chain/page_purchase_inspection_workspace?id='+encodeURIComponent(row.inspection_id)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/></svg></button>:'—'}</td>
</tr>)}</tbody>
</table>{!state.loading&&!rows.length&&<div className="muted" style={{padding:40,textAlign:'center'}}>暂无匹配的待检记录</div>}</div>
<div className="toolbar" style={{justifyContent:'flex-end',marginTop:12}}>
<span className="muted">共 {filteredRows.length} 条 · 20 条/页</span>
<button className="btn" disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>上一页</button>
<span>{safePage} / {totalPages}</span>
<button className="btn" disabled={safePage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>下一页</button>
</div>
</div>{dialog&&<ForgeDialog open title={dialog.title} subtitle={dialog.subtitle} error={dialog.error} busy={!!busy} confirmLabel="确认生成" onCancel={()=>!busy&&setDialog(null)} onConfirm={()=>runCreate(dialog.row)}>
<div className="notice">{dialog.impact}</div>
<div className="muted">请确认待检物料、批次、供应商和检验方式无误。</div>
</ForgeDialog>}{taskOpen&&<ForgeDialog open title="导入/导出任务" subtitle="待检验库存" confirmLabel="关闭" onCancel={()=>setTaskOpen(false)} onConfirm={()=>setTaskOpen(false)}>
<div className="notice">导出任务由当前筛选结果即时生成。</div>
<div className="muted">当前页面暂无待处理的后台导入任务；待检记录由到货登记自动生成，不支持从此页直接导入。</div>
</ForgeDialog>}</div>
</div>;
}
export default App;
${forgeProductUiRuntime}
`;

const purchaseInspectionPageSource = `
${forgeProductUiRuntime}
function App(){const adapter=useAdapter();
 const id=new URLSearchParams(window.location.search).get('id'),[state,setState]=React.useState({loading:true,rows:[],receipts:{},suppliers:{},record:null,receipt:null,pending:null,supplier:null,order:null,error:''}),[form,setForm]=React.useState({inspected_on:new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10),accepted_quantity:'',inspection_note:''}),[busy,setBusy]=React.useState(false),[items,setItems]=React.useState([]),[recordMode,setRecordMode]=React.useState('summary'),[planName,setPlanName]=React.useState(''),[query,setQuery]=React.useState(''),[statusFilter,setStatusFilter]=React.useState(''),[resultFilter,setResultFilter]=React.useState(''),[inspectionSelected,setInspectionSelected]=React.useState([]),[methodFilter,setMethodFilter]=React.useState(''),[supplierFilter,setSupplierFilter]=React.useState(''),[startDate,setStartDate]=React.useState(''),[endDate,setEndDate]=React.useState(''),[page,setPage]=React.useState(1),[taskOpen,setTaskOpen]=React.useState(false),[toast,setToast]=React.useState('');
 async function request(path,options){const response=await ForgeApiResponse(adapter,path,{credentials:'include',headers:{'Content-Type':'application/json'},...options});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error((typeof payload.error==='string'?payload.error:payload.error?.message)||(Array.isArray(payload.fields)&&payload.fields.length?payload.fields.map(f=>f.message||f.label).filter(Boolean).join('；'):'')||payload.message||'请求失败');return payload;}
 async function read(object,recordId){return (await request('/data/'+object+'/'+recordId)).record;}async function find(object){return (await request('/data/'+object+'?$top=100')).records||[];}
 async function findWhere(object,where){return (await request('/data/'+object+'?$top=200&$filter='+encodeURIComponent(JSON.stringify(where)))).records||[];}
 function setItem(index,field,value){setItems(list=>list.map((x,i)=>i===index?{...x,[field]:value}:x))}
 async function load(){try{if(!id){const [rows,receipts,suppliers,users]=await Promise.all([find('forge_purchase_inspection'),find('forge_purchase_receipt'),find('forge_supplier'),find('sys_user')]);setState({loading:false,rows,receipts:Object.fromEntries(receipts.map(x=>[x.id,x])),suppliers:Object.fromEntries(suppliers.map(x=>[x.id,x])),users:Object.fromEntries(users.map(x=>[x.id,x])),record:null,receipt:null,pending:null,supplier:null,order:null,error:''});return;}const record=await read('forge_purchase_inspection',id),[receipt,pending,supplier,order]=await Promise.all([read('forge_purchase_receipt',record.receipt_id),record.pending_inspection_id?read('forge_pending_inspection',record.pending_inspection_id):Promise.resolve(null),read('forge_supplier',record.supplier_id),read('forge_purchase_order',record.order_id)]);const [planRows,savedItems]=await Promise.all([findWhere('forge_inspection_plan',{status:'active'}),findWhere('forge_purchase_inspection_item',{inspection_id:id})]);
 const normKey=value=>String(value==null?'':value).trim().toLowerCase();let planSku=null,planMaterial=null;try{planSku=record.sku_id?await read('forge_material_sku',record.sku_id):null;planMaterial=planSku&&planSku.material_id?await read('forge_material',planSku.material_id):null}catch(error){planSku=null;planMaterial=null}const skuKeys=[record.item_code,planSku&&planSku.code,planSku&&planSku.id].filter(Boolean).map(normKey);const materialKeys=[planMaterial&&planMaterial.code,planMaterial&&planMaterial.id,planSku&&planSku.material_id].filter(Boolean).map(normKey);const plan=planRows.find(x=>skuKeys.includes(normKey(x.scope_value)))||planRows.find(x=>materialKeys.includes(normKey(x.scope_value)))||planRows.find(x=>x.scope_type!=='material')||null;
 const defs=plan?await findWhere('forge_inspection_plan_item',{plan_id:plan.id}):[];
 setRecordMode(record.record_mode||'summary');setPlanName(plan?plan.name:'');
 setItems(defs.map((d,i)=>{const saved=savedItems.find(x=>(d.item_id&&x.item_id===d.item_id)||x.name===d.name);return {id:saved?saved.id:null,item_id:d.item_id||null,name:d.name||('检验项目 '+(i+1)),requirement:d.requirement_override||'',sequence:d.sequence||i+1,result:saved?saved.result:'pass',measured_value:saved?saved.measured_value||'':'' ,remarks:saved?saved.remarks||'':''}}));
 setForm(f=>({...f,accepted_quantity:String(record.total_quantity||0),inspection_note:record.inspection_note||''}));setState({loading:false,rows:[],record,receipt,pending,supplier,order,error:''});}catch(error){setState(s=>({...s,loading:false,error:String(error.message||error)}));}}
 React.useEffect(()=>{load();if(!id){const retry=setTimeout(load,500);return()=>clearTimeout(retry);}},[]);
 async function complete(){
 if(!String(form.inspection_note||'').trim()){setState(s=>({...s,error:'请填写检验结论'}));return}
 const total=Number(state.record.total_quantity||0),accepted=Number(form.accepted_quantity);
 if(!Number.isFinite(accepted)||accepted<0||accepted>total){setState(s=>({...s,error:'合格数量必须在 0 与到货数量之间'}));return}
 if(recordMode==='item'){
  if(!items.length){setState(s=>({...s,error:'当前检验单未匹配到启用中的检验方案项目，请先在检验规则维护方案，或改用汇总数量录入'}));return}
  if(items.some(x=>!x.result)){setState(s=>({...s,error:'请为每个检验项目选择检验结果'}));return}
  const failed=items.filter(x=>x.result==='fail').length;
  if(failed>0&&accepted>=total){setState(s=>({...s,error:'存在不合格的检验项目，合格数量必须小于到货总数（不合格数量需大于 0）'}));return}
 }
 setBusy(true);
 try{
  await request('/data/forge_purchase_inspection/'+id,{method:'PATCH',body:JSON.stringify({record_mode:recordMode})});
  if(recordMode==='item'){for(const row of items){const body={inspection_id:id,item_id:row.item_id,name:row.name,sequence:row.sequence,requirement:row.requirement,result:row.result,measured_value:row.measured_value,remarks:row.remarks};if(row.id){await request('/data/forge_purchase_inspection_item/'+row.id,{method:'PATCH',body:JSON.stringify(body)});}else{const created=await request('/data/forge_purchase_inspection_item',{method:'POST',body:JSON.stringify(body)});row.id=(created.record&&created.record.id)||created.id;}}}
  await request('/actions/forge_purchase_inspection/purchase_inspection_complete/'+id,{method:'POST',body:JSON.stringify({params:{inspected_on:form.inspected_on,accepted_quantity:Number(form.accepted_quantity),inspection_note:form.inspection_note.trim()}})});
  await load();
 }catch(error){setState(s=>({...s,error:String(error.message||error)}));}finally{setBusy(false);}}
 const filteredRows=state.rows.filter(row=>{const arrivedOn=String(state.receipts[row.receipt_id]?.arrived_on||''),matchesQuery=!query||[row.code,row.item_code,row.name,state.receipts[row.receipt_id]?.code,state.suppliers[row.supplier_id]?.name].some(value=>String(value||'').includes(query));return (!statusFilter||row.status===statusFilter)&&(!resultFilter||row.result===resultFilter)&&(!methodFilter||row.inspection_method===methodFilter)&&(!supplierFilter||row.supplier_id===supplierFilter)&&(!startDate||arrivedOn>=startDate)&&(!endDate||arrivedOn<=endDate)&&matchesQuery;}),pageSize=20,totalPages=Math.max(1,Math.ceil(filteredRows.length/pageSize)),safePage=Math.min(page,totalPages),visibleRows=filteredRows.slice((safePage-1)*pageSize,safePage*pageSize);const receiptCode=id=>state.receipts[id]?.code||id,supplierName=id=>state.suppliers[id]?.name||'—';
 const resultText={pending:'待判定',passed:'合格',partial:'部分合格',rejected:'不合格'},statusText={pending:'待检验',completed:'已完成'};
 function exportRows(onlyIds){const headers=['检验单号','到货单号','物料名称','供应商/客户','方式','总数量','合格数量','不合格数量','结果','状态','检验员','到货日期'],values=(onlyIds&&onlyIds.length?filteredRows.filter(row=>onlyIds.includes(row.id)):filteredRows).map(row=>[row.code,receiptCode(row.receipt_id),row.item_code||row.name,supplierName(row.supplier_id),row.inspection_method==='sampling'?'抽检':'全检',row.total_quantity,row.accepted_quantity,row.rejected_quantity,resultText[row.result]||row.result,statusText[row.status]||row.status,row.inspector_id,state.receipts[row.receipt_id]?.arrived_on||'']),csv=[headers,...values].map(line=>line.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\\n'),blob=new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='检验单.csv';a.click();URL.revokeObjectURL(url);setToast('已导出 '+filteredRows.length+' 条检验单');}
 if(!id)return <div className="forge-product forge-procurement forge-iqc">
<style>{${JSON.stringify(sharedCss)}}</style>
<div className="body"><ForgeHero section="供应链 / 到货检验 / 检验单" title="检验单" description="每条检验单对应一种物料的来料检验。" icon="▤" tone="green" art="blueprint" next={{label:"采购入库",href:'/_console/apps/com.inoforge.forge.supply-chain/page_purchase_inbound_workspace',title:"下一步操作 · 采购入库"}}/>{state.error&&<div className="notice">{state.error}</div>}{toast&&<div className="notice">{toast}</div>}<div className="card">
<div className="fp-card-toolbar"><button className="fp-button" disabled={!(inspectionSelected.length||filteredRows.length)} onClick={()=>exportRows(inspectionSelected)}>导出{inspectionSelected.length?'选中 '+inspectionSelected.length:''} ▾</button><button className="fp-button" onClick={()=>setTaskOpen(true)}>导入/导出任务</button><span className="fp-grow"/><ForgeListSettings/><button className="fp-icon-button" aria-label="刷新" title="刷新" onClick={()=>{setToast('');load();}}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></button></div>
<div className="toolbar">
<input aria-label="搜索检验单" placeholder="搜索检验单号/物料名..." value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/>
<ForgeSelectControl aria-label="状态筛选" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);}}>
<option value="">状态</option>
<option value="pending">待检验</option>
<option value="completed">已完成</option>
</ForgeSelectControl>
<ForgeSelectControl aria-label="结果筛选" value={resultFilter} onChange={e=>{setResultFilter(e.target.value);setPage(1);}}>
<option value="">结果</option>
<option value="pending">待判定</option>
<option value="passed">合格</option>
<option value="partial">部分合格</option>
<option value="rejected">不合格</option>
</ForgeSelectControl>
<ForgeSelectControl aria-label="方式筛选" value={methodFilter} onChange={e=>{setMethodFilter(e.target.value);setPage(1);}}>
<option value="">方式</option>
<option value="full">全检</option>
<option value="sampling">抽检</option>
</ForgeSelectControl>
<ForgeSelectControl aria-label="供应商筛选" value={supplierFilter} onChange={e=>{setSupplierFilter(e.target.value);setPage(1);}}>
<option value="">供应商</option>{Object.values(state.suppliers).map(s=>
<option key={s.id} value={s.id}>{s.name}</option>)}</ForgeSelectControl>
<ForgeDateInput aria-label="开始日期" value={startDate} onChange={e=>{setStartDate(e.target.value);setPage(1);}}/>
<span className="muted">~</span>
<ForgeDateInput aria-label="结束日期" value={endDate} onChange={e=>{setEndDate(e.target.value);setPage(1);}}/>
</div>
<div className="table">
<table>
<thead>
<tr>
<th><input type="checkbox" aria-label="选择当前页" checked={visibleRows.length>0&&inspectionSelected.length===visibleRows.length} onChange={()=>setInspectionSelected(inspectionSelected.length===visibleRows.length?[]:visibleRows.map(r=>r.id))}/></th>
<th>检验单号</th>
<th>到货单号</th>
<th>物料名称</th>
<th>供应商/客户</th>
<th>方式</th>
<th>总数量</th>
<th>合格数量</th>
<th>不合格数量</th>
<th>结果</th>
<th>状态</th>
<th>检验员</th>
<th>到货日期</th>
<th>操作</th>
</tr>
</thead>
<tbody>{visibleRows.map(row=>
<tr key={row.id}>
<td><input type="checkbox" aria-label={'选择 '+row.code} checked={inspectionSelected.includes(row.id)} onChange={()=>setInspectionSelected(inspectionSelected.includes(row.id)?inspectionSelected.filter(i=>i!==row.id):[...inspectionSelected,row.id])}/></td>
<td>{row.code}</td>
<td>{receiptCode(row.receipt_id)}</td>
<td><strong>{String(row.name||'').replace(/^([A-Z]{2,4}-\\d{4}(-\\d+)?\\s+)+/,'')||row.item_code||'—'}</strong><div className="muted">{[row.item_code,row.specification].filter(Boolean).join(' · ')}</div></td>
<td>{supplierName(row.supplier_id)}</td>
<td>{row.inspection_method==='sampling'?'抽检':'全检'}</td>
<td>{row.total_quantity}</td>
<td>{row.accepted_quantity}</td>
<td>{row.rejected_quantity}</td>
<td>{resultText[row.result]||row.result}</td>
<td>{statusText[row.status]||row.status}</td>
<td>{state.users?.[row.inspector_id]?.display_name||state.users?.[row.inspector_id]?.name||'—'}</td>
<td>{state.receipts[row.receipt_id]?.arrived_on||'—'}</td>
<td>
<button className="fp-icon-button row-action" aria-label="查看" title="查看" onClick={()=>window.location.href=window.location.pathname+'?id='+encodeURIComponent(row.id)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/></svg></button>
</td>
</tr>)}</tbody>
</table>{!state.loading&&!visibleRows.length&&<div className="muted" style={{padding:40,textAlign:'center'}}>暂无检验单</div>}</div>
<div className="toolbar" style={{justifyContent:'flex-end',marginTop:12}}>
<span className="muted">共 {filteredRows.length} 条 · 20 条/页</span>
<button className="btn" disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>上一页</button>
<span>{safePage} / {totalPages}</span>
<button className="btn" disabled={safePage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>下一页</button>
</div>
</div>{taskOpen&&<ForgeDialog open title="导入/导出任务" subtitle="检验单" confirmLabel="关闭" onCancel={()=>setTaskOpen(false)} onConfirm={()=>setTaskOpen(false)}>
<div className="notice">导出任务由当前筛选结果即时生成。</div>
<div className="muted">检验单由待检验库存生成，不支持从此页直接导入；当前没有待处理的后台任务。</div>
</ForgeDialog>}</div>
</div>;
 const record=state.record;if(state.loading)return <div className="forge-product forge-procurement forge-iqc">
<style>{${JSON.stringify(sharedCss)}}</style>
<div className="body">正在加载检验单…</div>
</div>;if(!record)return <div className="forge-product forge-procurement forge-iqc">
<style>{${JSON.stringify(sharedCss)}}</style>
<div className="body">
<div className="notice">{state.error||'检验单不存在'}</div>
</div>
</div>;
 return <div className="forge-product forge-procurement forge-iqc">
<style>{${JSON.stringify(sharedCss)}}</style>
<div className="header-shell"><ForgePageHeader badge="供" section="供应链 / 到货检验 / 检验单" title={record.code} description={'来源 '+state.receipt.code+' · '+record.item_code+' · '+statusText[record.status]} actions={<><button className="fp-button" onClick={()=>window.location.href='/_console/apps/com.inoforge.forge.supply-chain/page_pending_inspection_workspace'}>返回待检列表</button>{record.status==='pending'&&<button className="fp-button primary" disabled={busy} onClick={complete}>完成检验</button>}{record.status==='completed'&&Number(record.accepted_quantity||0)>0&&<button className="fp-button primary" onClick={()=>window.location.href='/_console/apps/com.inoforge.forge.supply-chain/page_purchase_inbound_workspace?order='+encodeURIComponent(record.order_id)}>采购入库</button>}</>}/></div>
<div className="body">{state.error&&<div className="notice">{state.error}</div>}<div className="card">
<div className="details">
<div className="value">
<small>到货登记</small>{state.receipt.code}</div>
<div className="value">
<small>采购订单</small>{state.order.code}</div>
<div className="value">
<small>供应商</small>{state.supplier.name}</div>
<div className="value">
<small>物料</small>{record.item_code} · {record.name.replace(/^IQC-\\d{4}-\\d+ PIN-\\d{4}-\\d+ /,'')}</div>
<div className="value">
<small>规格型号</small>{record.specification} / {record.model}</div>
<div className="value">
<small>检验方式</small>{record.inspection_method==='sampling'?'抽检':'全检'}</div>
<div className="value">
<small>总数量</small>{record.total_quantity} {record.unit_name}</div>
<div className="value">
<small>批次</small>{record.batch_number||'—'}</div>
</div>
</div>
<div className="card"><div className="fp-card-toolbar"><strong>检验结果录入</strong><span className="fp-grow"/>{record.status==='pending'?<ForgeSelectControl aria-label="记录方式" className="fp-select" value={recordMode} onChange={e=>setRecordMode(e.target.value)}><option value="summary">汇总数量录入</option><option value="item">逐项录入</option></ForgeSelectControl>:<span className="fp-secondary">记录方式 {recordMode==='item'?'逐项录入':'汇总数量录入'}</span>}<span className="fp-secondary">{items.length} 项 / 抽样 {record.total_quantity} {record.unit_name||''}</span></div><div className="fp-description" style={{padding:'0 16px 10px'}}>{planName?('检验方案 '+planName):'未匹配到启用中的检验方案'}</div>{recordMode==='item'?(items.length?<div className="fp-table-wrap"><table className="fp-table"><thead><tr><th>#</th><th>检验项目</th><th>检验要求</th><th>检验结果 *</th><th>实测值</th><th>备注</th></tr></thead><tbody>{items.map((row,index)=><tr key={row.item_id||index}><td>{index+1}</td><td>{row.name}</td><td>{row.requirement||'—'}</td><td>{record.status==='pending'?<ForgeSelectControl aria-label={'第'+(index+1)+'项检验结果'} className="fp-select" value={row.result} onChange={e=>setItem(index,'result',e.target.value)}><option value="pass">合格</option><option value="fail">不合格</option><option value="na">不适用</option></ForgeSelectControl>:<ForgeStatus value={row.result==='pass'?'completed':row.result==='fail'?'rejected':'draft'} label={row.result==='pass'?'合格':row.result==='fail'?'不合格':'不适用'}/>}</td><td>{record.status==='pending'?<input className="fp-input" aria-label={'第'+(index+1)+'项实测值'} value={row.measured_value} onChange={e=>setItem(index,'measured_value',e.target.value)}/>:(row.measured_value||'—')}</td><td>{record.status==='pending'?<input className="fp-input" aria-label={'第'+(index+1)+'项备注'} value={row.remarks} onChange={e=>setItem(index,'remarks',e.target.value)}/>:(row.remarks||'—')}</td></tr>)}</tbody></table></div>:<div style={{padding:'0 16px 14px'}}><ForgeEmpty title="未匹配到检验方案项目" description="请在检验规则中为该物料维护启用中的检验方案，或改用汇总数量录入。"/></div>):<div style={{padding:'0 16px 14px'}}><ForgeNotice>当前为汇总数量录入：只登记合格数量与不合格数量，不逐项录入检验项目结果。切换到「逐项录入」后可按检验方案逐项记录结果、实测值与备注。</ForgeNotice></div>}</div>
<div className="card">{record.status==='pending'?<div className="form">
<div className="field">
<label>检验日期 *</label>
<ForgeDateInput aria-label="检验日期"  value={form.inspected_on} onChange={e=>setForm({...form,inspected_on:e.target.value})}/>
</div>
<div className="field">
<label>合格数量 *</label>
<input aria-label="合格数量" type="number" min="0" max={record.total_quantity} value={form.accepted_quantity} onChange={e=>setForm({...form,accepted_quantity:e.target.value})}/>
</div>
<div className="field">
<label>不合格数量</label>
<input value={Math.max(0,Number(record.total_quantity)-Number(form.accepted_quantity||0))} disabled/>
</div>
<div className="field wide">
<label>检验结论 *</label>
<textarea aria-label="检验结论" value={form.inspection_note} onChange={e=>setForm({...form,inspection_note:e.target.value})}/>
</div>
</div>:<div className="details">
<div className="value">
<small>检验日期</small>{record.inspected_on}</div>
<div className="value">
<small>合格数量</small>{record.accepted_quantity}</div>
<div className="value">
<small>不合格数量</small>{record.rejected_quantity}</div>
<div className="value">
<small>检验结果</small>{resultText[record.result]}</div>
<div className="value" style={{gridColumn:'1/-1'}}>
<small>检验结论</small>{record.inspection_note}</div>
</div>}</div>
</div>
</div>;
}
export default App;`;

export const PendingInspectionWorkspacePage = {
  name: "page_pending_inspection_workspace",
  label: "待检验库存",
  description: "按到货物料行跟踪待检状态并生成检验单",
  icon: "clipboard-clock",
  type: "app" as const,
  kind: "react" as const,
  source: pendingInspectionPageSource,
};
export const PurchaseInspectionWorkspacePage = {
  name: "page_purchase_inspection_workspace",
  label: "检验单",
  description: "逐物料办理采购检验并登记合格与不合格数量",
  icon: "clipboard-check",
  type: "app" as const,
  kind: "react" as const,
  source: purchaseInspectionPageSource,
};
