import { forgeProductUiCss, forgeProductUiRuntime } from './product-ui.js';

const source = (domain: string, groups: string, delivered: string) => `
const css=${JSON.stringify(forgeProductUiCss)};
${forgeProductUiRuntime}
function App(){return <div className="forge-product"><style>{css}</style><div className="fp-shell"><div className="fp-list-context"><div><h1 style={{margin:'0 0 6px',fontSize:24}}>${domain}</h1><p style={{margin:0,color:'var(--fp-muted)'}}>RISEMAP 产品结构恢复状态</p></div></div><section className="fp-card" style={{padding:20,marginBottom:14}}><h2 style={{fontSize:15,margin:'0 0 10px'}}>已观察功能组</h2><p>${groups}</p></section><section className="fp-card" style={{padding:20}}><h2 style={{fontSize:15,margin:'0 0 10px'}}>当前 Forge 边界</h2><p>${delivered}</p><div style={{marginTop:12}}><ForgeNotice tone="warning">未列出的业务入口仍在产品地图中，但尚未交付为可操作页面。</ForgeNotice></div></section></div></div>}export default App;`;

const page = (name: string, label: string, groups: string, delivered: string, icon: string) => ({
  name, label, description: `${label} 的 RISEMAP 结构与 Forge 交付边界`, icon,
  type: 'app' as const, kind: 'react' as const, source: source(label, groups, delivered),
});

export const AdministrationScopePage = page('page_administration_scope', '行政', '审批中心、行政管理、人力资源、考勤假期、流程中心。', '本轮没有把行政域描述为已实现；现有项目和费用动作也不能代替行政、人事和流程产品。', 'users');
export const ReportsScopePage = page('page_reports_scope', '报表', '业务报表、财务统计。', '项目经营分析已有可复用页面；销售、采购、库存、组装和完整财务统计仍按各自证据补齐。', 'chart-no-axes-combined');
export const SystemScopePage = page('page_system_scope', '系统', '系统设置、业务设置。', '部分主数据字典对象已存在；组织权限、编号、审批、通知、打印、AI 和各域完整配置尚未形成系统产品。', 'settings');
