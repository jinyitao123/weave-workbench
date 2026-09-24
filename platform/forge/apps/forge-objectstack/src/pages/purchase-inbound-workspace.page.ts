import {
  forgeProductUiCss,
  forgeProductUiRuntime,
  forgeProcurementUiCss,
} from "./product-ui.js";

const inboundCss = forgeProductUiCss + forgeProcurementUiCss;

const purchaseInboundPageSource = `
function App(){const adapter=useAdapter();
 const query=new URLSearchParams(window.location.search),inboundId=query.get('id'),orderId=query.get('order');
 const [state,setState]=React.useState({loading:true,inbounds:[],inbound:null,lines:[],order:null,orderLines:{},supplier:null,warehouses:[],suppliers:{},inspections:[],logs:[],invoices:[],error:''}),[form,setForm]=React.useState({inbound_on:new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10),remarks:''}),[lines,setLines]=React.useState([]),[approval,setApproval]=React.useState(''),[approveOpen,setApproveOpen]=React.useState(false),[invoiceDialog,setInvoiceDialog]=React.useState(null),[confirm,setConfirm]=React.useState(null),[search,setSearch]=React.useState(''),[statusFilter,setStatusFilter]=React.useState(''),[sourceFilter,setSourceFilter]=React.useState(''),[page,setPage]=React.useState(1),[printOpen,setPrintOpen]=React.useState(false),[selected,setSelected]=React.useState([]),[toast,setToast]=React.useState(''),[busy,setBusy]=React.useState(false);
 async function request(path,options){const response=await ForgeApiResponse(adapter,path,{credentials:'include',headers:{'Content-Type':'application/json'},...options});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error((typeof payload.error==='string'?payload.error:payload.error?.message)||(Array.isArray(payload.fields)&&payload.fields.length?payload.fields.map(f=>f.message||f.label).filter(Boolean).join('；'):'')||payload.message||'请求失败');return payload;}
 async function find(object,where){const filter=where?('&$filter='+encodeURIComponent(JSON.stringify(where))):'';return (await request('/data/'+object+'?$top=100'+filter)).records||[];}async function read(object,id){return (await request('/data/'+object+'/'+id)).record;}
 async function load(){try{if(!inboundId&&!orderId){const [inbounds,suppliers,warehouses,users]=await Promise.all([find('forge_purchase_inbound'),find('forge_supplier'),find('forge_warehouse'),find('sys_user')]);setState({loading:false,inbounds,inbound:null,lines:[],order:null,orderLines:{},supplier:null,warehouses,suppliers:Object.fromEntries(suppliers.map(x=>[x.id,x])),users:Object.fromEntries(users.map(x=>[x.id,x])),inspections:[],logs:[],invoices:[],error:''});return;}if(inboundId){const inbound=await read('forge_purchase_inbound',inboundId),[savedLines,order,supplier,warehouses,logs,invoices]=await Promise.all([find('forge_purchase_inbound_line',{inbound_id:inboundId}),read('forge_purchase_order',inbound.order_id),read('forge_supplier',inbound.supplier_id),find('forge_warehouse'),find('forge_purchase_inbound_approval_log',{inbound_id:inboundId}),find('forge_purchase_invoice',{inbound_id:inboundId})]);setState({loading:false,inbounds:[],inbound,lines:savedLines,order,orderLines:{},supplier,warehouses,suppliers:{},inspections:[],logs,invoices,error:''});return;}const order=await read('forge_purchase_order',orderId),[supplier,warehouses,inspections,existingLines,orderLineList]=await Promise.all([read('forge_supplier',order.supplier_id),find('forge_warehouse'),find('forge_purchase_inspection',{order_id:orderId}),find('forge_purchase_inbound_line'),find('forge_purchase_order_line',{order_id:orderId})]);const eligible=inspections.filter(i=>i.status==='completed'&&Number(i.accepted_quantity||0)>0).map(i=>{const used=existingLines.filter(line=>line.inspection_id===i.id&&line.status!=='cancelled').reduce((sum,line)=>sum+Number(line.quantity||0),0);return {...i,remaining:Math.max(0,Number(i.accepted_quantity||0)-used)}}).filter(i=>i.remaining>0);setLines(eligible.map(i=>({inspection_id:i.id,quantity:i.remaining,warehouse_id:i.warehouse_id,warehouse_location:'',remarks:''})));setState({loading:false,inbounds:[],inbound:null,lines:[],order,orderLines:Object.fromEntries(orderLineList.map(line=>[line.id,line])),supplier,warehouses,suppliers:{},inspections:eligible,logs:[],invoices:[],error:''});}catch(error){setState(s=>({...s,loading:false,error:String(error.message||error)}));}}
 React.useEffect(()=>{load();if(!inboundId&&!orderId){const retry=setTimeout(load,500);return()=>clearTimeout(retry);}},[]);function setLine(index,field,value){setLines(current=>current.map((line,i)=>i===index?{...line,[field]:value}:line));}
 function confirmTitle(action,mode){return {create:mode==='submit'?'确认提交采购入库':'确认保存采购入库',purchase_inbound_submit:'确认提交入库审批',purchase_inbound_approve:'确认审批通过',purchase_inbound_stock:'确认执行入库'}[action]||'确认采购入库操作';}
 function confirmImpact(action,mode){if(action==='create')return mode==='submit'?'确认后将生成采购入库单并提交审批。':'确认后将保存采购入库草稿，后续仍可提交审批。';if(action==='purchase_inbound_submit')return '确认后该入库单进入审批流程。';if(action==='purchase_inbound_approve')return '确认后该入库单可由仓库执行入库。';if(action==='purchase_inbound_stock')return '确认后将增加仓库库存并回写采购入库状态。';return '确认后将推进采购入库办理状态。';}
 async function runConfirmed(task){setBusy(true);setState(s=>({...s,error:''}));try{if(task.action==='create'){const mode=task.mode;const params={mode,inbound_on:form.inbound_on,remarks:form.remarks,lines_json:JSON.stringify(lines.map(line=>({...line,quantity:Number(line.quantity||0)})))};const payload=await request('/actions/forge_purchase_order/purchase_order_create_inbound/'+state.order.id,{method:'POST',body:JSON.stringify({params})});const result=payload.result||payload.data?.result||payload.data||payload;if(!result.id)throw new Error('采购入库单创建后未返回记录ID');window.location.href=window.location.pathname+'?id='+encodeURIComponent(result.id);return;}await request('/actions/forge_purchase_inbound/'+task.action+'/'+state.inbound.id,{method:'POST',body:JSON.stringify({params:task.params||{}})});setConfirm(null);await load();}catch(error){setConfirm(c=>c?({...c,error:String(error.message||error)}):c);setState(s=>({...s,error:String(error.message||error)}));}finally{setBusy(false);}}
 function create(mode){setConfirm({action:'create',mode,params:{},title:confirmTitle('create',mode),impact:confirmImpact('create',mode),subtitle:state.order?.code||'采购入库',error:''});}
 function action(name,params={}){setConfirm({action:name,params,title:confirmTitle(name),impact:confirmImpact(name),subtitle:state.inbound?.code||'采购入库',error:''});}
 async function registerInvoice(){const note=invoiceDialog||{},missing=!String(note.code||'').trim()?'请填写登记编号':!String(note.invoice_number||'').trim()?'请填写发票号码':!note.invoice_on?'请选择开票日期':!note.due_on?'请选择应付日期':'';if(missing){setInvoiceDialog({...note,error:missing});return;}setBusy(true);try{await request('/actions/forge_purchase_inbound/purchase_inbound_register_invoice/'+state.inbound.id,{method:'POST',body:JSON.stringify({params:{code:String(note.code).trim(),invoice_number:String(note.invoice_number).trim(),invoice_on:note.invoice_on,due_on:note.due_on,remarks:String(note.remarks||'').trim()||null}})});setInvoiceDialog(null);await load();}catch(error){setInvoiceDialog(value=>({...value,error:String(error.message||error)}));}finally{setBusy(false);}}
 const money=v=>'¥'+Number(v||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}),statusText={draft:'草稿',pending_approval:'待审批',approved:'已审批',stocked:'已入库',cancelled:'已取消'},sourceText={purchase_order:'采购订单',purchase_replacement:'采购换货补货',exempt_inspection:'免检入库'},inboundTypeText={purchase:'采购入库'},warehouseName=id=>state.warehouses.find(w=>w.id===id)?.name||'—',userName=id=>state.users?.[id]?.display_name||state.users?.[id]?.name||state.users?.[id]?.username||'Dev Admin';
 const total=lines.reduce((sum,line)=>sum+Number(line.quantity||0),0),taxed=lines.reduce((sum,line)=>{const i=state.inspections.find(x=>x.id===line.inspection_id),orderLine=i&&state.orderLines[i.order_line_id];return sum+Math.round((Number(line.quantity||0)*Number(orderLine?.taxed_unit_price||0)+Number.EPSILON)*100)/100;},0);
 const filteredInbounds=state.inbounds.filter(row=>(!statusFilter||row.status===statusFilter)&&(!sourceFilter||inboundRoute(row)===sourceFilter)&&(!search||[row.code,row.batch_number,state.suppliers[row.supplier_id]?.name,warehouseName(row.warehouse_id)].some(value=>String(value||'').includes(search)))),pageSize=20,totalPages=Math.max(1,Math.ceil(filteredInbounds.length/pageSize)),safePage=Math.min(page,totalPages),visibleInbounds=filteredInbounds.slice((safePage-1)*pageSize,safePage*pageSize);
 const inboundRoute=x=>x.source_type==='exempt_inspection'?'免检入库':'合格入库';function toggleRow(id){setSelected(c=>c.includes(id)?c.filter(x=>x!==id):[...c,id])}function toggleAll(){setSelected(c=>c.length===visibleInbounds.length&&visibleInbounds.length>0?[]:visibleInbounds.map(x=>x.id))}
function exportInbounds(){const headers=['入库单号','类型','来源','入库类型','批次号','供应商/客户','仓库','入库日期','含税金额','状态','创建人'],values=filteredInbounds.map(row=>[row.code,inboundTypeText[row.inbound_type]||'采购入库',inboundRoute(row),'-',row.batch_number||'',state.suppliers[row.supplier_id]?.name||'',warehouseName(row.warehouse_id),row.inbound_on,row.taxed_amount,statusText[row.status]||row.status,userName(row.submitted_by||row.responsible_id)]),csv=[headers,...values].map(line=>line.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\\n'),blob=new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='采购入库.csv';a.click();URL.revokeObjectURL(url);setToast('已导出 '+filteredInbounds.length+' 条采购入库单');}
 function printLabels(){setPrintOpen(false);setToast('已生成 '+filteredInbounds.length+' 张入库条码打印内容');setTimeout(()=>window.print(),50);}
 const confirmation=<ForgeDialog open={!!confirm} title={confirm?.title||'确认采购入库操作'} subtitle={confirm?.subtitle} error={confirm?.error} busy={busy} confirmLabel="确认办理" onCancel={()=>!busy&&setConfirm(null)} onConfirm={()=>confirm&&runConfirmed(confirm)}><div className="notice">{confirm?.impact}</div><div className="muted">系统会校验单据状态、物料数量和仓库信息；状态已变化时将阻止重复办理。</div></ForgeDialog>;
 const css=${JSON.stringify(inboundCss)};

 if(state.loading)return <div className="forge-product forge-procurement forge-inbound">
<style>{css}</style>
<div className="body">
<ForgeLoading label="正在加载采购入库"/>
</div>
</div>;
 if(!inboundId&&!orderId)return <div className="forge-product forge-procurement forge-inbound">
<style>{css}</style>
<div className="body"><ForgeHero section="供应链 / 入库管理 / 采购入库" title="采购入库" description="管理所有入库单据" icon="▤" tone="indigo" art="flow" chip="当前环节 · 采购入库"/>{state.error&&<div className="notice">{state.error}</div>}{toast&&<div className="notice">{toast}</div>}<div className="card">
<div className="fp-card-toolbar"><button className="fp-button primary" onClick={()=>navigate('/apps/com.inoforge.forge.supply-chain/page_purchase_inspection_workspace')}>新建入库单</button><button className="fp-button" disabled={!selected.length} title={selected.length?'':'请先选择入库单'} onClick={()=>setPrintOpen(true)}>打印条码</button><button className="fp-button" disabled={!filteredInbounds.length} onClick={exportInbounds}>导出 ▾</button><span className="fp-grow"/><ForgeListSettings/><button className="fp-icon-button" aria-label="刷新" title="刷新" onClick={()=>{setToast('');load();}}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></button></div>
<div className="toolbar">
<input aria-label="搜索采购入库" placeholder="搜索入库单号/批次号..." value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
<ForgeSelectControl aria-label="状态筛选" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);}}>
<option value="">全部状态</option>
<option value="draft">草稿</option>
<option value="pending_approval">待审批</option>
<option value="approved">已审批</option>
<option value="stocked">已入库</option>
<option value="cancelled">已取消</option>
</ForgeSelectControl>
<ForgeSelectControl aria-label="来源筛选" value={sourceFilter} onChange={e=>{setSourceFilter(e.target.value);setPage(1);}}>
<option value="">全部来源</option>
<option value="合格入库">合格入库</option>
<option value="免检入库">免检入库</option>
</ForgeSelectControl>
</div>
<div className="table">
<table>
<thead>
<tr>
<th><input type="checkbox" aria-label="选择当前页" checked={visibleInbounds.length>0&&selected.length===visibleInbounds.length} onChange={toggleAll}/></th>
<th>入库单号</th>
<th>类型</th>
<th>来源</th>
<th>入库类型</th>
<th>批次号</th>
<th>供应商/客户</th>
<th>仓库</th>
<th>入库日期</th>
<th>含税金额</th>
<th>状态</th>
<th>创建人</th>
<th>操作</th>
</tr>
</thead>
<tbody>{visibleInbounds.map(x=>
<tr key={x.id}>
<td><input type="checkbox" aria-label={'选择 '+x.code} checked={selected.includes(x.id)} onChange={()=>toggleRow(x.id)}/></td>
<td>{x.code}</td>
<td><span className="fp-type-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18v12H3z"/><path d="M8 7V5h8v2"/></svg>{inboundTypeText[x.inbound_type]||'采购入库'}</span></td>
<td>{inboundRoute(x)}</td>
<td>-</td>
<td>{x.batch_number||'—'}</td>
<td>{state.suppliers[x.supplier_id]?.name||'—'}</td>
<td>{warehouseName(x.warehouse_id)}</td>
<td>{x.inbound_on}</td>
<td>{money(x.taxed_amount)}</td>
<td>
<span className="pill">{statusText[x.status]}</span>
</td>
<td>{userName(x.submitted_by||x.responsible_id)}</td>
<td>
<button className="btn" aria-label="查看详情" title="查看详情" onClick={()=>window.location.href=window.location.pathname+'?id='+encodeURIComponent(x.id)}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/></svg></button>
</td>
</tr>)}</tbody>
</table>{!state.loading&&!visibleInbounds.length&&<div className="muted" style={{padding:40,textAlign:'center'}}>暂无入库单</div>}</div>
<div className="toolbar" style={{justifyContent:'flex-end',marginTop:12}}>
<span className="muted">共 {filteredInbounds.length} 条 · 20 条/页</span>
<button className="btn" disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>上一页</button>
<span>{safePage} / {totalPages}</span>
<button className="btn" disabled={safePage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>下一页</button>
</div>
</div>{printOpen&&<ForgeDialog open title="打印入库条码" subtitle={'已选择 '+selected.length+' 张'} confirmLabel="打开打印" onCancel={()=>setPrintOpen(false)} onConfirm={printLabels}>
<div className="notice">将按当前筛选结果生成入库单号与批次号标签。</div>
<div className="table">
<table>
<thead>
<tr>
<th>入库单号</th>
<th>批次号</th>
<th>仓库</th>
</tr>
</thead>
<tbody>{filteredInbounds.filter(row=>selected.includes(row.id)).map(row=>
<tr key={row.id}>
<td>{row.code}</td>
<td>{row.batch_number||'—'}</td>
<td>{warehouseName(row.warehouse_id)}</td>
</tr>)}</tbody>
</table>
</div>
</ForgeDialog>}</div>
</div>;
 if(inboundId){const inbound=state.inbound;return <div className="forge-product forge-procurement forge-inbound">
<style>{css}</style>
<div className="header-shell"><ForgePageHeader badge="供" section="供应链 / 采购入库" title={inbound.code} description={'来源 '+state.order.code+' · '+state.supplier.name+' · '+statusText[inbound.status]} actions={<><button className="fp-button" onClick={()=>window.location.href=window.location.pathname}>返回列表</button>{inbound.status==='draft'&&<button className="fp-button primary" disabled={busy} onClick={()=>action('purchase_inbound_submit')}>提交审批</button>}{inbound.status==='pending_approval'&&<><button className="fp-button primary" disabled={busy} onClick={()=>setApproveOpen(true)}>审批通过</button></>}{inbound.status==='approved'&&<button className="fp-button primary" disabled={busy} onClick={()=>action('purchase_inbound_stock')}>执行入库</button>}{inbound.status==='stocked'&&!state.invoices.some(x=>x.status==='normal')&&<button className="fp-button primary" disabled={busy} onClick={()=>setInvoiceDialog({code:'PI-'+inbound.code,invoice_number:'INV-'+inbound.code,invoice_on:inbound.inbound_on,due_on:inbound.inbound_on,remarks:'',error:''})}>登记采购发票</button>}{state.invoices.some(x=>x.status==='normal')&&<span className="pill">已登记进项发票</span>}</>}/></div>
<div className="flow">
<span>草稿</span>
<span>待审批</span>
<span>已审批</span>
<span className={inbound.status==='stocked'?'active':''}>已入库</span>
</div>
<div className="body">{state.error&&<div className="notice">{state.error}</div>}<div className="card">
<div className="details">
<div className="value">
<small>入库类型</small>采购入库</div>
<div className="value">
<small>入库日期</small>{inbound.inbound_on}</div>
<div className="value">
<small>供应商</small>{state.supplier.name}</div>
<div className="value">
<small>采购订单</small>{state.order.code}</div>
<div className="value">
<small>物料行数</small>{inbound.line_count}</div>
<div className="value">
<small>入库数量</small>{inbound.total_quantity}</div>
<div className="value">
<small>含税金额</small>{money(inbound.taxed_amount)}</div>
<div className="value">
<small>审批意见</small>{inbound.approval_note||'—'}</div>
</div>
</div>
<div className="card">
<h2>发票与应付</h2>{state.invoices.length?<div className="table">
<table>
<thead>
<tr>
<th>登记编号</th>
<th>发票号码</th>
<th>开票日期</th>
<th>应付日期</th>
<th>金额</th>
<th>状态</th>
</tr>
</thead>
<tbody>{state.invoices.map(inv=>
<tr key={inv.id}>
<td>{inv.code}</td>
<td>{inv.invoice_number}</td>
<td>{inv.invoice_on}</td>
<td>{inv.due_on}</td>
<td>{money(inv.total_amount)}</td>
<td>
<span className="pill">{inv.status==='normal'?'正常':inv.status}</span>
</td>
</tr>)}</tbody>
</table>
</div>:<div className="muted">入库完成后可登记采购发票，系统按入库明细生成进项发票和应付账款。</div>}</div>
<div className="card">
<h2>入库物料明细</h2>
<div className="table">
<table>
<thead>
<tr>
<th>物料编码</th>
<th>物料名称</th>
<th>规格型号</th>
<th>单位</th>
<th>数量</th>
<th>含税单价</th>
<th>不含税单价</th>
<th>税率</th>
<th>含税金额</th>
<th>仓库</th>
<th>库位</th>
<th>批次</th>
<th>状态</th>
</tr>
</thead>
<tbody>{state.lines.map(line=>
<tr key={line.id}>
<td>{line.item_code}</td>
<td>{line.name}</td>
<td>{line.specification} / {line.model}</td>
<td>{line.unit_name}</td>
<td>{line.quantity}</td>
<td>{money(line.taxed_unit_price)}</td>
<td>{money(line.untaxed_unit_price)}</td>
<td>{line.tax_rate}%</td>
<td>{money(line.taxed_amount)}</td>
<td>{state.warehouses.find(w=>w.id===line.warehouse_id)?.name||'—'}</td>
<td>{line.warehouse_location||'—'}</td>
<td>{line.batch_number||'—'}</td>
<td>{statusText[line.status]}</td>
</tr>)}</tbody>
</table>
</div>
</div>
</div>
<ForgeDialog open={approveOpen} title="审批采购入库单" subtitle={state.inbound?state.inbound.code:''} busy={busy} confirmLabel="确认审批" onCancel={()=>!busy&&setApproveOpen(false)} onConfirm={()=>{const note=String(approval||'').trim();if(!note){setState(v=>({...v,error:'请填写审批意见'}));return}setApproveOpen(false);action('purchase_inbound_approve',{approval_note:note})}}><div className="fp-field"><label>审批意见 <span className="fp-required">*</span></label><textarea className="fp-textarea" aria-label="审批意见" placeholder="填写审批意见后确认，审批通过后由仓库执行入库" value={approval} onChange={e=>setApproval(e.target.value)}/></div><div className="fp-secondary">审批本身不增加库存；执行入库后才会写入库存余额与流水。</div></ForgeDialog><ForgeDialog open={!!invoiceDialog} title="登记采购发票" subtitle={inbound.code} error={invoiceDialog?.error} busy={busy} confirmLabel="确认登记" onCancel={()=>!busy&&setInvoiceDialog(null)} onConfirm={registerInvoice}>
<div className="field">
<label>登记编号 *</label>
<input aria-label="进项发票登记编号" value={invoiceDialog?.code||''} onChange={e=>setInvoiceDialog({...invoiceDialog,code:e.target.value,error:''})}/>
</div>
<div className="field">
<label>发票号码 *</label>
<input aria-label="进项发票号码" value={invoiceDialog?.invoice_number||''} onChange={e=>setInvoiceDialog({...invoiceDialog,invoice_number:e.target.value,error:''})}/>
</div>
<div className="field">
<label>开票日期 *</label>
<ForgeDateInput aria-label="进项发票开票日期" value={invoiceDialog?.invoice_on||''} onChange={e=>setInvoiceDialog({...invoiceDialog,invoice_on:e.target.value,error:''})}/>
</div>
<div className="field">
<label>应付日期 *</label>
<ForgeDateInput aria-label="进项发票应付日期" value={invoiceDialog?.due_on||''} onChange={e=>setInvoiceDialog({...invoiceDialog,due_on:e.target.value,error:''})}/>
</div>
<div className="field">
<label>备注</label>
<textarea aria-label="进项发票备注" value={invoiceDialog?.remarks||''} onChange={e=>setInvoiceDialog({...invoiceDialog,remarks:e.target.value,error:''})}/>
</div>
</ForgeDialog>{confirmation}
</div>}
 return <div className="forge-product forge-procurement forge-inbound">
<style>{css}</style>
<div className="header-shell"><ForgePageHeader badge="供" section="供应链 / 采购入库" title="新建入库单" description="入库单号将在保存时生成，提交审批后进入工作流。" actions={<><button className="fp-button" disabled={busy} onClick={()=>navigate('/apps/com.inoforge.forge.supply-chain/page_purchase_inspection_workspace')}>返回检验单</button><button className="fp-button" disabled={busy} onClick={()=>create('draft')}>保存草稿</button><button className="fp-button primary" disabled={busy} onClick={()=>create('submit')}>提交审批</button></>}/></div>
<div className="flow">
<span className="active">草稿</span>
<span>待审批</span>
<span>已审批</span>
<span>已入库</span>
</div>
<div className="body">{state.error&&<div className="notice">{state.error}</div>}<div className="card">
<h2>基本信息</h2>
<div className="grid">
<div className="field">
<label>入库单号</label>
<input aria-label="入库单号" value="保存时自动生成" disabled/>
</div>
<div className="field">
<label>入库类型 *</label>
<input value="采购入库" disabled/>
</div>
<div className="field">
<label>入库日期 *</label>
<ForgeDateInput  value={form.inbound_on} onChange={e=>setForm({...form,inbound_on:e.target.value})}/>
</div>
<div className="field">
<label>供应商 *</label>
<input value={state.supplier.name} disabled/>
</div>
<div className="field">
<label>采购订单 *</label>
<input value={state.order.code} disabled/>
</div>
</div>
</div>
<div className="card">
<h2>入库物料明细 <span className="muted">{state.inspections.length} 种</span>
</h2>
<div className="table">
<table>
<thead>
<tr>
<th>#</th>
<th>物料编码</th>
<th>物料名称</th>
<th>规格型号</th>
<th>检验合格</th>
<th>入库数量 *</th>
<th>含税单价</th>
<th>仓库 *</th>
<th>库位</th>
</tr>
</thead>
<tbody>{state.inspections.map((inspection,index)=>{const line=lines[index]||{},orderLine=state.orderLines[inspection.order_line_id]||{};return <tr key={inspection.id}>
<td>{index+1}</td>
<td>{inspection.item_code}</td>
<td>{inspection.name.replace(/^IQC-\\d{4}-\\d+ PIN-\\d{4}-\\d+ /,'')}</td>
<td>{inspection.specification} / {inspection.model}</td>
<td>{inspection.remaining}</td>
<td>
<input aria-label={inspection.item_code+' 入库数量'} type="number" min="0" max={inspection.remaining} value={line.quantity??0} onChange={e=>setLine(index,'quantity',e.target.value)}/>
</td>
<td>{money(orderLine.taxed_unit_price)}</td>
<td>
<ForgeSelectControl aria-label={inspection.item_code+' 入库仓库'} value={line.warehouse_id||''} onChange={e=>setLine(index,'warehouse_id',e.target.value)}>
<option value="">请选择</option>{state.warehouses.map(w=>
<option key={w.id} value={w.id}>{w.name}</option>)}</ForgeSelectControl>
</td>
<td>
<input aria-label={inspection.item_code+' 入库库位'} value={line.warehouse_location||''} onChange={e=>setLine(index,'warehouse_location',e.target.value)}/>
</td>
</tr>})}</tbody>
</table>{!state.inspections.length&&<div className="muted" style={{padding:32,textAlign:'center'}}>当前订单没有可入库的检验合格物料</div>}</div>
<div className="summary">
<span>入库数量 <strong>{total}</strong>
</span>
<span>含税金额 <strong>{money(taxed)}</strong>
</span>
</div>
</div>
<div className="card">
<h2>备注与附件</h2>
<div className="field">
<label>备注</label>
<textarea value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})}/>
</div>
</div>
</div>{confirmation}
</div>;
}
export default App;
${forgeProductUiRuntime}
`;

export const PurchaseInboundWorkspacePage = {
  name: "page_purchase_inbound_workspace",
  label: "采购入库",
  description: "承接逐物料检验合格数量的采购入库审批与库存落账",
  icon: "package-plus",
  type: "app" as const,
  kind: "react" as const,
  source: purchaseInboundPageSource,
};
