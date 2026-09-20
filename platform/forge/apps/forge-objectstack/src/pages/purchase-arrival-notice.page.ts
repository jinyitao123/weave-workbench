import { forgeProductUiCss, forgeProductUiRuntime } from "./product-ui.js";

const source = `
function App(){
 const [s,setS]=React.useState({loading:true,notices:[],lines:[],orders:[],suppliers:[],warehouses:[],error:''}),[query,setQuery]=React.useState(''),[start,setStart]=React.useState(''),[end,setEnd]=React.useState(''),[warehouse,setWarehouse]=React.useState(''),[status,setStatus]=React.useState(''),[overdue,setOverdue]=React.useState(''),[selected,setSelected]=React.useState([]),[detail,setDetail]=React.useState(null),[page,setPage]=React.useState(1);
 async function request(path){const r=await fetch('/api/v1'+path,{credentials:'include'}),p=await r.json().catch(()=>({}));if(!r.ok)throw new Error((typeof p.error==='string'?p.error:p.error?.message)||(Array.isArray(p.fields)&&p.fields.length?p.fields.map(f=>f.message||f.label).filter(Boolean).join('；'):'')||p.message||'请求失败');return p}async function find(name){return(await request('/data/'+name+'?$top=200')).records||[]}
 async function load(){try{const v=await Promise.all(['forge_purchase_arrival_notice','forge_purchase_arrival_notice_line','forge_purchase_order','forge_supplier','forge_warehouse'].map(find));setS({loading:false,notices:v[0],lines:v[1],orders:v[2],suppliers:v[3],warehouses:v[4],error:''})}catch(e){setS(x=>({...x,loading:false,error:String(e.message||e)}))}}React.useEffect(()=>{load()},[]);
 const order=id=>s.orders.find(x=>x.id===id),supplier=id=>s.suppliers.find(x=>x.id===id),wh=id=>s.warehouses.find(x=>x.id===id),lines=id=>s.lines.filter(x=>x.notice_id===id),today=new Date().toISOString().slice(0,10),statusText={pending_arrival:'待到货',partially_arrived:'部分到货',arrived:'已全部到货',cancelled:'已取消'},pct=x=>Number(x.planned_quantity)>0?Math.round(Number(x.arrived_quantity||0)/Number(x.planned_quantity)*100):0;
 const filtered=s.notices.filter(x=>{const q=query.trim().toLowerCase(),isOverdue=x.expected_arrival_on&&x.expected_arrival_on<today&&!['arrived','cancelled'].includes(x.status);return(!q||[x.code,order(x.order_id)?.code,supplier(x.supplier_id)?.name,...lines(x.id).map(y=>y.item_code+' '+y.name)].join(' ').toLowerCase().includes(q))&&(!start||x.expected_arrival_on>=start)&&(!end||x.expected_arrival_on<=end)&&(!warehouse||x.warehouse_id===warehouse)&&(!status||x.status===status)&&(!overdue||(overdue==='yes'?isOverdue:!isOverdue))}),pages=Math.max(1,Math.ceil(filtered.length/20)),safe=Math.min(page,pages),rows=filtered.slice((safe-1)*20,safe*20);
 function toggle(id){setSelected(v=>v.includes(id)?[]:[id])}function register(id){location.href=forgeBase+'/page/page_purchase_arrival_workspace?notice='+encodeURIComponent(id)}
 const css=\`${forgeProductUiCss}div:has(>.forge-an){max-width:none!important;margin:0!important}.forge-an+*{display:none}main:has(.forge-an)>div{padding:0!important}.forge-an{min-height:100%;background:#f3f5f7}.shell{padding:18px 22px 40px;max-width:1500px;margin:auto}.head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px}.head h1{margin:0 0 5px;font-size:22px}.muted{color:#77818e}.toolbar,.filters,.actions,.pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.card{background:#fff;border:1px solid #dfe4e9;border-radius:7px;padding:15px}.filters{display:grid;grid-template-columns:minmax(230px,1fr) 155px 155px 190px 160px 150px;margin-bottom:12px}.filters input,.filters select{width:100%;box-sizing:border-box;border:1px solid #d4dae1;border-radius:4px;padding:8px}.btn{height:34px;border:1px solid #ccd3da;border-radius:4px;background:#fff;padding:0 10px}.primary{background:#1769e0;color:#fff;border-color:#1769e0}.btn:disabled{opacity:.45}.table{overflow:auto;border:1px solid #e1e5ea;border-radius:5px}.table table{width:100%;border-collapse:collapse;min-width:1100px;font-size:12px}.table th,.table td{padding:10px;border-bottom:1px solid #edf0f3;text-align:left}.table th{background:#f7f8fa;color:#68727ffont-size:12px;padding:17px 12px;}.pill{padding:3px 8px;border-radius:10px;background:#edf4ff;color:#1769e0}.pager{justify-content:space-between;margin-top:12px}.notice{background:#fff3cd;color:#745600;padding:10px 12px;margin-bottom:12px;border-radius:5px}.detail{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.detail div{background:#f7f8fa;padding:10px;border-radius:4px}.detail small{display:block;color:#77818e}.anbar{height:6px;border-radius:3px;background:#e6ebf3;overflow:hidden;margin-bottom:4px}.anbar i{display:block;height:100%;background:#1d4ed8}@media(max-width:900px){.filters{grid-template-columns:1fr}.head{display:block}.toolbar{margin-top:10px}}\`;
 if(s.loading)return <div className="forge-product forge-an">
<style>{css}</style>
<div className="shell">正在加载到货通知…</div>
</div>;
 return <div className="forge-product forge-an">
<style>{css}</style>
<div className="shell">
<ForgeHero section="供应链 / 到货检验 / 到货通知" title="到货通知" description="采购订单审核后进入目标仓库待到货队列" icon="▤" tone="blue" art="flow"/>{s.error&&<div className="notice">{s.error}</div>}<section className="card">
<div className="fp-card-toolbar"><button className="fp-button primary" disabled={selected.length!==1} onClick={()=>register(selected[0])}>合并到货登记</button><span className="fp-grow"/><ForgeListSettings/><button className="fp-icon-button" aria-label="刷新" title="刷新" onClick={load}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></button></div>
<div className="filters">
<input aria-label="搜索到货通知" placeholder="通知单号 / 采购订单 / 供应商 / 物料" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}}/>
<ForgeDateInput aria-label="预计到货开始日期" value={start} onChange={e=>{setStart(e.target.value);setPage(1)}}/>
<ForgeDateInput aria-label="预计到货结束日期" value={end} onChange={e=>{setEnd(e.target.value);setPage(1)}}/>
<ForgeSelectControl aria-label="筛选目标仓库" value={warehouse} onChange={e=>{setWarehouse(e.target.value);setPage(1)}}>
<option value="">全部目标仓库</option>{s.warehouses.map(x=>
<option key={x.id} value={x.id}>{x.name}</option>)}</ForgeSelectControl>
<ForgeSelectControl aria-label="到货通知状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}>
<option value="">全部状态</option>{Object.entries(statusText).map(([v,l])=>
<option key={v} value={v}>{l}</option>)}</ForgeSelectControl>
<ForgeSelectControl aria-label="是否逾期" value={overdue} onChange={e=>{setOverdue(e.target.value);setPage(1)}}>
<option value="">是否逾期</option>
<option value="yes">已逾期</option>
<option value="no">未逾期</option>
</ForgeSelectControl>
</div>
<div className="table">
<table>
<thead>
<tr>
<th>选择到货通知</th>
<th>到货通知</th>
<th>供应商 / 物料</th>
<th>预计到货</th>
<th>目标仓库</th>
<th>来源采购订单</th>
<th>到货进度</th>
<th>采购员</th>
<th>操作</th>
</tr>
</thead>
<tbody>{rows.map(x=>
<tr key={x.id}>
<td>
<input aria-label={'选择到货通知 '+x.code} type="checkbox" checked={selected.includes(x.id)} onChange={()=>toggle(x.id)}/>
</td>
<td>
<strong>{x.code}</strong>
<div>
<span className="pill">{statusText[x.status]||x.status}</span>
</div>
</td>
<td>{supplier(x.supplier_id)?.name||'—'}<div className="muted">共 {x.line_count||lines(x.id).length} 种物料</div>
</td>
<td>{x.expected_arrival_on||'—'}</td>
<td>{wh(x.warehouse_id)?.name||'—'}</td>
<td>{order(x.order_id)?.code||'—'}</td>
<td><div className="anbar"><i style={{width:pct(x)+'%'}}/></div><div className="muted">{x.arrived_quantity||0} / {x.planned_quantity||0}</div>
</td>
<td>{x.responsible_id?'Dev Admin':'—'}</td>
<td>
<div className="actions">
<button className="fp-icon-button row-action" aria-label="查看" title="查看" onClick={()=>setDetail(x)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/></svg></button>{!['arrived','cancelled'].includes(x.status)&&<button className="btn primary" onClick={()=>register(x.id)}>登记到货</button>}</div>
</td>
</tr>)}{!rows.length&&<tr>
<td colSpan="9">暂无匹配的到货通知</td>
</tr>}</tbody>
</table>
</div>
<div className="pager">
<span>共 {filtered.length} 条记录 · 每页 20 条</span>
<div className="actions">
<button className="btn" disabled={safe<=1} onClick={()=>setPage(safe-1)}>上一页</button>
<span>{safe} / {pages}</span>
<button className="btn" disabled={safe>=pages} onClick={()=>setPage(safe+1)}>下一页</button>
</div>
</div>
</section>
</div>{detail&&<ForgeDialog open title="到货通知详情" subtitle={detail.code} confirmLabel="关闭" onCancel={()=>setDetail(null)} onConfirm={()=>setDetail(null)}>
<div className="detail">
<div>
<small>供应商</small>{supplier(detail.supplier_id)?.name||'—'}</div>
<div>
<small>采购订单</small>{order(detail.order_id)?.code||'—'}</div>
<div>
<small>预计到货</small>{detail.expected_arrival_on||'—'}</div>
<div>
<small>目标仓库</small>{wh(detail.warehouse_id)?.name||'—'}</div>
<div>
<small>物料种类</small>{detail.line_count||lines(detail.id).length}</div>
<div>
<small>到货进度</small>{detail.arrived_quantity||0} / {detail.planned_quantity||0}</div>
</div>
</ForgeDialog>}</div>
}
export default App;
${forgeProductUiRuntime}
`;

export const PurchaseArrivalNoticePage = {
  name: "page_purchase_arrival_notice",
  label: "到货通知",
  description: "采购订单审核后的待到货队列",
  icon: "package-search",
  type: "app" as const,
  kind: "react" as const,
  source,
};
