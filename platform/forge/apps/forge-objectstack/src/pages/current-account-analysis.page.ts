import { forgeProductUiCss, forgeProductUiRuntime } from './product-ui.js';

const css = forgeProductUiCss + `
.current-account{--ca-blue:#245bdb;--ca-green:#2f9d72;--ca-red:#ef6b4a;--ca-orange:#f2a33b;color:#172b4d}
.current-account .fp-shell{width:1202px;max-width:calc(100vw - 80px);padding-top:20px}
.current-account .ca-hero{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:106.75px;margin-bottom:10.5px;padding:17.5px 21px;border:1px solid #dfe1e6;border-radius:7px;background:#fff}
.current-account .ca-hero-main{display:flex;align-items:center;gap:10.5px;min-width:0}
.current-account .ca-icon{display:grid;place-items:center;width:49px;height:49px;flex:none;border:1px solid #c8d7fb;border-radius:7px;background:#eef3ff;color:var(--ca-blue)}
.current-account .ca-icon svg{width:25px;height:25px}
.current-account .ca-breadcrumb{color:#6b778c;font-size:10.5px;line-height:14px}
.current-account .ca-hero h1{margin:2px 0 0;font-size:22px;font-weight:600;line-height:27.5px}
.current-account .ca-hero p{margin:3px 0 0;color:#6b778c;font-size:12.25px;line-height:17.5px}
.current-account .ca-actions{display:flex;gap:7px;flex:none}
.current-account .ca-actions .fp-button{height:28px;padding:0 12px;font-size:11px}
.current-account .ca-actions .ca-excel{border-color:#4fa97f;background:#4fa97f;color:#fff}
.current-account .ca-tabs{display:flex;height:44px;overflow-x:auto;padding:0 17.5px;border:1px solid #dfe1e6;border-radius:7px;background:#fff}
.current-account .ca-tab{min-width:70px;height:43px;margin-right:21px;padding:0 .5px;border:0;border-bottom:2px solid transparent;background:transparent;color:#42526e;font-size:12.25px;white-space:nowrap}
.current-account .ca-tab.active{border-bottom-color:var(--ca-blue);color:var(--ca-blue);font-weight:700}
.current-account .ca-filter{display:flex;align-items:center;box-sizing:border-box;gap:10.5px;height:47.5px;margin-top:10.5px;padding:8.75px 10.5px;border:1px solid #dfe1e6;border-radius:7px;background:#fff}
.current-account .ca-filter-label{display:inline-flex;align-items:center;gap:7px;margin-right:auto;color:#42526e;font-size:12px;font-weight:650;white-space:nowrap}
.current-account .ca-filter .fp-picker{width:126px}
.current-account .ca-filter .fp-picker-trigger{height:29px;min-height:29px}
.current-account .ca-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:48px;padding:0 4px;color:#6b778c;font-size:10.5px}
.current-account .ca-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10.5px;margin-bottom:14px}
.current-account .ca-metric{position:relative;min-width:0;min-height:116.25px;padding:14px 17px;border:1px solid #dfe1e6;border-radius:7px;background:#fff;overflow:hidden}
.current-account .ca-metric:before{content:"";position:absolute;inset:0 auto 0 0;width:3.5px;background:var(--tone,var(--ca-blue))}
.current-account .ca-metric-top{display:flex;align-items:center;gap:8px;color:#6b778c;font-size:10.5px}
.current-account .ca-metric-icon{display:grid;place-items:center;width:26px;height:26px;border-radius:4px;background:color-mix(in srgb,var(--tone,var(--ca-blue)) 11%,white);color:var(--tone,var(--ca-blue))}
.current-account .ca-metric strong{display:block;margin:7px 0 3px;font-size:25px;line-height:31.25px}
.current-account .ca-metric small{display:block;overflow:hidden;color:#6b778c;font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}
.current-account .ca-help{display:grid;place-items:center;width:13px;height:13px;padding:0;border:1px solid #97a0af;border-radius:50%;background:#fff;color:#6b778c;font-size:8px}
.current-account .ca-card{box-sizing:border-box;margin-bottom:14px;padding:17.5px;border-radius:8px}
.current-account .ca-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #ebeef0}
.current-account .ca-card h3{margin:0;font-size:12px}
.current-account .ca-card .fp-button{height:28px;font-size:10.5px}
.current-account .ca-top-grid{display:grid;grid-template-columns:minmax(360px,.82fr) minmax(480px,1.18fr);gap:14px}
.current-account .ca-top-grid .ca-card{height:337px}
.current-account .ca-aging{display:grid;grid-template-columns:145px minmax(0,1fr);gap:14px;align-items:center;min-height:245px}
.current-account .ca-donut{position:relative;width:128px;height:128px;margin:auto;border-radius:50%;background:conic-gradient(var(--ca-blue) 0 var(--progress,0%),#eef1f6 var(--progress,0%) 100%)}
.current-account .ca-donut:after{content:"";position:absolute;inset:28px;border-radius:50%;background:#fff}
.current-account .ca-donut-label{position:absolute;inset:0;z-index:1;display:grid;place-content:center;text-align:center;font-size:10px;color:#6b778c}
.current-account .ca-donut-label strong{display:block;color:#172b4d;font-size:16px}
.current-account .ca-age-list{display:grid;gap:10px}
.current-account .ca-age-row{display:grid;grid-template-columns:66px minmax(0,1fr) 42px;align-items:center;gap:6px;font-size:10.5px}
.current-account .ca-age-bar{display:none;height:8px;overflow:hidden;border-radius:8px;background:#eef1f6}
.current-account .ca-age-bar i{display:block;height:100%;min-width:0;border-radius:8px;background:var(--tone,var(--ca-blue))}
.current-account .ca-age-number,.current-account .number{text-align:right;font-variant-numeric:tabular-nums}
.current-account .ca-age-number{font-size:9.5px}
.current-account .ca-age-detail{height:312.75px}
.current-account .ca-table-wrap{overflow:auto}
.current-account .ca-table{width:100%;min-width:650px;border-collapse:collapse}
.current-account .ca-table th,.current-account .ca-table td{height:42px;padding:0 10px;border-bottom:1px solid #ebeef0;text-align:left;font-size:10.5px}
.current-account .ca-table th{color:#6b778c;font-weight:600}
.current-account .ca-table .number{text-align:right}
.current-account .ca-empty{padding:38px 12px;text-align:center;color:#97a0af;font-size:11px}
.current-account .ca-status{display:inline-flex;padding:2px 7px;border-radius:999px;background:#fff3e8;color:#a85d16}
@media(max-width:1050px){.current-account .fp-shell{width:min(100%,1158px);max-width:100%}.current-account .ca-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.current-account .ca-top-grid{grid-template-columns:1fr}.current-account .ca-top-grid .ca-card,.current-account .ca-age-detail{height:auto;min-height:312.75px}.current-account .ca-aging{grid-template-columns:180px 1fr}.current-account .ca-age-bar{display:block}}
@media(max-width:760px){.current-account .fp-shell{padding-left:2px;padding-right:2px}.current-account .ca-hero{align-items:flex-start;flex-direction:column}.current-account .ca-actions{width:100%}.current-account .ca-actions .fp-button{flex:1}.current-account .ca-filter{height:auto;min-height:47.5px;flex-wrap:wrap}.current-account .ca-filter-label{width:100%;margin:0}.current-account .ca-filter .fp-picker{width:100%}.current-account .ca-meta{align-items:flex-start;flex-direction:column;padding:10px 4px}.current-account .ca-metrics{grid-template-columns:1fr}.current-account .ca-age-row{grid-template-columns:70px 1fr}.current-account .ca-age-row .ca-age-number,.current-account .ca-age-row .ca-age-percent{grid-column:2;text-align:left}}
`;

const source = `
const css=${JSON.stringify(css)};
const rowsOf=p=>p.records||p.data?.records||p.data||[],sum=(rows,key)=>rows.reduce((n,x)=>n+Number(x[key]||0),0),money=v=>'¥'+Number(v||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}),day=v=>String(v||'').slice(0,10),valid=x=>!['cancelled','voided','reversed','rejected','draft'].includes(x.status);
function App(){
 const adapter=useAdapter(),[state,setState]=React.useState({loading:true,error:'',data:{}}),[tab,setTab]=React.useState(new URLSearchParams(location.search).get('section')==='payable'?'payable':'receivable'),[period,setPeriod]=React.useState('quarter'),[help,setHelp]=React.useState(null);
 async function request(path){return ForgeApiRequest(adapter,path)}async function find(name){return rowsOf(await request('/data/'+name+'?$top=2000'))}
 async function load(){setState(s=>({...s,loading:true,error:''}));try{const names=['forge_accounts_receivable','forge_accounts_payable','forge_cash_receipt','forge_cash_payment','forge_customer','forge_supplier','forge_supplier_prepayment'],sets=await Promise.all(names.map(find));setState({loading:false,error:'',data:Object.fromEntries(names.map((n,i)=>[n,sets[i]]))})}catch(e){setState(s=>({...s,loading:false,error:String(e.message||e)}))}}
 React.useEffect(()=>{load()},[]);
 const now=new Date(),today=now.toISOString().slice(0,10),rangeFor=p=>{const y=now.getFullYear(),m=now.getMonth();if(p==='year')return[y+'-01-01',today];if(p==='month')return[y+'-'+String(m+1).padStart(2,'0')+'-01',today];const s=Math.floor(m/3)*3;return[y+'-'+String(s+1).padStart(2,'0')+'-01',today]},range=rangeFor(period),inRange=(row,keys)=>{const value=keys.map(k=>day(row[k])).find(Boolean);return value&&value>=range[0]&&value<=range[1]},age=date=>Math.max(0,Math.floor((new Date(today)-new Date(day(date)))/86400000)),daysUntil=date=>Math.ceil((new Date(day(date))-new Date(today))/86400000),d=state.data;
 const receivables=(d.forge_accounts_receivable||[]).filter(x=>valid(x)&&Number(x.outstanding_amount||0)>0),payables=(d.forge_accounts_payable||[]).filter(x=>valid(x)&&Number(x.outstanding_amount||0)>0),receipts=(d.forge_cash_receipt||[]).filter(x=>valid(x)&&inRange(x,['received_on','created_at'])),payments=(d.forge_cash_payment||[]).filter(x=>valid(x)&&inRange(x,['paid_on','created_at'])),prepayments=(d.forge_supplier_prepayment||[]).filter(x=>valid(x)&&Number(x.balance_amount||0)>0),customers=d.forge_customer||[],suppliers=d.forge_supplier||[],nameOf=(rows,id)=>rows.find(x=>x.id===id)?.name||'未命名往来单位';
 const arBalance=sum(receivables,'outstanding_amount'),overdue=receivables.filter(x=>day(x.due_on)&&day(x.due_on)<today),overdueAmount=sum(overdue,'outstanding_amount'),arOriginal=sum((d.forge_accounts_receivable||[]).filter(valid),'original_amount'),arCollected=sum((d.forge_accounts_receivable||[]).filter(valid),'collected_amount'),collectionRate=arOriginal>0?arCollected/arOriginal*100:0,longest=overdue.length?Math.max(...overdue.map(x=>age(x.due_on))):0;
 const buckets=[['未到期',receivables.filter(x=>!day(x.due_on)||day(x.due_on)>=today),'#245bdb'],['1-30天',receivables.filter(x=>day(x.due_on)<today&&age(x.due_on)<=30),'#56bfd0'],['31-60天',receivables.filter(x=>age(x.due_on)>30&&age(x.due_on)<=60),'#f2a33b'],['61-90天',receivables.filter(x=>age(x.due_on)>60&&age(x.due_on)<=90),'#ef8b4a'],['90天以上',receivables.filter(x=>age(x.due_on)>90),'#ef6b4a']];
 const apBalance=sum(payables,'outstanding_amount'),due30=payables.filter(x=>day(x.due_on)&&daysUntil(x.due_on)>=0&&daysUntil(x.due_on)<=30),due30Amount=sum(due30,'outstanding_amount'),periodOut=sum(payments,'amount'),advance=sum(prepayments,'balance_amount'),supplierCount=new Set(due30.map(x=>x.supplier_id).filter(Boolean)).size,labels={month:'本月',quarter:'本季度',year:'本年度'};
 const helpText={ar:'当前未核销应收账款的余额合计。',overdue:'到期日早于今天且仍未核销的应收余额。',rate:'有效应收的累计已核销金额占应收原值的比例。',longest:'当前逾期应收中距到期日最久的天数。',ap:'当前未核销应付账款的余额合计。',due:'未来30天内到期且仍未核销的应付余额。',out:'统计周期内未撤销、未作废的实际付款金额。',advance:'供应商预付款中尚未完成冲抵或退款的余额。'};
 function metric(label,value,note,tone,key,format='money'){return <article className="ca-metric" style={{'--tone':tone}}><div className="ca-metric-top"><span className="ca-metric-icon">▣</span><span>{label}</span><button className="ca-help" aria-label={'查看'+label+'计算说明'} onClick={()=>setHelp({title:label,body:helpText[key]})}>?</button></div><strong>{format==='percent'?Number(value).toFixed(1)+'%':format==='days'?Number(value)+' 天':money(value)}</strong><small title={note}>{note}</small></article>}
 function exportCsv(){const detail=tab==='receivable'?receivables.map(x=>[x.code,nameOf(customers,x.customer_id),day(x.due_on),x.outstanding_amount]):payables.map(x=>[x.code,nameOf(suppliers,x.supplier_id),day(x.due_on),x.outstanding_amount]),rows=[[tab==='receivable'?'应收分析':'应付分析'],['统计周期',range.join(' 至 ')],['单据号','往来单位','到期日期','未核销余额'],...detail],csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='往来账款-'+tab+'-'+range[0]+'-'+range[1]+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
 const icon=<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 3h12l4 4v14H4z"/><path d="M16 3v5h5M8 12h8M8 16h8M8 8h3"/></svg>,goLedger=()=>location.href='/_console/apps/com.inoforge.forge.finance/page_receivables_payables';
 if(state.loading)return <div className="forge-product current-account"><style>{css}</style><div className="fp-shell"><ForgeLoading label="正在汇总往来账款"/></div></div>;
 return <div className="forge-product current-account"><style>{css}</style><div className="fp-shell">
  <section className="fp-page-header ca-hero"><div className="ca-hero-main"><span className="ca-icon">{icon}</span><div><div className="ca-breadcrumb">报表 / 财务统计 / 往来账款</div><h1>往来账款</h1><p>客户应收、账龄结构和供应商应付分析</p></div></div><div className="ca-actions"><button className="fp-button" onClick={()=>window.print()}>⇩ 导出PDF</button><button className="fp-button ca-excel" onClick={exportCsv}>▣ 导出Excel</button></div></section>
  <nav className="ca-tabs" aria-label="财务统计类型">{[['receivable','应收分析'],['payable','应付分析']].map(x=><button key={x[0]} className={'ca-tab '+(tab===x[0]?'active':'')} onClick={()=>{setTab(x[0]);history.replaceState(null,'',location.pathname+(x[0]==='payable'?'?section=payable':''))}}>{x[1]}</button>)}</nav>
  {state.error&&<ForgeNotice tone="error" onClose={load}>{state.error}</ForgeNotice>}
  <section className="ca-filter" aria-label="报表筛选"><span className="ca-filter-label">☷ 筛选条件</span><ForgeSelectControl aria-label="统计期间" value={period} onChange={e=>setPeriod(e.target.value)}><option value="month">本月</option><option value="quarter">本季度</option><option value="year">本年度</option></ForgeSelectControl></section>
  <div className="ca-meta"><span>▣ 财务数据按业务单据实时汇总</span><span>统计周期 {range[0]} ~ {range[1]}</span></div>
  {tab==='receivable'?<>
   <section className="ca-metrics">{metric('应收余额',arBalance,overdue.length+' 笔逾期','#245bdb','ar')}{metric('逾期金额',overdueAmount,'占应收 '+(arBalance?overdueAmount/arBalance*100:0).toFixed(1)+'%','#ef6b4a','overdue')}{metric('回款率',collectionRate,'按累计核销口径','#2f9d72','rate','percent')}{metric('最长逾期',longest,'按未核销余额统计','#f2a33b','longest','days')}</section>
   <div className="ca-top-grid"><section className="fp-card ca-card"><div className="ca-card-head"><h3>◔ 应收账龄结构</h3><strong>应收余额合计&nbsp; {money(arBalance)}</strong></div><div className="ca-aging"><div className="ca-donut" style={{'--progress':(arBalance?Math.max(...buckets.map(x=>sum(x[1],'outstanding_amount')/arBalance*100)):0)+'%'}}><div className="ca-donut-label">应收余额<strong>{money(arBalance)}</strong></div></div><div className="ca-age-list">{buckets.map(x=>{const amount=sum(x[1],'outstanding_amount'),pct=arBalance?amount/arBalance*100:0;return <div className="ca-age-row" key={x[0]}><span>{x[0]}</span><div className="ca-age-bar"><i style={{width:pct+'%','--tone':x[2]}}/></div><span className="ca-age-number">{x[1].length} 笔 · {money(amount)}</span><span className="ca-age-percent">{pct.toFixed(1)} %</span></div>})}</div></div></section>
   <section className="fp-card ca-card"><div className="ca-card-head"><h3>▣ 逾期客户明细</h3><button className="fp-button" onClick={goLedger}>查看全部应收</button></div>{overdue.length?<div className="ca-table-wrap"><table className="ca-table"><thead><tr><th>客户</th><th>到期日</th><th className="number">逾期天数</th><th className="number">余额</th></tr></thead><tbody>{overdue.slice().sort((a,b)=>age(b.due_on)-age(a.due_on)).map(x=><tr key={x.id}><td>{nameOf(customers,x.customer_id)}</td><td>{day(x.due_on)}</td><td className="number">{age(x.due_on)} 天</td><td className="number">{money(x.outstanding_amount)}</td></tr>)}</tbody></table></div>:<div className="ca-empty">当前没有逾期客户</div>}</section></div>
   <section className="fp-card ca-card ca-age-detail"><div className="ca-card-head"><div><h3>▥ 账龄区间明细</h3><small>按未核销应收余额统计</small></div></div><div className="ca-table-wrap"><table className="ca-table"><thead><tr><th>账龄区间</th><th className="number">余额</th><th className="number">单据数</th><th className="number">占比</th></tr></thead><tbody>{buckets.map(x=>{const amount=sum(x[1],'outstanding_amount');return <tr key={x[0]}><td>{x[0]}</td><td className="number">{money(amount)}</td><td className="number">{x[1].length}</td><td className="number">{(arBalance?amount/arBalance*100:0).toFixed(1)} %</td></tr>})}</tbody></table></div></section>
  </>:<>
   <section className="ca-metrics">{metric('应付余额',apBalance,'按未核销余额统计','#7656b5','ap')}{metric('30天内到期',due30Amount,supplierCount+' 家供应商','#f2a33b','due')}{metric(labels[period]+'资金流出',periodOut,payments.length+' 笔有效付款','#ef6b4a','out')}{metric('采购预付',advance,'尚未完成冲抵','#245bdb','advance')}</section>
   <section className="fp-card ca-card"><div className="ca-card-head"><h3>▥ 近期到期供应商</h3><button className="fp-button" onClick={goLedger}>查看全部应付</button></div>{due30.length?<div className="ca-table-wrap"><table className="ca-table"><thead><tr><th>供应商</th><th className="number">到期金额</th><th>到期日期</th><th>状态</th></tr></thead><tbody>{due30.slice().sort((a,b)=>String(a.due_on).localeCompare(String(b.due_on))).map(x=><tr key={x.id}><td>{nameOf(suppliers,x.supplier_id)}</td><td className="number">{money(x.outstanding_amount)}</td><td>{day(x.due_on)}</td><td><span className="ca-status">{daysUntil(x.due_on)} 天后到期</span></td></tr>)}</tbody></table></div>:<div className="ca-empty">未来30天内没有到期应付</div>}</section>
  </>}
  <ForgeDialog open={!!help} title={(help?.title||'指标')+'计算说明'} confirmLabel="我知道了" hideCancel onCancel={()=>setHelp(null)} onConfirm={()=>setHelp(null)}><p style={{margin:0,lineHeight:1.7,color:'#42526e'}}>{help?.body||''}</p></ForgeDialog>
 </div></div>}
export default App;${forgeProductUiRuntime}`;

export const CurrentAccountAnalysisPage = {
  name: 'page_current_account_analysis',
  label: '往来账款',
  description: '客户应收、账龄结构和供应商应付分析',
  icon: 'scale',
  type: 'app' as const,
  kind: 'react' as const,
  source,
};
