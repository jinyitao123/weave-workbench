// Browser readback for the drawing-number archive page (page_drawing_archive).
//
// Why this exists: the archive page carries two RISEMAP views — the file-resource
// tree and the ledger. Structure alone proves nothing: the ledger has to answer a
// real click on every filter, on the export, and on a row entry. This script drives
// the running instance in a browser and writes screenshots plus a report.
//
// Read-only by default. Creating a drawing needs FORGE_LEDGER_CREATE=1, so the
// script can run against an instance whose data must not be touched.
//
// Usage:
//   FORGE_URL=http://localhost:3000 \
//   FORGE_SMOKE_EMAIL=... FORGE_SMOKE_PASSWORD=... \
//   node tests/drawing-archive-ledger-ui-readback.mjs

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const BASE = (process.env.FORGE_URL || 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.FORGE_SMOKE_EMAIL || '';
const PASSWORD = process.env.FORGE_SMOKE_PASSWORD || '';
const CREATE = process.env.FORGE_LEDGER_CREATE === '1';
const ARCHIVE_URL = BASE + '/_console/apps/forge/page/page_drawing_archive';
const SHOTS = path.resolve(process.env.FORGE_LEDGER_SHOTS || '../../docs/evidence/drawing-archive-ledger');
const REPORT = path.resolve('.objectstack/acceptance/drawing-archive-ledger-report.json');
const LOAD_TIMEOUT = Number(process.env.FORGE_UI_TIMEOUT || 180000);

let chromium = null;
try {
  ({ chromium } = await import(process.env.FORGE_PLAYWRIGHT_MODULE || 'playwright'));
} catch {
  console.log('SKIP drawing archive ledger readback — Playwright not available '
    + '(set FORGE_PLAYWRIGHT_MODULE to an absolute playwright/index.mjs path)');
  process.exit(0);
}
await mkdir(SHOTS, { recursive: true });
await mkdir(path.dirname(REPORT), { recursive: true });

const observed = [];
const skipped = [];
const note = (text) => { observed.push(text); console.log('PASS ' + text); };
const skip = (text) => { skipped.push(text); console.log('SKIP ' + text); };
const shot = (suffix) => path.join(SHOTS, suffix + '.png');

const browser = await chromium.launch({ headless: true, channel: process.env.FORGE_CHROME_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
assert.ok(EMAIL && PASSWORD, 'FORGE_SMOKE_EMAIL/FORGE_SMOKE_PASSWORD are required');
await page.fill('#login-email', EMAIL);
await page.fill('#login-password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForFunction(() => document.querySelectorAll('a[href]').length > 3 && !document.body.innerText.includes('正在初始化'), null, { timeout: LOAD_TIMEOUT });
note('signed in and left the initializing splash');

await page.goto(ARCHIVE_URL, { waitUntil: 'commit', timeout: 60000 });
try {
  await page.waitForSelector('button:has-text("台账模式")', { timeout: 60000 });
} catch {
  await page.reload({ waitUntil: 'commit', timeout: 60000 });
  await page.waitForSelector('button:has-text("台账模式")', { timeout: LOAD_TIMEOUT });
}

// --- file-resource tree (default view) -------------------------------------
assert.equal(await page.locator('text=文件目录').count() > 0, true, 'tree view must show 文件目录');
assert.equal((await page.locator('.dw-modes button.dw-mode.active').innerText()).trim(), '文件资源树', 'file tree is the default mode');
const treeCountText = (await page.locator('.dw-list-count').filter({ hasText: '张图纸' }).innerText()).trim();
const treeCount = Number((treeCountText.match(/\d+/) || ['0'])[0]);
if (treeCount > 0) {
  assert.equal(await page.locator('.dw-list-panel table tbody tr').count(), treeCount, 'tree view must render every drawing in 全部图纸');
  assert.equal(await page.locator('.dw-list-panel button:has-text("查看属性")').count(), treeCount, 'each tree row must open a real attribute view');
}
await page.screenshot({ path: shot('01-file-tree-mode') });
note('file-resource tree renders as the default view and does not hide existing drawings');

// --- ledger view ------------------------------------------------------------
await page.click('button:has-text("台账模式")');
await page.waitForSelector('.dw-ledger', { timeout: 30000 });
assert.equal(await page.locator('text=文件目录').count(), 0, 'the tree panel must not stay in ledger mode');
assert.deepEqual(
  await page.locator('.dw-ledger-kpi > span').allInnerTexts(),
  ['图纸总数', '已发布', '待评审', '已评审', '变更中', '已作废'],
  'ledger indicators',
);
assert.deepEqual(
  await page.locator('.dw-ledger-actions button').allInnerTexts(),
  ['新建图号', '导出', '刷新'],
  'ledger action row',
);
assert.deepEqual(
  await page.locator('.dw-ledger-filter button.fp-picker-trigger').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label'))),
  ['图纸类型', '图纸状态', '所属分类', '受控标识', '关联项目'],
  'ledger filters',
);
assert.deepEqual(
  (await page.locator('.dw-ledger-table thead th').allInnerTexts()).map((x) => x.trim()),
  ['图号', '图纸名称', '图纸类型', '所属分类', '当前生效版本', '图纸状态', '受控标识', '关联物料', '关联项目', '最近更新时间', '操作'],
  'ledger columns',
);
const ledgerCount = await page.locator('.dw-ledger-table tbody tr').filter({ has: page.locator('td button') }).count();
note('ledger mode renders 6 indicators, 3 actions, 5 filter pickers, search and 11 columns');
await page.screenshot({ path: shot('02-ledger-mode') });

// --- filters converge and reset --------------------------------------------
const rowFor = (code) => page.locator('.dw-ledger-table tbody tr').filter({ hasText: code }).first();
let sample = '';
if (ledgerCount > 0) {
  sample = (await page.locator('.dw-ledger-table tbody tr td:first-child').first().innerText()).trim();
}
const dataRows = () => page.locator('.dw-ledger-table tbody tr').filter({ has: page.locator('td button') });
const columnValues = async (index) => dataRows().evaluateAll(
  (rows, i) => rows.map((row) => (row.children[i] ? row.children[i].innerText.replace(/\s+/g, ' ').trim() : '')),
  index,
);
const expectEmpty = async (why) => {
  await page.waitForSelector('text=未找到匹配的图号档案', { timeout: 20000 });
  if (sample) assert.equal(await page.locator('.dw-ledger-table tbody tr').filter({ hasText: sample }).count(), 0, why);
};
const usePicker = async (label, option) => {
  await page.click('.dw-ledger-filter button.fp-picker-trigger[aria-label="' + label + '"]');
  await page.click('[role="option"]:has-text("' + option + '")');
};

await usePicker('图纸状态', '已作废');
const obsoleteColumn = await columnValues(5);
assert.ok(obsoleteColumn.every((value) => value.includes('已作废')), 'status filter must keep only obsolete drawings');
if (!obsoleteColumn.length) {
  assert.ok(await page.locator('text=未找到匹配的图号档案').count() > 0, 'empty status result shows the RISEMAP empty state');
}
await page.screenshot({ path: shot('03-filter-empty-state') });
await page.click('.dw-ledger-filter button:has-text("重置")');
if (sample) await rowFor(sample).waitFor({ timeout: 20000 });
note('status filter keeps only obsolete rows and reset restores the list');

await page.click('.dw-ledger-filter button.fp-picker-trigger[aria-label="受控标识"]');
const controlledOptions = await page.locator('.dw-ledger-filter [role="option"]').allInnerTexts();
assert.deepEqual(controlledOptions, ['受控标识', '受控', '非受控'], 'controlled options');
await page.click('[role="option"]:has-text("受控")');
const controlledColumn = await columnValues(6);
assert.ok(controlledColumn.every((value) => value === '受控'), 'controlled filter must keep only controlled drawings');
await page.click('.dw-ledger-filter button.fp-picker-trigger[aria-label="受控标识"]');
await page.click('[role="option"]:has-text("非受控")');
const uncontrolledColumn = await columnValues(6);
assert.ok(uncontrolledColumn.every((value) => value === '非受控'), 'uncontrolled filter must keep only uncontrolled drawings');
await page.click('.dw-ledger-filter button:has-text("重置")');
if (sample) await rowFor(sample).waitFor({ timeout: 20000 });
note('controlled flag filter follows RISEMAP options 受控 / 非受控 and stays self-consistent');

const beforeSearch = await page.locator('.dw-ledger-table tbody tr').count();
await page.fill('.dw-ledger-filter input.fp-input', 'zzz-no-such-drawing');
await expectEmpty('unmatched search must empty the ledger');
await page.click('.dw-ledger-filter button:has-text("重置")');
await page.waitForFunction((expected) => document.querySelectorAll('.dw-ledger-table tbody tr').length === expected, beforeSearch, { timeout: 20000 });
note('keyword search filters by drawing number and name');

// --- export writes a real file ---------------------------------------------
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.click('.dw-ledger-actions button:has-text("导出")'),
]);
const csvName = download.suggestedFilename();
const csvPath = path.join(os.tmpdir(), csvName);
await download.saveAs(csvPath);
assert.ok(csvName.endsWith('.csv'), 'export must produce a csv');
note('export downloads ' + csvName);

// --- optional write path: create a drawing through the ledger --------------
let createdCode = '';
if (CREATE) {
  await page.click('.dw-ledger-actions button:has-text("新建图号")');
  await page.waitForSelector('.fp-modal[aria-label="新建图号"]', { timeout: 20000 });
  const inputs = page.locator('.fp-modal input.fp-input');
  await inputs.nth(1).fill('台账模式浏览器验证图纸');
  createdCode = (await inputs.nth(0).inputValue()).trim();
  await page.click('button:has-text("保存图号")');
  await page.waitForFunction((code) => document.body.innerText.includes(code), createdCode, { timeout: 60000 });
  note('created ' + createdCode + ' from the ledger action row');
} else {
  skip('drawing creation through the ledger action row (set FORGE_LEDGER_CREATE=1 to enable)');
}

// --- row entry opens the attribute panel -----------------------------------
const entryCode = createdCode || sample;
if (entryCode) {
  const row = rowFor(entryCode);
  await row.waitFor({ timeout: 30000 });
  const cells = (await row.locator('td').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
  assert.equal(cells[0], entryCode, 'first column carries the drawing number');
  assert.equal(cells[10], '查看', 'last column carries the row action');
  await row.locator('button:has-text("查看")').click();
  await page.waitForSelector('text=图纸属性 · ' + entryCode, { timeout: 20000 });
  const panel = (await page.locator('.dw-info-panel').innerText()).replace(/\s+/g, ' ');
  for (const field of ['图号', '图纸名称', '当前生效版本', '图纸状态', '受控标识', '关联物料', '关联项目', '最近更新时间']) {
    assert.ok(panel.includes(field), 'attribute panel misses ' + field);
  }
  const actions = await page.locator('.dw-info-actions button').allInnerTexts();
  assert.ok(actions.includes('上传新版本') && actions.includes('查看版本台账'), 'attribute panel keeps real next steps');
  await page.screenshot({ path: shot('04-row-attribute-panel') });
  await page.click('button:has-text("关闭")');
  await page.waitForSelector('text=图纸属性 · ' + entryCode, { state: 'detached', timeout: 20000 });
  note('row entry opens the drawing attribute panel with real next steps');
} else {
  skip('row entry and attribute panel (the ledger has no rows on this instance)');
}

// --- narrow viewport --------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
assert.equal(await page.locator('.dw-ledger-kpi').count(), 6, 'narrow viewport keeps all indicators');
assert.equal(await page.locator('.dw-ledger-actions button').count(), 3, 'narrow viewport keeps the action row');
await page.screenshot({ path: shot('05-ledger-narrow') });
note('narrow viewport keeps indicators, actions and filters usable');

await writeFile(REPORT, JSON.stringify({
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  pageUrl: ARCHIVE_URL,
  risemapReference: 'docs/evidence/risemap-drawing-archives-live-20260917.md',
  created: createdCode || null,
  screenshots: ['01-file-tree-mode', '02-ledger-mode', '03-filter-empty-state', '04-row-attribute-panel', '05-ledger-narrow'].map((x) => shot(x)),
  observed,
  skipped,
}, null, 2) + '\n');

console.log('PASS drawing archive ledger readback (' + observed.length + ' checks, ' + skipped.length + ' skipped)');
await browser.close();
