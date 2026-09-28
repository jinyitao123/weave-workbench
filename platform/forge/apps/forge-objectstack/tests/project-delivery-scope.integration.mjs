import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectReadDeliveryScope, ProjectRefreshCustomerSnapshot } from '../src/actions/project.action.ts';

const project = { id: 'project-1', customer_id: 'customer-1' };
const contract = {
  id: 'contract-1', code: 'SC-TEST-001', customer_id: 'customer-1', quotation_id: 'quote-1',
  status: 'active', signed_on: '2026-09-28', signed_evidence_attachment: 'signed-file-1',
};
const order = {
  id: 'order-1', code: 'SO-TEST-001', customer_id: 'customer-1', contract_id: 'contract-1',
  quotation_id: 'quote-1', status: 'active',
};
const quote = {
  id: 'quote-1', code: 'QT-TEST-001', customer_id: 'customer-1', status: 'accepted',
  pricing_version: 4, accepted_pricing_version: 4, customer_acceptance_evidence_attachment: 'accept-file-1',
};
const quoteLines = [
  { id: 'quote-line-1', quotation_id: 'quote-1', name: '设备 A', line_type: 'material', sku_id: 'sku-1', item_code: 'MAT-1', model: 'A', specification: '标准', unit_name: '台', quantity: 2, taxed_unit_price: 1000, tax_rate: 13, discount_rate: 0, taxed_subtotal: 2000 },
  { id: 'quote-line-2', quotation_id: 'quote-1', name: '视觉联调服务', line_type: 'service', sku_id: null, item_code: null, model: null, specification: '现场联调', unit_name: '项', quantity: 1, taxed_unit_price: 300, tax_rate: 13, discount_rate: 0, taxed_subtotal: 300 },
];
const contractLines = [
  { id: 'contract-line-1', contract_id: 'contract-1', quotation_line_id: 'quote-line-1', name: '设备 A', line_type: 'material', sku_id: 'sku-1', item_code: 'MAT-1', model: 'A', specification: '标准', unit_name: '台', quantity_limit: 2, taxed_unit_price: 1000, tax_rate: 13, discount_rate: 0, taxed_subtotal: 2000 },
  { id: 'contract-line-2', contract_id: 'contract-1', quotation_line_id: 'quote-line-2', name: '视觉联调服务', line_type: 'service', sku_id: null, item_code: null, model: null, specification: '现场联调', unit_name: '项', quantity_limit: 1, taxed_unit_price: 300, tax_rate: 13, discount_rate: 0, taxed_subtotal: 300 },
];
const orderLines = [
  { id: 'order-line-1', order_id: 'order-1', contract_line_id: 'contract-line-1', quotation_line_id: 'quote-line-1', name: '设备 A', line_type: 'material', sku_id: 'sku-1', item_code: 'MAT-1', model: 'A', specification: '标准', unit_name: '台', quantity: 2, taxed_unit_price: 1000, untaxed_unit_price: 884.9558, tax_rate: 13, discount_rate: 0, taxed_subtotal: 2000 },
  { id: 'order-line-2', order_id: 'order-1', contract_line_id: 'contract-line-2', quotation_line_id: 'quote-line-2', name: '视觉联调服务', line_type: 'service', sku_id: null, item_code: null, model: null, specification: '现场联调', unit_name: '项', quantity: 1, taxed_unit_price: 300, untaxed_unit_price: 265.4867, tax_rate: 13, discount_rate: 0, taxed_subtotal: 300 },
];

function harness(overrides = {}) {
  const rows = {
    forge_project_sales_link: [{ id: 'link-1', project_id: project.id, contract_id: contract.id, order_id: order.id, contract_code_snapshot: contract.code, order_code_snapshot: order.code }],
    forge_sales_contract: [contract],
    forge_sales_order: [order],
    forge_quotation: [quote],
    forge_sales_contract_line: contractLines,
    forge_sales_order_line: orderLines,
    forge_quotation_line: quoteLines,
    ...overrides,
  };
  const calls = [];
  const object = name => ({
    find: async query => {
      calls.push({ name, method: 'find', query });
      const found = (rows[name] || []).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
      return query.fields ? found.map(row => Object.fromEntries(query.fields.map(field => [field, row[field]]))) : found;
    },
    findOne: async query => {
      calls.push({ name, method: 'findOne', query });
      const row = (rows[name] || []).find(item => Object.entries(query.where || {}).every(([key, value]) => item[key] === value));
      if (!row) return null;
      return query.fields ? Object.fromEntries(query.fields.map(field => [field, row[field]])) : row;
    },
  });
  const ctx = { recordId: project.id, record: project, recordLoadDenied: false, api: { object } };
  return { calls, run: new Function('ctx', `return (async () => { ${ProjectReadDeliveryScope.body.source} })()`), ctx };
}

test('reads only linked signed-order lines and preserves material/service source trace', async () => {
  const h = harness();
  const result = await h.run(h.ctx);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].source_version_valid, true);
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.lines.map(line => ({ type: line.line_type, name: line.name, quantity: line.quantity, price: line.taxed_unit_price, rate: line.tax_rate, subtotal: line.taxed_subtotal, verified: line.trace_consistent })), [
    { type: 'material', name: '设备 A', quantity: 2, price: 1000, rate: 13, subtotal: 2000, verified: true },
    { type: 'service', name: '视觉联调服务', quantity: 1, price: 300, rate: 13, subtotal: 300, verified: true },
  ]);
  assert.equal(result.lines[1].sku_id, undefined, 'project-facing result must not expose internal SKU references');
  assert.ok(h.calls.some(call => call.name === 'forge_sales_order_line' && call.query.where.order_id === order.id));
  assert.ok(h.calls.every(call => call.name !== 'forge_sales_order_line' || call.query.where.order_id === order.id));
});

test('flags a service line with an SKU instead of treating it as a valid project service', async () => {
  const invalidLines = orderLines.map(line => line.id === 'order-line-2' ? { ...line, sku_id: 'sku-service-invalid' } : line);
  const h = harness({ forge_sales_order_line: invalidLines });
  const result = await h.run(h.ctx);
  const service = result.lines.find(line => line.line_type === 'service');
  assert.equal(service.trace_consistent, false);
  assert.ok(service.trace_issues.includes('服务项目不应关联物料规格'));
});

test('flags a superseded accepted quote version and does not claim the source chain is consistent', async () => {
  const h = harness({ forge_quotation: [{ ...quote, pricing_version: 5 }] });
  const result = await h.run(h.ctx);
  assert.equal(result.sources[0].source_version_valid, false);
  assert.ok(result.warnings.includes('订单来源报价或客户接受核价版本未通过核对'));
  assert.ok(result.lines.every(line => line.trace_consistent === false));
});

test('returns a genuine empty result when no project contract/order link exists', async () => {
  const h = harness({ forge_project_sales_link: [] });
  const result = await h.run(h.ctx);
  assert.deepEqual(result, { sources: [], lines: [], warnings: [] });
});

test('keeps a valid direct-contract order usable without inventing a quote source', async () => {
  const directContract = { ...contract, quotation_id: null };
  const directOrder = { ...order, quotation_id: null };
  const directContractLines = contractLines.map(line => { const { quotation_line_id, ...rest } = line; return { ...rest, contract_id: directContract.id }; });
  const directOrderLines = orderLines.map(line => { const { quotation_line_id, ...rest } = line; return { ...rest, order_id: directOrder.id }; });
  const h = harness({
    forge_sales_contract: [directContract], forge_sales_order: [directOrder],
    forge_sales_contract_line: directContractLines, forge_sales_order_line: directOrderLines,
    forge_quotation: [], forge_quotation_line: [],
  });
  const result = await h.run(h.ctx);
  assert.equal(result.sources[0].source_version_valid, null);
  assert.equal(result.lines.length, 2);
  assert.ok(result.lines.every(line => line.trace_consistent));
  assert.deepEqual(result.warnings, []);
});

test('denies access when the platform did not load the project through the caller permission', async () => {
  const h = harness();
  h.ctx.recordLoadDenied = true;
  await assert.rejects(() => h.run(h.ctx), /当前项目不存在或不可访问/);
  assert.equal(h.calls.length, 0);
});

test('lets the project creator copy only their own customer name into the project snapshot', async () => {
  const calls = [];
  const customer = { id: 'customer-1', name: '客户 A', owner_id: 'creator-1' };
  const ctx = {
    recordId: project.id,
    record: { ...project, created_by: 'creator-1', customer_name_snapshot: null },
    session: { userId: 'creator-1' },
    recordLoadDenied: false,
    api: { object: name => ({
      findOne: async query => { calls.push({ name, method: 'findOne', query }); return name === 'forge_customer' ? customer : null; },
      update: async values => { calls.push({ name, method: 'update', values }); },
    }) },
  };
  const run = new Function('ctx', `return (async () => { ${ProjectRefreshCustomerSnapshot.body.source} })()`);
  assert.deepEqual(await run(ctx), { id: project.id, status: 'updated' });
  assert.deepEqual(calls.find(call => call.name === 'forge_customer').query, { where: { id: 'customer-1' }, fields: ['id', 'name', 'owner_id'] });
  assert.deepEqual(calls.find(call => call.name === 'forge_project').values, { id: project.id, customer_name_snapshot: '客户 A' });
});

test('customer snapshot retry is idempotent and another customer owner cannot repair it', async () => {
  const writes = [];
  const run = new Function('ctx', `return (async () => { ${ProjectRefreshCustomerSnapshot.body.source} })()`);
  const alreadyFilled = { recordId: project.id, record: { ...project, created_by: 'creator-1', customer_name_snapshot: '客户 A' }, session: { userId: 'creator-1' }, recordLoadDenied: false, api: { object: () => ({ findOne: async () => { throw new Error('must not read'); }, update: async () => { writes.push('unexpected'); } }) } };
  assert.deepEqual(await run(alreadyFilled), { id: project.id, status: 'unchanged' });
  const otherOwner = { recordId: project.id, record: { ...project, created_by: 'creator-1', customer_name_snapshot: null }, session: { userId: 'creator-1' }, recordLoadDenied: false, api: { object: name => ({ findOne: async () => ({ id: 'customer-1', name: '客户 A', owner_id: 'someone-else' }), update: async () => { writes.push(name); } }) } };
  await assert.rejects(() => run(otherOwner), /当前账号无法读取此项目关联客户/);
  assert.deepEqual(writes, []);
});
