import assert from 'node:assert/strict';
import test from 'node:test';
import { SalesAdditionalFeeNewPage } from '../src/pages/sales-additional-fee-new.page.ts';
import { createServicePageHarness, serviceNodes, serviceButton, serviceText } from './service-page-react-harness.mjs';

const response = (value, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => value });
const actor = 'fee-clerk';
const order = { id: 'order', code: 'SO-FEE', customer_id: 'customer', owner_id: actor, responsible_id: actor, status: 'draft' };
const contract = { id: 'contract', code: 'SC-FEE', customer_id: 'customer', owner_id: actor, responsible_id: actor, status: 'active' };
const rows = { forge_sales_order: [order], forge_sales_contract: [contract], forge_customer: [{ id: 'customer', name: '费用客户', owner_id: actor }] };
const control = (h, label) => serviceNodes(h.render(), node => node.props?.label === label || node.props?.['aria-label'] === label)[0];
function fixture(refusals = {}) {
  const h = createServicePageHarness(SalesAdditionalFeeNewPage, {
    globals: { crypto: { randomUUID: () => 'fee-request' } },
    transport: async (url, options = {}) => {
      const route = new URL(url).pathname.replace('/api/v1', '');
      if (route === '/auth/get-session') return response({ user: { id: actor, name: '合同经办' } });
      if (route === '/actions/global/organization_business_date_query') return response({ result: { business_date: '2026-10-09', timezone: 'America/Los_Angeles' } });
      if (route.startsWith('/data/')) {
        const object = route.split('/')[2], status = refusals[object] || 200;
        return response(status === 200 ? { records: rows[object] || [], totalCount: (rows[object] || []).length } : { error: '资料不可读取' }, status);
      }
      if (route === '/actions/forge_sales_additional_fee/sales_additional_fee_draft_save') return response({ result: { id: 'saved-fee', code: 'AF-TEST', status: 'draft', revision: 0 } });
      throw new Error('Unexpected page request: ' + route);
    },
  });
  return h;
}
function fill(h) {
  control(h, '来源单据').props.onChange('order');
  control(h, '第1行费用名称').props.onChange({ target: { value: '运输费' } });
  control(h, '第1行不含税金额').props.onChange({ target: { value: '10' } });
}

test('a contract clerk can save direct order fees when shipment and project catalogs are forbidden', async () => {
  const h = fixture({ forge_sales_shipment: 403, forge_project: 403, forge_project_sales_link: 403, sys_user: 403 });
  await h.flushEffects(); fill(h);
  assert.equal(control(h, '费用发生日期').props.value, '2026-10-09');
  assert.equal(serviceButton(h.render(), '保存').props.disabled, false);
  assert.equal(control(h, '结算层级').props.options.find(option => option.value === 'project').disabled, true);
  assert.equal(h.calls.some(call => call.path === '/data/sys_user'), false, 'the page does not request the whole employee directory');
  assert.equal(control(h, '来源负责人').props.value, '合同经办');
  await serviceButton(h.render(), '保存').props.onClick(); await h.settle();
  assert.equal(h.calls.filter(call => call.path === '/actions/forge_sales_additional_fee/sales_additional_fee_draft_save').length, 1);
  assert.ok(serviceText(h.render()).includes('费用单已保存为草稿'));
});

test('a denied optional source does not prevent selecting another authorized source', async () => {
  const h = fixture({ forge_sales_order: 403 }); await h.flushEffects();
  assert.equal(serviceButton(h.render(), '保存').props.disabled, true);
  control(h, '来源类型').props.onChange('sales_contract');
  control(h, '来源单据').props.onChange('contract');
  assert.equal(serviceButton(h.render(), '保存').props.disabled, false);
});

test('necessary source or customer failures block the selected fee path and do not become empty valid data', async () => {
  for (const object of ['forge_sales_order', 'forge_customer']) {
    const h = fixture({ [object]: 500 }); await h.flushEffects();
    assert.equal(serviceButton(h.render(), '保存').props.disabled, true);
    assert.ok(serviceText(h.render()).includes('资料暂时无法完整读取'));
    assert.equal(h.calls.some(call => call.path === '/actions/forge_sales_additional_fee/sales_additional_fee_draft_save'), false);
  }
});

test('an expired session on an optional catalog blocks all paths until login is restored', async () => {
  const h = fixture({ forge_project: 401 }); await h.flushEffects();
  assert.equal(serviceButton(h.render(), '保存').props.disabled, true);
  assert.ok(serviceText(h.render()).includes('登录状态已失效'));
});
