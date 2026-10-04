import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const page = await readFile(new URL('../src/pages/management-profit-report.page.ts', import.meta.url), 'utf8');
const functionStart = page.indexOf('function reportColumns(compareBasis)');
assert.ok(functionStart >= 0, 'the report must derive all presentation columns from compare_basis');
const bodyStart = page.indexOf('{', functionStart);
let depth = 0;
let functionEnd = -1;
for (let i = bodyStart; i < page.length; i += 1) {
  if (page[i] === '{') depth += 1;
  if (page[i] === '}') {
    depth -= 1;
    if (depth === 0) {
      functionEnd = i + 1;
      break;
    }
  }
}
assert.ok(functionEnd > bodyStart, 'reportColumns must be a complete pure function');
const reportColumns = vm.runInNewContext('(' + page.slice(functionStart, functionEnd) + ')');

const noneColumns = reportColumns('none');
assert.deepEqual(Array.from(noneColumns, (column) => column.label), ['项目', '行次', '本期金额', '本年累计']);
assert.deepEqual(Array.from(noneColumns, (column) => column.value(['营业收入', '1', 12500])), ['营业收入', '1', '12500.00', '12500.00']);

const compareColumns = reportColumns('year_on_year');
assert.deepEqual(Array.from(compareColumns, (column) => column.label), ['项目', '行次', '本期金额', '上年同期', '本年累计', '上年同期累计', '差异率']);
assert.deepEqual(Array.from(compareColumns, (column) => column.value(['营业收入', '1', 12500])), ['营业收入', '1', '12500.00', '0.00', '12500.00', '0.00', '—']);

assert.ok(page.includes('const d=state.data,reportTemplate=') && page.includes('statementColumns=reportColumns(compare)'));
assert.ok(page.includes('statementColumns.map(column=><th key={column.key}>{column.label}</th>)'), 'the table header must use the selected comparison shape');
assert.ok(page.includes('statementColumns.map(column=><td key={column.key}>{column.value(x)}</td>)'), 'the report rows must use the same selected comparison shape');
assert.ok(page.includes('statementColumns.map(column=>column.label)'), 'CSV headers must use the selected comparison shape');
assert.ok(page.includes('lines.map(row=>statementColumns.map(column=>column.value(row)))'), 'CSV rows must use the selected comparison shape');
assert.ok(page.includes("compare==='none'?'未启用同比':'收入同比 —'"), 'the KPI must not show comparison residue when comparison is disabled');
assert.ok(page.includes("compare==='none'?'点击本期金额查看已审核来源单据；当前展示本期与本年累计金额。'"), 'the table description must match the selected basis');
assert.equal((page.match(/<th>上年同期/g) || []).length, 0, 'comparison labels may not remain as unconditional table markup');
assert.ok(page.includes('compare_basis:compare'), 'generated version snapshots must preserve the selected comparison basis');

console.log('管理利润表 comparison=none renders and exports four period columns; year_on_year keeps all seven comparison columns.');
