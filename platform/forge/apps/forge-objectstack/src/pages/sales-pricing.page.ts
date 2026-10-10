import { SalesPricingPage as materialPricingPage } from './sales-management-pages.page.js';
import { salesPricingFeaturesCss, salesPricingFeaturesRuntime } from './sales-pricing-features.source.js';

/** Keep the material/group UI owned by the shared presentation work. */
function withPricingFeatures(source: string) {
  const replace = (before: string, after: string) => {
    if (!source.includes(before)) throw new Error('Pricing workspace integration anchor changed');
    source = source.replace(before, after);
  };
  replace('function App(){const adapter=useAdapter();', 'function App(){const adapter=useAdapter();const priceWorkspace=useSalesPricingWorkspace(adapter);');
  replace("[tab,setTab]=React.useState('materials')", "[tab,setTab]=React.useState(()=>{const tab=new URLSearchParams(window.location.search).get('tab');return ['materials','groups','agreements','approval','adjustments','history'].includes(tab)?tab:'materials'})");
  replace('<div className="pricing-notice"><ForgeEmpty title={emptyMap[tab][0]} description={emptyMap[tab][1]}/></div>', '<SalesPricingFeaturePanel tab={tab} workspace={priceWorkspace} materials={allRows}/>');
  replace('if(state.loading)return', 'if(priceWorkspace.editor)return <><style>{css+PRICING_FEATURE_CSS}</style><SalesPriceRequestEditor workspace={priceWorkspace} materials={allRows} onExit={()=>{const kind=priceWorkspace.editor.kind;priceWorkspace.setEditor(null);setTab(kind===\'agreement\'?\'agreements\':kind===\'special\'?\'approval\':\'adjustments\');load();priceWorkspace.load()}}/></>;if(state.loading)return');
  source = source.replaceAll('<style>{css}</style>', '<style>{css+PRICING_FEATURE_CSS}</style>');
  replace("function openBatch(){if(!selected.length)return setState(s=>({...s,toast:'请先选择需要调价的物料'}));setDialog({kind:'batch',mode:'percent',value:'5',error:''})}", "function openBatch(){if(!selected.length)return setState(s=>({...s,toast:'请先选择需要调价的物料'}));priceWorkspace.open('adjustment',allRows.filter(row=>selected.includes(row.sku.id)))}");
  replace("function openEdit(row){setDialog({kind:'edit',row,cost:String(row.cost),catalog:String(row.catalog),error:''})}", "function openEdit(row){priceWorkspace.open('adjustment',[row])}");
  replace('<ForgeButton className="fp-button" onClick={()=>setDialog({kind:\'capability\',error:\'\'})}>价格关系与价格组说明</ForgeButton>', '<ForgeButton className="fp-button" onClick={()=>{setTab(\'groups\');setSelected([])}}>价格组管理</ForgeButton>');
  replace('<ForgeButton className="fp-button" onClick={()=>setDialog({kind:\'tasks\',error:\'\'})}>导入/导出任务</ForgeButton>', '');
  replace('<td>{money(0)}</td><td>{money(0)}</td>', '<td>{pricingMoney(row.sku.minimum_sale_price)}</td><td>{pricingMoney(row.sku.suggested_sale_price)}</td>');
  replace("cost=Number(sku.cost_price||0)", "cost=sku.cost_price==null?null:Number(sku.cost_price)");
  replace("catalog=Number(sku.sale_price||0)", "catalog=sku.sale_price==null?null:Number(sku.sale_price)");
  replace("x.cost,0,0,x.catalog", "x.cost,x.sku.minimum_sale_price??'',x.sku.suggested_sale_price??'',x.catalog");
  replace("const money=v=>'¥ '+Number(v||0).toLocaleString('zh-CN',{minimumFractionDigits:4,maximumFractionDigits:4})", "const money=pricingMoney");
  source = source.replace(/^  async function savePrices\(\).*$/m, "  async function savePrices(){throw new Error('请通过价格申请提交审批')}");
  source = source.replace(/^  const emptyMap=.*$/m, '');
  const obsoleteDialog = source.indexOf("<ForgeDialog open={dialog?.kind==='batch'}");
  const rootClose = source.lastIndexOf('</div>}', source.indexOf('export default App;'));
  if (obsoleteDialog < 0 || rootClose < obsoleteDialog) throw new Error('Obsolete pricing dialog boundary changed');
  source = source.slice(0, obsoleteDialog) + source.slice(rootClose);
  // Source extensions contain independent tab bodies, not another page shell.
  return `const PRICING_FEATURE_CSS=${JSON.stringify(salesPricingFeaturesCss)};\n${source}\n${salesPricingFeaturesRuntime}`;
}

export const SalesPricingPage = {
  ...materialPricingPage,
  source: withPricingFeatures(materialPricingPage.source),
};
