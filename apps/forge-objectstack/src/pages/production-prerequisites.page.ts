import { forgeProductUiCss, forgeProductUiRuntime } from './product-ui.js';

const css = forgeProductUiCss + `
.forge-production-ready .ready-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.forge-production-ready .ready-card{padding:18px}.forge-production-ready .ready-card h2{margin:0 0 5px;font-size:17px}.forge-production-ready .ready-list{margin-top:14px;border-top:1px solid var(--fp-line)}.forge-production-ready .ready-row{display:grid;grid-template-columns:minmax(150px,.8fr) 90px minmax(180px,1.2fr) auto;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid #edf0f5}.forge-production-ready .ready-row:last-child{border-bottom:0}.forge-production-ready .ready-result{color:var(--fp-muted)}.forge-production-ready .ready-summary{display:flex;gap:18px;align-items:center}.forge-production-ready .ready-summary strong{font-size:22px}@media(max-width:1100px){.forge-production-ready .ready-grid{grid-template-columns:1fr}.forge-production-ready .ready-row{grid-template-columns:1fr auto}.forge-production-ready .ready-result{grid-column:1/-1}.forge-production-ready .ready-row .fp-button{grid-column:2;grid-row:1}}
`;

const source = `
const groups=[
 {id:'assembly',title:'组装生产准备',description:'组装、领退补料和生产入库使用同一套物料与库存前置。'},
 {id:'drawing',title:'图纸准备',description:'图号、版本和发布状态决定生产现场可使用的技术资料。'},
 {id:'subcontract',title:'委外准备',description:'供应商档案、加工类型、仓库和库存共同决定委外订单能否连续办理。'}
];
function App(){const adapter=useAdapter();
 const [state,setState]=React.useState({loading:true,data:{},error:''});
 async function request(path){const response=await ForgeApiResponse(adapter,path,{credentials:'include',headers:{...(adapter?.getAuthHeaders?.()||{})}}),payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error?.message||'请求失败');return payload}
 async function find(object){return(await request('/data/'+object+'?$top=1000')).records||[]}
 async function load(){setState(s=>({...s,loading:true,error:''}));try{const objects=['forge_warehouse_type','forge_warehouse','forge_material','forge_material_sku','forge_bom','forge_bom_node','forge_inventory_balance','forge_other_inbound_type','forge_production_disassembly_reason','forge_production_replacement_reason','forge_drawing_business_setting','forge_drawing','forge_drawing_version','forge_supplier','forge_subcontract_supplier_profile','forge_subcontract_business_setting','forge_subcontract_processing_price','forge_subcontract_policy','forge_payment_condition'];const rows=await Promise.all(objects.map(find)),data=Object.fromEntries(objects.map((x,i)=>[x,rows[i]]));setState({loading:false,data,error:''})}catch(error){setState({loading:false,data:{},error:String(error.message||error)})}}
 React.useEffect(()=>{load()},[]);
 const d=state.data,active=x=>x.status==='active'||x.enabled===true||x.enabled===1||x.enabled==='1',count=(object,fn=()=>true)=>(d[object]||[]).filter(fn).length,categories=object=>new Set((d[object]||[]).map(x=>x.category).filter(Boolean)).size;
 const checks={assembly:[
  ['仓库类型与仓库',count('forge_warehouse_type')>0&&count('forge_warehouse')>0,count('forge_warehouse')+' 个仓库可选','/_console/apps/com.inoforge.forge.supply-chain/forge_warehouse'],
  ['物料与规格',count('forge_material')>0&&count('forge_material_sku')>0,count('forge_material')+' 项物料、'+count('forge_material_sku')+' 个规格','/_console/apps/com.inoforge.forge.supply-chain/forge_material'],
  ['生效 BOM',count('forge_bom',x=>x.status==='active')>0,count('forge_bom',x=>x.status==='active')+' 个生效版本','/_console/apps/com.inoforge.forge.supply-chain/page_bom_workspace'],
  ['其他入库类型',count('forge_other_inbound_type',active)>0,count('forge_other_inbound_type',active)+' 个已启用类型','/_console/apps/com.inoforge.forge.supply-chain/page_inventory_business_config'],
  ['可用库存',count('forge_inventory_balance',x=>Number(x.available_quantity||0)>0)>0,count('forge_inventory_balance',x=>Number(x.available_quantity||0)>0)+' 项物料有可用库存','/_console/apps/com.inoforge.forge.supply-chain/forge_inventory_balance'],
  ['拆解与改制原因',count('forge_production_disassembly_reason',active)>0&&count('forge_production_replacement_reason',active)>0,'拆解 '+count('forge_production_disassembly_reason',active)+'，改制 '+count('forge_production_replacement_reason',active),'/_console/apps/com.inoforge.forge.production/page_production_config'],
 ],drawing:[
  ['图纸配置',categories('forge_drawing_business_setting')===9,categories('forge_drawing_business_setting')+' / 9 类已建档，无线上可用值的类别保留停用占位','/_console/apps/com.inoforge.forge.production/page_drawing_business_config'],
  ['图号档案',count('forge_drawing')>0,count('forge_drawing')+' 个图号','/_console/apps/com.inoforge.forge.production/page_drawing_workspace'],
  ['可用发布版本',count('forge_drawing_version',x=>x.status==='released')>0,count('forge_drawing_version',x=>x.status==='released')+' 个已发布版本','/_console/apps/com.inoforge.forge.production/page_drawing_release'],
 ],subcontract:[
  ['供应商已启用并审批',count('forge_supplier',x=>x.status==='active'&&x.approval_status==='approved')>0,count('forge_supplier',x=>x.status==='active'&&x.approval_status==='approved')+' 家可开通委外','/_console/apps/com.inoforge.forge.supply-chain/forge_supplier'],
  ['委外供应商与工艺能力',count('forge_subcontract_supplier_profile',x=>x.status==='active'&&String(x.process_capabilities||'').trim())>0,count('forge_subcontract_supplier_profile',x=>x.status==='active'&&String(x.process_capabilities||'').trim())+' 家已开通','/_console/apps/com.inoforge.forge.production/page_subcontract_suppliers'],
  ['已启用加工类型',count('forge_subcontract_business_setting',x=>x.category==='process_type'&&active(x))>0,count('forge_subcontract_business_setting',x=>x.category==='process_type'&&active(x))+' 个可选加工类型','/_console/apps/com.inoforge.forge.production/page_subcontract_business_config'],
  ['已启用付款条件',count('forge_payment_condition',x=>x.status==='active')>0,count('forge_payment_condition',x=>x.status==='active')+' 项可选付款条件','/_console/apps/com.inoforge.forge.finance/forge_payment_condition'],
  ['当前加工价目',count('forge_subcontract_processing_price',x=>x.status==='active'&&(!x.effective_from||x.effective_from<=new Date().toISOString().slice(0,10))&&(!x.effective_to||x.effective_to>=new Date().toISOString().slice(0,10)))>0,count('forge_subcontract_processing_price',x=>x.status==='active')+' 条生效价目','/_console/apps/com.inoforge.forge.production/page_subcontract_pricing'],
  ['外协加工件与规格',count('forge_material',x=>x.status==='active'&&x.source_type==='subcontracted')>0&&count('forge_material_sku',x=>active(x)&&((d.forge_material||[]).find(m=>m.id===x.material_id)?.source_type==='subcontracted'))>0,count('forge_material_sku',x=>active(x)&&((d.forge_material||[]).find(m=>m.id===x.material_id)?.source_type==='subcontracted'))+' 个外协规格可选','/_console/apps/com.inoforge.forge.supply-chain/forge_material'],
  ['按 BOM 展开发料',count('forge_bom',x=>x.status==='active')>0&&count('forge_bom_node',x=>x.is_leaf&&x.sku_id)>0,count('forge_bom',x=>x.status==='active')+' 个生效 BOM 可检查','/_console/apps/com.inoforge.forge.supply-chain/page_bom_workspace'],
  ['发料与回厂仓库',count('forge_warehouse')>0,count('forge_warehouse')+' 个仓库可选','/_console/apps/com.inoforge.forge.supply-chain/forge_warehouse'],
  ['甲供料可用库存',count('forge_inventory_balance',x=>Number(x.available_quantity||0)>0)>0,count('forge_inventory_balance',x=>Number(x.available_quantity||0)>0)+' 项物料有可用库存','/_console/apps/com.inoforge.forge.supply-chain/forge_inventory_balance'],
  ['退料原因',count('forge_subcontract_business_setting',x=>x.category==='return_reason'&&active(x))>0,count('forge_subcontract_business_setting',x=>x.category==='return_reason'&&active(x))+' 个可选原因','/_console/apps/com.inoforge.forge.production/page_subcontract_business_config'],
  ['委外控制规则',count('forge_subcontract_policy',x=>x.status==='active')>0,count('forge_subcontract_policy',x=>x.status==='active')+' 套规则已生效','/_console/apps/com.inoforge.forge.production/page_subcontract_policy'],
 ]};
 const all=Object.values(checks).flat(),ready=all.filter(x=>x[1]).length;
 if(state.loading)return <div className="forge-product forge-production-ready"><style>{${JSON.stringify(css)}}</style><div className="fp-shell"><ForgeLoading label="正在检查生产准备"/></div></div>;
 return <div className="forge-product forge-production-ready"><style>{${JSON.stringify(css)}}</style><div className="fp-shell"><ForgeHero section="生产 / 办理前准备" title="生产准备检查" description="按 RISEMAP 当前业务配置与单据依赖，检查组装、图纸和委外开始前必须具备的资料。" icon="▤" tone="slate" art="flow"/><ForgeMetricStrip items={[{label:'检查项',value:all.length,icon:'orders'},{label:'已具备',value:ready,icon:'box',tone:'success'},{label:'待补充',value:all.length-ready,icon:'alert',tone:ready===all.length?'success':'warning'},{label:'覆盖模块',value:groups.length,icon:'stack'}]}/><div className="fp-action-row"><ForgeStatus value={ready===all.length?'active':'draft'} label={ready===all.length?'全部具备':'存在待补充'}/><span className="fp-action-end"><button className="fp-button" onClick={load}>重新检查</button></span></div>{state.error&&<ForgeNotice tone="error">{state.error}</ForgeNotice>}<div className="ready-grid">{groups.map(group=><section className="fp-card ready-card" key={group.id}><h2>{group.title}</h2><div className="fp-secondary">{group.description}</div><div className="ready-list">{checks[group.id].map(item=><div className="ready-row" key={item[0]}><strong>{item[0]}</strong><ForgeStatus value={item[1]?'active':'draft'} label={item[1]?'已具备':'待补充'}/><span className="ready-result">{item[2]}</span><button className="fp-button small" onClick={()=>window.location.href=item[3]}>{item[1]?'查看':'去补充'}</button></div>)}</div></section>)}</div></div></div>
}
export default App;
${forgeProductUiRuntime}
`;

export const ProductionPrerequisitesPage={name:'page_production_prerequisites',label:'生产准备检查',description:'检查组装、图纸和委外业务办理前置',icon:'list-checks',type:'app' as const,kind:'react' as const,source};
