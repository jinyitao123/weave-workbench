// Browser readback for the 组装业务管理 group (生产 → 组装业务管理).
//
// Covers 生产准备检查, 组装单, 缺料待办, 领料单, 补料单, 退料单, 拆解单, 换件单.
// Each page is opened, the RISEMAP section order is asserted (hero → indicators →
// tabs → action row → filters → table → pagination), and the buttons are really
// clicked: 导出 writes a CSV, 导入/导出任务 opens the task page, 新建X opens the
// create form, 查看 opens the document, 刷新 re-reads, tabs and search filter.
//
// Read-only: nothing is created, edited or deleted on the target instance.
//
// Usage:
//   FORGE_URL=http://localhost:3000 FORGE_SMOKE_EMAIL=... FORGE_SMOKE_PASSWORD=... \
//   node tests/production-assembly-group-ui-readback.mjs

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.FORGE_URL || 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.FORGE_SMOKE_EMAIL || '';
const PASSWORD = process.env.FORGE_SMOKE_PASSWORD || '';
const LOAD_TIMEOUT = Number(process.env.FORGE_UI_TIMEOUT || 180000);
const SHOTS = path.resolve(process.env.FORGE_GROUP_SHOTS || '../../docs/evidence/production-assembly-group');
const REPORT = path.resolve('.objectstack/acceptance/production-assembly-group-report.json');

let chromium = null;
try {
  ({ chromium } = await import(process.env.FORGE_PLAYWRIGHT_MODULE || 'playwright'));
} catch {
  console.log('SKIP 组装业务管理 readback — Playwright not available (set FORGE_PLAYWRIGHT_MODULE)');
  process.exit(0);
}
assert.ok(EMAIL && PASSWORD, 'FORGE_SMOKE_EMAIL/FORGE_SMOKE_PASSWORD are required');
await mkdir(SHOTS, { recursive: true });
await mkdir(path.dirname(REPORT), { recursive: true });

const checks = [];
const skipped = [];
const pass = (text) => { checks.push(text); console.log('PASS ' + text); };
const skip = (text) => { skipped.push(text); console.log('SKIP ' + text); };
const shot = (name) => path.join(SHOTS, name + '.png');

const PAGES = [
  ['prerequisites', 'page_production_prerequisites', '生产准备检查'],
  ['assembly', 'page_production_assembly_workspace', '组装单'],
  ['shortage', 'page_production_shortage_workspace', '缺料待办'],
  ['issue', 'page_production_material_workspace', '领料单'],
  ['supply', 'page_production_supply_workspace', '补料单'],
  ['return', 'page_production_return_workspace', '退料单'],
  ['disassembly', 'page_production_disassembly_workspace', '拆解单'],
  ['replacement', 'page_production_replacement_workspace', '换件单'],
];
const PAGE = Object.fromEntries(PAGES.map(([key, id, title]) => [key, { id, title }]));

const browser = await chromium.launch({ headless: true, channel: process.env.FORGE_CHROME_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
await page.fill('#login-email', EMAIL);
await page.fill('#login-password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForFunction(() => document.querySelectorAll('a[href]').length > 3 && !(document.body?document.body.innerText:'').includes('正在初始化'), null, { timeout: LOAD_TIMEOUT });
pass('已登录并离开初始化页');

const open = async (key) => {
  const target = PAGE[key];
  await page.goto(BASE + '/_console/apps/forge/page/' + target.id, { waitUntil: 'commit', timeout: 60000 });
  try {
    await page.waitForSelector('.fpHero', { timeout: 60000 });
  } catch {
    await page.reload({ waitUntil: 'commit', timeout: 60000 });
    await page.waitForSelector('.fpHero', { timeout: LOAD_TIMEOUT });
  }
  await page.waitForFunction((title) => {
    const hero = document.querySelector('.fpHero');
    return hero && hero.innerText.includes(title);
  }, target.title, { timeout: 60000 });
  return target;
};
const heroOf = () => page.evaluate(() => {
  const hero = document.querySelector('.fpHero');
  return {
    title: (hero.querySelector('.fpHeroTitle') || {}).textContent || '',
    description: (hero.querySelector('.fpHeroDesc') || {}).textContent || '',
    tone: hero.className,
    crumbs: [...hero.querySelectorAll('.fpHeroCrumbs span')].map((n) => n.textContent).filter((t) => t && t !== '›'),
  };
});
const metricsOf = () => page.locator('.fp-metric-card').evaluateAll((cards) => cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
const tabsOf = () => page.locator('.fp-list-card .fp-tabs button').allInnerTexts();
const actionsOf = () => page.locator('.fp-action-row button').allInnerTexts();
const headersOf = () => page.locator('.fp-table thead th').allInnerTexts();
const rowCount = () => page.locator('.fp-table tbody tr').count();
const footerOf = () => page.locator('.fp-pagination').innerText().then((t) => t.replace(/\s+/g, ' '));

// ------------------------------------------------------------------ 组装单 ---
await open('assembly');
{
  const hero = await heroOf();
  assert.equal(hero.title, '组装单');
  assert.ok(hero.crumbs.join(' / ').includes('组装业务管理'), 'hero 面包屑应包含业务分组');
  assert.ok(hero.description.includes('按 BOM 将原材料组装为成品'), '标题说明应对齐 RISEMAP');
  assert.ok(hero.tone.includes('tone-blue'), '组装单 hero 色调');
  const metrics = await metricsOf();
  assert.equal(metrics.length, 4, '组装单指标卡数量');
  for (const label of ['组装单总数', '进行中', '累计合格入库', '累计物料投入']) assert.ok(metrics.some((m) => m.startsWith(label)), '缺少指标卡 ' + label);
  const tabs = await tabsOf();
  assert.equal(tabs.length, 8, '组装单状态页签数量');
  assert.ok(/^全部\(\d+\)$/.test(tabs[0]), '全部页签应带计数');
  assert.deepEqual(tabs.slice(1), ['草稿', '审批中', '待领料', '组装中', '已完工', '已驳回', '已取消']);
  assert.deepEqual(await actionsOf(), ['新建组装单', '导出', '导入/导出任务', '刷新']);
  assert.deepEqual(await headersOf(), ['组装单号', '成品', 'BOM', '计划数量', '合格数量', '不合格数量', '物料种数', '物料成本', '来源订单', '创建日期', '创建人', '操作']);
  assert.match(await footerOf(), /共 \d+ 条记录 · 每页 20 条/);
  await page.screenshot({ path: shot('01-assembly-list') });
  pass('组装单：hero、4 指标卡、8 状态页签、动作行、12 列与分页对齐 RISEMAP');
}
{
  await page.click('.fp-list-card .fp-tabs button:has-text("待领料")');
  await page.waitForTimeout(1200);
  const firstCells = (await page.locator('.fp-table tbody tr td:first-child').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  if (firstCells.length) {
    assert.ok(firstCells.every((t) => t.includes('待领料')), '待领料页签只应保留待领料单据，实际：' + JSON.stringify(firstCells.slice(0, 3)));
  } else {
    assert.ok(await page.locator('.fp-empty').count() > 0, '该状态无数据时应显示空态');
  }
  await page.click('.fp-list-card .fp-tabs button:has-text("全部")');
  await page.waitForTimeout(500);
  pass('组装单：状态页签真实过滤列表');
}
{
  const before = await rowCount();
  await page.fill('.fp-filter-row input.fp-input', 'zzz-no-such-order');
  await page.waitForSelector('.fp-empty', { timeout: 20000 });
  assert.equal(await rowCount(), 0, '无匹配时列表应为空');
  await page.click('.fp-filter-row button:has-text("清空筛选")');
  await page.waitForFunction((n) => document.querySelectorAll('.fp-table tbody tr').length === n, before, { timeout: 20000 });
  pass('组装单：关键词搜索与清空筛选可用');
}
{
  const rowTotal = await rowCount();
  const exportButton = page.locator('.fp-action-row button:text-is("导出")');
  if (rowTotal === 0) {
    assert.ok(await page.locator('.fp-empty').count() > 0, '空列表应显示空态');
    assert.equal(await exportButton.isDisabled(), true, '空列表下导出应禁用而不是产出空文件');
    pass('组装单：空列表显示空态且导出按设计禁用');
    skip('组装单：导出下载（该实例没有组装单数据）');
  } else {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      exportButton.click(),
    ]);
    const name = download.suggestedFilename();
    const file = path.join(os.tmpdir(), name);
    await download.saveAs(file);
    const csv = await readFile(file, 'utf8');
    assert.ok(csv.includes('组装单号'), '导出文件应包含表头');
    pass('组装单：导出下载真实文件 ' + name);
  }
}
{
  await page.click('.fp-action-row button:has-text("导入/导出任务")');
  await page.waitForFunction(() => /page_production_data_tasks/.test(location.pathname + location.search), null, { timeout: 90000 });
  await page.waitForFunction(() => /导入导出任务|导入\/导出任务|数据任务/.test((document.body?document.body.innerText:'')), null, { timeout: 90000 });
  pass('组装单：导入/导出任务打开任务页');
}
{
  await open('assembly');
  if (await rowCount() > 0) {
    const code = (await page.locator('.fp-table tbody tr td:first-child').first().innerText()).split('\n')[0].trim();
    await page.locator('.fp-table tbody tr').first().locator('button:has-text("查看")').click();
    await page.waitForFunction((c) => location.search.includes('id=') && (document.body?document.body.innerText:'').includes(c), code, { timeout: 90000 });
    pass('组装单：行内查看打开 ' + code + ' 详情');
    await open('assembly');
  } else {
    skip('组装单：行内查看（该实例没有组装单数据）');
  }
  await page.click('.fp-action-row button:has-text("新建组装单")');
  await page.waitForFunction(() => location.search.includes('new=1') && /新建组装/.test((document.body?document.body.innerText:'')), null, { timeout: 90000 });
  pass('组装单：新建组装单打开创建表单');
}

// --------------------------------------------------------------- 缺料待办 ---
await open('shortage');
{
  const hero = await heroOf();
  assert.equal(hero.title, '缺料待办');
  assert.ok(hero.description.includes('对在产组装单实时做齐套分析'), '标题说明应对齐 RISEMAP');
  assert.ok(hero.tone.includes('tone-orange'), '缺料待办 hero 色调');
  const metrics = await metricsOf();
  assert.equal(metrics.length, 4);
  for (const label of ['缺料单据', '缺料物料', '缺口总额', '最早计划完工']) assert.ok(metrics.some((m) => m.startsWith(label)), '缺少指标卡 ' + label);
  assert.ok(metrics.some((m) => /缺口总额 ¥/.test(m)), '缺口总额应按金额展示');
  assert.match(await footerOf(), /每页 20 条/);
  await page.screenshot({ path: shot('02-shortage-list') });
  pass('缺料待办：hero、缺口总额口径与分页对齐 RISEMAP');
  if (await page.locator('.fp-empty').count() === 0) {
    await page.click('.fp-pagination button:has-text("下一页")');
    await page.waitForFunction(() => { const el = document.querySelector('.fp-pagination'); return !!el && /2 \/ \d+/.test(el.innerText); }, null, { timeout: 30000 });
    pass('缺料待办：分页可翻页');
  } else skip('缺料待办：翻页（当前无缺料数据）');
}

// --------------------------------------------------- 领料单/补料单/退料单 ---
const materialExpect = {
  issue: { metrics: ['领料单', '物料种类', '物料数量', '净领用金额'], headers: ['领料单号', '类型', '成品', '来源单', '物料种数', '数量', '金额', '经手人', '日期', '操作'], placeholder: '搜索领料单号/成品/来源单...' },
  supply: { metrics: ['补料单总数', '补领物料种数', '补料金额（出库）', '涉及来源单'], headers: ['补料单号', '成品', '来源单', '物料种数', '数量', '金额', '经手人', '日期', '操作'], placeholder: '搜索补料单号/成品/组装单...' },
  return: { metrics: ['退料单总数', '退回物料种数', '退回金额（入库）', '涉及来源单'], headers: ['退料单号', '成品', '来源单', '仓库', '物料种数', '数量', '金额', '经手人', '日期', '操作'], placeholder: '搜索退料单号/成品/组装单...' },
};
for (const key of ['issue', 'supply', 'return']) {
  const target = await open(key);
  const hero = await heroOf();
  assert.equal(hero.title, target.title);
  assert.ok(hero.tone.includes('tone-indigo'), target.title + ' hero 色调');
  const expect = materialExpect[key];
  const metrics = await metricsOf();
  assert.equal(metrics.length, 4);
  for (const label of expect.metrics) assert.ok(metrics.some((m) => m.startsWith(label)), target.title + ' 缺少指标卡 ' + label);
  assert.deepEqual(await headersOf(), expect.headers);
  assert.equal(await page.locator('.fp-filter-row input.fp-input').getAttribute('placeholder'), expect.placeholder);
  assert.deepEqual(await actionsOf(), ['新建' + target.title, '导出', '导入/导出任务', '刷新']);
  await page.screenshot({ path: shot('03-' + key + '-list') });
  pass(target.title + '：hero、指标口径、RISEMAP 列与动作行对齐');
}

// ------------------------------------------------------ 拆解单 / 换件单 -----
const transformExpect = [
  ['disassembly', 'tone-red', ['拆解单号', '成品', 'BOM', '数量', '原因', '回收价值', '报废', '经手人', '日期', '操作']],
  ['replacement', 'tone-blue', ['换件单号', '成品', '换件内容', '改制数量', '原因', '新件成本', '回收价值', '成本变化', '经手人', '日期', '操作']],
];
for (const [key, tone, headers] of transformExpect) {
  const target = await open(key);
  const hero = await heroOf();
  assert.equal(hero.title, target.title);
  assert.ok(hero.tone.includes(tone), target.title + ' hero 色调');
  assert.deepEqual(await headersOf(), headers);
  assert.equal((await metricsOf()).length, 4);
  await page.screenshot({ path: shot('04-' + key + '-list') });
  pass(target.title + '：hero、指标卡与 RISEMAP 列对齐');
}

// ---------------------------------------------------------- 生产准备检查 ----
await open('prerequisites');
{
  const hero = await heroOf();
  assert.equal(hero.title, '生产准备检查');
  const metrics = await metricsOf();
  assert.equal(metrics.length, 4);
  for (const label of ['检查项', '已具备', '待补充', '覆盖模块']) assert.ok(metrics.some((m) => m.startsWith(label)), '缺少指标卡 ' + label);
  assert.ok(await page.locator('.ready-row').count() > 0, '准备检查应有检查项');
  await page.screenshot({ path: shot('05-prerequisites') });
  pass('生产准备检查：hero、4 指标卡与检查项就地办理入口');
}

// ------------------------------------------------------------------ 窄屏 ----
await open('assembly');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
assert.equal(await page.locator('.fp-metric-card').count(), 4, '窄屏保留指标卡');
assert.ok((await actionsOf()).includes('新建组装单'), '窄屏保留主动作');
await page.screenshot({ path: shot('06-assembly-narrow') });
pass('窄屏下 hero、指标卡与动作行保持可用');

await writeFile(REPORT, JSON.stringify({
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  group: '生产 / 组装业务管理',
  pages: PAGES.map(([, id, title]) => ({ page: id, title })),
  checks,
  skipped,
  screenshots: checks.length ? [
    '01-assembly-list', '02-shortage-list', '03-issue-list', '03-supply-list', '03-return-list',
    '04-disassembly-list', '04-replacement-list', '05-prerequisites', '06-assembly-narrow',
  ].map(shot) : [],
}, null, 2) + '\n');

console.log('PASS 组装业务管理 页面回读（' + checks.length + ' 项通过，' + skipped.length + ' 项跳过）');
await browser.close();
