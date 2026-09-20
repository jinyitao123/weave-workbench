import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const api = await connect(process.env.FORGE_URL || 'http://localhost:4489');
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, object);
  return (result.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}

const [active] = await find('forge_supplier_price_book', { code: 'PB-ACC-ACTIVE-001' });
const [voided] = await find('forge_supplier_price_book', { code: 'PB-ACC-VOID-001' });
assert.ok(active && voided, 'acceptance price books must survive restart');
const [line] = await find('forge_supplier_price_book_line', { price_book_id: active.id });
const [activeLog] = await find('forge_supplier_price_book_status_log', { price_book_id: active.id });
const [voidLog] = await find('forge_supplier_price_book_status_log', { price_book_id: voided.id });
const [task] = await find('forge_supplier_price_book_batch_task', { price_book_id: active.id });
assert.ok(line && activeLog && voidLog && task, 'price line, lifecycle logs and batch task must survive restart');
assert.deepEqual({
  activeStatus: active.status, activeLines: Number(active.line_count), net: Number(line.net_price), activeAction: activeLog.action,
  voidStatus: voided.status, voidReason: voided.void_reason, voidAction: voidLog.action,
  taskStatus: task.status, taskSuccess: Number(task.success_rows),
}, {
  activeStatus: 'active', activeLines: 1, net: 85.5, activeAction: 'activated',
  voidStatus: 'voided', voidReason: '供应商报价协议已撤回', voidAction: 'voided',
  taskStatus: 'completed', taskSuccess: 1,
});
console.log(JSON.stringify({ suite: 'supplier-price-book-restart-readback', status: 'passed', active_id: active.id, voided_id: voided.id, line_id: line.id, task_id: task.id }, null, 2));
