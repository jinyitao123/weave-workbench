import { ProjectCostEntry } from '../objects/project.object.js';

// Field options stay owned by the ObjectStack model, including their labels.
const options = {
  type: ProjectCostEntry.fields.cost_type.options || [],
  source: ProjectCostEntry.fields.source_type.options || [],
  status: ProjectCostEntry.fields.status.options || [],
};

export const projectCostPanelCss = `
.pc-detail-body.pc-cost-panel{min-height:0}
.pc-cost-panel .pc-search,.pc-cost-panel .pc-button,.pc-cost-panel .fp-picker-trigger{height:var(--ui-control-height,28px);border-radius:var(--ui-control-radius,3.5px);font-size:var(--ui-control-font-size,12.25px);line-height:var(--ui-control-line-height,17.5px)}
.pc-cost-panel .pc-search{padding:var(--ui-input-padding-y,3.5px) var(--ui-input-padding-x,10.5px)}
.pc-cost-panel .pc-button{padding:var(--ui-button-padding-y,0px) var(--ui-button-padding-x,14px)}
.pc-cost-panel .fp-picker-trigger{min-height:var(--ui-control-height,28px);padding:var(--ui-button-padding-y,0px) var(--ui-input-padding-x,10.5px)}
`;

export const projectCostPanelRuntime = `
const projectCostPanelOptions=${JSON.stringify(options)};
function ProjectCostPanel({costs,purchaseOrders,suppliers,paymentSummary,purchaseStatusLabels,costUnavailable,purchaseUnavailable,supplierUnavailable,paidUnavailable,unpaidUnavailable,money,onManageCosts}) {
  const [view,setView]=React.useState('details');
  const [search,setSearch]=React.useState('');
  const [filtersOpen,setFiltersOpen]=React.useState(false);
  const [type,setType]=React.useState('');
  const [source,setSource]=React.useState('');
  const [status,setStatus]=React.useState('');
  const label=(kind,value)=>projectCostPanelOptions[kind].find(option=>option.value===value)?.label||'—';
  const query=search.trim().toLocaleLowerCase();
  const costRows=costs.filter(row=>(!type||row.cost_type===type)&&(!source||row.source_type===source)&&(!status||row.status===status)&&(!query||[row.code,row.name,label('type',row.cost_type),label('source',row.source_type),label('status',row.status)].join(' ').toLocaleLowerCase().includes(query)));
  const supplierName=row=>supplierUnavailable?'不可用':suppliers.find(supplier=>supplier.id===row.supplier_id)?.name||'—';
  const orderRows=purchaseOrders.filter(row=>(!status||row.status===status)&&(!query||[row.code,row.name,supplierUnavailable?'':supplierName(row)].join(' ').toLocaleLowerCase().includes(query)));
  const committedRows=orderRows.filter(row=>!['cancelled','rejected'].includes(row.status));
  const clear=()=>{setSearch('');setType('');setSource('');setStatus('');};
  const chooseView=next=>{setView(next);clear();setFiltersOpen(false);};
  const views=[['overview','成本概览'],['details','成本明细'],['committed','承诺成本'],['payments','付款情况']];
  const tabKey=(event,index)=>{
    const next=event.key==='ArrowRight'?(index+1)%views.length:event.key==='ArrowLeft'?(index+views.length-1)%views.length:event.key==='Home'?0:event.key==='End'?views.length-1:-1;
    if(next<0)return;
    event.preventDefault();chooseView(views[next][0]);event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  const isCostView=view==='overview'||view==='details';
  const filterOptions=(kind)=>projectCostPanelOptions[kind].map(option=><option key={option.value} value={option.value}>{option.label}</option>);
  const empty=(unavailable,title)=>unavailable?<p role="alert">当前账号无法读取此项数据</p>:<p>{search||type||source||status?'当前条件下暂无匹配记录':title}</p>;
  let headers=[],rows=[],unavailable=false,emptyTitle='';
  if(view==='overview') {
    headers=['成本类型','已归集记录','已归集金额'];
    rows=projectCostPanelOptions.type.map(option=>{
      const entries=costRows.filter(row=>row.cost_type===option.value&&row.status==='allocated');
      return entries.length?<tr key={option.value}><td>{option.label}</td><td>{entries.length}</td><td>{money(entries.reduce((total,row)=>total+Number(row.allocated_amount||0),0))}</td></tr>:null;
    }).filter(Boolean);
    unavailable=costUnavailable;emptyTitle='暂无已归集成本';
  } else if(view==='details') {
    headers=['成本编号','成本名称','成本类型','来源类型','发生日期','已归集金额','归集状态'];
    rows=costRows.map(row=><tr key={row.id}><td>{row.code||'—'}</td><td>{row.name||'—'}</td><td>{label('type',row.cost_type)}</td><td>{label('source',row.source_type)}</td><td>{row.occurred_on||'—'}</td><td>{money(row.allocated_amount)}</td><td>{label('status',row.status)}</td></tr>);
    unavailable=costUnavailable;emptyTitle='暂无成本明细';
  } else if(view==='committed') {
    headers=['采购单号','供应商','订单状态','订单金额'];
    rows=committedRows.map(row=><tr key={row.id}><td>{row.code||'—'}</td><td>{supplierName(row)}</td><td>{purchaseStatusLabels[row.status]||'—'}</td><td>{money(row.total_amount)}</td></tr>);
    unavailable=purchaseUnavailable;emptyTitle='暂无支出合同';
  } else {
    headers=['采购单号','供应商','订单状态','已确认采购付款','待付款'];
    rows=orderRows.map(row=><tr key={row.id}><td>{row.code||'—'}</td><td>{supplierName(row)}</td><td>{purchaseStatusLabels[row.status]||'—'}</td><td>{paidUnavailable?'不可用':money(paymentSummary.paidByOrder.get(row.id)||0)}</td><td>{unpaidUnavailable?'不可用':money(paymentSummary.unpaidByOrder.get(row.id)||0)}</td></tr>);
    unavailable=purchaseUnavailable;emptyTitle='暂无采购付款记录';
  }
  return <section className="pc-card pc-detail-body pc-cost-panel">
    <div className="pc-section-tabs" role="tablist" aria-label="项目成本视图">
      {views.map(([value,title],index)=><button key={value} id={'project-cost-tab-'+value} type="button" role="tab" aria-selected={view===value} aria-controls="project-cost-panel" tabIndex={view===value?0:-1} className={view===value?'active':''} onClick={()=>chooseView(value)} onKeyDown={event=>tabKey(event,index)}>{title}</button>)}
    </div>
    <div id="project-cost-panel" role="tabpanel" aria-labelledby={'project-cost-tab-'+view}>
    <div className="pc-sub-toolbar">
      <input className="pc-search" aria-label={isCostView?'搜索项目成本':'搜索项目采购单'} placeholder={isCostView?'搜索成本编号、名称...':'搜索采购单号、供应商...'} value={search} onChange={event=>setSearch(event.target.value)}/>
      <button type="button" className="pc-button" aria-expanded={filtersOpen} aria-controls="project-cost-filters" onClick={()=>setFiltersOpen(open=>!open)}>筛选</button>
      {(search||type||source||status)&&<button type="button" className="pc-button" onClick={clear}>清空筛选</button>}
      <button type="button" className="pc-button" onClick={onManageCosts}>进入成本管理</button>
    </div>
    {filtersOpen&&<div id="project-cost-filters" className="pc-sub-toolbar">
      {isCostView&&<><ForgeSelectControl aria-label="筛选成本类型" value={type} onChange={event=>setType(event.target.value)}><option value="">全部成本类型</option>{filterOptions('type')}</ForgeSelectControl><ForgeSelectControl aria-label="筛选成本来源" value={source} onChange={event=>setSource(event.target.value)}><option value="">全部来源</option>{filterOptions('source')}</ForgeSelectControl></>}
      <ForgeSelectControl aria-label={isCostView?'筛选归集状态':'筛选采购状态'} value={status} onChange={event=>setStatus(event.target.value)}><option value="">全部状态</option>{isCostView?filterOptions('status'):Object.entries(purchaseStatusLabels).map(([value,title])=><option key={value} value={value}>{title}</option>)}</ForgeSelectControl>
    </div>}
    {!isCostView&&supplierUnavailable&&<p role="alert">供应商资料读取失败，按供应商搜索暂不可用</p>}
    {unavailable?empty(true,emptyTitle):<ProjectRelatedRecordTable key={view+'|'+search+'|'+type+'|'+source+'|'+status} headers={headers} rows={rows} empty={empty(false,emptyTitle)}/>}
    </div>
  </section>;
}
`;
