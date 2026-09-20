// Browser readback for the 委外管理 group (生产 → 委外管理).
//
// Covers all 14 pages: guide, dashboard, orders, suppliers, pricing, issue,
// receipt, return, reconciliation, stock, trace, undelivered, inbound report and
// reconciliation statement.
//
// The 委外 list pages already carried RISEMAP's column order and status strips;
// this round gives every page the branded hero (breadcrumb, title, RISEMAP
// description, tone) plus the shared action row, and proves it renders. Read-only.
//
// Usage:
//   FORGE_URL=http://localhost:3000 FORGE_SMOKE_EMAIL=... FORGE_SMOKE_PASSWORD=... \
//   node tests/subcontract-group-ui-readback.mjs

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.FORGE_URL || 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.FORGE_SMOKE_EMAIL || '';
const PASSWORD = process.env.FORGE_SMOKE_PASSWORD || '';
const LOAD_TIMEOUT = Number(process.env.FORGE_UI_TIMEOUT || 180000);
const SHOTS = path.resolve(process.env.FORGE_GROUP_SHOTS || '../../docs/evidence/subcontract-group');
const REPORT = path.resolve('.objectstack/acceptance/subcontract-group-report.json');

let chromium = null;
try {
  ({ chromium } = await import(process.env.FORGE_PLAYWRIGHT_MODULE || 'playwright'));
} catch {
  console.log('SKIP 委外管理 readback — Playwright not available (set FORGE_PLAYWRIGHT_MODULE)');
  process.exit(0);
}
assert.ok(EMAIL && PASSWORD, 'FORGE_SMOKE_EMAIL/FORGE_SMOKE_PASSWORD are required');
await mkdir(SHOTS, { recursive: true });
await mkdir(path.dirname(REPORT), { recursive: true });

const checks = [];
const pass = (text) => { checks.push(text); console.log('PASS ' + text); };

// page id, hero title, description fragment taken from RISEMAP
const PAGES = [
  ['page_subcontract_guide', '委外管理上手指南', '按实际业务任务快速完成订单、发料、回厂和对账'],
  ['page_subcontract_dashboard', '委外看板', '从供应商能力、订单审批到发料、回厂和对账的委外业务入口'],
  ['page_subcontract_workspace', '委外订单', '整件委外 / 甲供料'],
  ['page_subcontract_issue_workspace', '委外发料', '管理甲供物料出库、交接与供应商签收'],
  ['page_subcontract_receipt_workspace', '委外回厂', '集中查询回厂验收结果、关联入库单与对账依据'],
  ['page_subcontract_return_workspace', '委外退料', '集中管理委外余料、工程变更及错发物料的退回和入库记录'],
  ['page_subcontract_reconciliation', '委外对账', '集中管理加工费、补料费用、损耗扣款及应付生成进度'],
  ['page_subcontract_suppliers', '委外供应商', '维护工艺能力、信用等级、加工价目表'],
  ['page_subcontract_pricing', '加工价目', '按委外供应商和加工类型维护价格'],
  ['page_subcontract_stock', '委外厂库存', '按 委外订单 + 物料 维度查询发到外协厂的在途库存'],
  ['page_subcontract_trace', '委外批次追溯', '基于回厂倒冲记录的材料↔成品批次关联'],
  ['page_subcontract_undelivered', '委外未交明细表', '按行展开所有未回完的委外订单'],
  ['page_subcontract_inbound_report', '委外进货明细表', '按物料行展开明细'],
  ['page_subcontract_reconciliation_report', '委外对账单（报表）', '对账数据查询视图'],
];

const browser = await chromium.launch({ headless: true, channel: process.env.FORGE_CHROME_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
await page.fill('#login-email', EMAIL);
await page.fill('#login-password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForFunction(() => document.querySelectorAll('a[href]').length > 3 && !(document.body ? document.body.innerText : '').includes('正在初始化'), null, { timeout: LOAD_TIMEOUT });

for (const [id, title, description] of PAGES) {
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
  const hero = await page.evaluate(() => {
    const node = document.querySelector('.fpHero');
    return {
      title: (node.querySelector('.fpHeroTitle') || {}).textContent || '',
      description: (node.querySelector('.fpHeroDesc') || {}).textContent || '',
      crumbs: [...node.querySelectorAll('.fpHeroCrumbs span')].map((n) => n.textContent).filter((t) => t && t !== '›'),
      tones: node.className,
    };
  });
  assert.equal(hero.title, title, id + ' hero 标题');
  assert.ok(hero.description.includes(description), id + ' hero 说明应对齐 RISEMAP：' + hero.description);
  assert.deepEqual(hero.crumbs.slice(0, 2), ['生产', '委外管理'], id + ' hero 面包屑');
  assert.ok(/tone-/.test(hero.tones), id + ' hero 色调');
  // the page keeps exactly one heading area: the hero must not be duplicated by a plain header
  const legacyHeader = await page.locator('.forge-product .fp-title:visible, .forge-product .fp-eyebrow:visible').count();
  assert.equal(legacyHeader, 0, id + ' 旧标题区未清理干净');
  await page.screenshot({ path: path.join(SHOTS, id + '.png') });
  pass(title + '：hero 面包屑/标题/说明与 RISEMAP 一致，且无重复标题区');
}

await writeFile(REPORT, JSON.stringify({
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  group: '生产 / 委外管理',
  pages: PAGES.map(([id, title]) => ({ page: id, title })),
  checks,
}, null, 2) + '\n');

console.log('PASS 委外管理组页面回读（' + checks.length + ' 项）');
await browser.close();
