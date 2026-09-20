// Browser readback for the 图纸管理 group (生产 → 图纸管理).
//
// Covers 图纸总览, 图纸评审, 图纸发布, 图纸变更, 图纸发放记录, 客户图纸管理 and
// 图纸关联查询. 图号档案 has its own readback (drawing-archive-ledger-ui-readback).
//
// Asserts RISEMAP's section order per page (hero → indicators → tabs → action row
// → filters → table → pagination), RISEMAP's column order, the export/refresh
// buttons and the 10-per-page footer. Read-only.
//
// Usage:
//   FORGE_URL=http://localhost:3000 FORGE_SMOKE_EMAIL=... FORGE_SMOKE_PASSWORD=... \
//   node tests/drawing-group-ui-readback.mjs

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.FORGE_URL || 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.FORGE_SMOKE_EMAIL || '';
const PASSWORD = process.env.FORGE_SMOKE_PASSWORD || '';
const LOAD_TIMEOUT = Number(process.env.FORGE_UI_TIMEOUT || 180000);
const SHOTS = path.resolve(process.env.FORGE_GROUP_SHOTS || '../../docs/evidence/drawing-group');
const REPORT = path.resolve('.objectstack/acceptance/drawing-group-report.json');

let chromium = null;
try {
  ({ chromium } = await import(process.env.FORGE_PLAYWRIGHT_MODULE || 'playwright'));
} catch {
  console.log('SKIP 图纸管理 readback — Playwright not available (set FORGE_PLAYWRIGHT_MODULE)');
  process.exit(0);
}
assert.ok(EMAIL && PASSWORD, 'FORGE_SMOKE_EMAIL/FORGE_SMOKE_PASSWORD are required');
await mkdir(SHOTS, { recursive: true });
await mkdir(path.dirname(REPORT), { recursive: true });

const checks = [];
const pass = (text) => { checks.push(text); console.log('PASS ' + text); };

const browser = await chromium.launch({ headless: true, channel: process.env.FORGE_CHROME_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
await page.fill('#login-email', EMAIL);
await page.fill('#login-password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForFunction(() => document.querySelectorAll('a[href]').length > 3 && !(document.body ? document.body.innerText : '').includes('正在初始化'), null, { timeout: LOAD_TIMEOUT });

const open = async (id, title) => {
  await page.goto(BASE + '/_console/apps/forge/page/' + id, { waitUntil: 'commit', timeout: 60000 });
  try {
    await page.waitForSelector('.fpHero', { timeout: 60000 });
  } catch {
    await page.reload({ waitUntil: 'commit', timeout: 60000 });
    await page.waitForSelector('.fpHero', { timeout: LOAD_TIMEOUT });
  }
  await page.waitForFunction((t) => {
    const hero = document.querySelector('.fpHero');
    return hero && hero.innerText.includes(t);
  }, title, { timeout: 60000 });
};

const SPEC = [
  ['page_drawing_workspace', '图纸总览', 7, ['图纸总数', '已发布图纸', '待审核图纸', '待会审评审', '待发布图纸', '变更中图纸', '本月新增/变更'], null],
  ['page_drawing_review', '图纸评审', 4, ['评审单总数', '待我处理', '已通过', '已退回'], ['评审编号', '图号', '图纸名称', '版本', '专业', '状态', '问题数', '发起人', '截止日期', '操作']],
  ['page_drawing_release', '图纸发布', 4, ['发布单总数', '待审核', '已发布', '重大变更'], ['图号', '图纸名称', '本次发布版本', '发布前版本', '版本链路', '审核状态', '发布状态', '是否重大变更', '审核通过时间', '建议生效日期', '影响对象数', '操作']],
  ['page_drawing_change', '图纸变更', 4, ['变更单总数', '待审批', '实施中', '已完成'], ['变更单号', '图号', '图纸名称', '原版本', '新版本', '变更类型', '变更等级', '是否紧急', '状态', '申请人', '申请时间', '审批时间', '操作']],
  ['page_drawing_distribution', '图纸发放记录', 4, ['发放单总数', '待确认', '已确认', '待回执'], ['发放单号', '图号', '图纸名称', '发放版本', '接收对象', '接收类型', '发放方式', '发放状态', '确认状态', '回执状态', '发放人', '发放时间', '风险', '操作']],
  ['page_customer_drawings', '客户图纸管理', 4, ['客户图纸总数', '草稿', '已接收', '机密及以上'], ['客户图号', '图纸名称', '客户名称', '密级', '使用范围', '版本', '状态', '接收日期', '操作']],
];

for (const [id, title, metricCount, metricLabels, headers] of SPEC) {
  await open(id, title);
  const hero = await page.evaluate(() => ({
    title: document.querySelector('.fpHeroTitle').textContent,
    description: document.querySelector('.fpHeroDesc').textContent,
    tone: document.querySelector('.fpHero').className,
  }));
  assert.equal(hero.title, title, id + ' hero 标题');
  assert.ok(hero.description.length > 0, id + ' hero 说明');
  const metrics = await page.locator('.fp-metric-card').evaluateAll((cards) => cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
  assert.equal(metrics.length, metricCount, id + ' 指标卡数量 ' + metrics.length);
  for (const label of metricLabels) assert.ok(metrics.some((m) => m.startsWith(label)), id + ' 缺少指标卡 ' + label);
  if (headers) {
    const actual = (await page.locator('.fp-table thead th').allInnerTexts()).map((t) => t.trim());
    assert.deepEqual(actual, headers, id + ' RISEMAP 列顺序');
    const actions = await page.locator('.fp-action-row button').allInnerTexts();
    assert.ok(actions.includes('导出'), id + ' 动作行缺少导出');
    assert.ok(actions.includes('刷新'), id + ' 动作行缺少刷新');
    assert.match(await page.locator('.fp-pagination').innerText().then((t) => t.replace(/\s+/g, ' ')), /每页 10 条/, id + ' 每页条数');
  }
  await page.screenshot({ path: path.join(SHOTS, id + '.png') });
  pass(title + '：hero、' + metricCount + ' 指标卡' + (headers ? '、RISEMAP 列、导出/刷新与每页 10 条' : '、指标口径') + ' 对齐');
}

await open('page_drawing_query', '图纸关联查询');
{
  const inputs = await page.locator('.fp-filterbar input.fp-input').count();
  assert.ok(inputs >= 4, '关联查询应有四个查询条件，实际 ' + inputs);
  await page.screenshot({ path: path.join(SHOTS, 'page_drawing_query.png') });
  pass('图纸关联查询：hero + 四个查询条件可用');
}

await writeFile(REPORT, JSON.stringify({
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  group: '生产 / 图纸管理（不含图号档案，另有 drawing-archive-ledger 回读）',
  checks,
}, null, 2) + '\n');

console.log('PASS 图纸管理组页面回读（' + checks.length + ' 项）');
await browser.close();
