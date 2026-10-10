import assert from 'node:assert/strict';
import test from 'node:test';
import { forgeProductUiRuntime } from '../src/pages/product-ui.ts';
import { salesPricingFeaturesRuntime } from '../src/pages/sales-pricing-features.source.ts';
import { createServicePageHarness } from './service-page-react-harness.mjs';

const agreement = { kind: 'agreement', status: 'approved', effect_status: 'applied', valid_from: '2026-10-09', valid_until: '2026-10-09' };
const page = { name: 'pricing-calendar', source: forgeProductUiRuntime + '\n' + salesPricingFeaturesRuntime + '\nexport default function App(){const workspace=useSalesPricingWorkspace(useAdapter());return {type:"Snapshot",props:{workspace,state:PriceState({row:' + JSON.stringify(agreement) + ',businessDate:workspace.data.business_date})}}}' };
const response = (value, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => value });
function fixture(calendarStatus = 200) {
  return createServicePageHarness(page, { transport: async url => {
    const route = new URL(url).pathname.replace('/api/v1', '');
    if (route === '/actions/global/organization_business_date_query') return response(calendarStatus === 200 ? { result: { business_date: '2026-10-09', timezone: 'America/Los_Angeles' } } : { error: '组织日期不可读取' }, calendarStatus);
    if (route === '/auth/me/permissions') return response({ systemPermissions: ['sales_order_operator'] });
    return response({ records: [], totalCount: 0 });
  } });
}

test('agreement defaults and expiration labels use the native organization date across a UTC day boundary', async () => {
  const h = fixture(); await h.flushEffects();
  let snapshot = h.render().props;
  assert.equal(snapshot.state.props.label, '生效中');
  snapshot.workspace.open('agreement');
  snapshot = h.render().props;
  assert.equal(snapshot.workspace.editor.valid_from, '2026-10-09');
  assert.equal(snapshot.workspace.canApply, true);
});

test('missing organization calendar never falls back to Shanghai or opens a guessed-date draft', async () => {
  for (const status of [401, 403, 500]) {
    const h = fixture(status); await h.flushEffects();
    const snapshot = h.render().props;
    assert.equal(snapshot.workspace.data.business_date, '');
    assert.ok(snapshot.workspace.data.errors.businessDate);
    assert.equal(snapshot.workspace.canApply, false);
    assert.equal(snapshot.state.props.label, '生效日期不可读取');
    snapshot.workspace.open('special');
    assert.equal(h.render().props.workspace.editor, null);
  }
});
