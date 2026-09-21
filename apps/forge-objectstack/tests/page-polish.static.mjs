import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkPageDelivery } from './page-delivery-gate.mjs';

const manifest = JSON.parse(await readFile(new URL('./page-polish.manifest.json', import.meta.url), 'utf8'));
const pagesDir = new URL('../src/pages/', import.meta.url);
const config = await readFile(new URL('../objectstack.config.ts', import.meta.url), 'utf8');
const productUi = await readFile(new URL('../src/pages/product-ui.ts', import.meta.url), 'utf8');
const findings = [];
const allowedArchetypes = new Set(['workbench', 'task_workspace', 'timesheet_composite', 'analysis', 'configuration']);
const allowedDesignStatuses = new Set(['review_required', 'accepted']);
const allowedReferences = new Set(['workbench.page.ts', 'project-task-workspace.page.ts', 'project-timesheet-cost.page.ts']);
let acceptedPages = 0;
let reviewRequiredPages = 0;

for (const [area, entries] of Object.entries(manifest)) {
  for (const entry of entries) {
    if (area === 'sales' && entry.pages.length !== 1) findings.push(`${area}/${entry.file}: 销售页面必须逐页登记，不能合并验收状态`);
    if (area === 'sales' && (typeof entry.acceptance !== 'string' || !entry.acceptance.trim())) findings.push(`${area}/${entry.file}: 销售页面缺少逐页结构化验收记录`);
    if (!allowedArchetypes.has(entry.archetype)) findings.push(`${area}/${entry.file}: 缺少有效页面主原型`);
    if (!allowedDesignStatuses.has(entry.designStatus)) findings.push(`${area}/${entry.file}: 缺少有效设计验收状态`);
    if (!allowedReferences.has(entry.reference)) findings.push(`${area}/${entry.file}: 缺少有效参考页面`);
    for (const issue of await checkPageDelivery(entry)) findings.push(`${area}/${entry.file}: ${issue}`);
    if (entry.designStatus === 'accepted') {
      acceptedPages += entry.pages.length;
      if (entry.pages.length !== 1) findings.push(`${area}/${entry.file}: accepted 必须逐页登记，不能批量验收`);
      if (typeof entry.evidence !== 'string' || !entry.evidence.trim()) findings.push(`${area}/${entry.file}: accepted 页面缺少浏览器对照证据路径`);
    } else {
      reviewRequiredPages += entry.pages.length;
      if (entry.evidence) findings.push(`${area}/${entry.file}: review_required 页面不得记录为已验收证据`);
    }
    const source = await readFile(new URL(entry.file, pagesDir), 'utf8');
    const structuralPatterns = entry.archetype === 'workbench'
      ? [
          ['产品根节点', /forge-product|forge-workbench/],
          // ForgeHero is the branded heading area for pages that lead with a hero.
          ['工作台标题区', /ForgeHero|ForgePageHeader|fp-page-header|wb-welcome|ws-hero/],
          ['可执行按钮', /<button\b[^>]*onClick=/],
        ]
      : [
          ['product-ui.ts 样式', /forgeProductUiCss/],
          ['product-ui.ts 运行时', /forgeProductUiRuntime/],
          ['标准产品根节点', /forge-product/],
          // The branded hero (allowed by the polish baseline since 2026-09-17) is a
          // standard heading area too: it carries the业务面包屑、标题与说明.
          ['标准标题区', /ForgeHero|ForgePageHeader|fp-page-header/],
          ['可执行按钮', /<button\b[^>]*onClick=/],
        ];
    for (const [label, pattern] of structuralPatterns) if (!pattern.test(source)) findings.push(`${area}/${entry.file}: 缺少${label}`);
    for (const [label, pattern] of [
      ['浏览器原生弹框', /(?<!function\s)(?<!const\s)(?<!let\s)(?<!var\s)(?:window\.)?(?:alert|confirm|prompt)\s*\(/],
      ['浏览器原生选择器', /<select\b/],
      ['浏览器原生日期控件', /type=["'](?:date|datetime-local)["']/],
      ['内部验收文案', /复刻验收|本阶段仅验证|后续切片|待复核/],
    ]) if (pattern.test(source)) findings.push(`${area}/${entry.file}: 包含${label}`);
    for (const page of entry.pages) if (!source.includes(page)) findings.push(`${area}/${entry.file}: 未导出 ${page}`);
  }
}

const financeStart = config.indexOf("id: 'finance'");
const financeEnd = config.indexOf("id: 'reports'", financeStart);
const financeBlock = config.slice(financeStart, financeEnd);
const financePages = [...financeBlock.matchAll(/page\([^,]+,[^,]+,\s*'([^']+)'/g)].map(match => match[1]);
const polishedFinancePages = new Set(manifest.finance.flatMap(entry => entry.pages));
for (const page of financePages) if (!polishedFinancePages.has(page)) findings.push(`finance: ${page} 未加入 page-polish 清单`);
const salesStart = config.indexOf("id: 'sales'");
const salesEnd = config.indexOf("id: 'production'", salesStart);
const salesBlock = config.slice(salesStart, salesEnd);
const salesPages = [...salesBlock.matchAll(/page\([^,]+,[^,]+,\s*'([^']+)'/g)].map(match => match[1]);
const polishedSalesPages = new Set((manifest.sales || []).flatMap(entry => entry.pages));
for (const page of salesPages) if (!polishedSalesPages.has(page)) findings.push(`sales: ${page} 未加入 page-polish 清单`);
for (const page of polishedSalesPages) if (!salesPages.includes(page)) findings.push(`sales: ${page} 不在当前销售导航中`);
assert.equal(financeBlock.includes("'page_finance_gap'"), false, '财务导航仍指向空白占位页');
assert.match(productUi, /div:has\(>\.forge-product\)>div\.space-y-2\{display:none!important\}/, 'product-ui.ts 必须隐藏 Console 自动标题，避免产品页出现重复标题区');
assert.match(productUi, /\.forge-product \.btn,.forge-product \.icon-btn\{height:34px;[^}]*border-radius:8px/, 'product-ui.ts 必须统一财务页主次按钮尺寸与圆角');
assert.match(productUi, /\.forge-product\.bank-flow \.page-shell,.forge-product\.finance-page \.fp-shell,.forge-product \.body\{width:min\(1380px,100%\);max-width:1380px/, 'product-ui.ts 必须按工时管理页面统一财务内容宽度');
assert.match(productUi, /\.forge-product \.card,.forge-product \.panel,.forge-product \.metric,.forge-product \.metric-card,.forge-product \.process\{[^}]*border-radius:10px/, 'product-ui.ts 必须统一财务卡片层级与圆角');
assert.deepEqual(findings, [], findings.join('\n'));
console.log(`PASS page-polish 清单覆盖 ${Object.values(manifest).flat().length} 个页面条目；${acceptedPages} 个页面设计已验收，${reviewRequiredPages} 个页面仍需逐页精修；${financePages.length} 个财务入口与 ${salesPages.length} 个销售入口均已纳入且导航无空白占位入口`);
