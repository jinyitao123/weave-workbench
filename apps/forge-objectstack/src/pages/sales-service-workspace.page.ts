import { ServiceConfigItem, ServiceOrder } from '../objects/sales.object.js';
import {
  ServiceOrderViews,
  ServiceQuotationViews,
  ServiceSettlementViews,
  ServiceConfigViews,
  ServicePartRequestViews,
  WarrantyCardViews,
  WarrantyCardEventViews,
} from '../views/service-workspace.view.js';
import { serviceDispatchPanelHelpersSource } from './sales-service-dispatch.panel.js';
import { servicePersonalWorkspacePanelHelpersSource } from './sales-service-personal-workspace.panel.js';
import { servicePersonalMetricsHelpersSource } from './sales-service-metrics.panel.js';
import { serviceTypeCatalogHelpersSource } from './sales-service-type-catalog.panel.js';
import { serviceWarrantyOverviewHelpersSource } from './sales-service-warranty-overview.panel.js';
import { serviceAnalysisRangeHelpersSource } from './sales-service-analysis-range.panel.js';
import { servicePersonalPerformanceHelpersSource } from './sales-service-personal-performance.panel.js';
import { servicePerformanceCustomersHelpersSource } from './sales-service-performance-customers.panel.js';
import { forgeProductUiCss, forgeProductUiRuntime } from './product-ui.js';

type ServiceListKey = 'orders' | 'quotations' | 'settlements' | 'warranty' | 'warrantyEvents' | 'configuration' | 'parts';
type ServicePageSpec = {
  name: string;
  label: string;
  description: string;
  icon: string;
  mode: 'orders' | 'quotations' | 'settlements' | 'workspace' | 'dispatch' | 'analysis' | 'warranty' | 'configuration';
  viewKey?: ServiceListKey;
  managerOnly?: boolean;
  standaloneCreate?: boolean;
};

const serviceViews = {
  orders: ServiceOrderViews,
  quotations: ServiceQuotationViews,
  settlements: ServiceSettlementViews,
  warranty: WarrantyCardViews,
  warrantyEvents: WarrantyCardEventViews,
  configuration: ServiceConfigViews,
  parts: ServicePartRequestViews,
};

const serviceConfigCategorySchema = ServiceConfigItem.fields.category as unknown as {
  options?: Array<{ value: string; label: string }>;
};
const serviceUrgencySchema = ServiceOrder.fields.urgency as unknown as {
  options?: Array<{ value: string; label: string }>;
};
const serviceOrderStatusSchema = ServiceOrder.fields.status as unknown as {
  options?: Array<{ value: string; label: string }>;
};
const serviceConfigCategories = serviceConfigCategorySchema.options ?? [];
const serviceUrgencyOptions = serviceUrgencySchema.options ?? [];
const serviceOrderStatusOptions = serviceOrderStatusSchema.options ?? [];
const warrantyRulesCategory = serviceConfigCategories.find(option => option.label === '质保规则')?.value ?? '';

const serviceCss = JSON.stringify(forgeProductUiCss + `
.forge-sales-service{min-width:0}
.forge-sales-service .ss-shell{max-width:1480px;min-width:0;margin:0 auto;padding:17.5px 21px 28px}
.forge-sales-service .ss-heading{--ui-workspace-header-min-height:117.25px;--ui-workspace-header-breadcrumb-line-height:18px;--ui-workspace-header-breadcrumb-margin-bottom:7px;--ui-workspace-header-icon-size:38.5px;--ui-workspace-header-row-gap:10.5px;--ui-page-title-font-size:22px;--ui-page-title-line-height:33px;border:1px solid var(--fp-line);border-radius:6px;margin-bottom:14px}
.forge-sales-service .ss-heading > div:last-child{align-items:center}
.forge-sales-service .ss-subtitle{font-size:12.5px;line-height:18.75px;margin-top:3.5px}
.forge-sales-service .ss-toolbar{margin:0 0 14px;--ui-workspace-toolbar-gap:7px}
.forge-sales-service .ss-dispatch-toolbar{margin-bottom:10.5px}
.forge-sales-service .ss-dispatch-toolbar [data-slot="workspace-toolbar-search"]{min-width:min(100%,218px);flex:0 1 218px}
.forge-sales-service .ss-dispatch-toolbar [data-slot="workspace-toolbar-filters"]{min-width:0;flex:1 1 auto}
.forge-sales-service .ss-dispatch-search{display:flex;align-items:center;gap:7px;min-width:0}
.forge-sales-service .ss-dispatch-search .fp-input{min-width:0;width:100%;height:28px}
.forge-sales-service .ss-dispatch-filter-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
.forge-sales-service .ss-dispatch-filter{width:132px;min-width:118px}
.forge-sales-service .ss-dispatch-reset{white-space:nowrap}
.forge-sales-service .ss-dispatch-period{display:flex;align-items:center;justify-content:space-between;gap:10.5px;flex-wrap:wrap;margin:0 0 10.5px}
.forge-sales-service .ss-dispatch-period-tabs{--ui-status-tabs-height:28px;--ui-status-tabs-padding-inline:10.5px;--ui-status-tabs-padding-block:5.25px;--ui-status-tabs-font-size:11px;--ui-status-tabs-line-height:15px}
.forge-sales-service .ss-dispatch-period-nav{display:flex;align-items:center;gap:7px}
.forge-sales-service .ss-dispatch-period-range{min-width:144px;text-align:center;color:var(--fp-muted);font-size:11px}
.forge-sales-service .ss-dispatch-tabs{--ui-status-tabs-height:40.5px;--ui-status-tabs-padding-inline:10.5px;--ui-status-tabs-padding-block:7px;--ui-status-tabs-font-size:13px;--ui-status-tabs-line-height:19.5px;--ui-status-tabs-icon-size:14px;--ui-status-tabs-icon-gap:6px}
.forge-sales-service .ss-dispatch-panel{min-width:0}
.forge-sales-service .ss-dispatch-summary{margin:0 0 14px;--ui-list-summary-card-height:91.5px;--ui-list-summary-padding-inline:14px;--ui-list-summary-padding-block:14px;--ui-list-summary-gap:10.5px;--ui-list-summary-item-gap:3.5px;--ui-list-summary-label-font-size:10.5px;--ui-list-summary-label-line-height:14px;--ui-list-summary-value-font-size:21px;--ui-list-summary-value-line-height:28px}

.forge-sales-service .ss-dispatch-panel>h2{margin:0 0 10.5px;font-size:12.25px;line-height:17.5px}
.forge-sales-service .ss-dispatch-table{min-width:0;max-width:100%;width:100%}
.forge-sales-service .ss-dispatch-table table{min-width:920px}
.forge-sales-service .ss-dispatch-table th{height:35px;font-size:10.5px;line-height:14px}
.forge-sales-service .ss-dispatch-incomplete{margin:0 0 10.5px}
.forge-sales-service .ss-dispatch-subtables{display:grid;gap:14px;margin-top:14px}
.forge-sales-service .ss-personal-summary{grid-template-columns:repeat(2,minmax(0,1fr));margin:0 0 14px;--ui-list-summary-columns:5;--ui-list-summary-card-height:102.75px;--ui-list-summary-padding-inline:14px;--ui-list-summary-padding-block:14px;--ui-list-summary-gap:10.5px;--ui-list-summary-item-gap:3.5px;--ui-list-summary-label-font-size:12px;--ui-list-summary-label-line-height:18px;--ui-list-summary-value-font-size:22px;--ui-list-summary-value-line-height:33px;--ui-list-summary-description-font-size:11px;--ui-list-summary-description-line-height:16.5px;--ui-list-summary-description-font-weight:400;--ui-list-summary-description-margin-top:1.75px;--ui-list-summary-value-font-weight:700}
@media(min-width:768px){.forge-sales-service .ss-personal-summary{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(min-width:1280px){.forge-sales-service .ss-personal-summary{grid-template-columns:repeat(5,minmax(0,1fr))}}
.forge-sales-service .ss-personal-document-metrics{padding:17.5px;--ui-list-summary-card-height:70px;--ui-list-summary-padding-inline:10.5px;--ui-list-summary-padding-block:10.5px;--ui-list-summary-gap:8.75px;--ui-list-summary-item-gap:3.5px;--ui-list-summary-label-font-size:11px;--ui-list-summary-label-line-height:16.5px;--ui-list-summary-label-font-weight:500;--ui-list-summary-value-font-size:18px;--ui-list-summary-value-line-height:27px;--ui-list-summary-value-font-weight:700}.forge-sales-service .ss-personal-document-metrics.six{--ui-list-summary-columns:6}.forge-sales-service .ss-personal-document-metrics.four{--ui-list-summary-columns:4}
.forge-sales-service .ss-personal-workspace{min-width:0;--ui-document-workspace-gap:14px;--ui-card-padding:17.5px;--ui-document-section-header-padding-top:17.5px;--ui-document-section-header-padding-bottom:7px;--ui-document-section-body-padding-top:0px;--ui-document-section-title-font-size:13px;--ui-document-section-title-line-height:19.5px;--ui-document-section-title-font-weight:600}
.forge-sales-service .ss-personal-main{display:grid;gap:14px;min-width:0}
.forge-sales-service .ss-personal-table{min-width:0;max-width:100%;width:100%}
.forge-sales-service .ss-personal-table table{min-width:760px}
.forge-sales-service .ss-personal-sidebar{display:grid;gap:14px;align-content:start}
.forge-sales-service .ss-personal-quick-card{border:1px solid var(--fp-line);border-radius:7px;padding:10.5px;background:var(--fp-surface);--ui-control-font-size:11.5px;--ui-control-line-height:17.25px;--ui-document-section-plain-header-height:18.75px;--ui-document-section-plain-icon-size:13px;--ui-document-section-plain-inline-gap:5.25px;--ui-document-section-plain-title-font-size:12.5px;--ui-document-section-plain-title-line-height:18.75px}.forge-sales-service .ss-personal-quick-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5.25px;font-weight:500}
.forge-sales-service .ss-personal-quick-links .fp-button{display:flex;gap:5.25px;align-items:center;width:100%;min-width:0;height:auto;min-height:29.75px;justify-content:center;padding:5.25px 7px;border-radius:3.5px;font-size:11.5px;line-height:17.25px;font-weight:500;white-space:normal;box-shadow:none}
.forge-sales-service .ss-personal-panel{border:1px solid var(--fp-line);border-radius:0 0 7px 7px;background:var(--fp-surface);padding:17.5px}.forge-sales-service .ss-personal-workspace{grid-template-columns:minmax(0,1fr);--ui-document-workspace-gap:14px}.forge-sales-service .ss-personal-main{gap:14px}.forge-sales-service .ss-personal-empty{height:100px;min-height:100px;padding:0;gap:0}.forge-sales-service .ss-personal-empty.today{height:140px;min-height:140px}.forge-sales-service .ss-personal-empty-title{font-size:12.25px;line-height:17.5px;font-weight:500;margin:10.5px 0 0;color:var(--fp-muted)}.forge-sales-service .ss-personal-empty-description{font-size:10.5px;line-height:14px;font-weight:400;margin:3.5px 0 0;max-width:none}.forge-sales-service .ss-personal-sidebar{gap:10.5px}.forge-sales-service .ss-personal-sidebar-cards{grid-template-columns:minmax(0,1fr)}.forge-sales-service .ss-personal-workspace [data-slot="document-section-count"]{--ui-document-section-plain-count-radius:3.5px}@media(min-width:1280px){.forge-sales-service .ss-personal-workspace{grid-template-columns:minmax(0,1fr) 320px}}
.forge-sales-service .ss-personal-date{margin:0;color:var(--fp-muted);font-size:12.25px;line-height:17.5px}
.forge-sales-service .ss-personal-order-toolbar{margin:0 0 10.5px;--ui-workspace-toolbar-gap:7px}
.forge-sales-service .ss-personal-order-filters{display:flex;align-items:end;gap:7px;flex-wrap:wrap;min-width:0}
.forge-sales-service .ss-personal-order-filters .fp-field{min-width:132px;max-width:200px}
.forge-sales-service .ss-personal-order-filters .fp-input{height:28px}
.forge-sales-service .ss-personal-status{min-width:0;max-width:100%;overflow-x:auto;margin:0 0 10.5px;--ui-status-tabs-height:32px;--ui-status-tabs-padding-inline:10.5px;--ui-status-tabs-padding-block:7px;--ui-status-tabs-radius:0px;--ui-status-tabs-font-size:12px;--ui-status-tabs-line-height:17px}
.forge-sales-service .ss-personal-list{min-width:0;border:1px solid var(--fp-line);border-radius:5.25px;background:var(--fp-surface);overflow:hidden}
.forge-sales-service .ss-next-step{display:grid;gap:0;min-height:45px;padding:3.5px 10.5px;line-height:17.5px;text-align:left}
.forge-sales-service .ss-next-step span{font-size:10.5px;line-height:14px}
.forge-sales-service .ss-next-step strong{font-size:12.25px;line-height:17.5px}
.forge-sales-service .ss-scope{min-width:0;max-width:100%;overflow-x:auto;margin:0;--ui-status-tabs-height:40.5px;--ui-status-tabs-padding-inline:14px;--ui-status-tabs-padding-block:10px;--ui-status-tabs-radius:0px;--ui-status-tabs-font-size:13px;--ui-status-tabs-line-height:17.5px}
.forge-sales-service .ss-tab-panel{min-width:0}
.forge-sales-service .ss-content{min-width:0;border:1px solid var(--fp-line);border-radius:5.25px;background:var(--fp-surface);overflow:hidden}
@container(max-width:55.999rem){.forge-sales-service .ss-create-workspace>[data-slot="document-workspace-sidebar"]{order:-1}}
.forge-sales-service .ss-create-fieldset{min-width:0;margin:0;padding:0;border:0}
.forge-sales-service .ss-create-actions{display:grid;gap:7px}
.forge-sales-service .ss-create-actions .fp-button{width:100%}
.forge-sales-service .ss-readonly-note{margin:10.5px 0;padding:10.5px 14px;border:1px solid var(--fp-line);border-radius:3.5px;color:var(--fp-muted);font-size:12.25px;line-height:17.5px}

.forge-sales-service .ss-warranty-overview{display:grid;gap:14px;min-width:0}
.forge-sales-service .ss-warranty-summary{grid-template-columns:repeat(5,minmax(0,1fr));--ui-list-summary-gap:10.5px;--ui-list-summary-card-height:102.75px;--ui-list-summary-padding-inline:14px;--ui-list-summary-padding-block:14px;--ui-list-summary-item-gap:0px;--ui-list-summary-card-radius:7px;--ui-list-summary-label-font-size:12px;--ui-list-summary-label-line-height:18px;--ui-list-summary-label-font-weight:500;--ui-list-summary-value-font-size:22px;--ui-list-summary-value-line-height:33px;--ui-list-summary-value-font-weight:700}
.forge-sales-service .ss-warranty-value{display:block;margin-top:3.5px}
.forge-sales-service .ss-warranty-description{display:block;margin-top:1.75px;font-size:11px;line-height:16.5px;font-weight:500;color:var(--fp-muted)}
.forge-sales-service .ss-warranty-windows{grid-template-columns:repeat(3,minmax(0,1fr));--ui-list-summary-columns:3;--ui-list-summary-gap:10.5px;--ui-list-summary-card-height:87.5px;--ui-list-summary-padding-inline:14px;--ui-list-summary-padding-block:14px;--ui-list-summary-item-gap:3.5px;--ui-list-summary-card-radius:7px;--ui-list-summary-label-font-size:12px;--ui-list-summary-label-line-height:18px;--ui-list-summary-value-font-size:24px;--ui-list-summary-value-line-height:36px;--ui-list-summary-value-font-weight:700}
.forge-sales-service .ss-warranty-distributions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10.5px;min-width:0}
.forge-sales-service .ss-warranty-distribution{--ui-card-padding:14px;--ui-card-radius:7px;--ui-card-divider-display:none;--ui-document-section-title-font-size:12.5px;--ui-document-section-title-line-height:18.75px;--ui-document-section-title-font-weight:600;--ui-document-section-header-padding-top:14px;--ui-document-section-header-padding-bottom:7px;--ui-document-section-body-padding-top:0px}
.forge-sales-service .ss-warranty-lists{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10.5px;min-width:0}
.forge-sales-service .ss-warranty-records{--ui-card-padding:17.5px;--ui-card-radius:7px;--ui-card-divider-display:none;--ui-document-section-title-font-size:13px;--ui-document-section-title-line-height:19.5px;--ui-document-section-title-font-weight:600;--ui-document-section-header-padding-top:17.5px;--ui-document-section-header-padding-bottom:10.5px;--ui-document-section-body-padding-top:0px}
.forge-sales-service .ss-warranty-empty{display:flex;min-height:140px;align-items:center;justify-content:center;font-size:12px;line-height:18px;color:var(--fp-muted);text-align:center}
.forge-sales-service .ss-warranty-dates{list-style:none;margin:0;padding:0;display:grid;gap:5.25px}
.forge-sales-service .ss-warranty-date-row{display:flex;width:100%;min-width:0;align-items:center;gap:7px;border:1px solid var(--fp-line);border-radius:3.5px;padding:7px;background:var(--fp-surface);text-align:left}
.forge-sales-service .ss-warranty-date-row strong{font-size:11.5px;line-height:17.25px;color:var(--fp-primary);overflow-wrap:anywhere}
.forge-sales-service .ss-warranty-date-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}
.forge-sales-service .ss-warranty-date-row time{flex-shrink:0;font-size:11px;line-height:16.5px;color:var(--fp-muted)}
@media(max-width:1279px){.forge-sales-service .ss-warranty-summary{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:767px){.forge-sales-service .ss-warranty-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:519px){.forge-sales-service .ss-warranty-distributions,.forge-sales-service .ss-warranty-lists{grid-template-columns:minmax(0,1fr)}}

.forge-sales-service .ss-performance{display:grid;gap:14px;min-width:0}
.forge-sales-service .ss-performance-summary{--ui-list-summary-columns:2;--ui-list-summary-gap:10.5px;--ui-list-summary-card-height:87.5px;--ui-list-summary-padding-inline:14px;--ui-list-summary-padding-block:14px;--ui-list-summary-card-radius:7px;--ui-list-summary-label-font-size:12px;--ui-list-summary-label-line-height:18px;--ui-list-summary-value-font-size:24px;--ui-list-summary-value-line-height:36px}
.forge-sales-service .ss-performance-section{--ui-card-radius:7px;--ui-card-padding:17.5px;--ui-document-section-title-font-size:13px;--ui-document-section-title-line-height:19.5px;--ui-document-section-title-font-weight:600;--ui-document-section-header-padding-bottom:10.5px}
.forge-sales-service .ss-performance-ranking{--ui-category-distribution-label-width:157.5px;--ui-category-distribution-count-width:42px;--ui-category-distribution-bar-height:5.25px;--ui-category-distribution-row-padding:5.25px;--ui-category-distribution-column-gap:7px;--ui-category-distribution-count-gap:7px;--ui-category-distribution-rank-width:14px;--ui-category-distribution-rank-font-size:10.5px}
.forge-sales-service .ss-performance-caption{margin:0 0 10.5px;font-size:11.5px;line-height:17.25px;color:var(--fp-muted)}
.forge-sales-service .ss-performance-unavailable{margin:0;font-size:12px;line-height:18px;color:var(--fp-muted)}
.forge-sales-service .ss-performance-table{min-width:0;--ui-table-header-height:40px;--ui-table-header-font-size:11.5px;--ui-table-font-size:12px;--ui-table-cell-padding-y:8px;--ui-table-cell-padding-x:10.5px}
.forge-sales-service .ss-analysis-filters{display:flex;align-items:end;gap:10.5px;flex-wrap:wrap;margin:0 0 14px}
.forge-sales-service .ss-analysis-filters .fp-field{min-width:150px;max-width:220px}
.forge-sales-service .ss-analysis-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10.5px;margin-bottom:14px}
.forge-sales-service .ss-analysis-chart{min-width:0;min-height:240px;margin-top:14px;border:1px solid var(--fp-line);border-radius:5.25px;background:var(--fp-surface);padding:14px}
.forge-sales-service .ss-upload{display:grid;gap:7px}
.forge-sales-service .ss-upload input{max-width:100%}
.forge-sales-service .ss-upload-files{margin:0;color:var(--fp-muted);font-size:12.25px;line-height:17.5px;overflow-wrap:anywhere}
.forge-sales-service .ss-event-history{margin-top:14px;border-top:1px solid var(--fp-line);padding-top:10px}
@media(max-width:980px){.forge-sales-service .ss-shell{padding:14px 14px 24px}.forge-sales-service .ss-analysis-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:680px){.forge-sales-service .ss-shell{padding:12px 10.5px 21px}.forge-sales-service .ss-analysis-metrics{grid-template-columns:minmax(0,1fr)}.forge-sales-service .ss-analysis-filters .fp-field{flex:1 1 100%;max-width:none}}
@media(max-width:760px){.forge-sales-service .ss-dispatch-toolbar{align-items:stretch}.forge-sales-service .ss-dispatch-toolbar [data-slot="workspace-toolbar-search"],.forge-sales-service .ss-dispatch-toolbar [data-slot="workspace-toolbar-filters"]{width:100%;max-width:none;flex:1 1 100%}.forge-sales-service .ss-dispatch-filter{flex:1 1 128px;width:auto}.forge-sales-service .ss-dispatch-period{align-items:stretch}.forge-sales-service .ss-dispatch-period-nav{justify-content:space-between}.forge-sales-service .ss-dispatch-period-range{min-width:0;flex:1}}
@media(max-width:1024px){.forge-sales-service .ss-personal-document-metrics.six{--ui-list-summary-columns:3}}
@media(max-width:767px){.forge-sales-service .ss-personal-document-metrics.six,.forge-sales-service .ss-personal-document-metrics.four{--ui-list-summary-columns:2}}
@media(max-width:760px){.forge-sales-service .ss-personal-order-filters{align-items:stretch}.forge-sales-service .ss-personal-order-filters .fp-field{flex:1 1 160px;max-width:none}}
`);

const serviceListViewsJson = JSON.stringify(serviceViews);
const serviceConfigCategoriesJson = JSON.stringify(serviceConfigCategories);
const serviceUrgencyOptionsJson = JSON.stringify(serviceUrgencyOptions);
const serviceOrderStatusOptionsJson = JSON.stringify(serviceOrderStatusOptions);
const warrantyRulesCategoryJson = JSON.stringify(warrantyRulesCategory);
const serviceOrderSourceField = {
  ...ServiceOrder.fields.sales_order_id,
  name: 'sales_order_id',
  label: '来源销售订单',
  required: true,
};

function createServicePage(spec: ServicePageSpec) {
  const source = `const servicePage=${JSON.stringify(spec)};
const serviceViews=${serviceListViewsJson};
const serviceConfigCategories=${serviceConfigCategoriesJson};
const serviceUrgencyOptions=${serviceUrgencyOptionsJson};
const serviceOrderStatusOptions=${serviceOrderStatusOptionsJson};
const warrantyRulesCategory=${warrantyRulesCategoryJson};
const serviceOrderSourceField=${JSON.stringify(serviceOrderSourceField)};
const serviceOrderTypeField=${JSON.stringify({...ServiceOrder.fields.service_type,name:'service_type',label:'服务场景'})};
const css=${serviceCss};
${serviceDispatchPanelHelpersSource}
${servicePersonalWorkspacePanelHelpersSource}
${servicePersonalMetricsHelpersSource}
${serviceTypeCatalogHelpersSource}
${serviceWarrantyOverviewHelpersSource}
${serviceAnalysisRangeHelpersSource}
${servicePersonalPerformanceHelpersSource}
${servicePerformanceCustomersHelpersSource}
function App(){
  const adapter=useAdapter();
  const [access,setAccess]=React.useState({loading:true,error:'',managerError:'',permissionsError:'',canManage:false,canOperateService:false,canOperateWarehouse:false,userId:''});
  const [revision,setRevision]=React.useState(0);
  const [scope,setScope]=React.useState(servicePage.mode==='workspace'?'today':servicePage.mode==='dispatch'?'pending_dispatch':'all');
  const [configCategory,setConfigCategory]=React.useState('');
  const [warrantyTab,setWarrantyTab]=React.useState('overview');
  const [warrantyOverview,setWarrantyOverview]=React.useState({loading:servicePage.mode==='warranty',complete:false,rows:[],error:'',businessDate:'',dateError:''});
  const [warrantyRevision,setWarrantyRevision]=React.useState(0);
  const [warrantyCardSelections,setWarrantyCardSelections]=React.useState({});
  const [warrantyCardEntry,setWarrantyCardEntry]=React.useState(0);
  const warrantyRequest=React.useRef(0);
  const [selected,setSelected]=React.useState(null);
  const [dialog,setDialog]=React.useState(()=>servicePage.standaloneCreate?{kind:'create-order',step:'form',values:{},baseline:{},error:''}:null);
  const [notice,setNotice]=React.useState(null);
  const [busy,setBusy]=React.useState(false);
  const [analysis,setAnalysis]=React.useState({from:'',to:'',dimension:'service_type',serviceType:'',region:'',urgency:''});
  const [personalWorkspace,setPersonalWorkspace]=React.useState(()=>({loading:servicePage.mode==='workspace',complete:false,unavailable:false,error:'',businessDate:'',businessTimezone:null,timezoneError:'',dateError:'',rows:[]}));
  const [personalRevision,setPersonalRevision]=React.useState(0);
  const [personalDocumentState,setPersonalDocumentState]=React.useState({});
  const [typeCatalog,setTypeCatalog]=React.useState({loading:false,available:false,options:[],error:''});
  const typeCatalogRequest=React.useRef(0);
  const [personalMetrics,setPersonalMetrics]=React.useState({key:'',loading:false,available:false,error:'',items:[]});
  const [personalSidebar,setPersonalSidebar]=React.useState({key:'',parts:{loading:false,available:false,value:null,description:'统计暂不可用',error:''},quotations:{loading:false,available:false,value:null,description:'统计暂不可用',error:''}});
  const personalSidebarRequest=React.useRef(0);
  const [performanceCustomers,setPerformanceCustomers]=React.useState({loading:false,available:false,names:{},error:'',missingCount:0});
  const performanceCustomerRequest=React.useRef(0);
  const [performancePage,setPerformancePage]=React.useState(1);
  const personalMetricRequest=React.useRef(0);
  const [personalSectionPages,setPersonalSectionPages]=React.useState({today:1,tomorrow:1,urgent:1,unplanned:1});
  const [personalListReset,setPersonalListReset]=React.useState(0);
  const [personalOrderFilters,setPersonalOrderFilters]=React.useState({status:'all',datePreset:'all',from:'',to:'',serviceType:'',urgency:'',region:'',search:''});
  const formController=React.useRef(null);
  const detailLoadSession=React.useRef(0);
  const personalRequest=React.useRef(0);
  const sourceView=servicePage.viewKey?serviceViews[servicePage.viewKey]:null;
  const formView=sourceView&&sourceView.form?sourceView.form:null;
  const formFields=formView?formView.sections.flatMap(section=>(section.fields||[]).map(field=>typeof field==='string'?field:field.field)):[];
  const formObject=servicePage.mode==='quotations'?'forge_service_quotation':servicePage.mode==='settlements'?'forge_service_settlement':servicePage.mode==='configuration'?'forge_service_config_item':servicePage.mode==='warranty'?'forge_warranty_card':'forge_service_order';
  const statusLabel={pending_acceptance:'待受理',pending_dispatch:'待分派',pending_receive:'待接单',in_progress:'服务中',completed:'已完工',closed:'已关闭',rejected:'已驳回',draft:'草稿',pending_confirmation:'待确认',confirmed:'已确认',settlement_created:'已转结算',pending_approval:'待审批',customer_confirming:'客户确认中',receivable_created:'已生成应收',active:'生效中',pending_activation:'待激活',grace_period:'宽限期',expired:'已过保',terminated:'已终止'};
  function unwrap(value){return value&&value.result&&value.result.result||value&&value.result||value&&value.data&&value.data.result&&value.data.result.result||value&&value.data&&value.data.result||value&&value.data||value}
  async function request(path,options){return ForgeApiRequest(adapter,path,options||{})}
  async function loadAccess(){
    try{
      const session=await request('/auth/get-session');
      const user=session&&session.user||session&&session.session&&session.session.user||session&&session.data&&session.data.user||null;
      if(!user||!user.id)throw new Error('登录已失效，请重新登录');
      const [managerResult,permissionResult]=await Promise.allSettled([
        request('/actions/forge_service_order/service_order_manager_context',{method:'POST',body:JSON.stringify({params:{}})}),
        request('/auth/me/permissions'),
      ]);
      const managerContext=managerResult.status==='fulfilled'?unwrap(managerResult.value):null;
      const permissions=permissionResult.status==='fulfilled'?unwrap(permissionResult.value):null;
      const systemPermissions=Array.isArray(permissions&&permissions.systemPermissions)?permissions.systemPermissions:[];
      const canManage=Boolean(managerContext&&managerContext.canManage===true);
      const managerError=managerResult.status==='rejected'?String(managerResult.reason&&managerResult.reason.message||managerResult.reason):'';
      const permissionsError=permissionResult.status==='rejected'||!Array.isArray(permissions&&permissions.systemPermissions)?'当前账号服务操作权限无法读取，相关操作已隐藏。':'';
      setAccess({loading:false,error:'',managerError,permissionsError,canManage,canOperateService:systemPermissions.includes('forge_service_operator'),canOperateWarehouse:systemPermissions.includes('forge_warehouse_operator'),userId:String(user.id)});
    }catch(error){setAccess({loading:false,error:String(error&&error.message||error),managerError:'',permissionsError:'',canManage:false,canOperateService:false,canOperateWarehouse:false,userId:''})}
  }
  React.useEffect(()=>{loadAccess()},[]);
  React.useEffect(()=>{
    if(servicePage.mode!=='workspace'||access.loading)return;
    const requestId=++personalRequest.current;
    if(access.error||!access.userId){
      setPersonalWorkspace({loading:false,complete:false,unavailable:true,error:'当前账号标识不可用，无法读取个人工单。',businessDate:'',businessTimezone:null,timezoneError:'',dateError:'',rows:[]});
      return()=>{personalRequest.current+=1};
    }
    setPersonalWorkspace({loading:true,complete:false,unavailable:false,error:'',businessDate:'',businessTimezone:null,timezoneError:'',dateError:'',rows:[]});
    setPersonalSectionPages({today:1,tomorrow:1,urgent:1,unplanned:1});
    Promise.allSettled([
      ForgeOrganizationBusinessContext(adapter),
      readServiceOrderPages(path=>request(path),{engineer_id:access.userId},200,5000,'个人服务工单'),
    ]).then(results=>{
      if(requestId!==personalRequest.current)return;
      const dateResult=results[0],ordersResult=results[1];
      const businessDate=dateResult.status==='fulfilled'?String(dateResult.value?.business_date||''):'',businessTimezone=dateResult.status==='fulfilled'?dateResult.value?.timezone:null,timezoneError=dateResult.status==='fulfilled'?String(dateResult.value?.timezoneError||''):'';
      const dateError=dateResult.status==='rejected'?String(dateResult.reason&&dateResult.reason.message||'组织业务日期读取失败，请重试。'):'';
      if(ordersResult.status==='rejected'){
        setPersonalWorkspace({loading:false,complete:false,unavailable:true,error:String(ordersResult.reason&&ordersResult.reason.message||'个人服务工单读取失败，请重试。'),businessDate,businessTimezone,timezoneError,dateError,rows:[]});
        return;
      }
      const result=ordersResult.value;
      setPersonalWorkspace({loading:false,complete:result.complete===true,unavailable:result.unavailable===true,error:result.error||'',businessDate,businessTimezone,timezoneError,dateError,rows:result.complete===true?servicePersonalActorRows(result.rows,access.userId):[]});
    }).catch(error=>{
      if(requestId===personalRequest.current)setPersonalWorkspace({loading:false,complete:false,unavailable:true,error:String(error&&error.message||'个人服务工单读取失败，请重试。'),businessDate:'',businessTimezone:null,timezoneError:'',dateError:'',rows:[]});
    });
    return()=>{personalRequest.current+=1};
  },[servicePage.mode,access.loading,access.error,access.userId,personalRevision,revision]);
  React.useEffect(()=>{
    if(servicePage.mode!=='workspace')return;
    const requestId=++personalMetricRequest.current;
    const kind=scope==='my-quotations'?'quotations':scope==='parts'?'parts':'';
    const key=scope+'-'+personalRevision;
    if(!kind||!access.userId||(kind==='quotations'&&!access.canManage)){
      setPersonalMetrics({key,loading:false,available:false,error:'',items:[]});
      return()=>{personalMetricRequest.current+=1};
    }
    const related=kind==='quotations'?servicePersonalRelatedListScope(access.userId,personalWorkspace):null;
    if(related&&related.status!=='ready'){
      setPersonalMetrics({key,loading:related.status==='loading',available:false,error:related.error,items:[]});
      return()=>{personalMetricRequest.current+=1};
    }
    const objectName=kind==='quotations'?'forge_service_quotation':'forge_service_part_request';
    const where=kind==='quotations'?{service_order_id:{$in:related.filter[2]}}:{requested_by:access.userId};
    setPersonalMetrics({key,loading:true,available:false,error:'',items:[]});
    readServiceRecordPages(path=>request(path),objectName,where,100,5000,'个人统计').then(result=>{
      if(requestId!==personalMetricRequest.current)return;
      if(!result.complete||result.unavailable){setPersonalMetrics({key,loading:false,available:false,error:result.error||'个人统计读取不完整，请重试。',items:[]});return}
      const projected=servicePersonalMetricProjection(kind,result.rows,access.userId,personalWorkspace.rows);
      setPersonalMetrics({key,loading:false,...projected});
    }).catch(error=>{
      if(requestId===personalMetricRequest.current)setPersonalMetrics({key,loading:false,available:false,error:String(error&&error.message||'个人统计读取失败，请重试。'),items:[]});
    });
    return()=>{personalMetricRequest.current+=1};
  },[servicePage.mode,scope,access.userId,access.canManage,personalRevision,revision,personalWorkspace.loading,personalWorkspace.complete,personalWorkspace.unavailable,personalWorkspace.rows]);
  React.useEffect(()=>{
    if(servicePage.mode!=='workspace')return;
    const requestId=++personalSidebarRequest.current,key=access.userId+'-'+personalRevision+'-'+revision;
    const unavailable={loading:false,available:false,value:null,description:'统计暂不可用',error:''};
    const loading={...unavailable,loading:true,description:'读取中…'};
    if(scope!=='today'||access.loading||!access.userId){
      setPersonalSidebar({key,parts:unavailable,quotations:unavailable});
      return()=>{personalSidebarRequest.current+=1};
    }
    const related=servicePersonalRelatedListScope(access.userId,personalWorkspace);
    if(related.status==='loading'){
      setPersonalSidebar({key,parts:loading,quotations:access.canManage?loading:{...unavailable,description:'当前账号无读取权限'}});
      return()=>{personalSidebarRequest.current+=1};
    }
    setPersonalSidebar({key,parts:loading,quotations:!access.canManage?{...unavailable,description:'当前账号无读取权限'}:related.status==='ready'?loading:{...unavailable,error:related.error}});
    function load(kind,objectName,where){
      readServiceRecordPages(path=>request(path),objectName,where,100,5000,'个人业务摘要').then(result=>{
        if(requestId!==personalSidebarRequest.current)return;
        const metric=!result.complete||result.unavailable?{...unavailable,error:result.error||'个人业务摘要读取不完整，请重试。'}:servicePersonalSidebarMetric(kind,result.rows,access.userId,personalWorkspace.rows);
        setPersonalSidebar(current=>({...current,[kind]:{loading:false,...metric}}));
      }).catch(error=>{
        if(requestId===personalSidebarRequest.current)setPersonalSidebar(current=>({...current,[kind]:{...unavailable,error:String(error&&error.message||'个人业务摘要读取失败，请重试。')}}));
      });
    }
    load('parts','forge_service_part_request',{requested_by:access.userId});
    if(access.canManage&&related.status==='ready')load('quotations','forge_service_quotation',{service_order_id:{$in:related.filter[2]}});
    return()=>{personalSidebarRequest.current+=1};
  },[servicePage.mode,scope,access.loading,access.userId,access.canManage,personalRevision,revision,personalWorkspace.loading,personalWorkspace.complete,personalWorkspace.unavailable,personalWorkspace.rows]);
  React.useEffect(()=>{
    if((!servicePage.standaloneCreate&&dialog?.kind!=='create-order')||access.loading||!access.canManage)return;
    const requestId=++typeCatalogRequest.current;
    setTypeCatalog({loading:true,available:false,options:[],error:''});
    readServiceRecordPages(path=>request(path),'forge_service_config_item',{category:'order_type',status:'active'},100,5000,'服务场景配置').then(result=>{
      if(requestId!==typeCatalogRequest.current)return;
      if(!result.complete||result.unavailable){setTypeCatalog({loading:false,available:false,options:[],error:result.error||'服务场景配置读取不完整，请重试。'});return}
      setTypeCatalog({loading:false,...serviceTypeCatalogOptions(result.rows)});
    }).catch(error=>{
      if(requestId===typeCatalogRequest.current)setTypeCatalog({loading:false,available:false,options:[],error:String(error&&error.message||'服务场景配置读取失败。')});
    });
    return()=>{typeCatalogRequest.current+=1};
  },[servicePage.standaloneCreate,dialog?.kind,access.loading,access.canManage,revision]);
  React.useEffect(()=>{
    if(servicePage.mode!=='warranty'||warrantyTab!=='overview'||access.loading)return;
    const requestId=++warrantyRequest.current;
    if(access.error||!access.userId){setWarrantyOverview({loading:false,complete:false,rows:[],error:'当前账号不可用，无法读取质保概览。',businessDate:'',dateError:''});return()=>{warrantyRequest.current+=1}}
    setWarrantyOverview({loading:true,complete:false,rows:[],error:'',businessDate:'',dateError:''});
    Promise.allSettled([ForgeOrganizationBusinessDate(adapter),readServiceRecordPages(path=>request(path),'forge_warranty_card',{},200,5000,'质保卡')]).then(results=>{
      if(requestId!==warrantyRequest.current)return;
      const dateResult=results[0],recordsResult=results[1];
      const businessDate=dateResult.status==='fulfilled'?String(dateResult.value||''):'';
      const dateError=dateResult.status==='rejected'?String(dateResult.reason&&dateResult.reason.message||'组织业务日期暂不可用。'):'';
      if(recordsResult.status==='rejected'){setWarrantyOverview({loading:false,complete:false,rows:[],error:String(recordsResult.reason&&recordsResult.reason.message||'质保卡读取失败，请重试。'),businessDate,dateError});return}
      const result=recordsResult.value;
      setWarrantyOverview({loading:false,complete:result.complete===true&&!result.unavailable,rows:result.complete===true&&!result.unavailable?result.rows:[],error:result.error||'',businessDate,dateError});
    }).catch(error=>{if(requestId===warrantyRequest.current)setWarrantyOverview({loading:false,complete:false,rows:[],error:String(error&&error.message||'质保概览读取失败。'),businessDate:'',dateError:''})});
    return()=>{warrantyRequest.current+=1};
  },[servicePage.mode,warrantyTab,access.loading,access.error,access.userId,warrantyRevision,revision]);
  React.useEffect(()=>{
    if(servicePage.mode!=='workspace'||scope!=='performance'||access.loading||personalWorkspace.loading||!personalWorkspace.complete||personalWorkspace.unavailable)return;
    const requestId=++performanceCustomerRequest.current;
    setPerformanceCustomers({loading:true,available:false,names:{},error:'',missingCount:0});
    readServicePerformanceCustomerNames(path=>request(path),personalWorkspace.rows,access.userId).then(result=>{
      if(requestId===performanceCustomerRequest.current)setPerformanceCustomers({loading:false,...result});
    }).catch(error=>{if(requestId===performanceCustomerRequest.current)setPerformanceCustomers({loading:false,available:false,names:{},error:String(error&&error.message||'客户名称读取失败。'),missingCount:null})});
    return()=>{performanceCustomerRequest.current+=1};
  },[servicePage.mode,scope,access.loading,access.userId,personalWorkspace.loading,personalWorkspace.complete,personalWorkspace.unavailable,personalWorkspace.rows,personalRevision]);
  async function readRecord(objectName,id){
    const response=await request('/data/'+objectName+'/'+encodeURIComponent(id));
    const payload=unwrap(response),record=payload&&payload.record||payload&&payload.data&&payload.data.record||payload&&payload.data||payload||null;
    if(!record||typeof record!=='object'||!record.id)throw new Error('操作后无法读取业务记录，请刷新页面核对');
    return record;
  }
  async function runAction(objectName,actionName,id,params){
    const path='/actions/'+objectName+'/'+actionName+(id?'/'+encodeURIComponent(id):'');
    return unwrap(await request(path,{method:'POST',body:JSON.stringify({params:params||{}})}));
  }
  const today=(()=>{const date=new Date();return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10)})();
  const [dispatchPeriod,setDispatchPeriod]=React.useState(7);
  const [dispatchAnchor,setDispatchAnchor]=React.useState(today);
  const [dispatchFilters,setDispatchFilters]=React.useState({search:'',region:'',serviceType:'',urgency:'',engineerId:''});
  const [dispatchPanel,setDispatchPanel]=React.useState({view:'',loading:false,rows:[],total:null,complete:false,unavailable:false,error:'',reason:''});
  const [dispatchTablePages,setDispatchTablePages]=React.useState({resources:1,orders:1,issues:1,sla:1});
  const dispatchRequest=React.useRef(0);
  async function loadDispatchPanel(view){
    const requestId=++dispatchRequest.current;
    setDispatchPanel({view,loading:true,rows:[],total:null,complete:false,unavailable:false,error:'',reason:''});
    setDispatchTablePages({resources:1,orders:1,issues:1,sla:1});
    const queryMode=view==='resource'?'resource-load':view;
    const result=await readServiceDispatchOrders(path=>request(path),queryMode,200,5000);
    if(requestId!==dispatchRequest.current)return;
    setDispatchPanel({view,loading:false,...result});
  }
  React.useEffect(()=>{
    if(servicePage.mode!=='dispatch'||scope==='pending_dispatch'||!access.canManage)return;
    const view=scope==='resource'?'resource-load':scope;
    loadDispatchPanel(view);
    return()=>{dispatchRequest.current+=1};
  },[servicePage.mode,scope,access.canManage]);
  function idempotencyKey(){return window.crypto&&typeof window.crypto.randomUUID==='function'?window.crypto.randomUUID():'svc-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)}
  function fileIds(value){return Array.isArray(value)?value.flatMap(fileIds):value&&typeof value==='object'?fileIds(value.id||value.fileId):typeof value==='string'?[value.trim()]:[]}
  async function uploadEvidence(file){
    if(!file||!String(file.type||'').toLowerCase().startsWith('image/'))throw new Error('现场处理凭证只接受图片文件');
    const signed=unwrap(await request('/storage/upload/presigned',{method:'POST',body:JSON.stringify({filename:file.name,mimeType:file.type||'application/octet-stream',size:file.size,scope:'user'})})),descriptor=signed&&signed.data||signed;
    if(!descriptor||!descriptor.fileId||!descriptor.uploadUrl)throw new Error('文件存储服务未返回有效上传地址');
    const url=new URL(descriptor.uploadUrl,window.location.origin),uploaded=await fetch(url.href,{method:descriptor.method||'PUT',headers:descriptor.headers||{},body:file});
    if(!uploaded.ok)throw new Error('现场图片上传失败：'+file.name);
    const completed=unwrap(await request('/storage/upload/complete',{method:'POST',body:JSON.stringify({fileId:descriptor.fileId})})),fileId=String(completed&&completed.fileId||descriptor.fileId);
    if(!fileId)throw new Error('文件已上传但未返回系统文件标识');
    return fileId;
  }
  function openDetail(row,objectName){
    const session=++detailLoadSession.current;
    setNotice(null);
    setSelected({objectName,record:row,loading:true});
    readRecord(objectName,row.id)
      .then(record=>{if(session===detailLoadSession.current)setSelected({objectName,record,loading:false})})
      .catch(error=>{if(session===detailLoadSession.current){setSelected(null);setNotice({tone:'error',text:String(error&&error.message||error)})}});
  }
  function openAction(action){
    formController.current=null;
    if(action.kind==='dispatch'){
      const values={engineer_id:'',scheduled_at:selected.record.expected_visit_on||'',dispatch_note:''};
      setDialog({kind:'dispatch',action,record:selected.record,engineers:[],loading:true,values,baseline:{...values},error:''});
      request('/actions/forge_service_order/service_order_dispatch_engineers/'+encodeURIComponent(selected.record.id),{method:'POST',body:JSON.stringify({params:{}})})
        .then(unwrap).then(result=>setDialog(current=>{
          if(!current||current.kind!=='dispatch')return current;
          const engineers=Array.isArray(result&&result.engineers)?result.engineers:[];
          return {...current,engineers,loading:false,error:engineers.length?'':'当前组织没有有效任职的售后工程师'};
        }))
        .catch(error=>setDialog(current=>current&&current.kind==='dispatch'?{...current,loading:false,error:String(error&&error.message||error)}:current));
      return;
    }
    if(action.kind==='quote'){const values={total_amount:'',valid_until:''};setDialog({kind:'quote-from-order',action,record:selected.record,values,baseline:{...values},error:''});return}
    if(action.kind==='settlement'){const values={total_amount:''};setDialog({kind:'settlement-from-order',action,record:selected.record,values,baseline:{...values},error:''});return}
    if(action.kind==='quote-draft-edit'){const values={total_amount:selected.record.total_amount??'',valid_until:servicePersonalDateKey(selected.record.valid_until)||'',remarks:selected.record.remarks||''};setDialog({kind:'quote-draft-edit',action,record:selected.record,values,baseline:{...values},idempotency_key:idempotencyKey(),error:''});return}
    if(action.kind==='complete'){const values={service_hours:'',treatment_record:'',service_result:''};setDialog({kind:'complete',action,record:selected.record,step:'form',values,baseline:{...values},files:[],uploadedFileIds:[],error:''});return}
    if(action.kind==='warranty-activate'){const values={starts_on:selected.record.starts_on||today,ends_on:selected.record.ends_on||'',idempotency_key:idempotencyKey()};setDialog({kind:'warranty-activate',action,record:selected.record,values,baseline:{...values},error:''});return}
    if(action.kind==='warranty-extend'){const values={ends_on:'',note:'',idempotency_key:idempotencyKey()};setDialog({kind:'warranty-extend',action,record:selected.record,values,baseline:{...values},error:''});return}
    if(action.kind==='config-edit'){const values={name:selected.record.name||'',code:selected.record.code||'',category:selected.record.category||'order_type',status:selected.record.status||'active',description:selected.record.description||'',remarks:selected.record.remarks||''};setDialog({kind:'config-edit',action,record:selected.record,values,baseline:{...values},error:''});return}
    if(action.kind==='receivable'){const values={due_on:''};setDialog({kind:'receivable',action,record:selected.record,values,baseline:{...values},error:''});return}
    setDialog({kind:'confirm',action,record:selected.record,error:''});
  }
  function openCreateConfiguration(){formController.current=null;const category=serviceConfigCategories.find(option=>option.value===configCategory)?.value||'order_type';const values={name:'',code:'',category,status:'active',description:'',remarks:''};setDialog({kind:'config-create',values,baseline:{...values},error:''})}
  function openCreateQuote(){setDialog({kind:'pick-quote-order',error:''})}
  function openCreateSettlement(){setDialog({kind:'pick-settlement-source',error:''})}
  function openQuoteSettlement(){setDialog({kind:'pick-settlement-quote',error:''})}
  function sourcePicked(kind,row){formController.current=null;if(kind==='pick-quote-order'){const values={total_amount:'',valid_until:''};setDialog({kind:'quote-from-order',record:row,values,baseline:{...values},error:''})}else if(kind==='pick-settlement-source'){const values={total_amount:''};setDialog({kind:'settlement-from-order',record:row,values,baseline:{...values},error:''})}else setDialog({kind:'settlement-from-quote',record:row,error:''})}
  async function validatedValues(){
    const controller=formController.current;
    if(!controller)throw new Error('表单正在加载，请稍后重试');
    const result=await controller.validate();
    if(!result||result.valid!==true)throw new Error(result&&result.formError||'请检查表单中标记的字段');
    return result.values||{};
  }
  async function commitDialog(){
    const current=dialog;if(!current||busy)return;
    setBusy(true);
    try{
      let targetObject='',targetId='',sourceObject='',sourceId='',actionResult=null;
      if(current.kind==='create-order'){
        const values=await validatedValues();
        actionResult=await runAction('forge_service_order','service_order_create',null,{draft_json:JSON.stringify(values)});
        targetObject='forge_service_order';targetId=String(actionResult&&actionResult.id||'');
      }else if(current.kind==='config-create'){
        const values=await validatedValues();
        actionResult=await runAction('forge_service_config_item','service_config_create',null,{draft_json:JSON.stringify(values)});
        targetObject='forge_service_config_item';targetId=String(actionResult&&actionResult.id||'');
      }else if(current.kind==='config-edit'){
        const values=await validatedValues();
        actionResult=await runAction('forge_service_config_item','service_config_update',current.record.id,{draft_json:JSON.stringify(values),expected_revision:Number(current.record.revision||1)});
        targetObject='forge_service_config_item';targetId=String(current.record.id);
      }else if(current.kind==='quote-from-order'){
        const values=await validatedValues();
        actionResult=await runAction('forge_service_order','service_order_create_quotation',current.record.id,{total_amount:values.total_amount,valid_until:values.valid_until});
        targetObject='forge_service_quotation';targetId=String(actionResult&&actionResult.id||'');sourceObject='forge_service_order';sourceId=String(current.record.id);
      }else if(current.kind==='quote-draft-edit'){
        const values=await validatedValues();
        const patch={total_amount:values.total_amount,valid_until:values.valid_until,remarks:values.remarks??''};
        actionResult=await runAction('forge_service_quotation','service_quotation_save_draft',current.record.id,{draft_json:JSON.stringify(patch),expected_revision:Number(current.record.revision??1),idempotency_key:current.idempotency_key});
        targetObject='forge_service_quotation';targetId=String(current.record.id);
      }else if(current.kind==='settlement-from-order'){
        const values=await validatedValues();
        actionResult=await runAction('forge_service_order','service_order_create_settlement',current.record.id,{total_amount:values.total_amount});
        targetObject='forge_service_settlement';targetId=String(actionResult&&actionResult.id||'');sourceObject='forge_service_order';sourceId=String(current.record.id);
      }else if(current.kind==='settlement-from-quote'){
        actionResult=await runAction('forge_service_quotation','service_quotation_create_settlement',current.record.id,{expected_revision:Number(current.record.revision??1)});
        targetObject='forge_service_settlement';targetId=String(actionResult&&actionResult.id||'');sourceObject='forge_service_quotation';sourceId=String(current.record.id);
      }else if(current.kind==='dispatch'){
        if(current.loading)throw new Error('工程师名单仍在读取，请稍后重试');
        if(!current.values.engineer_id)throw new Error('请选择服务工程师');
        if(!String(current.values.dispatch_note||'').trim())throw new Error('派工说明不能为空');
        actionResult=await runAction('forge_service_order','service_order_dispatch',current.record.id,current.values);
        targetObject='forge_service_order';targetId=String(current.record.id);
      }else if(current.kind==='complete'){
        const values=await validatedValues();
        const uploaded=[...(current.uploadedFileIds||[])];
        for(let index=0;index<(current.files||[]).length;index++){
          if(uploaded[index])continue;
          uploaded[index]=await uploadEvidence(current.files[index]);
          setDialog(value=>value&&value.kind==='complete'?{...value,uploadedFileIds:[...uploaded]}:value);
        }
        if(uploaded.length){
          await runAction('forge_service_order','service_order_attach_evidence',current.record.id,{file_ids:JSON.stringify(uploaded),expected_updated_at:String(current.record.updated_at||'')});
          const attached=await readRecord('forge_service_order',current.record.id);
          const stored=fileIds(attached.onsite_evidence_attachments);
          if(uploaded.some(id=>!stored.includes(id)))throw new Error('现场图片已上传，但工单尚未读回完整附件关联；请刷新核对后再提交');
        }
        actionResult=await runAction('forge_service_order','service_order_complete',current.record.id,values);
        targetObject='forge_service_order';targetId=String(current.record.id);
      }else if(current.kind==='warranty-activate'){
        const values=current.values||{};
        if(!values.starts_on||!values.ends_on)throw new Error('请填写质保开始日期和到期日期');
        actionResult=await runAction('forge_warranty_card','warranty_card_activate',current.record.id,{starts_on:values.starts_on,ends_on:values.ends_on,expected_revision:Number(current.record.revision||1),idempotency_key:values.idempotency_key});
        targetObject='forge_warranty_card';targetId=String(current.record.id);
      }else if(current.kind==='warranty-extend'){
        const values=current.values||{};
        if(!values.ends_on||!String(values.note||'').trim())throw new Error('请填写新的到期日期和延保说明');
        actionResult=await runAction('forge_warranty_card','warranty_card_extend',current.record.id,{ends_on:values.ends_on,note:values.note,expected_revision:Number(current.record.revision||1),idempotency_key:values.idempotency_key});
        targetObject='forge_warranty_card';targetId=String(current.record.id);
      }else if(current.kind==='receivable'){
        if(!current.values.due_on)throw new Error('请填写应收到账期');
        actionResult=await runAction('forge_service_settlement','service_settlement_create_receivable',current.record.id,current.values);
        targetObject='forge_service_settlement';targetId=String(current.record.id);
      }else if(current.kind==='confirm'){
        const params=current.action.expectedRevision?{expected_revision:Number(current.record.revision||1)}:{};
        actionResult=await runAction(current.action.object,current.action.action,current.record.id,params);
        targetObject=current.action.object;targetId=String(current.record.id);
      }else throw new Error('当前操作不可提交');
      if(!targetId)throw new Error('操作未返回业务记录标识，请刷新列表核对结果');
      const saved=await readRecord(targetObject,targetId);
      const source=sourceObject&&sourceId?await readRecord(sourceObject,sourceId):null;
      setRevision(value=>value+1);
      if(servicePage.standaloneCreate&&current.kind==='create-order'){
        ForgeNavigate('/_console/apps/com.inoforge.forge.sales/page_service_orders');
        setDialog(null);
        return;
      }
      setDialog(null);
      setSelected(null);
      const resultLabel=saved.code||saved.name||current.record&&current.record.code||'业务记录';
      const status=(targetObject==='forge_service_config_item'?{active:'启用',inactive:'停用'}:statusLabel)[saved.status]||saved.status||'';
      const suffix=status?'，当前状态为'+status:'';
      const linkedCode=saved.receivable_code||saved.quotation_code||saved.settlement_code||saved.warranty_code||source&&source.quotation_code||source&&source.settlement_code||'';
      setNotice({tone:'success',text:resultLabel+'已保存'+suffix+(linkedCode?'；关联单号 '+linkedCode:'')});
    }catch(error){setDialog(current=>current?{...current,error:String(error&&error.message||error)}:current)}
    finally{setBusy(false)}
  }
  function cancelDialog(){if(busy)return;formController.current=null;setDialog(null)}
  function listFilters(){
    if(servicePage.mode==='orders')return scope==='all'?undefined:['status','=',scope];
    if(servicePage.mode==='dispatch')return ['status','=','pending_dispatch'];
    if(servicePage.mode==='workspace'){
      if(scope==='my-quotations'||scope==='my-settlements')return servicePersonalRelatedListScope(access.userId,personalWorkspace).filter;
      if(scope==='parts')return access.userId?['requested_by','=',access.userId]:null;
      if(scope==='my-orders')return servicePersonalListFilters(access.userId,personalOrderFilters,servicePersonalDateRange(personalWorkspace.businessDate,personalOrderFilters.datePreset,personalOrderFilters.from,personalOrderFilters.to));
      if(scope==='today')return undefined;
      return ['status','=',scope];
    }
    if(servicePage.mode==='configuration')return configCategory?['category','=',configCategory]:undefined;
    return undefined;
  }
  const formDirty=Boolean(dialog&&((dialog.values&&dialog.baseline&&JSON.stringify(dialog.values)!==JSON.stringify(dialog.baseline))||(dialog.files&&dialog.files.length)));
  const sourceName=dialog&&dialog.record&&(dialog.record.code||dialog.record.name)||'';
  function servicePageActions(record,objectName){
    const actions=[];
    const assigned=Boolean(access.userId&&String(record.engineer_id||'')===access.userId&&String(record.owner_id||'')===access.userId&&String(record.responsible_id||'')===access.userId);
    if(servicePage.mode==='orders'||servicePage.mode==='dispatch'||servicePage.mode==='workspace'){
      if(record.status==='pending_acceptance'&&access.canManage)actions.push({kind:'confirm',object:'forge_service_order',action:'service_order_accept',label:'受理',title:'确认受理服务工单',message:'受理后工单进入待分派。'});
      if(record.status==='pending_dispatch'&&access.canManage)actions.push({kind:'dispatch',object:'forge_service_order',action:'service_order_dispatch',label:'派工',title:'派工给服务工程师'});
      if(record.status==='pending_receive'&&assigned&&access.canOperateService)actions.push({kind:'confirm',object:'forge_service_order',action:'service_order_engineer_accept',label:'接单',title:'确认接单',message:'接单后工单进入服务中。'});
      if(record.status==='in_progress'&&assigned&&access.canOperateService)actions.push({kind:'complete',object:'forge_service_order',action:'service_order_complete',label:'提交服务结果',title:'提交服务结果'});
      if(record.status==='completed'&&access.canManage&&!record.quotation_code)actions.push({kind:'quote',object:'forge_service_order',action:'service_order_create_quotation',label:'生成服务报价',title:'从完工工单生成服务报价'});
      if(record.status==='completed'&&access.canManage&&!record.settlement_code)actions.push({kind:'settlement',object:'forge_service_order',action:'service_order_create_settlement',label:'生成服务结算',title:'从完工工单生成服务结算'});
      if(record.status==='completed'&&assigned&&access.canOperateService&&!record.warranty_code)actions.push({kind:'confirm',object:'forge_service_order',action:'service_order_create_warranty',label:'生成质保卡',title:'生成质保卡',message:'该操作由当前指派的服务工程师办理。'});
    }
    if((servicePage.mode==='quotations'||objectName==='forge_service_quotation')&&access.canManage){
      if(record.status==='draft')actions.push({kind:'quote-draft-edit',object:'forge_service_quotation',action:'service_quotation_save_draft',label:'编辑草稿',title:'编辑服务报价草稿'});
      if(['draft','pending_confirmation'].includes(record.status))actions.push({kind:'confirm',object:'forge_service_quotation',action:'service_quotation_confirm',label:'确认报价',title:'确认客户已接受报价',message:'确认后可将报价转为服务结算。',expectedRevision:true});
      if(record.status==='confirmed')actions.push({kind:'confirm',object:'forge_service_quotation',action:'service_quotation_create_settlement',label:'转服务结算',title:'从已确认报价生成结算',message:'将按当前报价金额生成服务结算单。',expectedRevision:true});
    }
    if((servicePage.mode==='settlements'||objectName==='forge_service_settlement')&&access.canManage){
      if(['draft','customer_confirming'].includes(record.status))actions.push({kind:'confirm',object:'forge_service_settlement',action:'service_settlement_confirm',label:'确认结算',title:'确认服务结算',message:'确认后可生成财务应收。'});
      if(record.status==='confirmed')actions.push({kind:'receivable',object:'forge_service_settlement',action:'service_settlement_create_receivable',label:'生成应收',title:'生成财务应收'});
    }
    if(objectName==='forge_warranty_card'&&access.canManage){
      if(record.status==='pending_activation')actions.push({kind:'warranty-activate',object:'forge_warranty_card',action:'warranty_card_activate',label:'激活质保卡',title:'激活质保卡'});
      if(['active','grace_period','expired'].includes(record.status))actions.push({kind:'warranty-extend',object:'forge_warranty_card',action:'warranty_card_extend',label:'延长质保',title:'延长质保期限'});
    }
    if(objectName==='forge_service_config_item'&&access.canManage){
      actions.push({kind:'config-edit',object:'forge_service_config_item',action:'service_config_update',label:'编辑配置',title:'编辑服务配置'});
      if(record.status==='active')actions.push({kind:'confirm',object:'forge_service_config_item',action:'service_config_deactivate',label:'停用配置',title:'停用服务配置',message:'停用后新业务不应再选择该配置。',expectedRevision:true});
      if(record.status==='inactive')actions.push({kind:'confirm',object:'forge_service_config_item',action:'service_config_delete',label:'删除配置',title:'删除服务配置',message:'删除仅适用于未被业务引用的停用配置。',expectedRevision:true});
    }
    return actions;
  }
  function dateRules(){
    const filters=[];
    if(analysis.from){const start=new Date(analysis.from+'T00:00:00');if(!Number.isNaN(start.getTime()))filters.push({field:'created_at',operator:'greater_than_or_equal',value:start.toISOString()})}
    if(analysis.to){const end=new Date(analysis.to+'T00:00:00');if(!Number.isNaN(end.getTime())){end.setDate(end.getDate()+1);filters.push({field:'created_at',operator:'less_than',value:end.toISOString()})}}
    return filters;
  }
  const orderAnalysisFilters=[...dateRules(),...(analysis.serviceType?[{field:'service_type',operator:'icontains',value:analysis.serviceType}]:[]),...(analysis.region?[{field:'region',operator:'icontains',value:analysis.region}]:[]),...(analysis.urgency?[{field:'urgency',operator:'equals',value:analysis.urgency}]:[])];
  function updateAnalysis(field,value){setAnalysis(current=>({...current,[field]:value}))}
  function listComponent(view,filters,onRowClick,searchTerm,onSearchChange,listKey,showUserFilters=true,emptyState,restoreState={}){return <ListView key={listKey} data={view.data} fields={view.fields} type={view.type||'grid'} columns={view.columns} sort={view.sort} searchableFields={view.searchableFields} userFilters={showUserFilters?view.userFilters:undefined} userActions={view.userActions} pagination={view.pagination} selection={view.selection||{type:'none'}} filters={filters} refreshTrigger={revision} navigation={{mode:'none'}} onRowClick={onRowClick} rowActions={[]} bulkActions={[]} mobileLayout={servicePage.mode==='workspace'&&['my-quotations','my-settlements','parts'].includes(scope)?'table':undefined} {...restoreState} {...(emptyState?{emptyState}: {})} {...(searchTerm!==undefined?{initialSearchTerm:searchTerm,onSearchChange}: {})}/>}
  function updatePersonalOrderFilter(field,value){setPersonalOrderFilters(current=>({...current,[field]:value}))}
  function changePersonalDatePreset(value){setPersonalOrderFilters(current=>({...current,datePreset:value,from:value==='custom'?current.from:'',to:value==='custom'?current.to:''}))}
  function resetPersonalOrderFilters(){setPersonalOrderFilters({status:'all',datePreset:'all',from:'',to:'',serviceType:'',urgency:'',region:'',search:''});setPersonalListReset(value=>value+1)}
  function renderPersonalOrderFilters(){
    const dateRange=servicePersonalDateRange(personalWorkspace.businessDate,personalOrderFilters.datePreset,personalOrderFilters.from,personalOrderFilters.to);
    const statuses=[{value:'all',label:'全部状态'},...serviceOrderStatusOptions];
    const presets=[{value:'all',label:'全部计划日期'},{value:'7',label:'近 7 天计划'},{value:'30',label:'近 30 天计划'},{value:'month',label:'本月计划'},{value:'previous_month',label:'上月计划'},{value:'90',label:'近 90 天计划'},{value:'year',label:'今年计划'},{value:'custom',label:'自定义计划日期'}];
    return <>
      <StatusTabs className="ss-personal-status" aria-label="我的工单状态" value={personalOrderFilters.status} onValueChange={value=>updatePersonalOrderFilter('status',value)} items={statuses}/>
      <WorkspaceToolbar className="ss-personal-order-toolbar" aria-label="我的工单筛选" filters={<div className="ss-personal-order-filters">
        <ForgeSelect label="计划日期" value={personalOrderFilters.datePreset} options={presets} onChange={changePersonalDatePreset}/>
        {personalOrderFilters.datePreset==='custom'&&<DateRangeControl className="ss-personal-date-range" label="自定义计划日期范围" startPlaceholder="计划日期起" endPlaceholder="计划日期止" clearLabel="清除" quickRanges={[]} value={personalOrderFilters.from&&personalOrderFilters.to?{from:personalOrderFilters.from,to:personalOrderFilters.to}:undefined} onValueChange={value=>setPersonalOrderFilters(current=>({...current,from:value&&value.from||'',to:value&&value.to||''}))}/>}
        <div className="fp-field"><label htmlFor="ss-personal-service-type">服务类型</label><input id="ss-personal-service-type" className="fp-input" aria-label="服务类型筛选" placeholder="服务类型" value={personalOrderFilters.serviceType} onChange={event=>updatePersonalOrderFilter('serviceType',event.target.value)}/></div>
        <ForgeSelect label="紧急度" value={personalOrderFilters.urgency} options={[{value:'',label:'全部紧急度'},...serviceUrgencyOptions]} onChange={value=>updatePersonalOrderFilter('urgency',value)}/>
        <div className="fp-field"><label htmlFor="ss-personal-region">区域</label><input id="ss-personal-region" className="fp-input" aria-label="区域筛选" placeholder="区域" value={personalOrderFilters.region} onChange={event=>updatePersonalOrderFilter('region',event.target.value)}/></div>
        <button type="button" className="fp-button small" onClick={resetPersonalOrderFilters}>重置筛选</button>
      </div>}/>
      {!dateRange.valid&&personalOrderFilters.datePreset!=='all'&&<ForgeNotice tone="warning">{dateRange.error}</ForgeNotice>}
    </>;
  }
  function formComponent(objectName,fields,sections,columns,customFields){
    return <ObjectForm objectName={objectName} dataSource={adapter} mode="create" formType="simple" columns={columns||2} sections={sections||[]} fields={fields||[]} customFields={customFields} values={dialog&&dialog.values||{}} onValuesChange={values=>setDialog(current=>!current||busy?current:{...current,values,...(current.kind==='quote-draft-edit'&&JSON.stringify(values)!==JSON.stringify(current.values)?{idempotency_key:idempotencyKey()}:{}),error:''})} onControllerReady={controller=>{formController.current=controller}} showSubmit={false} showCancel={false} showReset={false} submitHandler={values=>values}/>;
  }
  function renderAnalysis(){
    const dateRange=serviceAnalysisDateRange(analysis.from,analysis.to);
    const metricFilter=dateRules();
    const appliedMetricFilter=metricFilter.length?metricFilter:undefined;
    return <><div className="ss-analysis-filters"><div className="fp-field"><label>开始日期</label><ForgeDateInput aria-label="开始日期" value={analysis.from} onChange={event=>updateAnalysis('from',event.target.value)}/></div><div className="fp-field"><label>结束日期</label><ForgeDateInput aria-label="结束日期" value={analysis.to} onChange={event=>updateAnalysis('to',event.target.value)}/></div><div className="fp-field"><label>服务类型</label><input className="fp-input" aria-label="服务类型" placeholder="输入服务类型" value={analysis.serviceType} onChange={event=>updateAnalysis('serviceType',event.target.value)}/></div><div className="fp-field"><label>区域</label><input className="fp-input" aria-label="区域" placeholder="输入区域" value={analysis.region} onChange={event=>updateAnalysis('region',event.target.value)}/></div><div className="fp-field"><label>紧急度</label><ForgeSelect label="紧急度" value={analysis.urgency} options={[{value:'',label:'全部紧急度'},...serviceUrgencyOptions]} onChange={value=>updateAnalysis('urgency',value)}/></div><div className="fp-field"><label>分析维度</label><ForgeSelect label="分析维度" value={analysis.dimension} options={[{value:'service_type',label:'服务类型'},{value:'region',label:'区域'},{value:'engineer_name',label:'服务工程师'}]} onChange={value=>updateAnalysis('dimension',value)}/></div></div>{!dateRange.valid?<ForgeNotice tone="error">{dateRange.error}</ForgeNotice>:<><div className="ss-analysis-metrics"><ObjectMetric objectName="forge_service_order" label="服务工单数" aggregate={{function:'count'}} filter={appliedMetricFilter}/><ObjectMetric objectName="forge_service_quotation" label="服务报价金额" aggregate={{function:'sum',field:'total_amount'}} filter={appliedMetricFilter} format="0,0.00" currency="CNY"/><ObjectMetric objectName="forge_service_settlement" label="服务结算金额" aggregate={{function:'sum',field:'total_amount'}} filter={appliedMetricFilter} format="0,0.00" currency="CNY"/><ObjectMetric objectName="forge_warranty_card" label="质保卡数" aggregate={{function:'count'}} filter={appliedMetricFilter}/></div><div className="ss-analysis-chart"><ObjectChart objectName="forge_service_order" type="column" title="工单分布" description="按当前维度汇总服务工单数量" aggregate={{function:'count',groupBy:analysis.dimension}} filter={orderAnalysisFilters.length?orderAnalysisFilters:undefined} xAxis={{field:analysis.dimension,title:'分析维度'}} yAxis={[{field:'count',title:'工单数量'}]} series={[{name:'count',label:'工单数量'}]} showLegend={false}/></div><div className="ss-analysis-chart"><ObjectChart objectName="forge_service_settlement" type="bar" title="服务结算金额" description="按结算状态汇总服务结算金额" aggregate={{function:'sum',field:'total_amount',groupBy:'status'}} filter={appliedMetricFilter} xAxis={{field:'status',title:'结算状态'}} yAxis={[{field:'total_amount',title:'结算金额（CNY）',format:',.2f'}]} series={[{name:'total_amount',label:'结算金额'}]} showLegend={false}/></div><p className="ss-readonly-note">日期范围应用于工单、报价、结算和质保卡聚合；服务类型、区域和紧急度应用于工单图表。团队、计费、SLA达标率、满意度、服务毛利及问题解决率暂不可用。</p></>}</>;
  }
  function renderPersonalRows(rows,label,pageKey,{emptyTitle,emptyDescription,unavailable=false}={}){
    if(!rows.length)return unavailable?<ForgeNotice tone="warning">工单信息不完整，暂不能确认该分区为空。</ForgeNotice>:<DataEmptyState className={'ss-personal-empty '+(pageKey==='today'?'today':'')} icon={<Icon icon="inbox" size={40}/>} iconWrapperClassName="" title={emptyTitle||'暂无'+label} description={emptyDescription} titleClassName="ss-personal-empty-title" descriptionClassName="ss-personal-empty-description"/>;
    const columns=[
      {accessorKey:'code',header:'工单号',width:150,cell:(value,row)=><button type="button" className="fp-link-button" onClick={()=>openDetail(row,'forge_service_order')}>{value||row.name||'查看工单'}</button>},
      {accessorKey:'name',header:'工单标题',width:210,cell:value=>value||'—'},
      {accessorKey:'service_object',header:'服务对象',width:145,cell:value=>value||'—'},
      {accessorKey:'service_type',header:'服务类型',width:120,cell:value=>value||'—'},
      {accessorKey:'scheduled_at',header:'计划日期',width:120,cell:value=>String(value||'').trim()?servicePersonalDateKey(value)||'日期未识别':'未排期'},
      {accessorKey:'urgency',header:'紧急度',width:95,cell:value=>serviceUrgencyOptions.find(option=>option.value===value)?.label||'紧急度不可用'},
      {accessorKey:'status',header:'状态',width:105,cell:value=>statusLabel[value]||'状态不可用'},
    ];
    const pageSize=10,pageCount=Math.max(1,Math.ceil(rows.length/pageSize)),page=Math.min(Math.max(1,personalSectionPages[pageKey]||1),pageCount),pageRows=rows.slice((page-1)*pageSize,page*pageSize);
    return <RecordTable schema={{type:'data-table',className:'ss-personal-table',columns,data:pageRows,searchable:false,sortable:false,exportable:false,selectable:false,reorderableColumns:false,manualPagination:true,page,pageSize,pageSizeOptions:[pageSize],rowCount:rows.length,onPageChange:value=>setPersonalSectionPages(current=>({...current,[pageKey]:value}))}}/>;
  }
  function renderPersonalToday(){
    if(personalWorkspace.loading)return <ForgeLoading label="读取个人服务工单"/>;
    if(!personalWorkspace.complete||personalWorkspace.unavailable)return <ForgeNotice tone="error">{personalWorkspace.error||'个人服务工单暂不可用，请重试。'}<button type="button" className="fp-button small" onClick={()=>setPersonalRevision(value=>value+1)}>重试</button></ForgeNotice>;
    const projection=servicePersonalTodayProjection(personalWorkspace.rows,personalWorkspace.businessDate,personalWorkspace.businessTimezone);
    if(!projection)return <ForgeNotice tone="error">个人工单统计暂不可用，请重试。</ForgeNotice>;
    const statusUnavailable=projection.statusDataAvailable===false,planUnavailable=projection.unclearScheduledRows?.length>0;
    const summaryValue=id=>projection.summary.find(item=>item.id===id)?.value??'—';
    return <div className="ss-personal-panel"><DocumentWorkspace className="ss-personal-workspace" sidebarLabel="个人业务与快捷入口" main={<div className="ss-personal-main">
      <DocumentSection variant="plain" icon="Clock" title={'今日行程'+(projection.dateAvailable?'（'+projection.today.slice(5)+'）':'')} count={summaryValue('today-plan')} description="按计划日期，包含已完工排期">
        {projection.dateAvailable?renderPersonalRows(projection.todayRows,'今日计划工单','today',{emptyTitle:'今天没有已排期的上门',emptyDescription:'可在「我的工单」查看在办工单',unavailable:statusUnavailable||planUnavailable}):<ForgeNotice tone="warning">组织业务日期不可用，无法确定今日排程。</ForgeNotice>}
      </DocumentSection>
      <DocumentSection variant="plain" icon="CalendarClock" title={'明日预告'+(projection.dateAvailable?'（'+projection.tomorrow.slice(5)+'）':'')} count={statusUnavailable||planUnavailable?'—':projection.tomorrowRows.length}>
        {projection.dateAvailable?renderPersonalRows(projection.tomorrowRows,'明日预告工单','tomorrow',{emptyTitle:'明天暂无排期',unavailable:statusUnavailable||planUnavailable}):<ForgeNotice tone="warning">组织业务日期不可用，无法确定明日排程。</ForgeNotice>}
      </DocumentSection>
      <DocumentSection variant="plain" icon="Zap" title="急单聚焦" count={statusUnavailable?'—':projection.urgentRows.length} description="当前紧急在办工单">
        {renderPersonalRows(projection.urgentRows,'紧急在办工单','urgent',{emptyTitle:'暂无紧急在办工单',unavailable:statusUnavailable})}
      </DocumentSection>
      <DocumentSection variant="plain" icon="CalendarClock" title="在办未排期" count={statusUnavailable?'—':projection.unplannedRows.length} description="在办工单尚未填写计划日期">
        {renderPersonalRows(projection.unplannedRows,'未排期工单','unplanned',{emptyTitle:'在办工单均已填写计划日期',unavailable:statusUnavailable||projection.unclearDateRows.length>0})}
      </DocumentSection>
      {personalWorkspace.dateError&&<ForgeNotice tone="warning">{personalWorkspace.dateError}<button type="button" className="fp-button small" onClick={()=>setPersonalRevision(value=>value+1)}>重试读取日期</button></ForgeNotice>}
      {projection.unknownStatusRows?.length>0&&<ForgeNotice tone="warning">有 {projection.unknownStatusRows.length} 条工单的状态无法识别，分区可能不完整。</ForgeNotice>}
      {projection.unclearScheduledRows?.length>0&&<ForgeNotice tone="warning">有 {projection.unclearScheduledRows.length} 条计划工单的日期无法识别，未计入日期排程。</ForgeNotice>}
    </div>} sidebar={<div className="ss-personal-sidebar">
      {renderPersonalSidebar(projection)}
      <DocumentSection variant="plain" className="ss-personal-quick-card" icon="Sparkles" title="快捷入口"><div className="ss-personal-quick-links">
        <button type="button" className="fp-button" onClick={()=>changePersonalScope('my-orders')}><Icon icon="briefcase" size={12}/>我的工单</button>
        {access.canManage&&<a className="fp-button" href={forgePageHref('page_service_order_create')}><Icon icon="plus" size={12}/>新建服务工单</a>}
      </div></DocumentSection>
    </div>}/></div>;
  }
  function renderPersonalSidebar(projection){
    const key=access.userId+'-'+personalRevision+'-'+revision,current=personalSidebar.key===key;
    const metric=kind=>current?personalSidebar[kind]:{loading:true,available:false,value:null,description:'读取中…',error:''};
    const parts=metric('parts'),quotations=metric('quotations'),pending=projection.summary.find(item=>item.id==='pending-receive');
    const items=[
      {id:'my-orders',label:'待接单',icon:'Briefcase',value:pending?.value??'—',description:projection.statusDataAvailable===false?'工单状态不可用':pending?.value===0?'没有待接的派工':'指派给本人待接单',actionLabel:'查看明细'},
      {id:'parts',label:'我的备件申请',icon:'Package',value:parts.available?parts.value:'—',description:parts.description,actionLabel:'查看明细'},
      {id:'my-quotations',label:'我的待处理报价',icon:'Wallet',value:quotations.available?quotations.value:'—',description:quotations.description,actionLabel:'查看明细',disabled:!access.canManage},
    ];
    return <><ListSummary variant="compact" className="ss-personal-sidebar-cards" aria-label="个人业务摘要" items={items} onItemActivate={changePersonalScope}/>{(parts.error||quotations.error)&&<ForgeNotice tone="error">{parts.error||quotations.error}<button type="button" className="fp-button small" onClick={refreshPersonalDocuments}>重试</button></ForgeNotice>}</>;
  }
  function renderPersonalOrders(){
    const dateRange=servicePersonalDateRange(personalWorkspace.businessDate,personalOrderFilters.datePreset,personalOrderFilters.from,personalOrderFilters.to);
    if(!access.userId)return <ForgeNotice tone="error">当前账号标识不可用，无法按工程师账号筛选工单。</ForgeNotice>;
    const personalView={...listView,userActions:{...listView.userActions,refresh:false}};
    return <section className="ss-personal-list" aria-label="我的工单列表">
      {renderPersonalOrderFilters()}
      {dateRange.valid?<div className="ss-content">{listComponent(personalView,listFilters(),row=>openDetail(row,'forge_service_order'),'',value=>updatePersonalOrderFilter('search',value),personalListReset,false)}</div>:null}
    </section>;
  }
  function renderPersonalMetrics(kind){
    const expectedKey=scope+'-'+personalRevision;
    if(personalMetrics.key!==expectedKey||personalMetrics.loading)return <ForgeLoading label="读取个人统计"/>;
    if(!personalMetrics.available)return personalMetrics.error?<ForgeNotice tone="error">{personalMetrics.error}</ForgeNotice>:null;
    const saved=personalDocumentState[scope]||{};
    const selected=saved.selections&&saved.selections.status||[];
    const selectedItemId=selected.length===0?'all':selected.length===1?String(selected[0]):undefined;
    function selectMetric(id){
      const selectable=personalMetrics.items.find(item=>item.id===id&&!item.disabled);
      if(!selectable)return;
      setPersonalDocumentState(current=>({...current,[scope]:{...current[scope],selections:{...current[scope]?.selections,status:id==='all'?[]:[id]}}}));
      setPersonalListReset(value=>value+1);
    }
    return <div className={'ss-personal-document-metrics '+(kind==='quotations'?'six':'four')}><ListSummary aria-label={kind==='quotations'?'个人报价统计':'个人备件统计'} items={personalMetrics.items.map(item=>({...item,value:item.value===null?'—':item.id==='valid_amount'?'¥'+Number(item.value).toLocaleString('zh-CN'):item.value}))} selectedItemId={selectedItemId} onItemSelect={selectMetric}/></div>;
  }
  function refreshPersonalDocuments(){
    setPersonalWorkspace(current=>({...current,loading:true,complete:false,unavailable:false,error:'',rows:[]}));
    setPersonalRevision(value=>value+1);
  }
  function changePersonalScope(next){
    if(next===scope)return;
    if(['today','my-quotations','my-settlements','parts','performance'].includes(next)){refreshPersonalDocuments();if(next==='performance'){setPerformancePage(1);setPerformanceCustomers({loading:true,available:false,names:{},error:'',missingCount:0})}}
    setScope(next);
  }
  function renderPersonalDocuments(){
    if(!access.canManage)return <ForgeNotice tone="error">当前账号无权读取服务报价与结算单。</ForgeNotice>;
    const quotation=scope==='my-quotations';
    const label=quotation?'我的报价单':'我的结算单';
    const view=quotation?serviceViews.quotations.list:serviceViews.settlements.list;
    const objectName=quotation?'forge_service_quotation':'forge_service_settlement';
    const personalScope=servicePersonalRelatedListScope(access.userId,personalWorkspace);
    const saved=personalDocumentState[scope]||{};
    function rememberPersonalList(patch){setPersonalDocumentState(current=>({...current,[scope]:{...current[scope],...patch}}))}
    const personalView={...view,sort:saved.sort||view.sort,userActions:{...view.userActions,refresh:false}};
    const restored={initialFilters:saved.filters,userFilterSelections:saved.selections,onFilterChange:filters=>rememberPersonalList({filters}),onSortChange:sort=>rememberPersonalList({sort}),onUserFilterSelectionsChange:selections=>rememberPersonalList({selections})};
    return <section className="ss-personal-list" aria-label={label}>{quotation&&renderPersonalMetrics('quotations')}{personalScope.status==='loading'?<ForgeLoading label="读取当前负责工单"/>:personalScope.status!=='ready'?<ForgeNotice tone="error">{personalScope.error}<button type="button" className="fp-button small" onClick={refreshPersonalDocuments}>重试</button></ForgeNotice>:<div className="ss-content">{listComponent(personalView,personalScope.filter,row=>openDetail(row,objectName),saved.search||'',search=>rememberPersonalList({search}),scope+'-'+personalRevision+'-'+personalListReset,true,{title:quotation?'暂无本人工单报价':'暂无本人工单结算',message:'当前负责工单在此范围内没有对应单据。'},restored)}</div>}</section>;
  }
  function renderPersonalPerformance(){
    if(personalWorkspace.loading)return <ForgeLoading label="读取个人业绩"/>;
    if(!personalWorkspace.complete||personalWorkspace.unavailable)return <ForgeNotice tone="error">{personalWorkspace.error||'个人工单读取不完整，业绩暂不可用。'}<button type="button" className="fp-button small" onClick={refreshPersonalDocuments}>重试</button></ForgeNotice>;
    const projection=servicePersonalPerformanceProjection(personalWorkspace.rows,access.userId,performanceCustomers.names,performanceCustomers.available);
    const rows=projection.rows||[],pageSize=20,pageCount=Math.max(1,Math.ceil(rows.length/pageSize)),page=Math.min(performancePage,pageCount);
    const namedCustomer=row=>performanceCustomers.names[servicePersonalReferenceId(row.customer_id)]||'客户名称不可用';
    const columns=[
      {accessorKey:'code',header:'工单号',width:160,cell:(value,row)=><button type="button" className="fp-link-button" onClick={()=>openDetail(row,'forge_service_order')}>{value||row.name||'查看工单'}</button>},
      {accessorKey:'name',header:'工单标题',width:220,cell:value=>value||'—'},
      {accessorKey:'customer_id',header:'客户',width:180,cell:(_value,row)=>namedCustomer(row)},
      {accessorKey:'service_type',header:'服务类型',width:140,cell:value=>value||'未填写'},
      {accessorKey:'completed_at',header:'完工时间（UTC）',width:190,cell:value=>{if(!value)return '未填写';const raw=String(value),instant=/^\\d{4}-\\d{2}-\\d{2}T.*(?:Z|[+-]\\d{2}:\\d{2})$/.test(raw)?new Date(raw):null;return !instant||Number.isNaN(instant.getTime())?'时间不可用':instant.toISOString().replace('T',' ').slice(0,19)}},
      {accessorKey:'service_hours',header:'填报服务耗时（小时）',width:150,cell:value=>value===null||value===undefined||value===''?'未填写':Number.isFinite(Number(value))&&Number(value)>=0?Number(value):'耗时不可用'},
    ];
    return <div className="ss-performance" aria-label="个人业绩">
      {projection.error&&<ForgeNotice tone="warning">{projection.error}</ForgeNotice>}
      <ListSummary className="ss-performance-summary" aria-label="本人累计业绩" items={projection.summary.map(item=>({...item,value:item.value===null?'—':item.value}))}/>
      <DocumentSection title="客户服务次数排行" className="ss-performance-section"><p className="ss-performance-caption">历史全部已完工工单，不限区间</p>{performanceCustomers.loading?<ForgeLoading label="读取客户名称"/>:projection.customerRanking.available?<CategoryDistribution className="ss-performance-ranking" aria-label="客户服务次数排行" items={projection.customerRanking.items} showRank truncateLabels valueFormatter={value=>value+' 单'} emptyText="还没有已完工的客户服务记录" invalidText="客户服务排行暂不可用"/>:<ForgeNotice tone="error">{performanceCustomers.error||projection.customerRanking.error||'客户服务排行暂不可用。'}</ForgeNotice>}</DocumentSection>
      <DocumentSection title="已完工工单明细" className="ss-performance-section"><p className="ss-performance-caption">本人当前负责的历史已完工工单</p>{projection.available?<RecordTable emptyStateContent={<div className="ss-warranty-empty" role="status">暂无本人已完工工单</div>} schema={{type:'data-table',className:'ss-performance-table',columns,data:rows.slice((page-1)*pageSize,page*pageSize),searchable:false,sortable:false,exportable:false,selectable:false,reorderableColumns:false,manualPagination:true,page,pageSize,pageSizeOptions:[pageSize],rowCount:rows.length,onPageChange:setPerformancePage}}/>:<p className="ss-performance-unavailable">完工工单明细暂不可用</p>}</DocumentSection>
    </div>;
  }
  function changeWarrantyTab(next){
    if(next==='overview'&&warrantyTab!=='overview')setWarrantyOverview(current=>({...current,loading:true,complete:false,rows:[],error:''}));
    setWarrantyTab(next);
  }
  function openWarrantyStatus(status){
    if(!['active','pending_activation','grace_period','expired','terminated'].includes(status))return;
    setWarrantyCardSelections({status:[status]});setWarrantyCardEntry(value=>value+1);setWarrantyTab('cards');
  }
  function renderWarrantyCards(){
    return listComponent(serviceViews.warranty.list,undefined,row=>openDetail(row,'forge_warranty_card'),'',undefined,'warranty-cards-'+warrantyCardEntry+'-'+revision,true,undefined,{userFilterSelections:warrantyCardSelections,onUserFilterSelectionsChange:setWarrantyCardSelections});
  }
  function renderWarrantyOverview(){
    if(warrantyOverview.loading)return <ForgeLoading label="读取质保概览"/>;
    if(!warrantyOverview.complete)return <ForgeNotice tone="error">{warrantyOverview.error||'质保卡读取不完整，概览暂不可用。'}<button type="button" className="fp-button small" onClick={()=>setWarrantyRevision(value=>value+1)}>重试</button></ForgeNotice>;
    const projection=serviceWarrantyOverviewProjection(warrantyOverview.rows,warrantyOverview.businessDate);
    const notes={active:'已生效的质保卡',pending_activation:'待办理激活',grace_period:'处于宽限期',expired:'已过保的质保卡',terminated:'已终止的质保卡'};
    const summary=projection.summary.map(item=>({...item,value:<><span className="ss-warranty-value">{item.value===null?'—':item.value}</span><small className="ss-warranty-description">{notes[item.id]}</small></>,disabled:item.value===null}));
    return <div className="ss-warranty-overview" aria-label="质保概览">
      {projection.error&&<ForgeNotice tone="warning">{projection.error}</ForgeNotice>}
      <ListSummary className="ss-warranty-summary" aria-label="质保状态统计" items={summary} onItemSelect={openWarrantyStatus}/>
      <ListSummary className="ss-warranty-windows" aria-label="质保到期预警" items={projection.expiry.windows.map(item=>({...item,value:item.value===null?'—':item.value}))}/>
      <ForgeNotice tone="info">{warrantyOverview.dateError||projection.expiry.error}</ForgeNotice>
      <div className="ss-warranty-distributions">{[['source','按来源单据'],['scope','按判定粒度'],['responsible','按责任方']].map(([key,title])=><DocumentSection key={key} title={title} className="ss-warranty-distribution"><CategoryDistribution aria-label={title} items={projection.distributions[key]} minPercent={6} emptyText="暂无数据" invalidText="分类统计暂不可用"/></DocumentSection>)}</div>
      <div className="ss-warranty-lists">
        <DocumentSection title="到期日期台账" className="ss-warranty-records">{!projection.expiry.rowsAvailable?<div className="ss-warranty-empty">到期日期暂不可用</div>:!projection.expiry.rows.length?<div className="ss-warranty-empty">暂无质保卡到期记录</div>:<><ul className="ss-warranty-dates">{projection.expiry.rows.map(row=><li key={row.id}><button type="button" className="ss-warranty-date-row" onClick={()=>openDetail(row,'forge_warranty_card')}><strong>{row.code||row.name||'质保卡'}</strong><span>{row.name||row.product_sn||'质保卡'}</span><time dateTime={row.ends_on}>{row.ends_on}</time></button></li>)}</ul>{projection.expiry.total>projection.expiry.rows.length&&<p className="ss-readonly-note">共 {projection.expiry.total} 张，按已记录到期日期显示前 {projection.expiry.rows.length} 张</p>}</>}</DocumentSection>
        <DocumentSection title="高频返修产品" className="ss-warranty-records"><div className="ss-warranty-empty">返修统计暂不可用</div></DocumentSection>
      </div>
    </div>;
  }
  function renderWorkspaceBody(){
    if(servicePage.mode==='analysis')return renderAnalysis();
    if(servicePage.mode==='workspace'&&scope==='today')return renderPersonalToday();
    if(servicePage.mode==='workspace'&&scope==='my-orders')return renderPersonalOrders();
    if(servicePage.mode==='warranty'&&warrantyTab==='overview')return renderWarrantyOverview();
    if(servicePage.mode==='warranty'&&warrantyTab==='rules'){
      if(!access.canManage)return <ForgeNotice tone="error">当前岗位无权读取服务配置项中的质保规则。</ForgeNotice>;
      const rulesView=serviceViews.configuration.list;
      return listComponent(rulesView,['category','=',warrantyRulesCategory],row=>openDetail(row,'forge_service_config_item'));
    }
    if(servicePage.mode==='configuration'&&!access.canManage)return <ForgeNotice tone="error">{access.managerError||'当前账号无权访问服务配置'}</ForgeNotice>;
    if(servicePage.mode==='configuration')return listComponent(serviceViews.configuration.list,listFilters(),row=>openDetail(row,'forge_service_config_item'));
    if(servicePage.mode==='workspace'&&['my-quotations','my-settlements'].includes(scope))return renderPersonalDocuments();
    if(servicePage.mode==='workspace'&&scope==='parts'){
      if(!access.userId)return <ForgeNotice tone="error">当前账号标识不可用，无法读取本人备件申请。</ForgeNotice>;
      const saved=personalDocumentState[scope]||{};
      function rememberPartList(patch){setPersonalDocumentState(current=>({...current,[scope]:{...current[scope],...patch}}))}
      const partView={...serviceViews.parts.list,sort:saved.sort||serviceViews.parts.list.sort,pagination:{...serviceViews.parts.list.pagination,pageSize:10,pageSizeOptions:[10,20,50,100]}};
      const restored={initialFilters:saved.filters,userFilterSelections:saved.selections,onFilterChange:filters=>rememberPartList({filters}),onSortChange:sort=>rememberPartList({sort}),onUserFilterSelectionsChange:selections=>rememberPartList({selections})};
      return <section className="ss-personal-list" aria-label="我的备件申请">{renderPersonalMetrics('parts')}<div className="ss-content">{listComponent(partView,listFilters(),row=>openDetail(row,'forge_service_part_request'),saved.search||'',search=>rememberPartList({search}),scope+'-'+personalRevision+'-'+personalListReset,true,{title:'暂无本人备件申请',message:'当前范围内没有符合条件的申请。'},restored)}</div></section>;
    }
    if(servicePage.mode==='workspace'&&scope==='performance')return renderPersonalPerformance();
    if(servicePage.mode==='warranty'&&warrantyTab==='cards')return renderWarrantyCards();
    if(servicePage.mode==='warranty')return listComponent(serviceViews.warranty.list,undefined,row=>openDetail(row,'forge_warranty_card'));
    return listComponent(serviceViews[servicePage.viewKey].list,listFilters(),row=>openDetail(row,formObject));
  }
  function dispatchDistinctOptions(rows,field,firstLabel){
    const values=[...new Set(rows.map(row=>String(row[field]||'').trim()).filter(Boolean))].sort((left,right)=>left.localeCompare(right));
    return [{value:'',label:firstLabel},...values.map(value=>({value,label:value}))];
  }
  function changeDispatchFilter(field,value){setDispatchFilters(current=>({...current,[field]:value}));setDispatchTablePages({resources:1,orders:1,issues:1,sla:1})}
  function resetDispatchFilters(){setDispatchFilters({search:'',region:'',serviceType:'',urgency:'',engineerId:''});setDispatchTablePages({resources:1,orders:1,issues:1,sla:1})}
  function dispatchRange(){return serviceDispatchRange(dispatchAnchor,dispatchPeriod)}
  function moveDispatchRange(offset){const range=dispatchRange();if(range.start)setDispatchAnchor(serviceDispatchAddDays(range.start,dispatchPeriod*offset));setDispatchTablePages({resources:1,orders:1,issues:1,sla:1})}
  function currentDispatchRows(){return serviceDispatchFilterRows(dispatchPanel.rows||[],dispatchFilters)}
  function renderDispatchFilters(rows){
    const engineers=serviceDispatchEngineerOptions(rows).map(person=>({value:person.value,label:person.label}));
    return <WorkspaceToolbar className="ss-dispatch-toolbar" aria-label="派工筛选" search={<div className="ss-dispatch-search"><Icon icon="search" size={14}/><input className="fp-input" aria-label="搜索派工工单" placeholder="工单号 / 标题 / 服务对象 / 联系方式" value={dispatchFilters.search} onChange={event=>changeDispatchFilter('search',event.target.value)}/></div>} filters={<div className="ss-dispatch-filter-controls"><ForgeSelect className="ss-dispatch-filter" label="地区" value={dispatchFilters.region} options={dispatchDistinctOptions(rows,'region','全部地区')} onChange={value=>changeDispatchFilter('region',value)}/><ForgeSelect className="ss-dispatch-filter" label="服务类型" value={dispatchFilters.serviceType} options={dispatchDistinctOptions(rows,'service_type','全部类型')} onChange={value=>changeDispatchFilter('serviceType',value)}/><ForgeSelect className="ss-dispatch-filter" label="紧急度" value={dispatchFilters.urgency} options={[{value:'',label:'全部紧急度'},...serviceUrgencyOptions]} onChange={value=>changeDispatchFilter('urgency',value)}/><ForgeSelect className="ss-dispatch-filter" label="服务工程师" value={dispatchFilters.engineerId} options={[{value:'',label:'全部工程师'},...engineers]} onChange={value=>changeDispatchFilter('engineerId',value)}/></div>} auxiliaryActions={<button type="button" className="fp-button small ss-dispatch-reset" onClick={resetDispatchFilters}>重置筛选</button>}/>;
  }
  function renderDispatchPeriod(){
    const range=dispatchRange();
    return <div className="ss-dispatch-period"><StatusTabs className="ss-dispatch-period-tabs" aria-label="派工周期" value={String(dispatchPeriod)} onValueChange={value=>{setDispatchPeriod(Number(value));setDispatchTablePages({resources:1,orders:1,issues:1,sla:1})}} items={[{value:'7',label:'周'},{value:'14',label:'双周'},{value:'28',label:'四周'}]}/><div className="ss-dispatch-period-nav"><button type="button" className="fp-button small" onClick={()=>moveDispatchRange(-1)}>上一段</button><button type="button" className="fp-button small" onClick={()=>{setDispatchAnchor(today);setDispatchTablePages({resources:1,orders:1,issues:1,sla:1})}}>回到本周</button><button type="button" className="fp-button small" onClick={()=>moveDispatchRange(1)}>下一段</button><span className="ss-dispatch-period-range">{range.start} 至 {range.end}</span></div></div>;
  }
  function renderDispatchReadState(view,label){
    if(dispatchPanel.view!==view||dispatchPanel.loading)return <ForgeLoading label={'读取'+label}/>;
    if(dispatchPanel.unavailable)return <ForgeNotice tone="error">{dispatchPanel.error}<button type="button" className="fp-button small" onClick={()=>loadDispatchPanel(view)}>重试</button></ForgeNotice>;
    return null;
  }
  function renderDispatchReadWarning(){return !dispatchPanel.complete&&dispatchPanel.error?<ForgeNotice tone="warning" className="ss-dispatch-incomplete">{dispatchPanel.error}已读取 {dispatchPanel.rows.length} 条工单。</ForgeNotice>:null}
  function renderDispatchSummary(summary,kind){
    const partial=!dispatchPanel.complete;
    const items=kind==='sla'?
      [{id:'due',label:partial?'已读取到期台账':'到期台账记录',value:summary.rows.length}]:
      [{id:'scheduled',label:partial?'已读取在办排程数':'在办排程数',value:summary.scheduledCount},{id:'urgent',label:partial?'已读取紧急排程':'紧急排程',value:summary.urgentScheduledCount},{id:'unplanned',label:partial?'已读取未排期工单':'未排期工单',value:summary.unplannedCount},{id:'unknown',label:partial?'已读取日期异常':'计划日期异常',value:summary.unknownDateCount}];
    return <ListSummary className="ss-dispatch-summary" aria-label={kind==='sla'?'到期日期记录统计':'派工周期统计'} items={items}/>;
  }
  function renderDispatchRecordTable(rows,periodField,pageKey='orders',withIssueLabels=false){
    const pageSize=20,pageCount=Math.max(1,Math.ceil(rows.length/pageSize)),page=Math.min(dispatchTablePages[pageKey]||1,pageCount),pageRows=rows.slice((page-1)*pageSize,page*pageSize);
    const dateLabel=periodField==='sla_due_at'?'SLA 到期日':'计划日期';
    const dateCell=value=>{const raw=String(value??'').trim();return raw?serviceDispatchDateKey(raw)||'日期未识别':periodField==='sla_due_at'?'未配置':'未排期'};
    const columns=[
      {accessorKey:'code',header:'工单号',width:150,sortable:false,cell:(_value,row)=><button type="button" className="fp-link-button" onClick={()=>openDetail(row,'forge_service_order')}>{row.code||row.name||'服务工单'}</button>},
      {accessorKey:'name',header:'工单标题',width:190,cell:value=>value||'—'},
      {accessorKey:'region',header:'地区',width:110,cell:value=>value||'—'},
      {accessorKey:'service_type',header:'服务类型',width:120,cell:value=>value||'—'},
      {accessorKey:'urgency',header:'紧急度',width:90,cell:value=>serviceUrgencyOptions.find(option=>option.value===value)?.label||'—'},
      {accessorKey:'engineer_name',header:'服务工程师',width:135,cell:value=>value||'姓名不可用'},
      {accessorKey:'status',header:'工单状态',width:100,cell:value=>statusLabel[value]||'状态不可用'},
      ...(withIssueLabels?[{accessorKey:'issueLabels',header:'排程信息',width:155,cell:value=>Array.isArray(value)?value.join('、'):'—'}]:[]),
      {accessorKey:periodField,header:dateLabel,width:125,cell:dateCell},
      {accessorKey:'next_step',header:'下一步',width:160,cell:value=>value||'—'},
    ];
    return <RecordTable schema={{type:'data-table',className:'ss-dispatch-table',data:pageRows,columns,searchable:false,sortable:false,exportable:false,selectable:false,reorderableColumns:false,manualPagination:true,page,pageSize,pageSizeOptions:[20],rowCount:rows.length,onPageChange:value=>setDispatchTablePages(current=>({...current,[pageKey]:value}))}}/>;
  }
  function renderDispatchScheduleIssues(summary){
    const issues=new Map();
    const add=(rows,label)=>{for(const row of rows){const id=serviceDispatchReferenceId(row.id);if(!id)continue;const current=issues.get(id)||{...row,issueLabels:[]};if(!current.issueLabels.includes(label))current.issueLabels.push(label);issues.set(id,current)}};
    add(summary.unplannedRows,'未排期');add(summary.unknownDateRows,'日期未识别');add(summary.unassignedRows,'未关联工程师账号');add(summary.unidentifiedNameRows,'工程师姓名不可用');
    const rows=[...issues.values()];
    return rows.length?<section className="ss-dispatch-panel ss-dispatch-subtables"><h2>排程信息待核对 · {rows.length}</h2>{renderDispatchRecordTable(rows,'scheduled_at','issues',true)}</section>:null;
  }
  function renderDispatchCalendar(){
    const state=renderDispatchReadState('calendar','派工日历');
    if(state)return <div className="ss-dispatch-panel">{state}</div>;
    const rows=currentDispatchRows(),range=dispatchRange(),summary=serviceDispatchLoadSummary(rows,range.start,range.end);
    return <div className="ss-dispatch-panel">{renderDispatchReadWarning()}{renderDispatchSummary(summary,'calendar')}{renderDispatchPeriod()}{renderDispatchFilters(dispatchPanel.rows)}{summary.unassignedCount>0&&<ForgeNotice tone="warning">有 {summary.unassignedCount} 条在办工单未记录工程师账号，未计入人员资源行。</ForgeNotice>}{summary.unidentifiedNameCount>0&&<ForgeNotice tone="warning">有 {summary.unidentifiedNameCount} 条在办工单的工程师姓名不可用，已按已记录账号保留资源行。</ForgeNotice>}<ResourceScheduleGrid className="ss-dispatch-grid" aria-label="派工日历" resourceHeaderLabel="工程师 / 日期" resources={summary.resources} dateColumns={serviceDispatchDateColumns(range.start,dispatchPeriod,today)} events={summary.events} onEventClick={event=>{const id=serviceDispatchReferenceId(event&&event.id),record=dispatchPanel.rows.find(row=>serviceDispatchReferenceId(row.id)===id);if(record)openDetail(record,'forge_service_order')}} emptyLabel="暂无已指派工单"/>{renderDispatchScheduleIssues(summary)}</div>;
  }
  function renderDispatchLoad(){
    const state=renderDispatchReadState('resource-load','资源负载');
    if(state)return <div className="ss-dispatch-panel">{state}</div>;
    const rows=currentDispatchRows(),range=dispatchRange(),summary=serviceDispatchLoadSummary(rows,range.start,range.end);
    const resourcePageSize=20,resourcePageCount=Math.max(1,Math.ceil(summary.loads.length/resourcePageSize)),resourcePage=Math.min(dispatchTablePages.resources||1,resourcePageCount),loadRows=summary.loads.slice((resourcePage-1)*resourcePageSize,resourcePage*resourcePageSize);
    const loadColumns=[
      {accessorKey:'label',header:'服务工程师',width:170,sortable:false,cell:(value,row)=><button type="button" className="fp-link-button" onClick={()=>changeDispatchFilter('engineerId',row.id)}>{value||'姓名不可用'}</button>},
      {accessorKey:'activeCount',header:'在办工单',width:105},
      {accessorKey:'scheduledCount',header:'周期排程',width:105},
      {accessorKey:'urgentCount',header:'紧急排程',width:105},
      {accessorKey:'unplannedCount',header:'未排期',width:105},
    ];
    const selectedEngineerRows=dispatchFilters.engineerId?rows.filter(row=>serviceDispatchReferenceId(row.engineer_id)===dispatchFilters.engineerId):[];
    return <div className="ss-dispatch-panel">{renderDispatchReadWarning()}{renderDispatchSummary(summary,'resource')}{renderDispatchPeriod()}{renderDispatchFilters(dispatchPanel.rows)}{summary.unassignedCount>0&&<ForgeNotice tone="warning">有 {summary.unassignedCount} 条在办工单未记录工程师账号，未计入人员资源行。</ForgeNotice>}{summary.unidentifiedNameCount>0&&<ForgeNotice tone="warning">有 {summary.unidentifiedNameCount} 条在办工单的工程师姓名不可用，仍按已记录账号显示资源行。</ForgeNotice>}{<><section className="ss-dispatch-panel"><h2>按已指派工单归属统计</h2><RecordTable schema={{type:'data-table',className:'ss-dispatch-table',data:loadRows,columns:loadColumns,searchable:false,sortable:false,exportable:false,selectable:false,reorderableColumns:false,manualPagination:true,page:resourcePage,pageSize:resourcePageSize,pageSizeOptions:[resourcePageSize],rowCount:summary.loads.length,onPageChange:value=>setDispatchTablePages(current=>({...current,resources:value}))}}/></section>{dispatchFilters.engineerId&&<section className="ss-dispatch-panel"><h2>当前工程师在办工单 · {selectedEngineerRows.length}</h2>{selectedEngineerRows.length?renderDispatchRecordTable(selectedEngineerRows,'scheduled_at','orders'):null}</section>}</>}{renderDispatchScheduleIssues(summary)}</div>;
  }
  function renderDispatchSla(){
    const state=renderDispatchReadState('sla','SLA 到期日期');
    if(state)return <div className="ss-dispatch-panel">{state}</div>;
    const rows=currentDispatchRows(),range=dispatchRange(),due=serviceDispatchSlaRows(rows,range.start,range.end),visible=[...due.rows,...due.unknownRows];
    return <div className="ss-dispatch-panel">{renderDispatchFilters(dispatchPanel.rows)}{renderDispatchPeriod()}{renderDispatchReadWarning()}<ForgeNotice tone="info">此处只列出现有工单填写的 SLA 到期日期；未配置到期日期或规则时不作风险判定。</ForgeNotice>{renderDispatchSummary({rows:visible},'sla')}{due.unknownDateCount>0&&<ForgeNotice tone="warning">有 {due.unknownDateCount} 条到期日期无法识别，仍保留在到期台账中。</ForgeNotice>}{renderDispatchRecordTable(visible,'sla_due_at','sla')}</div>;
  }
  function renderDispatchContent(){
    if(scope==='pending_dispatch'){const view={...serviceViews.orders.list,userActions:{...serviceViews.orders.list.userActions,refresh:false}};return <section className="ss-content" aria-label="待分派服务工单列表">{listComponent(view,listFilters(),row=>openDetail(row,'forge_service_order'))}</section>}
    if(scope==='calendar')return renderDispatchCalendar();
    if(scope==='resource')return renderDispatchLoad();
    if(scope==='sla')return renderDispatchSla();
    return <ForgeNotice tone="error">派工视图不可用，请重新选择。</ForgeNotice>;
  }
  function renderScope(){
    let options=[];
    if(servicePage.mode==='orders')options=[['all','全部工单'],['pending_acceptance','待受理'],['pending_dispatch','待分派'],['pending_receive','待接单'],['in_progress','服务中'],['completed','已完工']];
    if(servicePage.mode==='workspace')options=[['today','今日'],['my-orders','我的工单'],['performance','业绩'],['parts','我的备件'],...(access.canManage?[['my-quotations','我的报价单'],['my-settlements','我的结算单']]:[])];
    if(servicePage.mode==='dispatch')options=[['pending_dispatch','待分派','list'],['calendar','派工日历','calendar'],['resource','资源负载','users'],['sla','SLA 到期','clock']];
    if(servicePage.mode==='configuration')options=[['','全部配置'],...serviceConfigCategories.map(option=>[option.value,option.label])];
    if(servicePage.mode==='warranty')options=[['overview','概览'],['cards','质保卡'],['rules','质保规则']];
    if(!options.length)return null;
    const active=servicePage.mode==='configuration'?configCategory:servicePage.mode==='warranty'?warrantyTab:scope;
    const change=value=>servicePage.mode==='configuration'?setConfigCategory(value):servicePage.mode==='warranty'?changeWarrantyTab(value):servicePage.mode==='workspace'?changePersonalScope(value):setScope(value);
    return <StatusTabs className={'ss-scope'+(servicePage.mode==='dispatch'?' ss-dispatch-tabs':'')} aria-label={servicePage.mode==='configuration'?'服务配置分类':servicePage.mode==='warranty'?'质保管理视图':servicePage.mode==='workspace'?'接单中心工作范围':servicePage.mode==='dispatch'?'派工中心视图':'工单状态'} panelId={servicePage.name+'-panel'} value={active} onValueChange={change} items={options.map(([value,label,icon])=>({value,label,...(icon?{icon}: {})}))}/>;
  }
  function actionButtons(){
    if(!selected)return null;
    if(selected.loading)return null;
    const actions=servicePageActions(selected.record,selected.objectName);
    if(!actions.length)return <p className="ss-readonly-note">当前状态没有可办理的操作。</p>;
    return <div className="ss-detail-actions">{actions.map(action=><button type="button" key={action.action} className={'fp-button'+(action.kind==='quote-draft-edit'?'':' primary')} disabled={busy} onClick={()=>openAction(action)}>{action.label}</button>)}</div>;
  }
  function renderDialogContent(){
    if(!dialog)return null;
    if(dialog.kind==='create-order')return <><p className="ss-readonly-note">请选择客户和来源销售订单。</p>{typeCatalog.error&&<ForgeNotice tone="error">{typeCatalog.error}</ForgeNotice>}{formComponent('forge_service_order',formFields,formView.sections,formView.columns,[serviceOrderSourceField,{...serviceOrderTypeField,widget:'declared-label-combobox',options:typeCatalog.options,readonly:typeCatalog.loading||!typeCatalog.available,placeholder:typeCatalog.loading?'读取服务场景…':typeCatalog.options.length?'请选择服务场景':'暂无启用的服务场景'}])}</>;
    if(dialog.kind==='config-create'||dialog.kind==='config-edit')return <>{formComponent('forge_service_config_item',['name','code','category','status','description','remarks'],[{name:'configuration',label:'服务配置',columns:2,fields:['name','code','category','status','description','remarks']}],2)}</>;
    if(dialog.kind==='quote-from-order')return <><p className="ss-readonly-note">来源工单：{dialog.record.code||dialog.record.name}</p>{formComponent('forge_service_quotation',['total_amount','valid_until'],[{name:'quotation',label:'报价信息',columns:2,fields:['total_amount','valid_until']}],2)}</>;
    if(dialog.kind==='quote-draft-edit')return <fieldset className="ss-create-fieldset" disabled={busy} aria-busy={busy}>{formComponent('forge_service_quotation',['total_amount','valid_until','remarks'],[{name:'quotation_draft',label:'报价草稿',columns:2,fields:['total_amount','valid_until','remarks']}],2)}</fieldset>;
    if(dialog.kind==='settlement-from-order')return <><p className="ss-readonly-note">来源工单：{dialog.record.code||dialog.record.name}</p>{formComponent('forge_service_settlement',['total_amount'],[{name:'settlement',label:'结算信息',columns:2,fields:['total_amount']}],2)}</>;
    if(dialog.kind==='settlement-from-quote')return <div className="ss-readonly-note">报价单：{dialog.record.code||dialog.record.name} · 将按当前报价金额生成服务结算。</div>;
    if(dialog.kind==='dispatch')return <><p className="ss-readonly-note">工单：{dialog.record.code||dialog.record.name}</p>{dialog.loading?<ForgeLoading label="读取可派服务工程师"/>:<div className="fp-form-grid"><div className="fp-field"><label>服务工程师 *</label><ForgeSelect label="服务工程师" value={dialog.values.engineer_id} options={dialog.engineers.map(engineer=>({value:engineer.id,label:engineer.name}))} onChange={value=>setDialog(current=>({...current,values:{...current.values,engineer_id:value},error:''}))} placeholder="请选择服务工程师" disabled={!dialog.engineers.length}/></div><div className="fp-field"><label>计划日期</label><ForgeDateInput aria-label="计划日期" value={dialog.values.scheduled_at||''} onChange={event=>setDialog(current=>({...current,values:{...current.values,scheduled_at:event.target.value},error:''}))}/></div><div className="fp-field fp-span-2"><label>派工说明 *</label><textarea className="fp-textarea" aria-label="派工说明" value={dialog.values.dispatch_note||''} onChange={event=>setDialog(current=>({...current,values:{...current.values,dispatch_note:event.target.value},error:''}))}/></div></div>}</>;
    if(dialog.kind==='complete')return <><p className="ss-readonly-note">提交完工前需将至少一张现场图片上传并关联到当前服务工单。</p><div className="ss-upload"><label htmlFor="service-onsite-images">现场处理图片</label><input id="service-onsite-images" type="file" accept="image/*" multiple onChange={event=>{const files=Array.from(event.target.files||[]);if(files.some(file=>!String(file.type||'').toLowerCase().startsWith('image/')))return setDialog(current=>({...current,error:'现场处理凭证只接受图片文件'}));setDialog(current=>current?{...current,files,error:''}:current)}}/><p className="ss-upload-files">{(dialog.files||[]).length?(dialog.files||[]).map(file=>file.name).join('、'):'尚未选择新图片；已关联到工单的图片仍可用于提交。'}</p></div>{formComponent('forge_service_order',['service_hours','treatment_record','service_result'],[{name:'result',label:'服务结果',columns:2,fields:['service_hours','treatment_record','service_result']}],2)}</>;
    if(dialog.kind==='warranty-activate')return <><div className="ss-readonly-note">质保卡：{dialog.record.code||dialog.record.name}</div><div className="fp-form-grid"><div className="fp-field"><label>开始日期 *</label><ForgeDateInput aria-label="开始日期" value={dialog.values.starts_on||''} onChange={event=>setDialog(current=>({...current,values:{...current.values,starts_on:event.target.value},error:''}))}/></div><div className="fp-field"><label>到期日期 *</label><ForgeDateInput aria-label="到期日期" value={dialog.values.ends_on||''} onChange={event=>setDialog(current=>({...current,values:{...current.values,ends_on:event.target.value},error:''}))}/></div></div></>;
    if(dialog.kind==='warranty-extend')return <><div className="ss-readonly-note">质保卡：{dialog.record.code||dialog.record.name} · 当前到期日：{dialog.record.ends_on||'未设置'}</div><div className="fp-form-grid"><div className="fp-field"><label>延长至 *</label><ForgeDateInput aria-label="延长至" value={dialog.values.ends_on||''} onChange={event=>setDialog(current=>({...current,values:{...current.values,ends_on:event.target.value},error:''}))}/></div><div className="fp-field fp-span-2"><label>延保说明 *</label><textarea className="fp-textarea" aria-label="延保说明" value={dialog.values.note||''} onChange={event=>setDialog(current=>({...current,values:{...current.values,note:event.target.value},error:''}))}/></div></div></>;
    if(dialog.kind==='receivable')return <><p className="ss-readonly-note">结算单：{dialog.record.code||dialog.record.name}</p><div className="fp-field"><label>应收到期日 *</label><ForgeDateInput aria-label="应收到期日" value={dialog.values.due_on||''} onChange={event=>setDialog(current=>({...current,values:{...current.values,due_on:event.target.value},error:''}))}/></div></>;
    if(dialog.kind==='confirm')return <div className="ss-readonly-note">{dialog.record.code||dialog.record.name} · {dialog.action.message||'请确认当前业务状态并提交。'}</div>;
    if(['pick-quote-order','pick-settlement-source','pick-settlement-quote'].includes(dialog.kind)){
      const useQuotes=dialog.kind==='pick-settlement-quote';
      const view=useQuotes?serviceViews.quotations.list:serviceViews.orders.list;
      const filters=useQuotes?['status','=','confirmed']:['status','=','completed'];
      return <div className="ss-source-picker"><p className="fp-secondary">{useQuotes?'选择一张已确认服务报价。':'选择一张已完工服务工单。'}</p>{dialog.kind==='pick-settlement-source'&&<div className="fp-toolbar"><button type="button" className="fp-button" onClick={openQuoteSettlement}>从已确认报价生成结算</button></div>}<div className="ss-picker-list">{listComponent(view,filters,row=>sourcePicked(dialog.kind,row))}</div></div>;
    }
    return null;
  }
  function dialogTitle(){
    if(!dialog)return '';
    if(dialog.kind==='create-order')return '新建服务工单';
    if(dialog.kind==='config-create')return '新增服务配置';
    if(dialog.kind==='config-edit')return '编辑服务配置';
    if(dialog.kind==='warranty-activate')return '激活质保卡';
    if(dialog.kind==='warranty-extend')return '延长质保';
    if(dialog.kind==='quote-from-order')return '生成服务报价';
    if(dialog.kind==='settlement-from-order'||dialog.kind==='settlement-from-quote')return '生成服务结算';
    if(dialog.kind==='pick-quote-order')return '选择完工工单';
    if(dialog.kind==='pick-settlement-source')return '选择结算来源';
    if(dialog.kind==='pick-settlement-quote')return '选择已确认报价';
    if(dialog.kind==='dispatch')return '派工';
    if(dialog.kind==='complete')return '提交服务结果';
    if(dialog.kind==='receivable')return '生成财务应收';
    return dialog.action&&dialog.action.title||'确认业务操作';
  }
  function dialogConfirmLabel(){
    if(!dialog)return '确认';
    if(dialog.kind==='create-order')return '创建工单';
    if(dialog.kind==='config-create')return '新增配置';
    if(dialog.kind==='config-edit')return '保存配置';
    if(dialog.kind==='warranty-activate')return '激活质保卡';
    if(dialog.kind==='warranty-extend')return '保存延保';
    if(dialog.kind==='quote-from-order')return '生成报价';
    if(dialog.kind==='quote-draft-edit')return '保存草稿';
    if(dialog.kind==='settlement-from-order'||dialog.kind==='settlement-from-quote')return '生成结算';
    if(dialog.kind==='dispatch')return '确认派工';
    if(dialog.kind==='complete')return '提交服务结果';
    if(dialog.kind==='receivable')return '生成应收';
    if(dialog.kind==='confirm')return dialog.action.label;
    return '确认';
  }
  function canSubmitDialog(){
    if(!dialog)return false;
    if(['pick-quote-order','pick-settlement-source','pick-settlement-quote'].includes(dialog.kind))return false;
    if(dialog.kind==='dispatch'&&(dialog.loading||!dialog.engineers.length))return false;
    return true;
  }
  function submitReady(){
    if(!dialog||busy)return;
    if(dialog.kind==='dispatch'){
      if(!dialog.values.engineer_id)return setDialog(current=>({...current,error:'请选择服务工程师'}));
      if(!String(dialog.values.dispatch_note||'').trim())return setDialog(current=>({...current,error:'派工说明不能为空'}));
    }
    if(dialog.kind==='receivable'&&!dialog.values.due_on)return setDialog(current=>({...current,error:'请选择应收到期日'}));
    if(dialog.kind==='warranty-activate'&&(!dialog.values.starts_on||!dialog.values.ends_on))return setDialog(current=>({...current,error:'请填写质保开始日期和到期日期'}));
    if(dialog.kind==='warranty-extend'&&(!dialog.values.ends_on||!String(dialog.values.note||'').trim()))return setDialog(current=>({...current,error:'请填写新的到期日期和延保说明'}));
    commitDialog();
  }
  function renderDetailDialog(){
    if(!selected)return null;
    const selectedView=selected.objectName==='forge_service_order'?serviceViews.orders:selected.objectName==='forge_service_quotation'?serviceViews.quotations:selected.objectName==='forge_service_settlement'?serviceViews.settlements:selected.objectName==='forge_warranty_card'?serviceViews.warranty:selected.objectName==='forge_service_part_request'?serviceViews.parts:serviceViews.configuration;
    const detailFields=selectedView.form.sections.flatMap(section=>(section.fields||[]).map(field=>typeof field==='string'?field:field.field));
    return <CompositeDialog open={true} title={selected.record.name||selected.record.code||'业务记录详情'} description={selected.record.code||''} onOpenChange={open=>{if(!open){detailLoadSession.current+=1;setSelected(null)}}} footer={({requestClose})=><div className="ss-detail-actions"><button type="button" className="fp-button" onClick={requestClose}>关闭</button>{actionButtons()}</div>}>{selected.loading?<ForgeLoading label="读取业务记录"/>:<><ObjectForm objectName={selected.objectName} dataSource={adapter} mode="view" recordId={selected.record.id} formType="simple" columns={2} sections={selectedView.form.sections} fields={detailFields} showSubmit={false} showCancel={false} showReset={false}/>{selected.objectName==='forge_warranty_card'&&<section className="ss-event-history"><h3>质保变更记录</h3>{listComponent(serviceViews.warrantyEvents.list,['warranty_id','=',selected.record.id])}</section>}</>}</CompositeDialog>;
  }
  const workspaceListKey=scope==='my-quotations'?'quotations':scope==='my-settlements'?'settlements':scope==='parts'?'parts':null;
  const activeListKey=servicePage.mode==='workspace'&&workspaceListKey?workspaceListKey:servicePage.viewKey;
  const listView=activeListKey?serviceViews[activeListKey].list:null;
  const activeListObject=listView&&listView.data&&listView.data.object||formObject;
  const managerError='当前账号无权访问此页面';
  if(access.loading)return <div className="forge-product forge-sales-service"><style>{css}</style><ForgeLoading label={'加载'+servicePage.label}/></div>;
  if(access.error)return <div className="forge-product forge-sales-service"><style>{css}</style><main className="fp-shell ss-shell"><ForgeNotice tone="error">{access.error}</ForgeNotice></main></div>;
  if(servicePage.managerOnly&&!access.canManage)return <div className="forge-product forge-sales-service"><style>{css}</style><main className="fp-shell ss-shell"><WorkspaceHeader className="ss-heading" variant="workspace" icon={servicePage.icon} breadcrumbItems={[{label:'销售管理'},{label:'服务管理'},{label:servicePage.label}]} title={servicePage.label} subtitleClassName="ss-subtitle" subtitle={servicePage.mode==='workspace'?undefined:servicePage.description}/><ForgeNotice tone="error">{managerError}</ForgeNotice></main></div>;
  if(servicePage.standaloneCreate)return <div className="forge-product forge-sales-service"><style>{css}</style><main className="fp-shell ss-shell"><WorkspaceHeader className="ss-heading" variant="workspace" icon={servicePage.icon} breadcrumbItems={[{label:'销售管理'},{label:'服务管理'},{label:'新建服务工单'}]} title="新建服务工单" subtitleClassName="ss-subtitle" subtitle={servicePage.mode==='workspace'?undefined:servicePage.description} action={<button type="button" className="fp-button" disabled={busy} onClick={()=>ForgeNavigate('/_console/apps/com.inoforge.forge.sales/page_service_orders')}>取消</button>}/>{access.permissionsError&&<ForgeNotice tone="warning">{access.permissionsError}</ForgeNotice>}{dialog&&dialog.error&&<ForgeNotice tone="error">{dialog.error}</ForgeNotice>}<fieldset className="ss-create-fieldset" disabled={busy} aria-busy={busy}><DocumentWorkspace className="ss-create-workspace" sidebarLabel="工单操作" main={<DocumentSection title="服务工单信息">{typeCatalog.error&&<ForgeNotice tone="error">{typeCatalog.error}</ForgeNotice>}{typeCatalog.available&&!typeCatalog.options.length&&<ForgeNotice tone="info">暂无启用的服务场景。</ForgeNotice>}{formComponent('forge_service_order',formFields,formView.sections,formView.columns,[serviceOrderSourceField,{...serviceOrderTypeField,widget:'declared-label-combobox',options:typeCatalog.options,readonly:typeCatalog.loading||!typeCatalog.available,placeholder:typeCatalog.loading?'读取服务场景…':typeCatalog.options.length?'请选择服务场景':'暂无启用的服务场景'}])}</DocumentSection>} sidebar={<DocumentSection title="工单操作"><div className="ss-create-actions"><button type="button" className="fp-button primary" disabled={busy||!canSubmitDialog()} onClick={submitReady}>{busy?'创建中…':'创建服务工单'}</button></div></DocumentSection>}/></fieldset></main></div>;
  const pageActions=servicePage.mode==='orders'&&access.canManage?<a className="fp-button primary" href={forgePageHref('page_service_order_create')}>新建服务工单</a>:servicePage.mode==='quotations'&&access.canManage?<button type="button" className="fp-button primary" onClick={openCreateQuote}>从完工工单生成报价</button>:servicePage.mode==='settlements'&&access.canManage?<button type="button" className="fp-button primary" onClick={openCreateSettlement}>从完工工单生成结算</button>:servicePage.mode==='configuration'&&access.canManage?<button type="button" className="fp-button primary" onClick={openCreateConfiguration}>新增配置</button>:null;
  const scopeTabs=renderScope();
  const pageNavigation=servicePage.mode==='orders'?<a className="fp-button ss-next-step" href="/_console/apps/com.inoforge.forge.sales/page_service_dispatch"><span>下一步操作</span><strong>派工中心</strong></a>:servicePage.mode==='dispatch'?<a className="fp-button" href="/_console/apps/com.inoforge.forge.sales/page_service_orders">服务工单</a>:null;
  const showToolbar=Boolean(scopeTabs||pageNavigation||pageActions);
  const standaloneListView=['quotations','settlements'].includes(servicePage.mode)?{...listView,userActions:{...listView.userActions,refresh:false}}:listView;
  const standaloneListEmpty=servicePage.mode==='quotations'?{title:'暂无符合条件的服务报价',message:'可从已完工服务工单生成报价。'}:undefined;
  const pageContent=servicePage.mode==='dispatch'?renderDispatchContent():servicePage.mode==='analysis'?renderWorkspaceBody():servicePage.mode==='workspace'&&['today','my-orders','performance','parts','my-quotations','my-settlements'].includes(scope)?renderWorkspaceBody():servicePage.mode==='warranty'&&warrantyTab==='overview'?renderWorkspaceBody():servicePage.mode==='warranty'&&['rules','cards'].includes(warrantyTab)?renderWorkspaceBody():<section className="ss-content" aria-label={servicePage.label+'列表'}>{listComponent(standaloneListView,listFilters(),row=>openDetail(row,activeListObject),undefined,undefined,undefined,true,standaloneListEmpty)}</section>;
  const todayProjection=servicePage.mode==='workspace'&&personalWorkspace.complete&&!personalWorkspace.unavailable?servicePersonalTodayProjection(personalWorkspace.rows,personalWorkspace.businessDate,personalWorkspace.businessTimezone):null;
  const todaySummary=servicePage.mode==='workspace'?(personalWorkspace.loading?<ForgeLoading label="读取个人工单概览"/>:personalWorkspace.complete&&!personalWorkspace.unavailable&&todayProjection?<ListSummary className="ss-personal-summary" aria-label="接单中心今日概览" items={todayProjection.summary}/>:<ForgeNotice tone="error">{personalWorkspace.error||'个人工单概览暂不可用，请重试。'}<button type="button" className="fp-button small" onClick={()=>setPersonalRevision(value=>value+1)}>重试</button></ForgeNotice>):null;
  return <div className="forge-product forge-sales-service"><style>{css}</style><main className="fp-shell ss-shell"><WorkspaceHeader className="ss-heading" variant="workspace" icon={servicePage.icon} breadcrumbItems={[{label:'销售管理'},{label:'服务管理'},{label:servicePage.label}]} title={servicePage.label} subtitleClassName="ss-subtitle" subtitle={servicePage.mode==='workspace'?undefined:servicePage.description}/>{notice&&<ForgeNotice tone={notice.tone} onClose={()=>setNotice(null)}>{notice.text}</ForgeNotice>}{access.permissionsError&&<ForgeNotice tone="warning">{access.permissionsError}</ForgeNotice>}{servicePage.mode==='configuration'&&<p className="ss-readonly-note">新增、编辑与停用将按当前服务权限校验；删除仅允许停用且未被工单引用的工单类型。</p>}{todaySummary}{showToolbar&&<WorkspaceToolbar className="ss-toolbar" aria-label={servicePage.label+'工具栏'} filters={scopeTabs} auxiliaryActions={pageNavigation} primaryAction={pageActions}/>}{scopeTabs?<div id={servicePage.name+'-panel'} role="tabpanel" aria-label={servicePage.label} className="ss-tab-panel">{pageContent}</div>:pageContent}</main>{renderDetailDialog()}{dialog&&<CompositeDialog key={dialog.kind+String(dialog.record&&dialog.record.id||'')} open={true} title={dialogTitle()} description={dialog.record&&(dialog.record.code||dialog.record.name)||''} busy={busy} confirmOnDiscard={formDirty} onOpenChange={open=>{if(!open)cancelDialog()}} footer={({requestClose})=><div className="ss-dialog-actions"><button type="button" className="fp-button" disabled={busy} onClick={requestClose}>取消</button>{!['pick-quote-order','pick-settlement-source','pick-settlement-quote'].includes(dialog.kind)&&<button type="button" className="fp-button primary" disabled={busy||!canSubmitDialog()} onClick={submitReady}>{busy?'处理中…':dialogConfirmLabel()}</button>}</div>}>{dialog.error&&<ForgeNotice tone="error">{dialog.error}</ForgeNotice>}{renderDialogContent()}</CompositeDialog>}</div>;
}
export default App;
${forgeProductUiRuntime}`;
  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    icon: spec.icon,
    type: 'app' as const,
    template: 'react-source' as const, kind: 'react' as const,
    source,
  };
}

export const ServiceOrdersPage = createServicePage({
  name: 'page_service_orders', label: '服务工单',
  description: '统一查看服务请求、工单状态与后续办理。', icon: 'wrench', mode: 'orders', viewKey: 'orders',
});

export const ServiceOrderCreatePage = createServicePage({
  name: 'page_service_order_create', label: '新建服务工单',
  description: '填写客户、来源订单与工单信息。', icon: 'wrench', mode: 'orders', viewKey: 'orders', managerOnly: true, standaloneCreate: true,
});

export const ServiceQuotationsPage = createServicePage({
  name: 'page_service_quotations', label: '服务报价单',
  description: '查看已生成的服务报价并办理客户确认与结算承接。', icon: 'file-text', mode: 'quotations', viewKey: 'quotations', managerOnly: true,
});

export const ServiceSettlementsPage = createServicePage({
  name: 'page_service_settlements', label: '服务结算单',
  description: '查看服务结算并办理确认和财务应收衔接。', icon: 'receipt-text', mode: 'settlements', viewKey: 'settlements', managerOnly: true,
});

export const ServiceWorkspacePage = createServicePage({
  name: 'page_service_workspace', label: '接单中心',
  description: '处理指派给当前服务员工的工单和行程。', icon: 'calendar-check', mode: 'workspace', viewKey: 'orders',
});

export const ServiceDispatchPage = createServicePage({
  name: 'page_service_dispatch', label: '派工中心',
  description: '办理待分派服务工单并查看指派结果。', icon: 'route', mode: 'dispatch', viewKey: 'orders', managerOnly: true,
});

export const ServiceAnalysisPage = createServicePage({
  name: 'page_service_analysis', label: '服务分析',
  description: '按现有服务工单、报价、结算和质保数据核对服务经营情况。', icon: 'chart-no-axes-combined', mode: 'analysis', managerOnly: true,
});

export const WarrantyManagementPage = createServicePage({
  name: 'page_warranty_management', label: '质保管理',
  description: '查看服务工单生成的质保卡和已配置的质保规则。', icon: 'shield-check', mode: 'warranty', viewKey: 'warranty',
});

export const ServiceConfigPage = createServicePage({
  name: 'page_service_config', label: '服务配置',
  description: '查看并维护服务类型、质保规则等配置。', icon: 'settings', mode: 'configuration', viewKey: 'configuration', managerOnly: true,
});
