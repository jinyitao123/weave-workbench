import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSalesPriceDraft, salesPriceBaselineToken } from '../src/actions/sales-pricing.logic.ts';
import { SalesPriceDraftSave, SalesPriceSubmit, SalesPriceResolve, SalesPriceReviewers } from '../src/actions/sales-pricing.action.ts';
import { SalesApprovedPriceApply } from '../src/hooks/sales-pricing.hook.ts';
import { SalesQuotationPriceResolve } from '../src/actions/sales-quotation-price.action.ts';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = (definition, ctx) => new AsyncFunction('ctx', definition.body.source)({...ctx,session:{businessDate:'2026-10-10',...ctx.session}});
const org = 'test-org', actor = 'test-clerk';
const sampleDraft = overrides => ({ kind: 'adjustment', reason: '年度销售价格调整', lines: [{ sku_id: 'sku-1', quantity: '2.5000', proposed_price: '12.3456' }], ...overrides });

function memoryApi(seed, rejectUpdate, bindFileFields = true) {
  let tables = structuredClone(seed), sequence = 0;
  const match = (record, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === '$or') return value.some(part => match(record, part));
    if (value && typeof value === 'object') {
      if ('$in' in value) return value.$in.includes(record[key]);
      throw new Error('Unsupported test predicate: ' + key);
    }
    return (record[key] ?? null) === (value ?? null);
  });
  const linkFiles = (name, row) => {
    if (!bindFileFields || name !== 'forge_sales_price_request') return;
    const ids = new Set(row.attachment_ids || []);
    for (const file of tables.sys_file || []) {
      if (file.ref_object === name && file.ref_id === row.id && file.ref_field === 'attachment_ids' && !ids.has(file.id)) Object.assign(file, { ref_object: null, ref_id: null, ref_field: null });
      if (ids.has(file.id)) Object.assign(file, { ref_object: name, ref_id: row.id, ref_field: 'attachment_ids' });
    }
  };
  const api = {
    object(name) {
      const records = () => tables[name] ||= [];
      return {
        find: async ({ where, offset = 0, limit = 200 } = {}) => records().filter(row => match(row, where)).slice(offset, offset + limit),
        findOne: async ({ where }) => records().find(row => match(row, where)) || null,
        insert: async data => { const row = { ...data, id: `test-${++sequence}`, code: `TEST-${sequence}` }; records().push(row); linkFiles(name, row); return row; },
        update: async (data, { where, multi } = {}) => {
          if (rejectUpdate?.(name, data, where)) return 0;
          const selected = records().filter(row => match(row, where || { id: data.id }));
          for (const row of selected) { Object.assign(row, data); linkFiles(name, row); }
          return multi ? selected.length : selected[0];
        },
        delete: async ({ where }) => { tables[name] = records().filter(row => !match(row, where)); },
      };
    },
    async transaction(callback) {
      const before = structuredClone(tables);
      try { return await callback(); } catch (error) { tables = before; throw error; }
    },
  };
  return { api, rows: name => tables[name] || [] };
}

function applyFixture(kind = 'adjustment', second = false) {
  const skus = [{ id: 'sku-1', organization_id: org, sale_price: 100.0001, updated_at: '2026-01-01T00:00:00Z', sale_price_revision: 0 }];
  if (second) skus.push({ ...skus[0], id: 'sku-2' });
  const request = { id: 'request-1', organization_id: org, code: 'PR-TEST', kind, status: 'approved', approval_status: 'approved', effect_status: 'pending', item_count: skus.length, revision: 1, submitted_by: actor, reason: '业务价格复核', customer_id: kind === 'adjustment' ? null : 'customer-1', valid_from: kind === 'adjustment' ? null : '2020-01-01', valid_until: null };
  const lines = skus.map((sku, index) => ({ id: `line-${index}`, organization_id: org, request_id: request.id, name: '测试物料', sku_id: sku.id, material_code: `TEST-${index}`, quantity: 1, original_price: sku.sale_price, proposed_price: 120.0001, baseline_token: salesPriceBaselineToken(sku), baseline_revision: 0, target_key: JSON.stringify([kind === 'adjustment' ? 'catalog' : 'customer', request.customer_id || '', sku.id]) }));
  const cursors = lines.map((line, index) => ({ id: `cursor-${index}`, organization_id: org, target_key: line.target_key, revision: 0 }));
  return { forge_sales_price_request: [request], forge_sales_price_request_line: lines, forge_material_sku: skus, forge_sales_price_cursor: cursors, forge_sales_price_history: [] };
}
const hookContext = api => ({ api, input: { id: 'request-1', status: 'approved' }, previous: { id: 'request-1', status: 'pending_approval' }, session: { organizationId: org, isSystem: true } });

test('unit prices and extended amounts retain four decimal places without binary multiplication drift', () => {
  const draft = normalizeSalesPriceDraft(JSON.stringify(sampleDraft()));
  assert.equal(draft.lines[0].proposed_price, '12.3456');
  assert.equal(draft.proposed_total, '30.8640');
  assert.equal(normalizeSalesPriceDraft(JSON.stringify(sampleDraft({ lines: [{ sku_id: 'sku-1', quantity: '0.1', proposed_price: '0.0005' }] }))).proposed_total, '0.0001');
});

test('duplicate SKUs, invalid intervals and missing customer attribution are rejected', () => {
  assert.throws(() => normalizeSalesPriceDraft(JSON.stringify(sampleDraft({ lines: [{ sku_id: 'sku-1', proposed_price: 1 }, { sku_id: 'sku-1', proposed_price: 2 }] }))), /重复/);
  assert.throws(() => normalizeSalesPriceDraft(JSON.stringify(sampleDraft({ kind: 'agreement', customer_id: 'customer-1', valid_from: '2026-02-30', valid_until: '2026-04-01' }))), /无效/);
  assert.throws(() => normalizeSalesPriceDraft(JSON.stringify(sampleDraft({ kind: 'special' }))), /客户/);
});

test('a frozen baseline detects price changes outside this workspace, including an ABA price change', () => {
  const sku = { sale_price: 100, updated_at: '2026-01-01' };
  assert.notEqual(salesPriceBaselineToken(sku), salesPriceBaselineToken({ ...sku, updated_at: '2026-01-02' }));
});

test('approved catalog changes atomically update the SKU, advance the cursor and retain a price version', async () => {
  const db = memoryApi(applyFixture());
  await execute(SalesApprovedPriceApply, hookContext(db.api));
  assert.equal(db.rows('forge_material_sku')[0].sale_price, 120.0001);
  assert.equal(db.rows('forge_sales_price_cursor')[0].revision, 1);
  assert.equal(db.rows('forge_sales_price_history').length, 1);
  assert.equal(db.rows('forge_sales_price_history')[0].original_price, 100.0001);
  assert.equal(db.rows('forge_sales_price_request')[0].effect_status, 'applied');
  await execute(SalesApprovedPriceApply, hookContext(db.api));
  assert.equal(db.rows('forge_sales_price_history').length, 1);
});

test('customer prices are retained as effective versions without changing the global catalog', async () => {
  const db = memoryApi(applyFixture('agreement'));
  await execute(SalesApprovedPriceApply, hookContext(db.api));
  assert.equal(db.rows('forge_material_sku')[0].sale_price, 100.0001);
  assert.equal(db.rows('forge_sales_price_history')[0].customer_id, 'customer-1');
  assert.equal(db.rows('forge_sales_price_request')[0].effect_status, 'applied');
});

test('a concurrent change on a later line rolls back earlier lines and reports an execution conflict', async () => {
  const db = memoryApi(applyFixture('adjustment', true), (name, _data, where) => name === 'forge_material_sku' && where.id === 'sku-2');
  await execute(SalesApprovedPriceApply, hookContext(db.api));
  assert.deepEqual(db.rows('forge_material_sku').map(row => row.sale_price), [100.0001, 100.0001]);
  assert.deepEqual(db.rows('forge_sales_price_cursor').map(row => row.revision), [0, 0]);
  assert.equal(db.rows('forge_sales_price_history').length, 0);
  assert.equal(db.rows('forge_sales_price_request')[0].effect_status, 'conflict');
});

test('a stale baseline does not overwrite the new current price', async () => {
  const seed = applyFixture(); seed.forge_material_sku[0].sale_price = 105;
  const db = memoryApi(seed);
  await execute(SalesApprovedPriceApply, hookContext(db.api));
  assert.equal(db.rows('forge_material_sku')[0].sale_price, 105);
  assert.equal(db.rows('forge_sales_price_history').length, 0);
  assert.equal(db.rows('forge_sales_price_request')[0].effect_status, 'conflict');
});

test('draft retry returns its durable receipt and cannot create another application', async () => {
  const db = memoryApi({ sys_member: [{ organization_id: org, user_id: actor }], forge_material_sku: [{ id: 'sku-1', organization_id: org, material_id: 'material-1', sale_price: 10 }], forge_material: [{ id: 'material-1', organization_id: org, name: '测试物料', code: 'TEST-MATERIAL' }] });
  const ctx = { api: db.api, user: { id: actor, organizationId: org }, input: { request_key: 'save-test', draft_json: JSON.stringify(sampleDraft()) } };
  const first = await execute(SalesPriceDraftSave, ctx), repeated = await execute(SalesPriceDraftSave, ctx);
  assert.deepEqual(repeated, first);
  assert.equal(db.rows('forge_sales_price_request').length, 1);
  ctx.input.draft_json = JSON.stringify(sampleDraft({ reason: '不同请求' }));
  await assert.rejects(execute(SalesPriceDraftSave, ctx), /相同请求/);
});

test('first catalog pricing preserves an unknown original price instead of fabricating zero', async () => {
  const db = memoryApi({ sys_member: [{ organization_id: org, user_id: actor }], forge_material_sku: [{ id: 'sku-1', organization_id: org, material_id: 'material-1', sale_price: null }], forge_material: [{ id: 'material-1', organization_id: org, name: '测试物料', code: 'TEST-MATERIAL' }] });
  const saved = await execute(SalesPriceDraftSave, { api: db.api, user: { id: actor, organizationId: org }, input: { request_key: 'initial-price', draft_json: JSON.stringify(sampleDraft()) } });
  const request = db.rows('forge_sales_price_request')[0], line = db.rows('forge_sales_price_request_line')[0];
  assert.equal(request.original_total, null);
  assert.equal(line.original_price, null);
  Object.assign(request, { status: 'approved', approval_status: 'approved', effect_status: 'pending' });
  await execute(SalesApprovedPriceApply, { api: db.api, input: { id: saved.id, status: 'approved' }, previous: { id: saved.id, status: 'pending_approval' }, session: { organizationId: org, isSystem: true } });
  assert.equal(db.rows('forge_material_sku')[0].sale_price, 12.3456);
  assert.equal(db.rows('forge_sales_price_history')[0].original_price, null);
});

test('submission rejects self-approval and requires a live independent native appointment', async () => {
  const fixture = applyFixture();
  fixture.forge_sales_price_request[0] = { ...fixture.forge_sales_price_request[0], status: 'draft', revision: 0, owner_id: actor, review_owner_id: actor };
  fixture.sys_member = [{ organization_id: org, user_id: actor }];
  fixture.sys_position = [{ organization_id: org, id: 'review-position', name: 'sales_order_reviewer', active: true }];
  fixture.sys_user_position = [{ organization_id: org, user_id: actor, position: 'review-position' }];
  fixture.sys_user = [{ id: actor }];
  const db = memoryApi(fixture);
  await assert.rejects(execute(SalesPriceSubmit, { api: db.api, user: { id: actor, organizationId: org }, recordId: 'request-1', input: { expected_revision: 0 } }), /独立审批任职/);
  assert.equal(db.rows('forge_sales_price_request')[0].status, 'draft');
});

test('customer price lookup ignores terminated sources and prices outside their effective window', async () => {
  const db = memoryApi({ sys_member: [{ organization_id: org, user_id: actor }], forge_customer: [{ organization_id: org, id: 'customer-1' }], forge_material_sku: [{ organization_id: org, id: 'sku-1', sale_price: 100 }], forge_sales_price_request: [{ organization_id: org, id: 'a', status: 'approved', effect_status: 'applied' }, { organization_id: org, id: 's', status: 'terminated', effect_status: 'applied' }], forge_sales_price_history: [{ organization_id: org, request_id: 'a', sku_id: 'sku-1', customer_id: 'customer-1', kind: 'agreement', price: 90, price_revision: 1, valid_from: '2026-01-01', valid_until: '2026-12-31' }, { organization_id: org, request_id: 's', sku_id: 'sku-1', customer_id: 'customer-1', kind: 'special', price: 80, price_revision: 2, valid_from: '2026-01-01', valid_until: '2026-12-31' }] });
  const ctx = { api: db.api, user: { id: actor, organizationId: org }, input: { customer_id: 'customer-1', sku_id: 'sku-1', date: '2026-10-10' } };
  assert.equal((await execute(SalesPriceResolve, ctx)).price, 90);
  ctx.input.date = '2027-01-01';
  assert.equal((await execute(SalesPriceResolve, ctx)).price, 100);
});

test('quote default pricing uses the effective customer price and refuses another employee’s customer', async () => {
  const seed = applyFixture('special');
  seed.sys_member = [{ organization_id: org, user_id: actor }];
  seed.forge_customer = [{ organization_id: org, id: 'customer-1', owner_id: actor }];
  const db = memoryApi(seed);
  await execute(SalesApprovedPriceApply, hookContext(db.api));
  const ctx = { api: db.api, user: { id: actor, organizationId: org }, input: { customer_id: 'customer-1', sku_id: 'sku-1', date: '2026-10-10' } };
  assert.equal((await execute(SalesQuotationPriceResolve, ctx)).price, 120.0001);
  db.rows('forge_customer')[0].owner_id = 'another-test-clerk';
  await assert.rejects(execute(SalesQuotationPriceResolve, ctx), /本人可办理客户/);
});


test('price draft preserves its native bound files and rolls back foreign file attempts', async () => {
  const fixture = () => ({ sys_member: [{ organization_id: org, user_id: actor }], forge_material_sku: [{ id: 'sku-1', organization_id: org, material_id: 'material-1', sale_price: 10 }], forge_material: [{ id: 'material-1', organization_id: org, name: '测试物料', code: 'TEST' }], sys_file: [{ id: 'file-1', organization_id: org, owner_id: actor, status: 'committed', name: '材料.pdf', size: 100 }] });
  const positive = fixture(); positive.forge_sales_price_request = [{ id: 'attachment-request', organization_id: org, owner_id: actor, status: 'draft', revision: 0 }]; Object.assign(positive.sys_file[0], { ref_object: 'forge_sales_price_request', ref_id: 'attachment-request', ref_field: 'attachment_ids' });
  const db = memoryApi(positive);
  const result = await execute(SalesPriceDraftSave, { api: db.api, user: { id: actor, organizationId: org }, input: { request_key: 'file-draft', request_id: 'attachment-request', expected_revision: 0, draft_json: JSON.stringify(sampleDraft({ attachment_ids: ['file-1'] })) } });
  assert.deepEqual(db.rows('forge_sales_price_request')[0].attachment_ids, ['file-1']);
  assert.equal(db.rows('sys_file')[0].ref_id, result.id);
  assert.equal(db.rows('sys_file')[0].ref_field, 'attachment_ids');
  for (const override of [{ owner_id: 'other-employee' }, { organization_id: 'other-org' }, { status: 'pending' }, { ref_id: 'other-record', ref_object: 'forge_sales_price_request' }]) {
    const seed = fixture(); Object.assign(seed.sys_file[0], override); const denied = memoryApi(seed);
    await assert.rejects(execute(SalesPriceDraftSave, { api: denied.api, user: { id: actor, organizationId: org }, input: { request_key: 'rejected-file', draft_json: JSON.stringify(sampleDraft({ attachment_ids: ['file-1'] })) } }), /辅助材料/);
    assert.equal(denied.rows('forge_sales_price_request').length, 0);
  }
});

test('reviewer choices come only from independent active native appointments in the current organization', async () => {
  const db = memoryApi({ sys_member: [{ organization_id: org, user_id: actor }, { organization_id: org, user_id: 'reviewer' }, { organization_id: org, user_id: 'banned-reviewer' }], sys_position: [{ organization_id: org, id: 'position', name: 'sales_order_reviewer', active: true }], sys_user_position: [{ organization_id: org, user_id: actor, position: 'position' }, { organization_id: org, user_id: 'reviewer', position: 'position' }, { organization_id: org, user_id: 'banned-reviewer', position: 'position' }, { organization_id: 'other-org', user_id: 'outsider', position: 'position' }], sys_user: [{ id: actor }, { id: 'reviewer', name: '独立复核人' }, { id: 'banned-reviewer', banned: true }, { id: 'outsider' }] });
  assert.deepEqual(await execute(SalesPriceReviewers, { api: db.api, user: { id: actor, organizationId: org } }), { reviewers: [{ id: 'reviewer', name: '独立复核人' }] });
});

function attachmentDraftFixture(fileOverrides = {}, bindFileFields = true) {
  const file = { id: 'file-1', organization_id: org, owner_id: actor, status: 'committed', name: '申请说明.pdf', size: 1024, ...fileOverrides };
  const db = memoryApi({ sys_member: [{ organization_id: org, user_id: actor }], sys_file: [file], forge_material_sku: [{ id: 'sku-1', organization_id: org, material_id: 'material-1', sale_price: 10 }], forge_material: [{ id: 'material-1', organization_id: org, name: '测试物料' }] }, undefined, bindFileFields);
  const ctx = { api: db.api, user: { id: actor, organizationId: org }, input: { request_key: 'file-save', draft_json: JSON.stringify(sampleDraft({ attachment_ids: ['file-1'] })) } };
  return { db, ctx };
}

test('auxiliary files retain native ownership, bind to the saved request and replay without another draft', async () => {
  const { db, ctx } = attachmentDraftFixture();
  const saved = await execute(SalesPriceDraftSave, ctx);
  assert.equal(db.rows('sys_file')[0].ref_id, saved.id);
  assert.equal(db.rows('sys_file')[0].ref_field, 'attachment_ids');
  assert.deepEqual(await execute(SalesPriceDraftSave, ctx), saved);
  assert.equal(db.rows('forge_sales_price_request').length, 1);
});

test('files owned by another employee or organization, or bound elsewhere, cannot enter a price request', async () => {
  for (const overrides of [{ owner_id: 'other-employee' }, { organization_id: 'other-org' }, { ref_object: 'forge_sales_contract', ref_id: 'contract-1', ref_field: 'attachment_ids' }, { status: 'pending' }]) {
    const { db, ctx } = attachmentDraftFixture(overrides);
    await assert.rejects(execute(SalesPriceDraftSave, ctx), /辅助材料/);
    assert.equal(db.rows('forge_sales_price_request').length, 0);
  }
});

test('missing native file binding aborts the draft transaction', async () => {
  const { db, ctx } = attachmentDraftFixture({}, false);
  await assert.rejects(execute(SalesPriceDraftSave, ctx), /归属尚未确认/);
  assert.equal(db.rows('forge_sales_price_request').length, 0);
  assert.equal(db.rows('forge_sales_price_request_line').length, 0);
  assert.equal(db.rows('sys_file')[0].ref_id, undefined);
});

test('duplicate files, unsupported payloads and oversized material are rejected', async () => {
  assert.throws(() => normalizeSalesPriceDraft(JSON.stringify(sampleDraft({ attachment_ids: ['file-1', 'file-1'] }))), /辅助材料/);
  assert.throws(() => normalizeSalesPriceDraft(JSON.stringify(sampleDraft({ attachment_ids: [{ id: 'file-1' }] }))), /辅助材料/);
  for (const fileOverrides of [{ name: '程序.exe' }, { size: 20 * 1024 * 1024 + 1 }]) {
    const { ctx } = attachmentDraftFixture(fileOverrides);
    await assert.rejects(execute(SalesPriceDraftSave, ctx), /辅助材料/);
  }
});

test('special prices still require the effective interval configured in advanced settings', () => {
  const base = sampleDraft({ kind: 'special', customer_id: 'customer-1', valid_from: '2026-10-10', valid_until: '2026-12-31' });
  assert.equal(normalizeSalesPriceDraft(JSON.stringify(base)).valid_until, '2026-12-31');
  assert.throws(() => normalizeSalesPriceDraft(JSON.stringify({ ...base, valid_until: '' })), /到期日期/);
  assert.equal(normalizeSalesPriceDraft(JSON.stringify({ ...base, valid_until: '', long_term: true })).valid_until, '');
});

test('advanced approval choices expose only active independent native appointments in the same organization', async () => {
  const db = memoryApi({ sys_member: [{ organization_id: org, user_id: actor }, { organization_id: org, user_id: 'reviewer' }], sys_position: [{ id: 'review-position', name: 'sales_order_reviewer', organization_id: org, active: true }], sys_user_position: [{ organization_id: org, user_id: actor, position: 'review-position' }, { organization_id: org, user_id: 'reviewer', position: 'review-position' }, { organization_id: org, user_id: 'outsider', position: 'review-position' }], sys_user: [{ id: actor, name: '申请员工' }, { id: 'reviewer', name: '审批员工' }, { id: 'outsider', name: '其他组织员工' }] });
  const result = await execute(SalesPriceReviewers, { api: db.api, user: { id: actor, organizationId: org }, input: {} });
  assert.deepEqual(result.reviewers, [{ id: 'reviewer', name: '审批员工' }]);
});
