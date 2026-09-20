import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api = await connect();
const find = async object => {
  const response = await api.request(`/data/${object}?$top=500`);
  assert.equal(response.status, 200, `${object} list`);
  return response.value.records || [];
};

const [returns, lines, orders, suppliers, ledgers] = await Promise.all([
  'forge_purchase_return', 'forge_purchase_return_line', 'forge_purchase_order', 'forge_supplier', 'forge_inventory_ledger',
].map(find));
const record = returns.find(row => row.status === 'completed' && row.outbound_status === 'outbounded');
assert.ok(record, 'a completed purchase return outbound must exist');
const recordLines = lines.filter(row => row.return_id === record.id);
assert.ok(recordLines.length > 0, 'purchase return must retain material lines');
assert.ok(orders.some(row => row.id === record.order_id), 'purchase order source must be readable');
assert.ok(suppliers.some(row => row.id === record.supplier_id), 'supplier source must be readable');
assert.equal(recordLines.reduce((sum, row) => sum + Number(row.outbounded_quantity || 0), 0), Number(record.total_quantity), 'outbound progress must equal return quantity');
assert.equal(ledgers.filter(row => row.source_object === 'forge_purchase_return' && row.source_id === record.id && row.movement_type === 'purchase_return_outbound').length, recordLines.length, 'every outbound line must have a source ledger');

const repeat = await api.request(`/actions/forge_purchase_return/purchase_return_outbound/${record.id}`, 'POST', { params: { outbound_comment: '重复出库阻断验证' } });
assert.ok(repeat.status >= 400, 'completed purchase return must reject repeated outbound');
const afterRepeat = await find('forge_inventory_ledger');
assert.equal(afterRepeat.filter(row => row.source_object === 'forge_purchase_return' && row.source_id === record.id && row.movement_type === 'purchase_return_outbound').length, recordLines.length, 'rejected repeat must not add inventory ledgers');

const pageSource = await readFile('src/pages/purchase-return-outbounds.page.ts', 'utf8');
for (const label of ['退货单号', '供应商', '退货地址', '退货金额', '出库进度', '状态', '日期', '操作']) assert.ok(pageSource.includes(label), `page must expose ${label}`);
assert.ok(pageSource.includes('page_purchase_return?id='), 'row action must return to the source purchase return');
console.log(`PASS purchase return outbound source chain and persisted progress: ${record.code}`);
