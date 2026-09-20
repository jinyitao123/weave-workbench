import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [page, index, routing] = await Promise.all([
  readFile(new URL('../src/pages/drawing-guide.page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/supply-production-routing.page.ts', import.meta.url), 'utf8'),
]);

for (const token of ['ForgePageHeader', '选择角色视角', '完整业务流程', '搜索图纸指南', '标记已掌握', '打开图纸总览', "localStorage.setItem('forge-drawing-guide-known'"]) {
  assert.ok(page.includes(token), `drawing guide missing ${token}`);
}
for (const role of ['设计 / 工艺', '审核 / 会审', '文控管理员', '使用部门']) assert.ok(page.includes(role));
for (const stage of ['图号建档', '版本提交', '会审审批', '图纸发布', '变更执行', '发放追溯']) assert.ok(page.includes(stage));
for (const target of ['page_drawing_archive', 'page_drawing_review', 'page_drawing_release', 'page_drawing_change', 'page_drawing_distribution', 'page_drawing_query', 'page_customer_drawings']) assert.ok(page.includes(target));
assert.ok(index.includes("export * from './drawing-guide.page.js'"));
assert.ok(!routing.includes("export const DrawingGuidePage = makePage"), 'generic routed drawing guide must not remain exported');
console.log('PASS drawing guide is a dedicated role-based page with real destinations');
