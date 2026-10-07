import assert from 'node:assert/strict';
import test from 'node:test';
import { FieldSchema, SelectOptionSchema } from '@objectstack/spec/data';
import { serviceTypeCatalogOptions } from '../src/pages/sales-service-type-catalog.panel.ts';

test('service type options contain only enabled order types and store the business name', () => {
  const rows = [
    { id: 'type-1', code: 'CFG-1', name: '  现场维修  ', category: 'order_type', status: 'active' },
    { id: 'type-2', name: '已停用类型', category: 'order_type', status: 'inactive' },
    { id: 'type-3', name: '付款模板', category: 'payment_template', status: 'active' },
    { id: 'type-4', name: '设备巡检', category: 'order_type', status: 'active' },
  ];
  const result = serviceTypeCatalogOptions(rows);

  assert.equal(result.available, true);
  assert.equal(result.error, '');
  assert.deepEqual(result.options.map(option => option.label), ['现场维修', '设备巡检']);
  assert.equal(new Set(result.options.map(option => option.value)).size, result.options.length, 'internal values are unique');
  for (const option of result.options) {
    assert.notEqual(option.value, option.label, 'the machine key is hidden behind its business label');
    assert.equal(SelectOptionSchema.safeParse(option).success, true, 'each option value obeys the ObjectStack identifier grammar');
  }
  assert.equal(FieldSchema.safeParse({ name: 'service_type', type: 'text', widget: 'declared-label-combobox', label: '服务场景', options: result.options }).success, true, 'the generated catalog is accepted on the actual text-field widget contract');

  const changedMetadataAndOrder = serviceTypeCatalogOptions(rows.map((row, index) => ({
    ...row,
    id: 'replacement-' + index,
    code: 'CHANGED-' + index,
  })).reverse());
  const keyByName = options => Object.fromEntries(options.map(option => [option.label, option.value]));
  assert.deepEqual(keyByName(changedMetadataAndOrder.options), keyByName(result.options), 'the hidden keys remain stable when catalog ids, codes, or row order change');
});

test('an empty active catalog is a real empty result', () => {
  assert.deepEqual(serviceTypeCatalogOptions([
    { id: 'type-disabled', name: '已停用类型', category: 'order_type', status: 'inactive' },
    { id: 'fee', name: '差旅', category: 'fee_type', status: 'active' },
  ]), { available: true, options: [], error: '' });
  assert.deepEqual(serviceTypeCatalogOptions([]), { available: true, options: [], error: '' });
});

test('missing or duplicated enabled order-type names fail closed', () => {
  const unnamed = serviceTypeCatalogOptions([
    { id: 'type-unnamed', name: '   ', category: 'order_type', status: 'active' },
  ]);
  assert.deepEqual(unnamed, { available: false, options: [], error: '服务场景配置缺少名称。' });

  const duplicate = serviceTypeCatalogOptions([
    { id: 'type-a', name: '现场维修', category: 'order_type', status: 'active' },
    { id: 'type-b', name: '现场维修', category: 'order_type', status: 'active' },
  ]);
  assert.deepEqual(duplicate, { available: false, options: [], error: '服务场景配置名称重复，暂无法选择。' });
});
