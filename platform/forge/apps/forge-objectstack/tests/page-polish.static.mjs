import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkPageDelivery } from './page-delivery-gate.mjs';

const manifest = JSON.parse(await readFile(new URL('./page-polish.manifest.json', import.meta.url), 'utf8'));
const pagesDir = new URL('../src/pages/', import.meta.url);
const productUi = await readFile(new URL('../src/pages/product-ui.ts', import.meta.url), 'utf8');
const findings = [];
const allowedSurfaces = new Set(['object', 'dashboard', 'report', 'component', 'action', 'page']);
const allowedArchetypes = new Set(['workbench', 'task_workspace', 'timesheet_composite', 'analysis', 'configuration']);
const allowedDesignStatuses = new Set(['review_required', 'accepted']);
const allowedReferences = new Set(['workbench.page.ts', 'project-task-workspace.page.ts', 'project-timesheet-cost.page.ts']);
let acceptedTargets = 0;
let reviewRequiredTargets = 0;

for (const [area, entries] of Object.entries(manifest)) {
  for (const entry of entries) {
    const isV3Entry = entry.surfaceType !== undefined;
    const label = `${area}/${entry.target || entry.file || 'target'}`;
    if (!isV3Entry && area === 'sales' && entry.pages.length !== 1) findings.push(`${label}: 销售页面必须逐页登记，不能合并验收状态`);
    if (!isV3Entry && area === 'sales' && (typeof entry.acceptance !== 'string' || !entry.acceptance.trim())) findings.push(`${label}: 销售页面缺少逐页结构化验收记录`);
    if (!isV3Entry && !allowedArchetypes.has(entry.archetype)) findings.push(`${label}: 缺少有效页面主原型`);
    if (!allowedDesignStatuses.has(entry.designStatus)) findings.push(`${label}: 缺少有效设计验收状态`);
    if (!isV3Entry && !allowedReferences.has(entry.reference)) findings.push(`${label}: 缺少有效参考页面`);
    if (isV3Entry) {
      if (!allowedSurfaces.has(entry.surfaceType)) findings.push(`${label}: 缺少有效 ObjectStack surfaceType`);
      for (const field of ['featureId', 'app', 'target']) {
        if (typeof entry[field] !== 'string' || !entry[field].trim()) findings.push(`${label}: 缺少 v3 ${field}`);
      }
      if (!Array.isArray(entry.subjectFiles) || !entry.subjectFiles.length) findings.push(`${label}: 缺少实际受验 subjectFiles 范围`);
      if (!Array.isArray(entry.requirementIds) || !entry.requirementIds.length
        || entry.requirementIds.some(id => typeof id !== 'string' || !id.trim())
        || new Set(entry.requirementIds).size !== entry.requirementIds.length) {
        findings.push(`${label}: 缺少唯一且完整的 v3 requirementIds`);
      }
    }
    for (const issue of await checkPageDelivery(entry)) findings.push(`${label}: ${issue}`);
    if (entry.designStatus === 'accepted') {
      acceptedTargets += isV3Entry ? 1 : entry.pages.length;
      if (!isV3Entry && entry.pages.length !== 1) findings.push(`${label}: accepted 必须逐页登记，不能批量验收`);
      if (!isV3Entry && (typeof entry.evidence !== 'string' || !entry.evidence.trim())) findings.push(`${label}: accepted 页面缺少浏览器对照证据路径`);
    } else {
      reviewRequiredTargets += isV3Entry ? 1 : entry.pages.length;
      if (entry.evidence) findings.push(`${label}: review_required 不得附带总体成功报告或已验收证据`);
    }
    if (isV3Entry || typeof entry.file !== 'string' || !entry.file.trim()) continue;
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

// Built navigation is checked against this manifest after compilation by
// navigation-linkage.static.mjs. This prebuild gate checks source contracts.
assert.match(productUi, /div:has\(>\.forge-product\)>div\.space-y-2\{display:none!important\}/, 'product-ui.ts 必须隐藏 Console 自动标题，避免产品页出现重复标题区');
assert.match(productUi, /\.forge-product \.btn,.forge-product \.icon-btn\{height:34px;[^}]*border-radius:8px/, 'product-ui.ts 必须统一财务页主次按钮尺寸与圆角');
assert.match(productUi, /\.forge-product\.bank-flow \.page-shell,.forge-product\.finance-page \.fp-shell,.forge-product \.body\{width:min\(1380px,100%\);max-width:1380px/, 'product-ui.ts 必须按工时管理页面统一财务内容宽度');
assert.match(productUi, /\.forge-product \.card,.forge-product \.panel,.forge-product \.metric,.forge-product \.metric-card,.forge-product \.process\{[^}]*border-radius:10px/, 'product-ui.ts 必须统一财务卡片层级与圆角');
assert.deepEqual(findings, [], findings.join('\n'));
console.log(`PASS page-polish 清单覆盖 ${Object.values(manifest).flat().length} 个交付条目；${acceptedTargets} 个目标已验收，${reviewRequiredTargets} 个目标仍需逐项复核。导航目标需在编译后检查；此检查不证明入口或业务动作可用`);
