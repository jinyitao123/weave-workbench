import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceQuotationsPage } from '../src/pages/sales-service-workspace.page.ts';
import { serviceManagerPermission } from '../src/permissions/otc-role.permission.ts';
import { createServicePageHarness, serviceButton, serviceNodes, serviceText } from './service-page-react-harness.mjs';

function fixture(status = 'draft', options = {}) {
  const quote = { id: 'quote-edit-test', name: '合成服务报价', code: 'SQ-TEST', organization_id: 'quote-test-org', status, revision: 4, total_amount: 125.5, valid_until: '2026-12-31T00:00:00.000Z', remarks: '原备注' };
  const records = { forge_service_quotation: [quote] };
  const requests = [];
  const harness = createServicePageHarness(ServiceQuotationsPage, {
    manager: options.manager !== false, permissions: serviceManagerPermission.systemPermissions,
    records,
    formValues: props => ({ ...props.values, ...(options.values || {}) }),
    onAction: async request => {
      requests.push(request);
      if (request.path.includes('/service_quotation_save_draft/')) {
        if (options.failSave) throw new Error('服务报价已变化，请重新打开核对');
        const patch = JSON.parse(request.body.params.draft_json);
        Object.assign(quote, patch, { revision: 5 });
        return { id: quote.id, code: quote.code, status: 'draft', revision: 5 };
      }
      return {};
    },
  });
  return { harness, quote, requests };
}

async function openQuote(harness) {
  let tree = await harness.flushEffects();
  const list = serviceNodes(tree, node => node.type === 'ListView')[0];
  assert.ok(list);
  assert.equal(list.props.userActions.refresh, false, 'the standalone quotation page does not add the default refresh icon');
  assert.equal(list.props.emptyState.title, '暂无符合条件的服务报价');
  assert.match(list.props.emptyState.message, /已完工服务工单/);
  serviceButton(list, 'SQ-TEST').props.onClick();
  await harness.settle();
  return harness.flushEffects();
}

function editor(tree) {
  return serviceNodes(tree, node => node.type === 'CompositeDialog' && node.props.title === '编辑服务报价草稿')[0];
}

test('draft editor sends only approved fields, a private revision/key, then reads the authoritative quotation', async () => {
  const { harness, requests, quote } = fixture('draft', { values: { total_amount: 210.75, valid_until: '2027-01-31', remarks: '现场服务费用', status: 'confirmed', owner_id: 'forged-owner' } });
  let tree = await openQuote(harness);
  const edit = serviceButton(tree, '编辑草稿');
  assert.ok(edit);
  assert.equal(edit.props.className, 'fp-button', 'editing is a secondary action');
  edit.props.onClick();
  tree = harness.render();
  const dialog = editor(tree);
  assert.ok(dialog);
  const form = serviceNodes(dialog, node => node.type === 'ObjectForm')[0];
  assert.deepEqual(JSON.parse(JSON.stringify(form.props.fields)), ['total_amount', 'valid_until', 'remarks']);
  assert.equal(form.props.values.total_amount, 125.5);
  assert.equal(form.props.values.valid_until, '2026-12-31', 'the date-only field strips its API midnight timestamp');
  assert.equal(form.props.values.remarks, '原备注');
  assert.equal(form.props.showSubmit, false);
  assert.ok(!serviceText(dialog).includes('revision'));
  await serviceButton(dialog, '保存草稿').props.onClick();
  await harness.settle();
  tree = await harness.flushEffects();
  const save = requests.find(request => request.path.includes('/service_quotation_save_draft/'));
  assert.ok(save);
  assert.equal(save.body.params.expected_revision, 4);
  assert.ok(save.body.params.idempotency_key);
  assert.deepEqual(JSON.parse(save.body.params.draft_json), { total_amount: 210.75, valid_until: '2027-01-31', remarks: '现场服务费用' });
  assert.equal(quote.status, 'draft');
  assert.equal(quote.revision, 5);
  assert.equal(editor(tree), undefined);
  const savePosition = harness.calls.findIndex(call => call.path.includes('/service_quotation_save_draft/'));
  assert.ok(harness.calls.slice(savePosition + 1).some(call => call.method === 'GET' && call.path === '/data/forge_service_quotation/' + quote.id));
  assert.equal(harness.calls.some(call => ['PATCH', 'PUT'].includes(call.method)), false, 'no generic quote update is used');
});

test('a version conflict keeps edited values visible, and cancel never resubmits them', async () => {
  const { harness, requests } = fixture('draft', { failSave: true, values: { total_amount: 200, valid_until: '2027-01-31', remarks: '修改说明' } });
  let tree = await openQuote(harness);
  serviceButton(tree, '编辑草稿').props.onClick();
  tree = harness.render();
  const form = serviceNodes(editor(tree), node => node.type === 'ObjectForm')[0];
  form.props.onValuesChange({ total_amount: 200, valid_until: '2027-01-31', remarks: '修改说明' });
  tree = harness.render();
  await serviceButton(editor(tree), '保存草稿').props.onClick();
  await harness.settle();
  tree = await harness.flushEffects();
  const failed = editor(tree);
  assert.ok(failed);
  assert.ok(serviceText(failed).includes('报价已变化'));
  assert.equal(serviceNodes(failed, node => node.type === 'ObjectForm')[0].props.values.remarks, '修改说明');
  failed.props.onOpenChange(false);
  tree = harness.render();
  assert.equal(editor(tree), undefined);
  assert.equal(requests.filter(request => request.path.includes('/service_quotation_save_draft/')).length, 1);
});

test('confirmed and pending-confirmation quotations never expose draft editing, and existing actions send the read version', async () => {
  for (const status of ['pending_confirmation', 'confirmed', 'settlement_created', 'cancelled']) {
    const { harness, requests } = fixture(status);
    let tree = await openQuote(harness);
    assert.equal(serviceButton(tree, '编辑草稿'), undefined, status);
    const label = status === 'pending_confirmation' ? '确认报价' : status === 'confirmed' ? '转服务结算' : '';
    if (!label) continue;
    serviceButton(tree, label).props.onClick();
    tree = harness.render();
    const confirmation = serviceNodes(tree, node => node.type === 'CompositeDialog' && node.props.title === (status === 'pending_confirmation' ? '确认客户已接受报价' : '从已确认报价生成结算'))[0];
    assert.ok(confirmation);
    await serviceButton(confirmation, label).props.onClick();
    await harness.settle();
    assert.equal(requests[0].body.params.expected_revision, 4, label);
  }
  const { harness } = fixture('draft', { manager: false });
  const tree = await harness.flushEffects();
  assert.equal(serviceNodes(tree, node => node.type === 'ListView').length, 0);
  assert.equal(serviceButton(tree, '编辑草稿'), undefined);
});
