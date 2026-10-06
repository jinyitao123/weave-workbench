import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  readServicePerformanceCustomerNames,
  servicePerformanceCustomerReferenceId,
  servicePerformanceCustomersHelpersSource,
} from '../src/pages/sales-service-performance-customers.panel.ts';

function order(id, actor, customerId, overrides = {}) {
  return { id, status: 'completed', engineer_id: actor, customer_id: customerId, ...overrides };
}

function referenceFilter(path) {
  const url = new URL(path, 'http://service-performance.test');
  return {
    route: url.pathname,
    params: url.searchParams,
    where: JSON.parse(url.searchParams.get('$filter') || 'null'),
  };
}

test('reads only unique customer ids from the actor’s completed orders in bounded projected batches', async () => {
  const actor = 'engineer-current';
  const orders = Array.from({ length: 51 }, (_, index) => {
    const id = 'customer-' + String(index + 1).padStart(3, '0');
    const customerId = index === 0 ? { id } : index === 1 ? { _id: id } : index === 2 ? { value: id } : index === 3 ? [{ id }] : id;
    return order('order-' + index, actor, customerId);
  });
  orders.push(order('duplicate-order', actor, 'customer-001'));
  orders.push(order('other-engineer', 'engineer-other', 'customer-peer'));
  orders.push(order('not-completed', actor, 'customer-open', { status: 'in_progress' }));
  const customers = Array.from({ length: 51 }, (_, index) => ({
    id: 'customer-' + String(index + 1).padStart(3, '0'),
    name: index < 2 ? '同名客户' : '客户 ' + (index + 1),
    owner_id: 'some-owner',
  }));
  const calls = [];
  const result = await readServicePerformanceCustomerNames(async path => {
    const parsed = referenceFilter(path);
    calls.push({ path, ...parsed });
    const ids = parsed.where?.id?.$in || [];
    const rows = customers.filter(customer => ids.includes(customer.id));
    const skip = Number(parsed.params.get('$skip'));
    const top = Number(parsed.params.get('$top'));
    return { result: { data: { records: rows.slice(skip, skip + top), totalCount: rows.length } } };
  }, orders, actor);

  assert.equal(result.available, true);
  assert.equal(result.error, '');
  assert.equal(result.missingCount, 0);
  assert.equal(Object.keys(result.names).length, 51);
  assert.equal(result.names['customer-001'], '同名客户');
  assert.equal(result.names['customer-002'], '同名客户', 'same-name customers remain separate id-to-name entries');
  assert.equal(result.names['customer-peer'], undefined);
  assert.equal(result.names['customer-open'], undefined);
  assert.equal(calls.length, 2, '51 unique ids are split into batches of 50 and 1');
  assert.ok(calls.every(call => call.route === '/data/forge_customer'));
  assert.ok(calls.every(call => call.where && Array.isArray(call.where.id?.$in)));
  assert.deepEqual(calls.map(call => call.where.id.$in.length), [50, 1]);
  assert.ok(calls.every(call => call.params.get('$select') === 'id,name'));
  assert.ok(calls.every(call => call.params.get('$count') === 'true' && call.params.get('$orderby') === 'id asc'));
  assert.ok(calls.every(call => Number(call.params.get('$top')) === 50 && Number(call.params.get('$skip')) === 0));
  assert.ok(calls.every(call => call.path.length <= 6000));
  assert.ok(calls.every(call => call.where.id.$in.every(id => !['customer-peer', 'customer-open'].includes(id))));
});

test('probes through short pages without totals, fails on a missing id, and treats an empty required-id set as available', async () => {
  const actor = 'engineer-current';
  const orders = [
    order('order-a', actor, 'customer-a'),
    order('order-b', actor, 'customer-b'),
    order('order-c', actor, 'customer-c'),
    order('order-d', actor, 'customer-d'),
  ];
  const customers = [
    { id: 'customer-a', name: '客户甲' },
    { id: 'customer-b', name: '客户乙' },
    { id: 'customer-c', name: '客户丙' },
  ];
  const skips = [];
  const result = await readServicePerformanceCustomerNames(async path => {
    const parsed = referenceFilter(path);
    const skip = Number(parsed.params.get('$skip'));
    skips.push(skip);
    return { records: skip < customers.length ? [customers[skip]] : [] };
  }, orders, actor);

  assert.equal(result.available, false);
  assert.deepEqual(result.names, {}, 'incomplete names do not expose a partial customer map');
  assert.equal(result.missingCount, 1);
  assert.deepEqual(skips, [0, 1, 2, 3], 'a short non-empty page is followed by the final empty-page probe');

  let calls = 0;
  const empty = await readServicePerformanceCustomerNames(async () => { calls++; return { records: [] }; }, [], actor);
  assert.deepEqual(empty, { available: true, names: {}, error: '', missingCount: 0 });
  assert.equal(calls, 0, 'no relevant completed orders requires no customer request');

  const unrelated = await readServicePerformanceCustomerNames(async () => { calls++; return { records: [] }; }, [
    order('open', actor, 'customer-open', { status: 'in_progress' }),
    order('peer', 'engineer-other', 'customer-peer'),
  ], actor);
  assert.deepEqual(unrelated, { available: true, names: {}, error: '', missingCount: 0 });
  assert.equal(calls, 0, 'non-completed and peer orders do not produce customer ids');
});

test('missing identity never queries, while completed rows without customer references fail closed', async () => {
  let calls = 0;
  const missingActor = await readServicePerformanceCustomerNames(async () => { calls++; return { records: [] }; }, [
    order('order-a', 'engineer-current', 'customer-a'),
  ], '');
  assert.equal(missingActor.available, false);
  assert.deepEqual(missingActor.names, {});
  assert.equal(calls, 0);

  const missingReference = await readServicePerformanceCustomerNames(async () => { calls++; return { records: [] }; }, [
    order('order-without-customer', 'engineer-current', null),
    order('order-number-customer', 'engineer-current', 123),
    order('order-number-expanded-id', 'engineer-current', { id: 123 }),
  ], 'engineer-current');
  assert.equal(missingReference.available, false);
  assert.deepEqual(missingReference.names, {});
  assert.equal(missingReference.missingCount, 3);
  assert.equal(calls, 0, 'missing relationship ids do not trigger an unfiltered customer query');

  const invalidRow = await readServicePerformanceCustomerNames(async () => { calls++; return { records: [] }; }, [null], 'engineer-current');
  assert.equal(invalidRow.available, false, 'null page input is rejected rather than throwing or being silently ignored');
  assert.deepEqual(invalidRow.names, {});
  assert.equal(calls, 0);
});

test('serialized helper source is self-contained and resolves a single expanded-reference array', async () => {
  const sandbox = { URLSearchParams };
  vm.runInNewContext(`${servicePerformanceCustomersHelpersSource}\nthis.readNames = readServicePerformanceCustomerNames; this.readReference = servicePerformanceCustomerReferenceId;`, sandbox);
  assert.equal(sandbox.readReference([{ value: 'customer-vm' }]), 'customer-vm');
  assert.equal(sandbox.readReference([{ id: 1 }]), '', 'non-string expanded ids are not coerced into identifiers');

  const result = await sandbox.readNames(async path => {
    const filter = JSON.parse(new URL(path, 'http://service-performance.test').searchParams.get('$filter'));
    return { records: [{ id: filter.id.$in[0], name: '客户 VM' }], totalCount: 1 };
  }, [order('order-vm', 'actor-vm', [{ id: 'customer-vm' }])], 'actor-vm');
  assert.equal(result.available, true);
  assert.equal(result.names['customer-vm'], '客户 VM');
});

test('403, 404, incomplete pages, missing names, and duplicate ids return no partial name map', async t => {
  const actor = 'engineer-current';
  const rows = [order('order-a', actor, 'customer-secret-id')];
  const cases = [
    ['403', async () => { const error = new Error('customer-secret-id forbidden'); error.status = 403; throw error; }],
    ['404', async () => { const error = new Error('customer-secret-id missing'); error.status = 404; throw error; }],
    ['missing row', async () => ({ records: [], totalCount: 0 })],
    ['blank name', async () => ({ records: [{ id: 'customer-secret-id', name: '   ' }], totalCount: 1 })],
    ['non-string name', async () => ({ records: [{ id: 'customer-secret-id', name: { display: '客户甲' } }], totalCount: 1 })],
    ['duplicate id', async () => ({ records: [
      { id: 'customer-secret-id', name: '客户甲' },
      { id: 'customer-secret-id', name: '客户甲' },
    ] })],
  ];

  for (const [label, respond] of cases) {
    await t.test(label, async () => {
      const result = await readServicePerformanceCustomerNames(respond, rows, actor);
      assert.equal(result.available, false);
      assert.deepEqual(result.names, {}, 'partial or inconsistent data is not exposed as a usable map');
      assert.ok(result.error);
      assert.equal(result.error.includes('customer-secret-id'), false, 'errors never disclose the requested id');
    });
  }

  const incomplete = await readServicePerformanceCustomerNames(async path => {
    const parsed = referenceFilter(path);
    return Number(parsed.params.get('$skip')) === 0
      ? { records: [{ id: 'customer-secret-id', name: '客户甲' }], totalCount: 2 }
      : { records: [], totalCount: 2 };
  }, rows, actor);
  assert.equal(incomplete.available, false);
  assert.deepEqual(incomplete.names, {});
  assert.ok(incomplete.error.includes('不完整'));
});

test('rejects overlong encoded filters and more than 5000 ids instead of broadening the read', async () => {
  let calls = 0;
  const overlong = await readServicePerformanceCustomerNames(async () => { calls++; return { records: [] }; }, [
    order('long-id', 'engineer-current', 'customer-' + 'x'.repeat(6100)),
  ], 'engineer-current');
  assert.equal(overlong.available, false);
  assert.deepEqual(overlong.names, {});
  assert.equal(calls, 0, 'an oversized URL is rejected before sending a request');

  const tooMany = await readServicePerformanceCustomerNames(async () => { calls++; return { records: [] }; },
    Array.from({ length: 5001 }, (_, index) => order('order-' + index, 'engineer-current', 'customer-' + index)),
    'engineer-current');
  assert.equal(tooMany.available, false);
  assert.equal(tooMany.missingCount, 5001);
  assert.equal(calls, 0, 'an over-limit set is rejected before sending any batch');
});
