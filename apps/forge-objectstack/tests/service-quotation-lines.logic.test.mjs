import assert from 'node:assert/strict';
import test from 'node:test';
import { QuickJSScriptRunner } from '@objectstack/runtime';
import {
  normalizeServiceQuotationDraft,
  normalizeServiceQuotationLinePricing,
  serviceQuotationLinesHelpersSource,
} from '../src/actions/service-quotation-lines.logic.ts';

const baseLine = (overrides = {}) => ({
  line_type: 'service', item_id: 'catalog-service-1', description: '现场服务', unit_name: '次',
  quantity: 1, taxed_unit_price: 10, ...overrides,
});
const baseDraft = (overrides = {}) => ({
  valid_until: '2026-12-31', remarks: '', pricing_mode: 'estimated', payment_mode: 'full_prepayment',
  discount_rate: 0, lines: [baseLine()], ...overrides,
});
const normalize = draft => normalizeServiceQuotationDraft(JSON.stringify(draft));

test('row previews and saved totals share exact cent rounding at the binary-float boundary', () => {
  assert.equal(Number((1.15 * 0.10).toFixed(2)), 0.11);
  const preview = normalizeServiceQuotationLinePricing('1.15', '0.10');
  assert.deepEqual(preview, { quantity: 1.15, taxed_unit_price: 0.1, line_amount: 0.12 });
  const saved = normalize(baseDraft({ discount_rate: 10, lines: [baseLine({ quantity: preview.quantity, taxed_unit_price: preview.taxed_unit_price })] }));
  assert.equal(saved.lines[0].line_amount, preview.line_amount);
  assert.equal(saved.subtotal, 0.12);
  assert.equal(saved.discount_amount, 0.01);
  assert.equal(saved.total_amount, 0.11);
});

test('pricing previews reject incomplete and invalid amounts without changing catalogue validation', () => {
  for (const quantity of ['', null, undefined, 0, '0.001', NaN, Infinity]) {
    assert.throws(() => normalizeServiceQuotationLinePricing(quantity, '0.10'), /数量/);
  }
  for (const price of ['', null, undefined, '-1', '0.101', NaN, Infinity]) {
    assert.throws(() => normalizeServiceQuotationLinePricing(1, price), /含税单价/);
  }
  assert.equal(normalizeServiceQuotationLinePricing('0.01', 0).line_amount, 0);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ item_id: '' })] })), /物料或服务标识/);
});

test('line amounts round to cents before the subtotal is summed', () => {
  const result = normalize(baseDraft({
    lines: [
      baseLine({ item_id: 'service-a', quantity: '0.01', taxed_unit_price: '0.50' }),
      baseLine({ item_id: 'service-b', quantity: '0.01', taxed_unit_price: '0.50' }),
      baseLine({ item_id: 'service-c', quantity: '0.10', taxed_unit_price: '0.05' }),
    ],
  }));
  assert.deepEqual(result.lines.map(line => line.line_amount), [0.01, 0.01, 0.01]);
  assert.equal(result.subtotal, 0.03);
  assert.equal(result.discount_amount, 0);
  assert.equal(result.total_amount, 0.03);
  assert.equal(result.item_count, 3);
});

test('accepted minimum quantity is 0.01 and explicit zero price stays valid', () => {
  const result = normalize(baseDraft({ lines: [baseLine({ quantity: '0.01', taxed_unit_price: 0 })] }));
  assert.equal(result.lines[0].quantity, 0.01);
  assert.equal(result.lines[0].taxed_unit_price, 0);
  assert.equal(result.lines[0].line_amount, 0);
  assert.equal(result.total_amount, 0);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ quantity: '0.00' })] })), /数量/);
});

test('discount uses exact tenth-percent arithmetic and handles zero and full discount', () => {
  const partial = normalize(baseDraft({
    discount_rate: '12.3',
    lines: [baseLine({ quantity: '1.00', taxed_unit_price: '19.99' })],
  }));
  assert.equal(partial.discount_rate, 12.3);
  assert.equal(partial.subtotal, 19.99);
  assert.equal(partial.discount_amount, 2.46);
  assert.equal(partial.total_amount, 17.53);

  const noDiscount = normalize(baseDraft({ discount_rate: 0 }));
  assert.equal(noDiscount.discount_amount, 0);
  assert.equal(noDiscount.total_amount, noDiscount.subtotal);

  const fullDiscount = normalize(baseDraft({ discount_rate: '100.0' }));
  assert.equal(fullDiscount.discount_amount, fullDiscount.subtotal);
  assert.equal(fullDiscount.total_amount, 0);
});

test('normalizes supported terms and preserves only caller-editable line fields', () => {
  const result = normalize(baseDraft({
    valid_until: '0099-02-28', remarks: '  安装与培训  ', pricing_mode: 'fixed',
    payment_mode: 'staged', discount_rate: '0.1',
    lines: [baseLine({ id: 'existing-line-1', line_type: 'part', item_id: 'sku-1', description: '  轴承  ', unit_name: '件', quantity: '2.50', taxed_unit_price: '12.30' })],
  }));
  assert.deepEqual(result, {
    valid_until: '0099-02-28', remarks: '安装与培训', pricing_mode: 'fixed', payment_mode: 'staged',
    discount_rate: 0.1,
    lines: [{
      id: 'existing-line-1', line_type: 'part', item_id: 'sku-1', description: '轴承', unit_name: '件',
      quantity: 2.5, taxed_unit_price: 12.3, line_amount: 30.75,
    }],
    subtotal: 30.75, discount_amount: 0.03, total_amount: 30.72, item_count: 1,
  });
});

test('rejects unknown and client-computed header or line fields', () => {
  for (const field of ['name', 'code', 'amount', 'total_amount', 'subtotal', 'organization_id', 'owner_id', 'quotation_id']) {
    assert.throws(() => normalize(baseDraft({ [field]: 'tampered' })), /不允许的字段/, field);
  }
  for (const field of ['name', 'code', 'line_amount', 'amount', 'organization_id', 'owner_id', 'quotation_id']) {
    assert.throws(() => normalize(baseDraft({ lines: [baseLine({ [field]: 'tampered' })] })), /不允许的字段/, field);
  }
});

test('rejects duplicate existing line ids, invalid line kinds, and bad catalog ids or text fields', () => {
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ id: 'line-1' }), baseLine({ id: 'line-1' })] })), /重复/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ line_type: 'other' })] })), /类型无效/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ item_id: '  ' })] })), /标识无效/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ item_id: 'x'.repeat(129) })] })), /标识无效/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ description: 5 })] })), /描述格式无效/);
  const longDescription = 'x'.repeat(256);
  assert.equal(normalize(baseDraft({ lines: [baseLine({ description: longDescription })] })).lines[0].description, longDescription);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ unit_name: '' })] })), /单位不能为空/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ unit_name: '件'.repeat(51) })] })), /单位不能为空/);
});

test('rejects invalid terms, impossible dates and missing or empty line inputs', () => {
  assert.throws(() => normalize(baseDraft({ pricing_mode: 'free' })), /计价方式/);
  assert.throws(() => normalize(baseDraft({ payment_mode: 'unknown' })), /付款方式/);
  assert.throws(() => normalize(baseDraft({ discount_rate: '0.01' })), /精度/);
  assert.throws(() => normalize(baseDraft({ discount_rate: 100.1 })), /必须在0到100/);
  assert.throws(() => normalize(baseDraft({ valid_until: '2026-02-30' })), /有效日期/);
  assert.throws(() => normalize(baseDraft({ lines: [] })), /至少需要一条/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ taxed_unit_price: '' })] })), /不能为空/);
});

test('rejects number coercion, boolean/object values, unsafe monetary serialization and excessive precision', () => {
  for (const value of [['1.00'], true, { value: 1 }, null]) {
    assert.throws(() => normalize(baseDraft({ lines: [baseLine({ quantity: value })] })), /格式无效|数量不能为空/);
    assert.throws(() => normalize(baseDraft({ lines: [baseLine({ taxed_unit_price: value })] })), /格式无效|单价不能为空/);
  }
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ quantity: '1.001' })] })), /精度超出/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ taxed_unit_price: '1.001' })] })), /精度超出/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ quantity: 'Infinity' })] })), /有限数字/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ taxed_unit_price: 'Infinity' })] })), /有限数字/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ quantity: '-0.01' })] })), /不能为负数/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ taxed_unit_price: '-0.01' })] })), /不能为负数/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ quantity: '1e2' })] })), /格式无效/);
  assert.throws(() => normalize(baseDraft({ discount_rate: true })), /格式无效/);
  assert.throws(() => normalize(baseDraft({ discount_rate: '101' })), /必须在0到100/);
  assert.throws(() => normalize(baseDraft({ lines: [baseLine({ taxed_unit_price: '90071992547409.91' })] })), /超出可保存范围/);
  assert.throws(() => normalize(baseDraft({
    lines: [baseLine({ taxed_unit_price: '50000000000000.00' }), baseLine({ taxed_unit_price: '50000000000000.00' })],
  })), /小计超出可保存范围/);
});

test('500 lines are accepted while 501 are rejected without truncation', () => {
  const lines = Array.from({ length: 500 }, (_, index) => baseLine({ item_id: 'item-' + index }));
  assert.equal(normalize(baseDraft({ lines })).item_count, 500);
  assert.throws(() => normalize(baseDraft({ lines: [...lines, baseLine({ item_id: 'item-500' })] })), /不能超过500/);
});

test('serialized helper source executes in the real QuickJS sandbox with equivalent JSON output', async t => {
  assert.equal(serviceQuotationLinesHelpersSource.includes('__name'), false, 'serialized helper contains no transpiler-only symbols');
  const runner = new QuickJSScriptRunner({ actionTimeoutMs: 10_000 });
  t.after(async () => runner.dispose());
  const draftJson = JSON.stringify(baseDraft({
    discount_rate: '12.3',
    lines: [baseLine({ quantity: '1.15', taxed_unit_price: '0.10' })],
  }));
  const body = {
    language: 'js',
    capabilities: [],
    source: serviceQuotationLinesHelpersSource + '\nreturn normalizeServiceQuotationDraft(ctx.input.draft_json);',
  };
  const result = await runner.runScript(body, { input: { draft_json: draftJson } }, {
    origin: { kind: 'action', name: 'service_quotation_lines_helper_test' },
  });
  assert.deepEqual(result.value, normalizeServiceQuotationDraft(draftJson));
  assert.equal(result.value.lines[0].line_amount, 0.12);
  const previewResult = await runner.runScript({ ...body, source: serviceQuotationLinesHelpersSource + '\nreturn normalizeServiceQuotationLinePricing(ctx.input.quantity, ctx.input.price);' }, {
    input: { quantity: '1.15', price: '0.10' },
  }, { origin: { kind: 'action', name: 'service_quotation_line_preview_helper_test' } });
  assert.deepEqual(previewResult.value, normalizeServiceQuotationLinePricing('1.15', '0.10'));
});
