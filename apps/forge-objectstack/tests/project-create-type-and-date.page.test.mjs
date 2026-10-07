import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectCenterPage } from '../src/pages/project-center.page.ts';
import { createServicePageHarness, serviceText } from './service-page-react-harness.mjs';

function nodes(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return [...(predicate(value) ? [value] : []), ...Object.values(value).flatMap(item =>
    Array.isArray(item) ? item.flatMap(child => nodes(child, predicate, seen)) : nodes(item, predicate, seen))];
}
const button = (h, label) => nodes(h.render(), n => n.type === 'button' && (n.props?.['aria-label'] === label || serviceText(n).trim() === label))[0];
const field = (h, label) => nodes(h.render(), n => n.props?.label === label)[0];
const projectDialog = h => nodes(h.render(), n => n.type === 'ForgeDialog' && n.props.open)[0];
const typeForm = h => nodes(h.render(), n => n.type === 'ObjectForm' && n.props.objectName === 'forge_project_type')[0];
const typeCloseConfirmation = h => nodes(h.render(), n => n.type === 'ForgeDialog' && n.props.title === '确认关闭')[0];
const draftForm = h => nodes(h.render(), n => n.type === 'form' && n.props?.['aria-label'] === '项目立项资料')[0];
const response = (payload, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => payload });

async function fixture({ manage = true, create = true, onTypes } = {}) {
  const records = {
    forge_project_type: [{ id: 'type-a', name: '现有项目类型', active: true }],
    forge_customer: [{ id: 'customer-a', name: '测试客户' }],
    sys_user: [{ id: 'actor-a', name: '项目负责人' }],
  };
  let typeReads = 0;
  const h = createServicePageHarness(ProjectCenterPage, {
    records,
    transport: async (url, options = {}) => {
      const route = new URL(url).pathname.replace('/api/v1', '');
      if (route === '/auth/get-session') return response({ user: { id: 'actor-a' } });
      if (route === '/auth/me/permissions') return response({
        systemPermissions: ['forge_project_operator', ...(manage ? ['forge_project_settings_manage'] : [])],
        objects: { forge_project_type: { allowRead: true, allowCreate: create } },
      });
      if (route === '/data/forge_project_type') {
        typeReads++;
        if (onTypes) return onTypes(typeReads, records);
      }
      if (route.startsWith('/actions/')) return response({ result: {} });
      assert.equal(options.method || 'GET', 'GET', 'the page must not replace native ObjectForm persistence');
      const rows = records[route.split('/').at(-1)] || [];
      return response({ records: rows, total: rows.length });
    },
    globals: {
      __name: value => value,
      Switch: function Switch() {},
      window: { location: { search: '', href: 'http://service-page.test/' }, history: { pushState() {} }, addEventListener() {}, removeEventListener() {} },
    },
  });
  await h.flushEffects();
  button(h, '新建项目').props.onClick();
  return { h, records, typeReads: () => typeReads };
}

function completeDraft(h) {
  for (const [label, value] of [
    ['项目名称', '需要保留的中文项目草稿'], ['关联客户', 'customer-a'], ['项目类型', 'type-a'],
    ['项目负责人', 'actor-a'], ['计划开始日期', '2026-10-07'], ['计划结束日期', '2026-10-20'],
  ]) field(h, label).props.onChange(value);
}

test('type creation requires both existing grants and never preselects the first type', async () => {
  for (const [manage, create] of [[false, false], [false, true], [true, false], [true, true]]) {
    const { h } = await fixture({ manage, create });
    assert.equal(field(h, '项目类型').props.value, '');
    const add = button(h, '新增项目类型');
    assert.equal(add.props.disabled, !(manage && create));
    add.props.onClick();
    assert.equal(Boolean(typeForm(h)), manage && create);
    if (typeForm(h)) {
      const props = typeForm(h).props;
      assert.equal(props.mode, 'create');
      assert.equal(props.formType, 'modal');
      assert.deepEqual(Array.from(props.fields), ['name', 'code', 'color']);
      assert.equal(props.submitHandler, undefined);
      assert.equal(props.initialValues, undefined, 'object defaults stay authoritative');
      assert.equal(props.confirmOnDiscard, false, 'all close paths use the host confirmation instead of the dirty-only guard');
      assert.equal(nodes(draftForm(h), n => n.type === 'ObjectForm').length, 0, 'the native form is outside the project form');
    }
    assert.equal(h.calls.some(call => call.method !== 'GET'), false);
  }
});

test('type cancellation and successful targeted readback preserve the project draft and selection', async () => {
  const { h, records, typeReads } = await fixture();
  completeDraft(h);
  button(h, '新增项目类型').props.onClick();
  typeForm(h).props.onOpenChange(false);
  assert.ok(typeCloseConfirmation(h));
  typeCloseConfirmation(h).props.onConfirm();
  assert.equal(typeForm(h), undefined);
  assert.equal(field(h, '项目名称').props.value, '需要保留的中文项目草稿');
  assert.equal(field(h, '项目类型').props.value, 'type-a');

  button(h, '新增项目类型').props.onClick();
  const native = typeForm(h).props;
  const callsBefore = h.calls.length;
  records.forge_project_type.push({ id: 'type-b', name: '刚创建的项目类型', active: true });
  await native.onSuccess({ id: 'type-b' });
  native.onOpenChange(false);
  assert.equal(typeForm(h), undefined);
  assert.equal(typeCloseConfirmation(h), undefined, 'successful native close must not prompt again');
  assert.equal(typeReads(), 2);
  assert.deepEqual(h.calls.slice(callsBefore).map(call => [call.path, call.method]), [['/data/forge_project_type', 'GET']]);
  assert.equal(field(h, '项目名称').props.value, '需要保留的中文项目草稿');
  assert.equal(field(h, '计划开始日期').props.value, '2026-10-07');
  assert.equal(field(h, '项目类型').props.value, 'type-a');
  assert.equal(field(h, '项目类型').props.options.some(([id]) => id === 'type-b'), true);
});

test('late saved-type readback and stale modal callbacks cannot overwrite a replacement draft', async () => {
  let release;
  const { h, typeReads } = await fixture({ onTypes: (count, records) => count === 2
    ? new Promise(resolve => { release = resolve; })
    : response({ records: records.forge_project_type, total: records.forge_project_type.length }) });
  completeDraft(h);
  button(h, '新增项目类型').props.onClick();
  const old = typeForm(h).props;
  const pending = old.onSuccess({ id: 'late-type' });
  assert.equal(typeForm(h), undefined, 'the saved type form closes before readback settles');
  old.onOpenChange(false);
  assert.equal(typeCloseConfirmation(h), undefined);
  projectDialog(h).props.onCancel();
  button(h, '新建项目').props.onClick();
  field(h, '项目名称').props.onChange('新的项目草稿');
  button(h, '新增项目类型').props.onClick();
  old.onOpenChange(false);
  assert.ok(typeForm(h));
  release(response({ records: [{ id: 'late-type', name: '迟到类型', active: true }], total: 1 }));
  await pending;
  await old.onSuccess({ id: 'late-type' });
  assert.equal(typeReads(), 2);
  assert.equal(field(h, '项目名称').props.value, '新的项目草稿');
  assert.equal(field(h, '项目类型').props.value, '');
  assert.equal(field(h, '项目类型').props.options.some(([id]) => id === 'late-type'), false);
  assert.ok(typeForm(h));
});

test('failed post-save readback offers a read-only retry without resubmitting the saved type', async () => {
  const { h, records } = await fixture({ onTypes: (count, rows) => count === 2
    ? response({ error: '类型读取中断' }, 503)
    : response({ records: rows.forge_project_type, total: rows.forge_project_type.length }) });
  completeDraft(h);
  button(h, '新增项目类型').props.onClick();
  const native = typeForm(h).props;
  await native.onSuccess({ id: 'type-b' });
  native.onOpenChange(false);
  assert.equal(typeForm(h), undefined);
  assert.equal(typeCloseConfirmation(h), undefined);
  assert.match(serviceText(h.render()), /项目类型已保存，但列表读取失败/);
  records.forge_project_type.push({ id: 'type-b', name: '已保存类型', active: true });
  await button(h, '重新读取类型').props.onClick();
  assert.equal(button(h, '重新读取类型'), undefined);
  assert.equal(field(h, '项目类型').props.options.some(([id]) => id === 'type-b'), true);
  assert.equal(field(h, '项目名称').props.value, '需要保留的中文项目草稿');
  assert.equal(h.calls.some(call => call.method !== 'GET'), false);
});

test('type close requests always confirm while the native modal remains open with a stable key', async () => {
  const { h, typeReads } = await fixture();
  completeDraft(h);
  button(h, '新增项目类型').props.onClick();
  const opened = typeForm(h), native = opened.props;
  // Native ObjectForm owns empty/edited values; confirmOnDiscard=false routes
  // every close intent to this host handler without a dirty-only branch.
  assert.equal(native.confirmOnDiscard, false);
  native.onOpenChange(false);
  const stillOpen = typeForm(h);
  assert.equal(stillOpen.type, opened.type);
  assert.equal(stillOpen.props.key, native.key);
  assert.equal(stillOpen.props.open, true);
  assert.equal(stillOpen.props.initialValues, undefined);
  assert.ok(typeCloseConfirmation(h));
  typeCloseConfirmation(h).props.onCancel();
  assert.equal(typeCloseConfirmation(h), undefined);
  assert.equal(typeForm(h).props.key, native.key);
  assert.equal(field(h, '项目名称').props.value, '需要保留的中文项目草稿');
  assert.equal(field(h, '项目类型').props.value, 'type-a');
  native.onOpenChange(false);
  typeCloseConfirmation(h).props.onConfirm();
  assert.equal(typeForm(h), undefined);
  assert.equal(typeReads(), 1);
  assert.equal(h.calls.some(call => call.method !== 'GET'), false);
});

test('new-project dates opt into editable controls and native form validity gates both submit steps', async () => {
  const { h } = await fixture();
  let valid = false, checks = 0, prevented = false;
  const form = draftForm(h);
  form.props.ref.current = { reportValidity() { checks++; return valid; } };
  form.props.onSubmit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(field(h, '计划开始日期').props.editable, true);
  assert.equal(field(h, '计划结束日期').props.editable, true);
  projectDialog(h).props.onConfirm();
  assert.equal(checks, 0, 'required-field feedback precedes native validity');
  completeDraft(h);
  field(h, '计划开始日期').props.onChange('2026-02-30');
  field(h, '计划开始日期').props.onValidityChange(false);
  projectDialog(h).props.onConfirm();
  assert.equal(checks, 1);
  assert.equal(projectDialog(h).props.confirmLabel, '下一步');
  assert.equal(h.calls.some(call => call.path.startsWith('/actions/')), false);

  // A collapsed section has no mounted date input; native validity alone is now true.
  valid = true;
  projectDialog(h).props.onConfirm();
  assert.equal(projectDialog(h).props.confirmLabel, '下一步');
  assert.equal(h.calls.some(call => call.path.startsWith('/actions/')), false);
  field(h, '计划开始日期').props.onChange('2026-10-07');
  field(h, '计划开始日期').props.onValidityChange(true);
  valid = true;
  projectDialog(h).props.onConfirm();
  assert.equal(projectDialog(h).props.confirmLabel, '确认提交');
  valid = false;
  projectDialog(h).props.onConfirm();
  assert.equal(h.calls.some(call => call.path.startsWith('/actions/')), false);
  valid = true;
  await projectDialog(h).props.onConfirm();
  const writes = h.calls.filter(call => call.path.startsWith('/actions/'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.params.planned_start_on, '2026-10-07');
});
