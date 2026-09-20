import {
  forgeProductUiCss,
  forgeProductUiRuntime,
  forgeProcurementUiCss,
} from "./product-ui.js";

const arrivalCss = forgeProductUiCss + forgeProcurementUiCss;

const purchaseArrivalPageSource = `
function App(){
  const query=new URLSearchParams(window.location.search),receiptId=query.get('id'),requestedNotice=query.get('notice');
  const [state,setState]=React.useState({loading:true,receipts:[],allReceiptLines:[],notice:null,noticeLines:[],order:null,orderLines:{},receipt:null,receiptLines:[],supplier:null,suppliers:{},orders:{},warehouses:[],error:''});
  const [form,setForm]=React.useState({arrived_on:new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10),contact_name:'',contact_phone:'',carrier:'',logistics_number:'',remarks:''});
  const [lines,setLines]=React.useState([]),[busy,setBusy]=React.useState(false),[confirm,setConfirm]=React.useState(null),[listMode,setListMode]=React.useState('orders'),[listQuery,setListQuery]=React.useState(''),[listStatus,setListStatus]=React.useState(''),[listType,setListType]=React.useState(''),[page,setPage]=React.useState(1),[taskOpen,setTaskOpen]=React.useState(false),[toast,setToast]=React.useState('');
  async function request(path,options){const response=await fetch('/api/v1'+path,{credentials:'include',headers:{'Content-Type':'application/json'},...options});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error((typeof payload.error==='string'?payload.error:payload.error?.message)||(Array.isArray(payload.fields)&&payload.fields.length?payload.fields.map(f=>f.message||f.label).filter(Boolean).join('；'):'')||payload.message||'请求失败');return payload;}
  async function find(object,where){const filter=where?('&$filter='+encodeURIComponent(JSON.stringify(where))):'';return (await request('/data/'+object+'?$top=100'+filter)).records||[];}
  async function read(object,id){return (await request('/data/'+object+'/'+id)).record;}
  async function load(){try{if(!receiptId&&!requestedNotice){const [receipts,allReceiptLines,suppliers,orders,warehouses]=await Promise.all([find('forge_purchase_receipt'),find('forge_purchase_receipt_line'),find('forge_supplier'),find('forge_purchase_order'),find('forge_warehouse')]);setState(s=>({...s,loading:false,receipts,allReceiptLines,suppliers:Object.fromEntries(suppliers.map(x=>[x.id,x])),orders:Object.fromEntries(orders.map(x=>[x.id,x])),warehouses,error:''}));return;}let receipt=receiptId?await read('forge_purchase_receipt',receiptId):null,noticeId=requestedNotice||receipt?.notice_id;if(!noticeId)throw new Error('缺少到货通知');const notice=await read('forge_purchase_arrival_notice',noticeId);const [noticeLines,order,supplier,warehouses,receiptLines]=await Promise.all([find('forge_purchase_arrival_notice_line',{notice_id:noticeId}),read('forge_purchase_order',notice.order_id),read('forge_supplier',notice.supplier_id),find('forge_warehouse'),receipt?find('forge_purchase_receipt_line',{receipt_id:receipt.id}):Promise.resolve([])]);const orderLines=Object.fromEntries((await find('forge_purchase_order_line',{order_id:notice.order_id})).map(item=>[item.id,item]));if(!receipt){const defaultWarehouse=notice.warehouse_id||warehouses[0]?.id||'';setLines(noticeLines.map(item=>({notice_line_id:item.id,quantity:Math.max(0,Number(item.planned_quantity||0)-Number(item.arrived_quantity||0)),warehouse_id:defaultWarehouse,warehouse_location:'',external_sn:'',batch_number:'',remarks:''})));}else setLines(receiptLines.map(item=>({...item})));setState(s=>({...s,loading:false,notice,noticeLines,order,orderLines,receipt,receiptLines,supplier,warehouses,error:''}));}catch(error){setState(s=>({...s,loading:false,error:String(error.message||error)}));}}
 React.useEffect(()=>{load();if(!receiptId&&!requestedNotice){const retry=setTimeout(load,500);return()=>clearTimeout(retry);}},[]);
  function setLine(index,field,value){setLines(current=>current.map((line,i)=>i===index?{...line,[field]:value}:line));}
  function confirmTitle(action,mode){if(action==='save')return mode==='submit'?'确认提交到货登记':'确认保存到货登记';return '确认提交待检';}
  function confirmImpact(action,mode){if(action==='save')return mode==='submit'?'确认后将生成到货登记，并把本次到货物料送入待检流程。':'确认后将保存当前到货登记草稿，后续仍可补充后再提交。';return '确认后将把草稿到货登记送入待检流程，待检库存将生成对应记录。';}
  async function runConfirmed(task){setBusy(true);setState(s=>({...s,error:''}));try{if(task.action==='save'){const mode=task.mode;const payload=await request('/actions/forge_purchase_arrival_notice/purchase_arrival_register/'+state.notice.id,{method:'POST',body:JSON.stringify({params:{mode,arrived_on:form.arrived_on,contact_name:form.contact_name,contact_phone:form.contact_phone,carrier:form.carrier,logistics_number:form.logistics_number,remarks:form.remarks,lines_json:JSON.stringify(lines.map(line=>({notice_line_id:line.notice_line_id,quantity:Number(line.quantity||0),warehouse_id:line.warehouse_id||null,warehouse_location:line.warehouse_location||null,external_sn:line.external_sn||null,batch_number:line.batch_number||null,remarks:line.remarks||null})))}})});const result=payload.result||payload.data?.result||payload.data||payload;if(!result.id)throw new Error('到货登记创建后未返回记录ID');window.location.href=window.location.pathname+'?id='+encodeURIComponent(result.id);return;}await request('/actions/forge_purchase_receipt/purchase_receipt_submit/'+state.receipt.id,{method:'POST',body:JSON.stringify({params:{}})});setConfirm(null);await load();}catch(error){setConfirm(c=>c?({...c,error:String(error.message||error)}):c);setState(s=>({...s,error:String(error.message||error)}));}finally{setBusy(false);}}
  function save(mode){setConfirm({action:'save',mode,title:confirmTitle('save',mode),impact:confirmImpact('save',mode),subtitle:state.notice?.code||state.order?.code||'到货登记',error:''});}
  function submitDraft(){setConfirm({action:'submit',title:confirmTitle('submit'),impact:confirmImpact('submit'),subtitle:state.receipt?.code||'到货登记',error:''});}
  const money=value=>'¥'+Number(value||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const statusText={draft:'草稿',pending_inspection:'待检验',inspection_in_progress:'检验中',inspected:'已检验',exempt:'免检入库',exempt_stocked:'免检已入库',stocked:'已入库',cancelled:'已取消'},arrivalTypeText={purchase:'采购到货',supplier_replacement:'供应商补货',other:'其他到货',return:'退货到货'},warehouseName=id=>state.warehouses.find(w=>w.id===id)?.name||'—';
  const round2=value=>Math.round((Number(value)+Number.EPSILON)*100)/100,total=lines.reduce((sum,line)=>sum+Number(line.quantity||0),0),untaxed=lines.reduce((sum,line)=>{const noticeLine=state.noticeLines.find(item=>item.id===(line.notice_line_id||line.id));const orderLine=noticeLine&&state.orderLines[noticeLine.order_line_id];return sum+round2(Number(line.quantity||0)*Number(orderLine?.untaxed_unit_price||line.untaxed_unit_price||0));},0),taxed=lines.reduce((sum,line)=>{const noticeLine=state.noticeLines.find(item=>item.id===(line.notice_line_id||line.id));const orderLine=noticeLine&&state.orderLines[noticeLine.order_line_id];return sum+round2(Number(line.quantity||0)*Number(orderLine?.taxed_unit_price||line.taxed_unit_price||0));},0);
  const listRows=state.receipts.filter(row=>(!listQuery.trim()||[row.code,state.suppliers[row.supplier_id]?.name,state.orders[row.order_id]?.code,row.purchase_return_id].join(' ').toLowerCase().includes(listQuery.trim().toLowerCase()))&&(!listStatus||row.status===listStatus)&&(!listType||row.arrival_type===listType)),pageCount=Math.max(1,Math.ceil(listRows.length/20)),safePage=Math.min(page,pageCount),visibleRows=listRows.slice((safePage-1)*20,safePage*20),visibleLines=state.allReceiptLines.filter(line=>visibleRows.some(row=>row.id===line.receipt_id));
  function exportList(){const head=['到货单号','类型','到货日期','仓库','对方','关联单号','物料种类数量','含税金额','状态'],body=listRows.map(row=>[row.code,arrivalTypeText[row.arrival_type]||row.arrival_type,row.arrived_on,warehouseName(row.warehouse_id),state.suppliers[row.supplier_id]?.name||'',state.orders[row.order_id]?.code||'',(row.line_count||0)+' 种 / '+(row.total_quantity||0),row.taxed_amount,statusText[row.status]||row.status]),csv=[head,...body].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\\ufeff'+csv],{type:'text/csv'}));a.download='purchase-arrivals.csv';a.click();URL.revokeObjectURL(a.href);setToast('已导出 '+listRows.length+' 条到货登记');setTimeout(()=>setToast(''),2000);}
  const css=${JSON.stringify(arrivalCss)};

  if(state.loading)return <div className="forge-product forge-procurement forge-arrival">
<style>{css}</style>
<div className="body">
<ForgeLoading label="正在加载到货登记"/>
</div>
</div>;
  if(!receiptId&&!requestedNotice)return <div className="forge-product forge-procurement forge-arrival">
<style>{css}</style>
<div className="body">
<ForgeHero section="供应链 / 到货检验 / 到货登记" title="到货登记" description="登记到货物料，进入待检或免检流程。" icon="▤" tone="indigo" art="boxes" next={{label:"待检验库存",href:forgeBase+'/page/page_pending_inspection_workspace',title:"下一步操作 · 待检验库存"}}/><div className="fp-action-row"><button className="fp-button" disabled={!listRows.length} onClick={exportList}>导出</button><button className="fp-button" onClick={()=>setTaskOpen(true)}>导入/导出任务</button><ForgeListSettings/><button className="fp-icon-button" aria-label="刷新" title="刷新" onClick={load}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></button><button className="fp-button primary" onClick={()=>window.location.href=forgeBase+'/page/page_purchase_arrival_notice'}>新建到货登记</button></div>
{state.error&&<div className="notice">{state.error}</div>}<div className="card">
<div className="actions" style={{marginBottom:12}}>
<button className={'btn '+(listMode==='orders'?'primary':'')} onClick={()=>setListMode('orders')}>订单明细</button>
<button className={'btn '+(listMode==='lines'?'primary':'')} onClick={()=>setListMode('lines')}>物料明细</button>
<input aria-label="搜索到货登记" placeholder="搜索到货单号/供应商/客户/退货单号..." value={listQuery} onChange={e=>{setListQuery(e.target.value);setPage(1)}}/>
<ForgeSelectControl aria-label="到货登记状态" value={listStatus} onChange={e=>{setListStatus(e.target.value);setPage(1)}}>
<option value="">全部状态</option>{Object.entries(statusText).map(([v,l])=>
<option key={v} value={v}>{l}</option>)}</ForgeSelectControl>
<ForgeSelectControl aria-label="到货登记类型" value={listType} onChange={e=>{setListType(e.target.value);setPage(1)}}>
<option value="">全部类型</option>{Object.entries(arrivalTypeText).map(([v,l])=>
<option key={v} value={v}>{l}</option>)}</ForgeSelectControl>
</div>
<div className="table">{listMode==='orders'?<table>
<thead>
<tr>
<th>到货单号</th>
<th>类型</th>
<th>到货日期</th>
<th>仓库</th>
<th>对方</th>
<th>关联单号</th>
<th>物料种类数量</th>
<th>含税金额</th>
<th>状态</th>
<th>操作</th>
</tr>
</thead>
<tbody>{visibleRows.map(row=>
<tr key={row.id}>
<td>{row.code}</td>
<td>{arrivalTypeText[row.arrival_type]||row.arrival_type||'采购到货'}</td>
<td>{row.arrived_on||'—'}</td>
<td>{warehouseName(row.warehouse_id)}</td>
<td>{state.suppliers[row.supplier_id]?.name||'—'}</td>
<td>{state.orders[row.order_id]?.code||'—'}</td>
<td>{row.line_count||0} 种 / {row.total_quantity||0}</td>
<td>{money(row.taxed_amount)}</td>
<td>
<span className="pill">{statusText[row.status]||row.status}</span>
</td>
<td>
<button className="fp-icon-button row-action" aria-label="查看" title="查看" onClick={()=>window.location.href=window.location.pathname+'?id='+encodeURIComponent(row.id)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/></svg></button>
</td>
</tr>)}{!visibleRows.length&&<tr>
<td colSpan="10">暂无到货登记记录</td>
</tr>}</tbody>
</table>:<table>
<thead>
<tr>
<th>到货单号</th>
<th>物料编码</th>
<th>物料名称</th>
<th>规格/型号</th>
<th>数量</th>
<th>批次</th>
<th>仓库</th>
<th>含税金额</th>
<th>状态</th>
</tr>
</thead>
<tbody>{visibleLines.map(line=>
<tr key={line.id}>
<td>{state.receipts.find(r=>r.id===line.receipt_id)?.code||'—'}</td>
<td>{line.item_code||'—'}</td>
<td>{line.name}</td>
<td>{line.specification||line.model||'—'}</td>
<td>{line.quantity}</td>
<td>{line.batch_number||'—'}<div className="fp-secondary">{line.external_sn?('SN '+line.external_sn):'无 SN'}</div></td>
<td>{warehouseName(line.warehouse_id)}</td>
<td>{money(line.taxed_amount)}</td>
<td>
<span className="pill">{statusText[line.status]||line.status}</span>
</td>
</tr>)}{!visibleLines.length&&<tr>
<td colSpan="9">暂无物料明细</td>
</tr>}</tbody>
</table>}</div>
<div className="actions" style={{justifyContent:'space-between',marginTop:12}}>
<span>共 {listRows.length} 条记录 · 每页 20 条</span>
<span className="actions">
<button className="btn" disabled={safePage<=1} onClick={()=>setPage(safePage-1)}>上一页</button>
<span>{safePage} / {pageCount}</span>
<button className="btn" disabled={safePage>=pageCount} onClick={()=>setPage(safePage+1)}>下一页</button>
</span>
</div>
</div>
</div>{taskOpen&&<ForgeDialog open title="导入/导出任务" subtitle="到货登记" confirmLabel="关闭" onCancel={()=>setTaskOpen(false)} onConfirm={()=>setTaskOpen(false)}>
<div className="hint">当前没有运行中的到货登记导入任务。导出会即时生成 CSV。</div>
</ForgeDialog>}{toast&&<div role="status" className="notice">{toast}</div>}</div>;
  if(!state.notice)return <div className="forge-product forge-procurement forge-arrival">
<style>{css}</style>
<div className="body">
<div className="notice">{state.error||'到货通知不存在'}</div>
<button className="btn" onClick={()=>window.location.href=window.location.pathname}>返回列表</button>
</div>
</div>;
  if(state.receipt){return <div className="forge-product forge-procurement forge-arrival">
<style>{css}</style>
<div className="header-shell"><ForgePageHeader badge="供" section="供应链 / 到货登记" title={state.receipt.code} description={'来源 '+state.order.code+' · '+state.supplier.name+' · '+(statusText[state.receipt.status]||state.receipt.status)} actions={<><button className="fp-button" onClick={()=>window.location.href=window.location.pathname}>返回列表</button>{state.receipt.status==='draft'&&<button className="fp-button primary" disabled={busy} onClick={submitDraft}>提交待检</button>}{['pending_inspection','inspection_in_progress','inspected','stocked'].includes(state.receipt.status)&&<button className="fp-button primary" onClick={()=>window.location.href=forgeBase+'/page/page_pending_inspection_workspace'}>查看待检库存</button>}</>}/></div>
<div className="flow">
<span>到货登记</span>
<span className="active">待检库存</span>
<span>检验单</span>
<span>入库单</span>
</div>
<div className="body">{state.error&&<div className="notice">{state.error}</div>}<section className="card">
<h2>基本信息</h2>
<div className="details">
<div className="value">
<small>到货类型</small>采购到货</div>
<div className="value">
<small>到货日期</small>{state.receipt.arrived_on}</div>
<div className="value">
<small>供应商</small>{state.supplier.name}</div>
<div className="value">
<small>采购订单</small>{state.order.code}</div>
<div className="value">
<small>物料行数</small>{state.receipt.line_count}</div>
<div className="value">
<small>到货数量</small>{state.receipt.total_quantity}</div>
</div>
</section>
<section className="card">
<h2>到货登记摘要</h2>
<div className="grid">
<div className="value"><small>到货类型</small>{state.receipt.receipt_type==='other'?'其他到货':'采购到货'}</div>
<div className="value"><small>到货日期</small>{state.receipt.received_on||state.receipt.arrived_on||'—'}</div>
<div className="value"><small>物料行数</small>{state.receipt.line_count}</div>
<div className="value"><small>到货数量</small>{state.receipt.total_quantity}</div>
<div className="value"><small>不含税金额</small>{money(state.receipt.untaxed_amount)}</div>
<div className="value"><small>含税金额</small>{money(state.receipt.taxed_amount)}</div>
</div>
</section>
<section className="card">
<h2>到货物料明细</h2>
<div className="table">
<table>
<thead>
<tr>
<th>编码</th>
<th>物料名称</th>
<th>规格</th>
<th>型号</th>
<th>单位</th>
<th>数量</th>
<th>批次 / SN</th>
<th>含税单价</th>
<th>不含税单价</th>
<th>含税金额</th>
<th>仓库</th>
<th>库位</th>
</tr>
</thead>
<tbody>{state.receiptLines.map(line=>
<tr key={line.id}>
<td>{line.item_code}</td>
<td>{line.name}</td>
<td>{line.specification}</td>
<td>{line.model}</td>
<td>{line.unit_name}</td>
<td>{line.quantity}</td>
<td>{line.batch_number||'—'}<div className="fp-secondary">{line.external_sn?('SN '+line.external_sn):'无 SN'}</div></td>
<td>{money(line.taxed_unit_price)}</td>
<td>{money(line.untaxed_unit_price)}</td>
<td>{money(line.taxed_amount)}</td>
<td>{state.warehouses.find(w=>w.id===line.warehouse_id)?.name||'—'}</td>
<td>{line.warehouse_location||'不指定'}</td>
</tr>)}</tbody>
</table>
</div>
<div className="summary">
<span>到货数量 <strong>{state.receipt.total_quantity}</strong>
</span>
<span>不含税金额 <strong>{money(state.receipt.untaxed_amount)}</strong>
</span>
<span>含税金额 <strong>{money(state.receipt.taxed_amount)}</strong>
</span>
</div>
</section>
</div>{confirm&&<ForgeDialog open title={confirm.title} subtitle={confirm.subtitle} error={confirm.error} busy={busy} confirmLabel="确认提交" onCancel={()=>!busy&&setConfirm(null)} onConfirm={()=>runConfirmed(confirm)}>
<div className="notice">{confirm.impact}</div>
<div className="hint">请确认到货日期、来源订单、物料数量、仓库和批次信息无误。</div>
</ForgeDialog>}</div>}
  return <div className="forge-product forge-procurement forge-arrival">
<style>{css}</style>
<div className="header-shell"><ForgePageHeader badge="供" section="供应链 / 到货登记" title="新建采购到货登记" description="到货单号将在保存时自动生成。" actions={<><button className="fp-button" disabled={busy} onClick={()=>window.location.href=forgeBase+'/page/page_purchase_order_workspace?id='+encodeURIComponent(state.order.id)}>返回采购订单</button><button className="fp-button" disabled={busy} onClick={()=>save('draft')}>保存草稿</button><button className="fp-button primary" disabled={busy} onClick={()=>save('submit')}>提交待检</button></>}/></div>
<div className="flow">
<span className="active">到货登记</span>
<span>待检库存</span>
<span>检验单</span>
<span>入库单</span>
</div>
<div className="body">{state.error&&<div className="notice">{state.error}</div>}<section className="card">
<h2>基本信息</h2>
<div className="grid">
<div className="field">
<label>到货类型 *</label>
<input value="采购到货" disabled/>
</div>
<div className="field">
<label>到货日期 *</label>
<ForgeDateInput  value={form.arrived_on} onChange={e=>setForm({...form,arrived_on:e.target.value})}/>
</div>
<div className="field">
<label>送货联系人</label>
<input value={form.contact_name} onChange={e=>setForm({...form,contact_name:e.target.value})}/>
</div>
<div className="field">
<label>联系电话</label>
<input value={form.contact_phone} onChange={e=>setForm({...form,contact_phone:e.target.value})}/>
</div>
<div className="field">
<label>承运方</label>
<input value={form.carrier} onChange={e=>setForm({...form,carrier:e.target.value})}/>
</div>
<div className="field">
<label>物流单号</label>
<input value={form.logistics_number} onChange={e=>setForm({...form,logistics_number:e.target.value})}/>
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
</section>
<section className="card">
<h2>到货物料明细 <span className="muted">{state.noticeLines.length} 种</span>
</h2>
<div className="table">
<table>
<thead>
<tr>
<th>#</th>
<th>物料编码</th>
<th>物料名称</th>
<th>规格</th>
<th>型号</th>
<th>单位</th>
<th>到货数量 *</th>
<th>批次</th>
<th>外部 SN</th>
<th>含税单价</th>
<th>不含税单价</th>
<th>税率</th>
<th>含税金额</th>
<th>仓库 *</th>
<th>库位</th>
<th>备注</th>
</tr>
</thead>
<tbody>{state.noticeLines.map((noticeLine,index)=>{const line=lines[index]||{},orderLine=state.orderLines[noticeLine.order_line_id]||{},remaining=Number(noticeLine.planned_quantity||0)-Number(noticeLine.arrived_quantity||0);return <tr key={noticeLine.id}>
<td>{index+1}</td>
<td>{noticeLine.item_code}</td>
<td>{noticeLine.name}</td>
<td>{noticeLine.specification}</td>
<td>{noticeLine.model}</td>
<td>{noticeLine.unit_name}</td>
<td>
<input aria-label={noticeLine.item_code+' 到货数量'} type="number" min="0" max={remaining} value={line.quantity??0} onChange={e=>setLine(index,'quantity',e.target.value)}/>
<div className="muted">剩余可到 {remaining}</div>
</td>
<td>
<input aria-label={noticeLine.item_code+' 批次'} value={line.batch_number||''} onChange={e=>setLine(index,'batch_number',e.target.value)}/>
</td>
<td>
<input aria-label={noticeLine.item_code+' 外部 SN'} value={line.external_sn||''} onChange={e=>setLine(index,'external_sn',e.target.value)} placeholder="多个用逗号分隔"/>
</td>
<td>{money(orderLine.taxed_unit_price)}</td>
<td>{money(orderLine.untaxed_unit_price)}</td>
<td>{orderLine.tax_rate||13}%</td>
<td>{money(Number(line.quantity||0)*Number(orderLine.taxed_unit_price||0))}</td>
<td>
<ForgeSelectControl aria-label={noticeLine.item_code+' 仓库'} value={line.warehouse_id||''} onChange={e=>setLine(index,'warehouse_id',e.target.value)}>
<option value="">请选择</option>{state.warehouses.map(w=>
<option key={w.id} value={w.id}>{w.name}</option>)}</ForgeSelectControl>
</td>
<td>
<input aria-label={noticeLine.item_code+' 库位'} value={line.warehouse_location||''} onChange={e=>setLine(index,'warehouse_location',e.target.value)} placeholder="不指定"/>
</td>
<td>
<input aria-label={noticeLine.item_code+' 备注'} value={line.remarks||''} onChange={e=>setLine(index,'remarks',e.target.value)}/>
</td>
</tr>})}</tbody>
</table>
</div>
<div className="summary">
<span>到货数量 <strong>{total}</strong>
</span>
<span>不含税金额 <strong>{money(untaxed)}</strong>
</span>
<span>含税金额 <strong>{money(taxed)}</strong>
</span>
</div>
</section>
<section className="card">
<h2>备注</h2>
<div className="field">
<label>备注</label>
<textarea value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})}/>
</div>
</section>
</div>{confirm&&<ForgeDialog open title={confirm.title} subtitle={confirm.subtitle} error={confirm.error} busy={busy} confirmLabel="确认提交" onCancel={()=>!busy&&setConfirm(null)} onConfirm={()=>runConfirmed(confirm)}>
<div className="notice">{confirm.impact}</div>
<div className="hint">请确认到货日期、来源订单、物料数量、仓库和批次信息无误。</div>
</ForgeDialog>}</div>;
}
export default App;

${forgeProductUiRuntime}
`;

export const PurchaseArrivalWorkspacePage = {
  name: "page_purchase_arrival_workspace",
  label: "到货登记",
  description: "采购订单级多物料到货登记与待检流转",
  icon: "package-check",
  type: "app" as const,
  kind: "react" as const,
  source: purchaseArrivalPageSource,
};
