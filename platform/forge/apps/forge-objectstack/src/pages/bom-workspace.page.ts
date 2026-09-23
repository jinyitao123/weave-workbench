import { forgeProductUiCss, forgeProductUiRuntime } from './product-ui.js';

const bomCss = `
.forge-bom .fp-bom-list-card,.forge-bom .fp-detail-card{overflow:hidden}.forge-bom .fp-version-list{display:grid;gap:8px}.forge-bom .fp-version-item{display:grid;grid-template-columns:minmax(220px,1fr) 100px 90px 120px 170px;gap:12px;align-items:center;border:1px solid var(--fp-line);border-radius:9px;padding:11px 13px;background:#fff}.forge-bom .fp-version-item.current{border-color:#a8c2f7;background:#f7faff}.forge-bom .fp-version-item button{border:0;background:transparent;color:var(--fp-primary);font-weight:620;text-align:left;padding:0}.forge-bom .fp-analysis-source{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--fp-muted);font-size:12px;margin-bottom:12px}.forge-bom .fp-analysis-source strong{color:#344054}.forge-bom .fp-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:13px}.forge-bom .fp-section-heading h2{font-size:14px;margin:0}.forge-bom .fp-list-count{color:var(--fp-muted);font-size:12px}@media(max-width:900px){.forge-bom .fp-version-item{grid-template-columns:1fr 90px}.forge-bom .fp-version-item>*:nth-child(n+3){display:none}}
`;

const bomPageSource = `
const css=${JSON.stringify(forgeProductUiCss + bomCss)};
function App(){const adapter=useAdapter();
  const pageSize=12;
  const initialId=new URLSearchParams(window.location.search).get('id');
  const [view,setView]=React.useState(initialId?'detail':'list');
  const [state,setState]=React.useState({loading:true,boms:[],projects:[],bom:null,nodes:[],skus:[],materials:[],logs:[],analyses:[],analysis:null,shortageLines:[],project:null,customer:null,material:null,error:''});
  const [filters,setFilters]=React.useState({search:'',type:'',status:'',project:''});
  const [selected,setSelected]=React.useState([]);
  const [page,setPage]=React.useState(1);
  const [tab,setTab]=React.useState('基础资料');
  const [plannedQuantity,setPlannedQuantity]=React.useState('1');
  const [analysisError,setAnalysisError]=React.useState('');
  const [dialog,setDialog]=React.useState(null);
  const [busy,setBusy]=React.useState(false);
  const [toast,setToast]=React.useState('');
  const [collapsed,setCollapsed]=React.useState({});

  async function request(path,options){
    const response=await ForgeApiResponse(adapter,path,{credentials:'include',headers:{'Content-Type':'application/json'},...options});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error((typeof payload.error==='string'?payload.error:payload.error?.message)||(Array.isArray(payload.fields)&&payload.fields.length?payload.fields.map(f=>f.message||f.label).filter(Boolean).join('；'):'')||payload.message||'请求失败');
    return payload;
  }
  async function fetchAll(object,filter){
    const rows=[];const size=100;let skip=0;
    for(let guard=0;guard<100;guard++){
      const params=new URLSearchParams({$top:String(size),$skip:String(skip)});
      if(filter)params.set('$filter',JSON.stringify(filter));
      const payload=await request('/data/'+object+'?'+params.toString());
      const batch=payload.records||[];rows.push(...batch);
      if(batch.length<size)break;skip+=batch.length;
    }
    return rows;
  }
  
  function exportBoms(){const rows=filtered.length?filtered:state.boms,head=['BOM编号','BOM名称','产品/设备','BOM类型','当前版本','状态','适用项目','物料数','未税成本','更新时间'],body=rows.map(b=>[b.code,b.name,b.product_name||'',typeText[b.bom_type]||b.bom_type,b.version||'',statusText[b.status]||b.status,state.projects.find(p=>p.id===b.project_id)?.name||'',b.node_count||0,b.total_cost||0,String(b.updated_at||'').slice(0,16)]),csv=[head,...body].map(r=>r.map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join('\\n'));const text=[head,...body].map(r=>r.join(',')).join('\\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\\ufeff'+text],{type:'text/csv'}));a.download='BOM列表.csv';a.click();setToast('已导出 '+body.length+' 条 BOM');}
  function nodeKey(n){const sku=state.skus.find(x=>x.id===n.sku_id),mat=state.materials.find(x=>x.id===sku?.material_id);return (mat?.code||sku?.code||n.name||'—')+' · '+(mat?.name||sku?.name||'');}
  function openCompare(){if(selected.length!==2)return setToast('请选择两条 BOM 进行对比');const [a,b]=selected.map(id=>state.boms.find(x=>x.id===id));const na=state.nodes.filter(n=>n.bom_id===a.id),nb=state.nodes.filter(n=>n.bom_id===b.id);const mapA=new Map(na.map(n=>[nodeKey(n),n])),mapB=new Map(nb.map(n=>[nodeKey(n),n]));const keys=[...new Set([...mapA.keys(),...mapB.keys()])].sort();const rows=keys.map(k=>{const x=mapA.get(k),y=mapB.get(k),qa=Number(x?.quantity||0),qb=Number(y?.quantity||0);return {key:k,a:qa,b:qb,status:!x?'新增':!y?'缺失':qa===qb?'一致':'数量变化'};});setDialog({kind:'compare',a,b,rows,error:''});}
  async function createBom(){if(!dialog)return;const name=String(dialog.name||'').trim();if(!name)return setDialog(d=>({...d,error:'请填写 BOM 名称'}));setBusy(true);try{await (async()=>{const r=await ForgeApiResponse(adapter,'/data/forge_bom',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,code:'BOM-'+String(Date.now()).slice(-8),product_name:String(dialog.product_name||'').trim()||name,bom_type:dialog.bom_type||'standard',project_id:dialog.project_id||null,change_note:String(dialog.change_note||'').trim()||null})});const txt=await r.text();if(!r.ok)throw new Error('HTTP '+r.status+' '+txt.slice(0,160));return JSON.parse(txt||'{}');})();setDialog(null);setToast('BOM 已创建（草稿）');await loadList();}catch(error){setDialog(d=>({...d,error:String(error.message||error)}));}finally{setBusy(false);}}
function routeTo(id,replace=false){
    const url=id?window.location.pathname+'?id='+encodeURIComponent(id):window.location.pathname;
    window.history[replace?'replaceState':'pushState']({},'',url);
    if(id){setView('detail');setTab('基础资料');loadDetail(id)}else{setView('list');loadList()}
  }
  async function loadList(){
    setState(s=>({...s,loading:true,error:'',bom:null}));
    try{const [boms,projects,nodes,skus,materials]=await Promise.all([fetchAll('forge_bom'),fetchAll('forge_project'),fetchAll('forge_bom_node'),fetchAll('forge_material_sku'),fetchAll('forge_material')]);setState(s=>({...s,loading:false,boms,projects,nodes,skus,materials,error:''}));}
    catch(error){setState(s=>({...s,loading:false,error:String(error.message||error)}));}
  }
  async function loadDetail(id){
    setState(s=>({...s,loading:true,error:''}));setAnalysisError('');setCollapsed({});
    try{
      const detail=await request('/data/forge_bom/'+id);const bom=detail.record;
      if(!bom)throw new Error('未找到指定 BOM，记录可能已删除或当前账号无权访问');
      const [boms,nodes,logs,analyses,projectData,customerData,materialData]=await Promise.all([
        fetchAll('forge_bom'),fetchAll('forge_bom_node',{bom_id:id}),fetchAll('forge_bom_approval_log',{bom_id:id}),fetchAll('forge_bom_shortage_analysis',{bom_id:id}),
        bom.project_id?request('/data/forge_project/'+bom.project_id):Promise.resolve({record:null}),
        bom.customer_id?request('/data/forge_customer/'+bom.customer_id):Promise.resolve({record:null}),
        bom.material_id?request('/data/forge_material/'+bom.material_id):Promise.resolve({record:null})
      ]);
      analyses.sort((a,b)=>String(b.analyzed_at||'').localeCompare(String(a.analyzed_at||'')));
      const analysis=analyses[0]||null;
      const shortageLines=analysis?await fetchAll('forge_bom_shortage_line',{analysis_id:analysis.id}):[];
      if(analysis)setPlannedQuantity(String(analysis.planned_quantity));
      setState({loading:false,boms,bom,nodes,logs,analyses,analysis,shortageLines,project:projectData.record||null,customer:customerData.record||null,material:materialData.record||null,error:''});
    }catch(error){setState(s=>({...s,loading:false,bom:null,error:String(error.message||error)}));}
  }
  React.useEffect(()=>{
    const onPop=()=>{const id=new URLSearchParams(window.location.search).get('id');if(id){setView('detail');loadDetail(id)}else{setView('list');loadList()}};
    window.addEventListener('popstate',onPop);if(initialId)loadDetail(initialId);else loadList();
    return()=>window.removeEventListener('popstate',onPop);
  },[]);
  React.useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),3200);return()=>clearTimeout(timer)},[toast]);

  function actionResultId(payload){return payload?.id||payload?.result?.id||payload?.value?.id||payload?.data?.id||payload?.result?.value?.id||null}
  async function invoke(action,params,success){
    if(!state.bom)return null;setBusy(true);
    try{
      const payload=await request('/actions/forge_bom/'+action+'/'+state.bom.id,{method:'POST',body:JSON.stringify({params:params||{}})});
      const resultId=actionResultId(payload);setDialog(null);setToast(success);
      if(action==='bom_copy_new_version'&&resultId){routeTo(resultId,true)}else await loadDetail(state.bom.id);
      return payload;
    }catch(error){setDialog(d=>d?({...d,error:String(error.message||error)}):d);if(!dialog)setState(s=>({...s,error:String(error.message||error)}));return null}
    finally{setBusy(false)}
  }
  async function analyze(){
    const quantity=Number(plannedQuantity);if(!(quantity>0)){setAnalysisError('计划生产数量必须大于 0');return}
    setBusy(true);setAnalysisError('');
    try{await request('/actions/forge_bom/bom_analyze_shortage/'+state.bom.id,{method:'POST',body:JSON.stringify({params:{planned_quantity:quantity}})});setToast('缺料分析已完成');await loadDetail(state.bom.id);setTab('缺料分析')}
    catch(error){setAnalysisError(String(error.message||error))}
    finally{setBusy(false)}
  }
  function openDialog(kind){
    const config={review:{title:'评审 BOM',subtitle:'评审结论会改变当前版本状态',decision:'approve',comment:''},copy:{title:'复制到新版本',subtitle:'新版本将以草稿状态创建',change_note:''},invalidate:{title:'使 BOM 失效',subtitle:'失效后不能继续进行缺料分析',reason:''}}[kind];setDialog({...config,kind,error:''})
  }
  function confirmDialog(){
    if(dialog.kind==='review'&&!String(dialog.comment||'').trim()){setDialog({...dialog,error:'请填写评审意见'});return}
    if(dialog.kind==='copy'&&!String(dialog.change_note||'').trim()){setDialog({...dialog,error:'请填写版本变更说明'});return}
    if(dialog.kind==='invalidate'&&!String(dialog.reason||'').trim()){setDialog({...dialog,error:'请填写失效原因'});return}
    if(dialog.kind==='review')return invoke('bom_review',{decision:dialog.decision,comment:dialog.comment},dialog.decision==='approve'?'BOM 已评审通过':'BOM 已退回修改');
    if(dialog.kind==='copy')return invoke('bom_copy_new_version',{change_note:dialog.change_note},'新版本草稿已创建');
    if(dialog.kind==='invalidate')return invoke('bom_invalidate',{reason:dialog.reason},'BOM 已失效');
  }
  const statusText={draft:'草稿',pending_review:'待评审',active:'已生效',inactive:'已失效',archived:'已归档'};
  const typeText={standard:'标准',project:'项目',prototype:'试制','标准':'标准','项目':'项目','试制':'试制'};
  const logText={submitted:'提交评审',approved:'评审通过',rejected:'评审退回',copied:'复制新版本',invalidated:'失效',created:'创建'};
  const nodeTypeText={root:'根节点',component:'物料',material:'物料',group:'分组',sub_bom:'子 BOM','根节点':'根节点','物料':'物料','分组':'分组','子BOM':'子 BOM'};
  const money=value=>value===null||value===undefined||value===''?'—':'¥'+Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtDate=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
  const normalized=value=>String(value||'').toLowerCase();
  const projectById=Object.fromEntries((state.projects||[]).map(item=>[item.id,item]));
  const applicableProjects=(state.projects||[]).filter(project=>state.boms.some(item=>item.project_id===project.id));
  const filtered=state.boms.filter(item=>(!filters.search||(normalized(item.name).includes(normalized(filters.search))||normalized(item.code).includes(normalized(filters.search))))&&(!filters.type||item.bom_type===filters.type)&&(!filters.status||item.status===filters.status)&&(!filters.project||(filters.project==='__none__'?!item.project_id:item.project_id===filters.project)));
  const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));const currentPage=Math.min(page,totalPages);const visible=filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);
  function changeFilter(patch){setFilters(value=>({...value,...patch}));setPage(1)}
  function treeRows(){
    const byParent={};state.nodes.forEach(node=>{const key=node.parent_id||'__root__';(byParent[key]||(byParent[key]=[])).push(node)});Object.values(byParent).forEach(list=>list.sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.name).localeCompare(String(b.name),'zh-CN')));
    const rows=[];const visited=new Set();function walk(node,depth){if(visited.has(node.id))return;visited.add(node.id);const children=byParent[node.id]||[];rows.push({node,depth,hasChildren:children.length>0});if(!collapsed[node.id])children.forEach(child=>walk(child,depth+1))}
    (byParent.__root__||[]).forEach(node=>walk(node,0));state.nodes.filter(node=>!visited.has(node.id)).forEach(node=>walk(node,0));return rows
  }
  function versionFamily(current){
    if(current.family_key)return state.boms.filter(item=>item.family_key===current.family_key);
    const ids=new Set([current.id]);let changed=true;
    while(changed){changed=false;state.boms.forEach(item=>{if(ids.has(item.id)||ids.has(item.source_bom_id)){if(!ids.has(item.id)){ids.add(item.id);changed=true}if(item.source_bom_id&&!ids.has(item.source_bom_id)){ids.add(item.source_bom_id);changed=true}}})}
    return state.boms.filter(item=>ids.has(item.id));
  }
  const tabs=['基础资料','BOM结构','缺料分析','版本历史','审批日志'];const bom=state.bom;const analysisStale=state.analysis&&Number(plannedQuantity)!==Number(state.analysis.planned_quantity);

  function BomListScreen(){return <div className="fp-shell"><ForgeHero section="供应链 / 基础资料 / BOM管理" title="BOM管理" description="统一管理标准 BOM 与项目 BOM 的结构、版本与成本" icon="▤" tone="slate" art="blueprint"/><div className="fp-action-row"><button className="fp-button primary" onClick={()=>setDialog({kind:'create',name:'',product_name:'',bom_type:'standard',project_id:'',version:'V1.0',change_note:'',error:''})}>新建BOM</button><ForgeSelectControl aria-label="导入导出" className="fp-select" value="" onChange={e=>{if(e.target.value==='export')exportBoms();else if(e.target.value==='import')setDialog({kind:'note',title:'导入说明',text:'BOM 导入使用平台导入能力：可在平台「数据导入」中按模板批量导入 BOM 与结构行；导出会按当前筛选输出 CSV。'})}}><option value="">导入/导出 ▾</option><option value="export" disabled={!state.boms.length}>导出当前筛选 CSV</option><option value="import">导入说明</option></ForgeSelectControl><button className="fp-button" disabled={selected.length!==2} onClick={()=>openCompare()}>BOM对比</button><span className="fp-action-end"><ForgeListSettings/><button className="fp-icon-button" disabled={state.loading} aria-label="刷新" title="刷新" onClick={loadList}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></button></span></div>{state.error&&<ForgeNotice tone="error" onClose={()=>setState(s=>({...s,error:''}))}>{state.error}</ForgeNotice>}<section className="fp-card fp-bom-list-card"><nav className="fp-tabs" role="tablist" aria-label="BOM 状态筛选"><button className={'fp-tab '+(filters.status===''?'active':'')} onClick={()=>changeFilter({status:''})}>全部({state.boms.length})</button>{Object.entries(statusText).map(([value,label])=><button key={value} className={'fp-tab '+(filters.status===value?'active':'')} onClick={()=>changeFilter({status:value})}>{label}({state.boms.filter(item=>item.status===value).length})</button>)}</nav><div className="fp-filterbar"><div className="fp-search"><input className="fp-input" aria-label="搜索 BOM" placeholder="搜索编号/名称/产品..." value={filters.search} onChange={e=>changeFilter({search:e.target.value})}/></div><ForgeSelectControl className="fp-select" aria-label="BOM 类型" value={filters.type} onChange={e=>changeFilter({type:e.target.value})}><option value="">全部类型</option><option value="standard">标准 BOM</option><option value="project">项目 BOM</option><option value="prototype">试制 BOM</option></ForgeSelectControl><ForgeSelectControl className="fp-select" aria-label="BOM 状态" value={filters.status} onChange={e=>changeFilter({status:e.target.value})}><option value="">全部状态</option>{Object.entries(statusText).map(([value,label])=><option key={value} value={value}>{label}</option>)}</ForgeSelectControl><ForgeSelectControl className="fp-select" aria-label="适用项目" value={filters.project} onChange={e=>changeFilter({project:e.target.value})}><option value="">全部项目</option><option value="__none__">通用 BOM</option>{applicableProjects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</ForgeSelectControl><button className="fp-button" onClick={()=>{setFilters({search:'',type:'',status:'',project:''});setPage(1)}}>重置</button></div>{state.loading?<ForgeLoading label="正在加载 BOM 列表"/>:<div className="fp-table-wrap"><table className="fp-table"><thead><tr><th><input type="checkbox" aria-label="选择当前页" checked={visible.length>0&&selected.length===visible.length} onChange={()=>setSelected(selected.length===visible.length?[]:visible.map(x=>x.id))}/></th><th>BOM编号</th><th>BOM名称</th><th>产品/设备</th><th>BOM类型</th><th>当前版本</th><th>状态</th><th>适用项目</th><th className="fp-number">物料数</th><th className="fp-number">成本</th><th>更新时间</th><th>创建人</th><th>操作</th></tr></thead><tbody>{visible.map(item=><tr key={item.id}><td><input type="checkbox" aria-label={'选择 '+item.code} checked={selected.includes(item.id)} onChange={()=>setSelected(selected.includes(item.id)?selected.filter(i=>i!==item.id):[...selected,item.id])}/></td><td className="fp-code">{item.code}</td><td><button className="fp-link-button" onClick={()=>routeTo(item.id)}>{item.name}</button></td><td>{item.product_name||'—'}</td><td><span className="fp-tag">{typeText[item.bom_type]||item.bom_type}</span></td><td>{item.version||'—'}</td><td><ForgeStatus value={item.status} label={statusText[item.status]}/></td><td>{projectById[item.project_id]?.name||'通用'}</td><td className="fp-number">{item.node_count||0}</td><td className="fp-number">{money(item.total_cost)}</td><td>{fmtDate(item.updated_at)}</td><td>{item.created_by_name||item.created_by||'—'}</td><td><button className="fp-icon-button row-action" aria-label="查看" title="查看" onClick={()=>routeTo(item.id)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/></svg></button></td></tr>)}{!visible.length&&<tr><td colSpan="12" className="fp-empty-cell"><ForgeEmpty title="没有符合条件的 BOM" description="调整搜索词或筛选条件后再试"/></td></tr>}</tbody></table></div>}<div className="fp-pagination"><span>共 {filtered.length} 条{filtered.length!==state.boms.length?'筛选结果':''}</span><div className="fp-pagination-actions"><button className="fp-button small" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage} / {totalPages}</span><button className="fp-button small" disabled={currentPage>=totalPages} onClick={()=>setPage(currentPage+1)}>下一页</button></div></div></section></div>}

  function DetailView(){
    if(state.loading)return <div className="fp-shell"><ForgeLoading label="正在加载 BOM 详情"/></div>;
    if(!bom)return <div className="fp-shell"><ForgeNotice tone="error">{state.error||'无法读取 BOM'}</ForgeNotice><button className="fp-button" onClick={()=>routeTo(null)}>返回 BOM 列表</button></div>;
    const versions=versionFamily(bom);
    return <div className="fp-shell"><div className="fp-phase"><span className="fp-phase-index">03</span><button className="fp-link-button" onClick={()=>routeTo(null)}>BOM 管理</button><span>/</span><strong>{bom.name}</strong></div>{state.error&&<ForgeNotice tone="error" onClose={()=>setState(s=>({...s,error:''}))}>{state.error}</ForgeNotice>}<ForgeHero section="{state.project?'项目 · '+state.project.name:'产品结构'} / bom.name" title={bom.name} description="" icon="▤" tone="slate" art="blueprint"/>><section className="fp-card fp-detail-card"><nav className="fp-tabs" aria-label="BOM 详情页签">{tabs.map(name=><button key={name} className={'fp-tab '+(tab===name?'active':'')} onClick={()=>setTab(name)}>{name}</button>)}</nav><div className="fp-detail-content">
      {tab==='基础资料'&&<BasicTab/>}{tab==='BOM结构'&&<StructureTab/>}{tab==='缺料分析'&&<ShortageTab/>}{tab==='版本历史'&&<VersionTab versions={versions}/>} {tab==='审批日志'&&<LogTab/>}
    </div></section></div>
  }
  function BasicTab(){return <div className="fp-detail-grid"><Detail label="BOM 编号" value={bom.code}/><Detail label="BOM 名称" value={bom.name}/><Detail label="产品 / 设备" value={bom.product_name}/><Detail label="BOM 类型" value={(typeText[bom.bom_type]||bom.bom_type)+' BOM'}/><Detail label="成品物料" value={state.material?.name} link/><Detail label="客户" value={state.customer?.name} link/><Detail label="适用项目" value={state.project?.name} link/><Detail label="版本与状态" value={bom.version+' · '+statusText[bom.status]}/><Detail label="物料数" value={bom.node_count||0}/><Detail label="未税成本" value={money(bom.total_cost)}/><Detail label="备注" value={bom.remarks} wide/></div>}
  function Detail({label,value,link=false,wide=false}){return <div className={'fp-detail-item '+(wide?'fp-span-2':'')}><div className="fp-detail-label">{label}</div><div className={'fp-detail-value '+(link?'link':'')}>{value||value===0?value:'—'}</div></div>}
  function StructureTab(){return <><div className="fp-section-heading"><h2>BOM 结构</h2><span className="fp-list-count">{state.nodes.length} 个节点，{bom.node_count||0} 个物料</span></div>{!state.nodes.length?<ForgeEmpty title="尚未建立 BOM 结构" description="草稿 BOM 需要先建立根节点和物料明细"/>:<div className="fp-table-wrap"><table className="fp-table"><thead><tr><th>节点 / 物料</th><th>节点类型</th><th className="fp-number">单机用量</th><th>位号</th><th>关键件</th></tr></thead><tbody>{treeRows().map(({node,depth,hasChildren})=><tr key={node.id}><td><div className="fp-tree-name"><span className="fp-tree-indent" style={{width:depth*22}}></span>{hasChildren?<button className="fp-tree-toggle" aria-label={(collapsed[node.id]?'展开':'收起')+node.name} onClick={()=>setCollapsed(value=>({...value,[node.id]:!value[node.id]}))}>{collapsed[node.id]?'›':'⌄'}</button>:<span className="fp-tree-spacer"></span>}<span>{node.name}</span>{node.is_key_part&&<span className="fp-key">关键件</span>}</div></td><td>{nodeTypeText[node.node_type]||node.node_type}</td><td className="fp-number">{node.quantity}</td><td>{node.position||'—'}</td><td>{node.is_key_part?'是':'否'}</td></tr>)}</tbody></table></div>}</>}
  function ShortageTab(){return <><div className="fp-action-strip"><div className="fp-field"><label>计划生产数量 <span className="fp-required">*</span></label><input className="fp-input" aria-label="计划生产数量" type="number" min="0.0001" step="1" value={plannedQuantity} onChange={e=>{setPlannedQuantity(e.target.value);setAnalysisError('')}}/></div><button className="fp-button primary" disabled={busy||bom.status!=='active'} onClick={analyze}>{busy?'分析中…':state.analysis?'重新分析':'开始分析'}</button><div className="fp-action-note">仅已生效版本可分析，结果将保存为历史快照</div></div>{analysisError&&<ForgeNotice tone="error">{analysisError}</ForgeNotice>}{bom.status!=='active'&&<ForgeNotice tone="warning">当前版本为{statusText[bom.status]}，评审生效后才能进行缺料分析。</ForgeNotice>}{analysisStale&&<ForgeNotice tone="warning">输入已修改。当前结果仍基于计划数量 {state.analysis.planned_quantity}，重新分析后才会更新。</ForgeNotice>}{!state.analysis?<ForgeEmpty title="还没有缺料分析" description="设置计划生产数量后开始分析，系统会按当前库存保存一份快照"/>:<><div className="fp-analysis-source"><span>当前结果</span><strong>计划数量 {state.analysis.planned_quantity}</strong><span>·</span><span>{fmtDate(state.analysis.analyzed_at)}</span><span>·</span><span>共 {state.analyses.length} 次分析</span></div><div className="fp-metrics"><Metric label="齐套率" value={state.analysis.kit_rate+'%'} warning={Number(state.analysis.kit_rate)<100}/><Metric label="采购件总数" value={state.analysis.component_count}/><Metric label="缺口项" value={state.analysis.shortage_count} warning={Number(state.analysis.shortage_count)>0}/><Metric label="最大可生产数" value={state.analysis.max_producible_quantity}/><Metric label="预计采购金额" value={money(state.analysis.estimated_purchase_amount)} warning/></div><div className="fp-table-wrap"><table className="fp-table"><thead><tr><th>物料编码</th><th>名称 / 规格</th><th>单位</th><th className="fp-number">单机用量</th><th className="fp-number">总需求</th><th className="fp-number">可用</th><th className="fp-number">缺口</th><th className="fp-number">未税单价</th><th className="fp-number">小计</th></tr></thead><tbody>{state.shortageLines.map(line=><tr key={line.id}><td>{line.item_code}</td><td>{line.name}<div className="fp-secondary">{line.specification||line.model||'—'}</div></td><td>{line.unit_name||'—'}</td><td className="fp-number">{line.required_per_unit}</td><td className="fp-number">{line.total_required}</td><td className="fp-number">{line.available_quantity}</td><td className="fp-number" style={{color:Number(line.shortage_quantity)>0?'var(--fp-danger)':'inherit',fontWeight:Number(line.shortage_quantity)>0?650:400}}>{line.shortage_quantity}</td><td className="fp-number">{money(line.untaxed_unit_price)}</td><td className="fp-number">{money(line.subtotal)}</td></tr>)}</tbody></table></div></>}</>}
  function Metric({label,value,warning=false}){return <div className={'fp-metric '+(warning?'warning':'')}><div className="fp-metric-label">{label}</div><div className="fp-metric-value">{value}</div></div>}
  function VersionTab({versions}){return <><div className="fp-section-heading"><h2>版本历史</h2><span className="fp-list-count">同一版本族 {versions.length} 条记录</span></div><div className="fp-version-list">{versions.slice().sort((a,b)=>String(b.version||'').localeCompare(String(a.version||''),'zh-CN',{numeric:true})).map(item=><div key={item.id} className={'fp-version-item '+(item.id===bom.id?'current':'')}><button onClick={()=>routeTo(item.id)}>{item.version} · {item.name}<div className="fp-secondary">{item.code}</div></button><ForgeStatus value={item.status} label={statusText[item.status]}/><span>{item.node_count||0} 项</span><span>{money(item.total_cost)}</span><span>{fmtDate(item.effective_at)}</span></div>)}</div></>}
  function LogTab(){return <><div className="fp-section-heading"><h2>审批日志</h2><span className="fp-list-count">{state.logs.length} 条记录</span></div>{!state.logs.length?<ForgeEmpty title="还没有审批记录" description="提交评审后，流转记录会显示在这里"/>:<div className="fp-timeline">{state.logs.slice().sort((a,b)=>String(b.occurred_at).localeCompare(String(a.occurred_at))).map(log=><div className="fp-event" key={log.id}><div className="fp-event-marker"><span className="fp-event-dot"></span></div><div><div className="fp-event-title">{logText[log.action]||log.action}</div><div className="fp-event-note">{fmtDate(log.occurred_at)}</div></div><div className="fp-event-note">{log.comment||'—'}<br/>{statusText[log.from_status]||log.from_status||'—'} → {statusText[log.to_status]||log.to_status||'—'}</div></div>)}</div>}</>}
  return <div className="forge-product forge-bom"><style>{css}</style>{view==='list'?<BomListScreen/>:<DetailView/>}{toast&&<div className="fp-toast" role="status">{toast}</div>}{dialog&&<ForgeDialog open title={dialog.kind==='create'?'新建BOM':dialog.kind==='compare'?'BOM 对比':'导入/导出'} subtitle={dialog.kind==='compare'?(dialog.a.code+' ↔ '+dialog.b.code):dialog.kind==='create'?'创建草稿 BOM':'BOM 导入与导出'} error={dialog.error} busy={busy} confirmLabel={dialog.kind==='create'?'创建':dialog.kind==='compare'?'关闭':'知道了'} onCancel={()=>setDialog(null)} onConfirm={()=>dialog.kind==='create'?createBom():setDialog(null)}>{dialog.kind==='create'?<div className="fp-form-grid"><div className="fp-field"><label>BOM 名称 *</label><input className="fp-input" aria-label="BOM名称" value={dialog.name} onChange={e=>setDialog(d=>({...d,name:e.target.value}))}/></div><div className="fp-field"><label>产品/设备</label><input className="fp-input" aria-label="产品设备" value={dialog.product_name} onChange={e=>setDialog(d=>({...d,product_name:e.target.value}))}/></div><div className="fp-field"><label>BOM 类型</label><ForgeSelectControl aria-label="BOM类型" value={dialog.bom_type} onChange={e=>setDialog(d=>({...d,bom_type:e.target.value}))}><option value="standard">标准</option><option value="project">项目</option><option value="trial">试制</option></ForgeSelectControl></div><div className="fp-field"><label>适用项目</label><ForgeSelectControl aria-label="适用项目" value={dialog.project_id} onChange={e=>setDialog(d=>({...d,project_id:e.target.value}))}><option value="">不指定</option>{state.projects.map(pr=><option key={pr.id} value={pr.id}>{pr.name}</option>)}</ForgeSelectControl></div><div className="fp-field"><label>版本</label><input className="fp-input" aria-label="版本" value={dialog.version} onChange={e=>setDialog(d=>({...d,version:e.target.value}))}/></div><div className="fp-field" style={{gridColumn:'1/-1'}}><label>版本变更说明</label><textarea className="fp-textarea" aria-label="版本变更说明" value={dialog.change_note} onChange={e=>setDialog(d=>({...d,change_note:e.target.value}))}/></div></div>:dialog.kind==='compare'?<div className="fp-table-wrap"><table className="fp-table"><thead><tr><th>物料</th><th>{dialog.a.code} 数量</th><th>{dialog.b.code} 数量</th><th>结论</th></tr></thead><tbody>{dialog.rows.map(r=><tr key={r.key}><td>{r.key}</td><td>{r.a||'—'}</td><td>{r.b||'—'}</td><td><ForgeStatus value={r.status==='一致'?'completed':r.status==='新增'?'draft':'rejected'} label={r.status}/></td></tr>)}{!dialog.rows.length&&<tr><td colSpan="4"><ForgeEmpty title="两条 BOM 结构都为空" description="先为 BOM 维护结构行后再对比。"/></td></tr>}</tbody></table></div>:<div className="fp-dialog-impact">{dialog.text}</div>}</ForgeDialog>}<ForgeDialog open={!!dialog&&['review','copy','invalidate'].includes(dialog.kind)} title={dialog?.title} subtitle={dialog?.subtitle} error={dialog?.error} busy={busy} confirmLabel={dialog?.kind==='review'?(dialog.decision==='approve'?'确认通过':'确认退回'):dialog?.kind==='copy'?'创建新版本':'确认失效'} danger={dialog?.kind==='invalidate'||(dialog?.kind==='review'&&dialog.decision==='reject')} onCancel={()=>!busy&&setDialog(null)} onConfirm={confirmDialog}>{dialog?.kind==='review'&&<><div className="fp-field"><label>评审结论 <span className="fp-required">*</span></label><ForgeSelectControl className="fp-select" aria-label="评审结论" value={dialog.decision} onChange={e=>setDialog({...dialog,decision:e.target.value,error:''})}><option value="approve">同意</option><option value="reject">退回修改</option></ForgeSelectControl></div><div className="fp-field"><label>评审意见 <span className="fp-required">*</span></label><textarea className="fp-textarea" aria-label="评审意见" value={dialog.comment} onChange={e=>setDialog({...dialog,comment:e.target.value,error:''})} placeholder="说明评审依据或需要修改的内容"/></div></>}{dialog?.kind==='copy'&&<div className="fp-field"><label>版本变更说明 <span className="fp-required">*</span></label><textarea className="fp-textarea" aria-label="版本变更说明" value={dialog.change_note} onChange={e=>setDialog({...dialog,change_note:e.target.value,error:''})} placeholder="说明本次版本调整的原因和范围"/></div>}{dialog?.kind==='invalidate'&&<div className="fp-field"><label>失效原因 <span className="fp-required">*</span></label><textarea className="fp-textarea" aria-label="失效原因" value={dialog.reason} onChange={e=>setDialog({...dialog,reason:e.target.value,error:''})} placeholder="说明为什么停止使用这个版本"/></div>}</ForgeDialog></div>
}
export default App;

${forgeProductUiRuntime}
`;

export const BomWorkspacePage = {
  name: 'page_bom_workspace',
  label: 'BOM管理',
  description: 'BOM 列表、版本、结构、评审与缺料分析工作台',
  icon: 'git-branch',
  type: 'app' as const,
  kind: 'react' as const,
  source: bomPageSource,
};
