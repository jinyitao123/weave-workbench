import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceQuotationSaveDraft } from '../src/actions/service-quotation-draft.action.ts';

const quoteFixture = (overrides = {}) => ({
  id: 'quote-1', code: 'SQ-1001', organization_id: 'org-1', owner_id: 'manager-1',
  status: 'draft', total_amount: 100, valid_until: '2026-12-31', remarks: '旧备注', revision: 1,
  ...overrides,
});

function matches(row, where = {}) {
  return Object.entries(where).every(([field, expected]) => {
    const actual = row[field];
    if (expected === null) return actual == null;
    if (expected && typeof expected === 'object') return false;
    return String(actual) === String(expected);
  });
}

function cloneTables(tables) {
  return Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
}

function makeHarness({ quote = quoteFixture(), failReceiptInsert = false, beforeQuoteUpdate } = {}) {
  const tables = {
    forge_service_quotation: [quote],
    forge_service_quotation_draft_receipt: [],
  };
  let nextReceiptId = 1;
  let transactionCount = 0;
  let transactionTail = Promise.resolve();
  const updateCalls = [];

  const api = {
    object(name) {
      const rows = () => tables[name] || (tables[name] = []);
      return {
        async findOne({ where = {} } = {}) { return rows().find(row => matches(row, where)) || null; },
        async find({ where = {} } = {}) { return rows().filter(row => matches(row, where)); },
        async update(value, options = {}) {
          updateCalls.push({ object: name, value: { ...value }, options: { ...options, where: { ...(options.where || {}) } } });
          if (name === 'forge_service_quotation' && beforeQuoteUpdate) await beforeQuoteUpdate({ tables, value, options });
          const targets = rows().filter(row => matches(row, options.where || (value.id ? { id: value.id } : {})));
          for (const row of targets) Object.assign(row, value);
          return targets.length;
        },
        async insert(value) {
          if (name === 'forge_service_quotation_draft_receipt' && failReceiptInsert) throw new Error('SQL driver private detail');
          const row = { ...value, id: value.id || `receipt-${nextReceiptId++}` };
          rows().push(row);
          return { ...row };
        },
      };
    },
    async transaction(callback) {
      transactionCount++;
      let release;
      const previous = transactionTail;
      transactionTail = new Promise(resolve => { release = resolve; });
      await previous;
      const snapshot = cloneTables(tables);
      const originals = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, new Map(rows.map(row => [String(row.id), row]))]));
      try {
        return await callback();
      } catch (error) {
        const names = new Set([...Object.keys(tables), ...Object.keys(snapshot)]);
        for (const name of names) {
          const savedRows = snapshot[name] || [];
          const originalById = originals[name] || new Map();
          tables[name] = savedRows.map(saved => {
            const original = originalById.get(String(saved.id)) || {};
            for (const field of Object.keys(original)) delete original[field];
            Object.assign(original, saved);
            return original;
          });
        }
        throw error;
      } finally {
        release();
      }
    },
  };
  return { tables, api, updateCalls, get transactionCount() { return transactionCount; } };
}

function makeContext(harness, {
  input = {}, actor = 'manager-1', organizationId = 'org-1',
  record = harness.tables.forge_service_quotation[0], recordLoadDenied = false,
  session = { userId: actor, organizationId }, user = { id: actor, organizationId }, recordId = 'quote-1',
} = {}) {
  return { recordId, record, recordLoadDenied, input, session, user, api: harness.api };
}

function execute(ctx) {
  return new Function('ctx', `return (async()=>{${ServiceQuotationSaveDraft.body.source}\n})()`)(ctx);
}

const validInput = (overrides = {}) => ({
  expected_revision: 1,
  idempotency_key: 'save-quote-once',
  draft_json: JSON.stringify({ total_amount: 1250.5, valid_until: '2026-11-30', remarks: '客户现场报价' }),
  ...overrides,
});

test('service quotation draft Action is manager-gated and saves only its three editable fields once', async () => {
  assert.equal(ServiceQuotationSaveDraft.name, 'service_quotation_save_draft');
  assert.equal(ServiceQuotationSaveDraft.objectName, 'forge_service_quotation');
  assert.deepEqual(ServiceQuotationSaveDraft.locations, []);
  assert.deepEqual(ServiceQuotationSaveDraft.requiredPermissions, ['forge_service_manager']);
  assert.deepEqual(ServiceQuotationSaveDraft.body.capabilities, ['api.read', 'api.write', 'api.transaction']);

  const h = makeHarness();
  const result = await execute(makeContext(h, { input: validInput() }));
  assert.deepEqual(result, {
    id: 'quote-1', code: 'SQ-1001', status: 'draft', total_amount: 1250.5,
    valid_until: '2026-11-30', remarks: '客户现场报价', revision: 2, repeated: false,
  });
  assert.deepEqual(h.tables.forge_service_quotation[0], {
    ...quoteFixture(), total_amount: 1250.5, valid_until: '2026-11-30', remarks: '客户现场报价', revision: 2,
  });
  assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 1);
  const receipt = h.tables.forge_service_quotation_draft_receipt[0];
  assert.equal(receipt.quotation_id, 'quote-1');
  assert.equal(receipt.actor_id, 'manager-1');
  assert.equal(receipt.expected_revision, 1);
  assert.equal(receipt.resulting_revision, 2);
  assert.equal(receipt.idempotency_key, 'save-quote-once');
  assert.equal(receipt.organization_id, 'org-1');
  assert.deepEqual(JSON.parse(receipt.result_json), { ...result });
  assert.equal(h.transactionCount, 1);
  const write = h.updateCalls.find(call => call.object === 'forge_service_quotation');
  assert.deepEqual(write.options, { multi: true, where: { id: 'quote-1', organization_id: 'org-1', status: 'draft', revision: 1 } });
  assert.equal(Object.hasOwn(write.value, 'id'), false, 'the record id stays in the CAS predicate, not the multi-update payload');
});

test('same actor and canonical input replay the original receipt after the quote later changes', async () => {
  const h = makeHarness();
  const input = validInput();
  const first = await execute(makeContext(h, { input }));
  Object.assign(h.tables.forge_service_quotation[0], { status: 'confirmed', total_amount: 2000, revision: 3 });

  const replayed = await execute(makeContext(h, { input, record: { ...h.tables.forge_service_quotation[0] } }));
  assert.deepEqual(replayed, { ...first, repeated: true });
  assert.equal(h.tables.forge_service_quotation[0].total_amount, 2000);
  assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 1);
  assert.equal(h.transactionCount, 1, 'a completed idempotent replay does not start another write transaction');
});

test('same key rejects a different canonical payload or another actor', async () => {
  const h = makeHarness();
  const input = validInput();
  await execute(makeContext(h, { input }));
  const changedDraft = JSON.stringify({ total_amount: 1251, valid_until: '2026-11-30', remarks: '客户现场报价' });
  await assert.rejects(execute(makeContext(h, { input: { ...input, draft_json: changedDraft } })), /同一请求标识已用于不同员工或内容/);
  await assert.rejects(execute(makeContext(h, { input, actor: 'manager-2', user: { id: 'manager-2', organizationId: 'org-1' } })), /同一请求标识已用于不同员工或内容/);
  assert.equal(h.tables.forge_service_quotation[0].revision, 2);
  assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 1);
});

test('identity, organization, inaccessible records and non-draft state fail before any write', async () => {
  const cases = [
    { label: 'record load denied', context: { recordLoadDenied: true } },
    { label: 'missing user', context: { session: { organizationId: 'org-1' } } },
    { label: 'session/user mismatch', context: { user: { id: 'another-manager', organizationId: 'org-1' } } },
    { label: 'organization mismatch', context: { user: { id: 'manager-1', organizationId: 'org-2' } } },
    { label: 'quote belongs to another organization', quote: quoteFixture({ organization_id: 'org-2' }) },
    { label: 'non-draft quote', quote: quoteFixture({ status: 'confirmed' }) },
  ];
  for (const entry of cases) {
    const h = makeHarness({ quote: entry.quote || quoteFixture() });
    const context = makeContext(h, { input: validInput(), ...(entry.context || {}) });
    await assert.rejects(execute(context), Error, entry.label);
    assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 0, entry.label);
    assert.notEqual(h.tables.forge_service_quotation[0].revision, 2, entry.label);
  }
});

test('the draft payload rejects unknown fields, missing/invalid amounts, excess precision and invalid calendar dates', async () => {
  const invalidDrafts = [
    [{ valid_until: '2026-11-30', remarks: '' }, /报价金额不能为空/],
    [{ total_amount: '', valid_until: '2026-11-30', remarks: '' }, /报价金额不能为空/],
    [{ total_amount: 'Infinity', valid_until: '2026-11-30', remarks: '' }, /报价金额无效/],
    [{ total_amount: -0.01, valid_until: '2026-11-30', remarks: '' }, /报价金额不能为负数/],
    [{ total_amount: 1.239, valid_until: '2026-11-30', remarks: '' }, /最多保留两位小数/],
    [{ total_amount: '90071992547409.91', valid_until: '2026-11-30', remarks: '' }, /金额超出可保存范围/],
    [{ total_amount: ['1.23'], valid_until: '2026-11-30', remarks: '' }, /报价金额格式无效/],
    [{ total_amount: true, valid_until: '2026-11-30', remarks: '' }, /报价金额格式无效/],
    [{ total_amount: { value: 1.23 }, valid_until: '2026-11-30', remarks: '' }, /报价金额格式无效/],
    [{ total_amount: 1, valid_until: '2026-02-30', remarks: '' }, /报价有效期必须是有效日期/],
    [{ total_amount: 1, valid_until: '2026-11-30', status: 'confirmed' }, /不允许修改的字段/],
    [{ total_amount: 1, valid_until: '2026-11-30', remarks: 7 }, /报价备注格式无效/],
  ];
  for (const [draft, error] of invalidDrafts) {
    const h = makeHarness();
    const input = validInput({ draft_json: JSON.stringify(draft) });
    await assert.rejects(execute(makeContext(h, { input })), error);
    assert.equal(h.transactionCount, 0);
    assert.deepEqual(h.tables.forge_service_quotation[0], quoteFixture());
    assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 0);
  }
});

test('typed action params reject arrays and non-string JSON/key payloads before querying or writing', async () => {
  const invalidInputs = [
    { expected_revision: [1], idempotency_key: 'key', draft_json: validInput().draft_json },
    { expected_revision: 1, idempotency_key: ['key'], draft_json: validInput().draft_json },
    { expected_revision: 1, idempotency_key: 'key', draft_json: [{ total_amount: 1, valid_until: '2026-11-30' }] },
  ];
  for (const input of invalidInputs) {
    const h = makeHarness();
    await assert.rejects(execute(makeContext(h, { input })), Error);
    assert.equal(h.transactionCount, 0);
    assert.deepEqual(h.tables.forge_service_quotation[0], quoteFixture());
    assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 0);
  }
});

test('a stale revision is rejected and does not create a receipt', async () => {
  const h = makeHarness({ quote: quoteFixture({ revision: 2 }) });
  await assert.rejects(execute(makeContext(h, { input: validInput() })), /已被修改，请刷新后重试/);
  assert.equal(h.tables.forge_service_quotation[0].revision, 2);
  assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 0);
});

test('a lost compare-and-swap does not persist a receipt or weaken its predicate', async () => {
  const h = makeHarness({ beforeQuoteUpdate: ({ tables }) => { tables.forge_service_quotation[0].revision = 2; } });
  await assert.rejects(execute(makeContext(h, { input: validInput() })), /已被修改，请刷新后重试/);
  assert.equal(h.tables.forge_service_quotation[0].revision, 1, 'the mock transaction rolls back its concurrent-write simulation');
  assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 0);
  assert.deepEqual(h.updateCalls[0].options.where, { id: 'quote-1', organization_id: 'org-1', status: 'draft', revision: 1 });
});

test('revision values must remain safe integers and increment without precision loss', async () => {
  const unsafeExpected = makeHarness();
  await assert.rejects(
    execute(makeContext(unsafeExpected, { input: validInput({ expected_revision: Number.MAX_SAFE_INTEGER + 1 }) })),
    /读取报价修订号无效/,
  );
  assert.equal(unsafeExpected.transactionCount, 0);

  const unsafeCurrent = makeHarness({ quote: quoteFixture({ revision: Number.MAX_SAFE_INTEGER + 1 }) });
  await assert.rejects(execute(makeContext(unsafeCurrent, { input: validInput() })), /服务报价修订号无效/);
  assert.equal(unsafeCurrent.tables.forge_service_quotation_draft_receipt.length, 0);

  const atLimit = makeHarness({ quote: quoteFixture({ revision: Number.MAX_SAFE_INTEGER }) });
  await assert.rejects(
    execute(makeContext(atLimit, { input: validInput({ expected_revision: Number.MAX_SAFE_INTEGER }) })),
    /修订号已达到可保存上限/,
  );
  assert.equal(atLimit.tables.forge_service_quotation[0].revision, Number.MAX_SAFE_INTEGER);
  assert.equal(atLimit.tables.forge_service_quotation_draft_receipt.length, 0);
});

test('ISO dates before year 0100 are validated by round-trip without year remapping', async () => {
  const h = makeHarness();
  const result = await execute(makeContext(h, {
    input: validInput({ draft_json: JSON.stringify({ total_amount: 25, valid_until: '0099-02-28', remarks: '' }) }),
  }));
  assert.equal(result.valid_until, '0099-02-28');
  assert.equal(h.tables.forge_service_quotation[0].valid_until, '0099-02-28');
});

test('corrupted receipt result fields are rejected instead of replaying inconsistent data', async () => {
  const corrupt = [
    receipt => { receipt.resulting_revision = 99; },
    receipt => { receipt.result_json = JSON.stringify({ ...JSON.parse(receipt.result_json), total_amount: 777 }); },
    receipt => { receipt.result_json = JSON.stringify({ ...JSON.parse(receipt.result_json), valid_until: '2099-01-01' }); },
    receipt => { receipt.result_json = JSON.stringify({ ...JSON.parse(receipt.result_json), id: 'another-quote' }); },
  ];
  for (const corruptReceipt of corrupt) {
    const h = makeHarness();
    const input = validInput();
    await execute(makeContext(h, { input }));
    corruptReceipt(h.tables.forge_service_quotation_draft_receipt[0]);
    await assert.rejects(execute(makeContext(h, { input })), /原报价保存回执无效/);
    assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 1);
    assert.equal(h.transactionCount, 1, 'invalid stored receipts are refused before another transaction');
  }
});

test('receipt insertion failure rolls back the quote and hides storage internals', async () => {
  const h = makeHarness({ failReceiptInsert: true });
  await assert.rejects(
    execute(makeContext(h, { input: validInput() })),
    error => error instanceof Error && /保存失败或当前报价已变化/.test(error.message) && !error.message.includes('SQL driver'),
  );
  assert.deepEqual(h.tables.forge_service_quotation[0], quoteFixture());
  assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 0);
  assert.equal(h.transactionCount, 1);
});

test('concurrent identical requests converge on one saved result and one immutable receipt', async () => {
  const h = makeHarness();
  const input = validInput();
  const [left, right] = await Promise.all([
    execute(makeContext(h, { input })),
    execute(makeContext(h, { input })),
  ]);
  assert.equal(h.tables.forge_service_quotation[0].revision, 2);
  assert.equal(h.tables.forge_service_quotation_draft_receipt.length, 1);
  assert.deepEqual({ ...left, repeated: null }, { ...right, repeated: null });
  assert.equal([left, right].filter(result => result.repeated === false).length, 1);
  assert.equal([left, right].filter(result => result.repeated === true).length, 1);
});
