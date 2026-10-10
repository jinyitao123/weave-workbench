import { SalesPricingPage as materialPricingPage } from './sales-management-pages.page.js';
import { salesPricingFeaturesCss, salesPricingFeaturesRuntime } from './sales-pricing-features.source.js';

/** Keep the material/group UI owned by the shared presentation work. */
function withPricingFeatures(source: string) {
  const replace = (before: string, after: string) => {
    if (!source.includes(before)) throw new Error('Pricing workspace integration anchor changed');
    source = source.replace(before, after);
  };
  replace('function App(){const adapter=useAdapter();', 'function App(){const adapter=useAdapter();const priceWorkspace=useSalesPricingWorkspace(adapter);const [priceAssignment,setPriceAssignment]=React.useState(null);');
  replace("[tab,setTab]=React.useState('materials')", "[tab,setTab]=React.useState(()=>{return pricingInitialTab()})");
  replace('<div className="pricing-notice"><ForgeEmpty title={emptyMap[tab][0]} description={emptyMap[tab][1]}/></div>', '<SalesPricingFeaturePanel tab={tab} workspace={priceWorkspace} materials={allRows}/>');
  replace('if(state.loading)return', 'if(priceWorkspace.editor&&!priceWorkspace.editor.mode.startsWith(\'material-\'))return <><style>{css+PRICING_FEATURE_CSS}</style><SalesPriceRequestEditor workspace={priceWorkspace} materials={allRows} onExit={()=>{const kind=priceWorkspace.editor.kind;priceWorkspace.setEditor(null);const origin=priceWorkspace.editor.originTab||pricingTabForKind(kind);setTab(origin);pricingRememberTab(origin);load();priceWorkspace.load()}}/></>;if(state.loading)return');
  source = source.replaceAll('<style>{css}</style>', '<style>{css+PRICING_FEATURE_CSS}</style>');
  replace("function openBatch(){if(!selected.length)return setState(s=>({...s,toast:'请先选择需要调价的物料'}));setDialog({kind:'batch',mode:'percent',value:'5',error:''})}", "function openBatch(){if(!selected.length)return setState(s=>({...s,toast:'请先选择需要调价的物料'}));priceWorkspace.open('adjustment',allRows.filter(row=>selected.includes(row.sku.id)),{mode:'material-batch',originTab:'materials'})}");
  replace("function openEdit(row){setDialog({kind:'edit',row,cost:String(row.cost),catalog:String(row.catalog),error:''})}", "function openEdit(row){if(!row?.sku?.id)return setState(previous=>({...previous,toast:'所选物料暂不可读取，请刷新后编辑'}));priceWorkspace.open('adjustment',[row],{mode:'material-edit',originTab:'materials'})}");
  replace('<ForgeButton className="fp-button" onClick={()=>setDialog({kind:\'capability\',error:\'\'})}>价格关系与价格组说明</ForgeButton>', '<ForgeButton className="fp-button" onClick={()=>{setTab(\'groups\');setSelected([]);pricingRememberTab(\'groups\')}}>价格组管理</ForgeButton>');
  replace('<ForgeButton className="fp-button" onClick={()=>setDialog({kind:\'tasks\',error:\'\'})}>导入/导出任务</ForgeButton>', '');
  replace('<td>{money(0)}</td><td>{money(0)}</td>', '<td>{pricingMoney(row.sku.minimum_sale_price)}</td><td>{pricingMoney(row.sku.suggested_sale_price)}</td>');
  replace("cost=Number(sku.cost_price||0)", "cost=sku.cost_price==null?null:Number(sku.cost_price)");
  replace("catalog=Number(sku.sale_price||0)", "catalog=sku.sale_price==null?null:Number(sku.sale_price)");
  replace("x.cost,0,0,x.catalog", "x.cost,x.sku.minimum_sale_price??'',x.sku.suggested_sale_price??'',x.catalog");
  replace("const money=v=>'¥ '+Number(v||0).toLocaleString('zh-CN',{minimumFractionDigits:4,maximumFractionDigits:4})", "const money=pricingMoney");
  source = source.replace(/^  async function savePrices\(\).*$/m, "  async function savePrices(){throw new Error('请通过价格申请提交审批')}");
  source = source.replace(/^  const emptyMap=.*$/m, '');
  source = source.replace('onClick={()=>{setTab(value);setSelected([])}}', 'onClick={()=>{setTab(value);setSelected([]);pricingRememberTab(value)}}');
  source = source.replace("<td>—</td><td>{money(row.cost)}</td>", "<td>{priceWorkspace.data.members===null?'—':priceWorkspace.data.groups?.find(group=>priceWorkspace.data.members.some(member=>member.sku_id===row.sku.id&&member.group_id===group.id))?.name||'未分配'}</td><td>{money(row.cost)}</td>");
  replace('<ForgeButton className="fp-button primary" onClick={openBatch}>批量调价</ForgeButton>', '<ForgeButton className="fp-button" disabled={!priceWorkspace.canApply} onClick={openBatch}>批量调价</ForgeButton><ForgeButton className="fp-button" disabled={!priceWorkspace.canApply} onClick={()=>{const chosen=allRows.filter(row=>selected.includes(row.sku.id));if(!chosen.length)return setState(previous=>({...previous,toast:\'请先选择需要配置的物料\'}));priceWorkspace.open(\'adjustment\',chosen,{mode:\'material-relations\',originTab:\'materials\'})}}>批量配置价格关系</ForgeButton><ForgeButton className="fp-button" disabled={!priceWorkspace.canManage} onClick={()=>{const chosen=allRows.filter(row=>selected.includes(row.sku.id));if(!chosen.length)return setState(previous=>({...previous,toast:\'请先选择需要分配的物料\'}));setPriceAssignment(chosen)}}>分配价格组</ForgeButton>');
  replace('<ForgeSelectControl aria-label="部门筛选" value={department}', '<ForgeSelectControl aria-label="部门筛选" disabled value={department}');
  source = source.replace('<option value="none">未分配部门</option>', '');
  replace('icon="¥" tone="violet" art="blueprint"', 'icon={<ForgeIcon name="target"/>} tone="violet" art="target"');
  source = source.replace(' description="统一管理商品定价、折扣策略、框架协议及特价审批"', '');
  replace('>{label}</ForgeButton>)}</div><section className="pricing-workspace">', '><ForgeIcon name={{materials:"tag",groups:"layers",agreements:"file",approval:"shield",adjustments:"clipboard",history:"history"}[value]}/>{label}</ForgeButton>)}</div><section className="pricing-workspace">');
  replace('<ForgeButton className="fp-button" disabled={!priceWorkspace.canApply} onClick={openBatch}>', '<ForgeButton className="fp-button" icon="currency" disabled={!priceWorkspace.canApply} onClick={openBatch}>');
  source = source.replace('<ForgeButton className="fp-button" disabled={!priceWorkspace.canApply} onClick={()=>{const chosen=', '<ForgeButton className="fp-button" icon="sliders" disabled={!priceWorkspace.canApply} onClick={()=>{const chosen=');
  source = source.replace('<ForgeButton className="fp-button" disabled={!priceWorkspace.canManage} onClick={()=>{const chosen=', '<ForgeButton className="fp-button" icon="layers" disabled={!priceWorkspace.canManage} onClick={()=>{const chosen=');
  source = source.replace('<ForgeButton className="fp-button" onClick={()=>{setTab(\'groups\');setSelected([]);pricingRememberTab(\'groups\')}}>价格组管理</ForgeButton>', '');
  replace('<span className="pricing-toolbar-spacer"/><ForgeListSettings/><ForgeButton className="fp-icon-button" aria-label="刷新" title="刷新" onClick={load}>↻</ForgeButton>', '<div className="pricing-toolbar-actions"><ForgeButton className="fp-icon-button" aria-label="刷新" title="刷新" onClick={load}>↻</ForgeButton><ForgeListSettings/></div>');
  replace('<input className="fp-input" aria-label="搜索价格" placeholder="搜索物料编码、物料名称、规格型号..." value={q} onChange={e=>setQ(e.target.value)}/>', '<PriceSearch value={q} onChange={setQ} variant="muted" placeholder="搜索物料编码、物料名称、规格型号..."/>');
  source = source.replace('<ForgeButton className="fp-button" onClick={()=>{setQ(\'\');setDepartment(\'all\')}}>重置筛选</ForgeButton>', '');
  source = source.replace('<td title={row.code}>', '<td data-price-cell="code" title={row.code}>').replace('<td title={row.name}>', '<td data-price-cell="name" title={row.name}>');
  source = source.replace('resizable:![\'selection\',\'actions\'].includes(key)', 'resizable:![\'selection\',\'actions\'].includes(key),align:[\'cost\',\'minimum\',\'suggested\',\'catalog\'].includes(key)?\'right\':undefined');
  replace('[dialog,setDialog]=React.useState(null),[busy,setBusy]=React.useState(false)', '[dialog,setDialog]=React.useState(null),[busy,setBusy]=React.useState(false),[page,setPage]=React.useState(1),[pageSize,setPageSize]=React.useState(20)');
  replace('rows=allRows.filter(x=>', 'filteredRows=allRows.filter(x=>');
  replace('allChecked=rows.length>0', 'rows=filteredRows.slice((page-1)*pageSize,page*pageSize),allChecked=rows.length>0');
  replace('function selectGroup(){setSelected([...new Set([...selected,...rows.map(x=>x.sku.id)])]);', 'function selectGroup(){setSelected([...new Set([...selected,...filteredRows.map(x=>x.sku.id)])]);');
  replace("React.useEffect(()=>{load()},[]);", "React.useEffect(()=>{load()},[]);React.useEffect(()=>{setPage(1)},[group,q,department,pageSize]);");
  replace('<div className="fp-pagination"><span>已选 {selected.length} 项 · 共 {rows.length} 条记录</span><span>每页 20 条 · 1 / 1</span></div>', '<ForgeTablePagination total={filteredRows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize}/>');
  replace('<div className="pricing-toolbar">', '<ForgeToolbar className="pricing-toolbar" tools={<><ForgeButton className="fp-icon-button" aria-label="刷新" title="刷新" onClick={load}>↻</ForgeButton><ForgeListSettings/></>}>');
  replace('<div className="pricing-toolbar-actions"><ForgeButton className="fp-icon-button" aria-label="刷新" title="刷新" onClick={load}>↻</ForgeButton><ForgeListSettings/></div></div><div className="pricing-filter">', '</ForgeToolbar><div className="pricing-filter">');
  const obsoleteDialog = source.indexOf("<ForgeDialog open={dialog?.kind==='batch'}");
  const rootClose = source.lastIndexOf('</div>}', source.indexOf('export default App;'));
  if (obsoleteDialog < 0 || rootClose < obsoleteDialog) throw new Error('Obsolete pricing dialog boundary changed');
  source = source.slice(0, obsoleteDialog) + "{priceWorkspace.editor?.mode.startsWith('material-')&&<SalesMaterialPriceEditor workspace={priceWorkspace} onExit={()=>{const origin=priceWorkspace.editor.originTab||'materials';priceWorkspace.setEditor(null);setTab(origin);pricingRememberTab(origin);load();priceWorkspace.load()}}/>}{priceAssignment&&<SalesMaterialGroupAssignment workspace={priceWorkspace} items={priceAssignment} onExit={()=>setPriceAssignment(null)}/>}" + source.slice(rootClose);
  // Source extensions contain independent tab bodies, not another page shell.
  return `const PRICING_FEATURE_CSS=${JSON.stringify(salesPricingFeaturesCss)};\n${source}\n${salesPricingFeaturesRuntime}`;
}

export const SalesPricingPage = {
  ...materialPricingPage,
  source: withPricingFeatures(materialPricingPage.source),
};
