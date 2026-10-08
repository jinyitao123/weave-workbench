import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectMemberEditorPage } from '../src/pages/project-member-editor.page.ts';
import { createServicePageHarness, serviceNodes, serviceButton, serviceText } from './service-page-react-harness.mjs';

const response = (payload, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => payload });
const input = (h, label) => serviceNodes(h.render(), node => node.props?.['aria-label'] === label)[0];
const click = (h, label) => serviceButton(h.render(), label).props.onClick();
const change = (h, label, value) => input(h, label).props.onChange({ target: { value } });

async function fixture({ rejectReadback = false, rejectPositionReadback = false, holdWrite = false } = {}) {
  const routes = [], writes = [];
  const member = { id: 'member-a', project_id: 'project-a', user_id: 'user-b', member_duty: 'member', active: true, joined_on: '2026-10-01', remarks: '原备注', updated_at: 'revision-1' };
  let positionIds = ['position-a'], revision = 1, readbackRejected = false, release;
  const rows = {
    forge_project: [{ id: 'project-a', name: '项目成员验证', owner_id: 'actor', manager_id: 'actor' }],
    forge_project_member: [member],
    sys_user: [{ id: 'actor', name: '项目负责人' }, { id: 'user-b', name: '项目成员' }],
  };
  const location = { origin: 'http://service-page.test', href: 'http://service-page.test/_console/apps/project/member?project=project-a&member=member-a', pathname: '/_console/apps/project/member', search: '?project=project-a&member=member-a' };
  const h = createServicePageHarness(ProjectMemberEditorPage, {
    records: rows,
    globals: { location, window: { location }, navigate: path => routes.push(path) },
    transport: async (url, options = {}) => {
      const path = new URL(url).pathname.replace('/api/v1', '');
      if (path === '/auth/get-session') return response({ user: { id: 'actor' } });
      if (path === '/auth/me/permissions') return response({ systemPermissions: ['forge_project_operator'] });
      if (path.includes('project_member_position_assignments_read') && rejectPositionReadback && writes.length && !readbackRejected) { readbackRejected = true; return response({ error: '岗位目录暂时不可读' }, 503); }
      if (path.includes('project_member_position_assignments_read')) return response({ result: {
        available_positions: [{ id: 'position-a', label: '项目执行' }, { id: 'position-b', label: '计划维护' }],
        assignments: positionIds.map(positionId => ({ positionId, active: true, appointed: true, isDefault: false })),
      } });
      if (path.startsWith('/data/')) {
        if (rejectReadback && writes.length && !readbackRejected && path.endsWith('/forge_project_member')) {
          readbackRejected = true;
          return response({ error: '读取暂时失败' }, 503);
        }
        const records = rows[path.split('/').at(-1)] || [];
        return response({ records: structuredClone(records), total: records.length });
      }
      if (path.startsWith('/actions/')) {
        const params = JSON.parse(options.body).params;
        writes.push({ path, params });
        if (holdWrite) await new Promise(resolve => { release = resolve; });
        assert.equal(params.expected_updated_at, member.updated_at, 'the next save uses the refreshed member revision');
        if (path.includes('project_member_position_assignments_save')) positionIds = JSON.parse(params.position_ids);
        else if (path.includes('project_member_update')) Object.assign(member, { joined_on: params.joined_on, remarks: params.remarks });
        member.updated_at = 'revision-' + (++revision);
        return response({ result: { id: member.id } });
      }
      throw new Error('Unexpected request: ' + path);
    },
  });
  await h.flushEffects();
  return { h, routes, writes, member, release: () => release() };
}

function editBoth(h) {
  change(h, '项目成员备注', '待保存的中文成员说明');
  change(h, '项目岗位（可多选）', ['position-a', 'position-b']);
}

test('saving positions preserves member edits and refreshes the revision for their subsequent save', async () => {
  const { h, routes, writes, member } = await fixture();
  editBoth(h);
  await click(h, '保存岗位分配');
  assert.equal(input(h, '项目成员备注').props.value, '待保存的中文成员说明');
  assert.equal(member.remarks, '原备注');
  assert.equal(serviceButton(h.render(), '保存岗位分配').props.disabled, true);
  assert.match(serviceText(h.render()), /成员信息修改尚未保存/);
  assert.deepEqual(routes, []);
  await click(h, '保存成员信息');
  assert.equal(member.remarks, '待保存的中文成员说明');
  assert.equal(writes.length, 2);
  assert.match(routes[0], /page_project_center\?project=project-a&tab=team$/);
});

test('saving member information retains position edits and only resets the saved section baseline', async () => {
  const { h, routes, writes } = await fixture();
  editBoth(h);
  await click(h, '保存成员信息');
  assert.deepEqual(Array.from(input(h, '项目岗位（可多选）').props.value), ['position-a', 'position-b']);
  assert.equal(serviceButton(h.render(), '保存成员信息').props.disabled, true);
  assert.equal(serviceButton(h.render(), '保存岗位分配').props.disabled, false);
  assert.match(serviceText(h.render()), /岗位分配修改尚未保存/);
  assert.deepEqual(routes, []);
  await click(h, '保存岗位分配');
  await click(h, '返回项目');
  assert.equal(writes.length, 2);
  assert.match(routes[0], /tab=team$/);
});

test('failed readback retries reads without repeating the successful write or dropping the other draft', async () => {
  const { h, routes, writes } = await fixture({ rejectReadback: true });
  editBoth(h);
  await click(h, '保存岗位分配');
  assert.match(serviceText(h.render()), /保存已完成，但最新资料读取失败/);
  click(h, '返回项目');
  const discard = serviceNodes(h.render(), node => node.type === 'ForgeDialog' && node.props.open)[0];
  assert.ok(discard, 'the readback error view must retain the unsaved-changes confirmation');
  discard.props.onCancel();
  await click(h, '重新读取资料');
  assert.equal(writes.length, 1);
  assert.deepEqual(routes, []);
  assert.equal(input(h, '项目成员备注').props.value, '待保存的中文成员说明');
});

test('pending save blocks duplicate actions, field edits and return navigation', async () => {
  const { h, routes, writes, release } = await fixture({ holdWrite: true });
  editBoth(h);
  const save = serviceButton(h.render(), '保存岗位分配').props.onClick;
  const pending = save();
  await save();
  assert.equal(writes.length, 1);
  assert.equal(input(h, '项目成员备注').props.disabled, true);
  assert.equal(input(h, '成员加入日期').props.disabled, true);
  click(h, '返回项目');
  assert.deepEqual(routes, []);
  release();
  await pending;
  assert.equal(input(h, '项目成员备注').props.disabled, false);
});


test('failed position-directory readback keeps the unsaved position draft reachable through read-only retry', async () => {
  const { h, routes, writes } = await fixture({ rejectPositionReadback: true });
  editBoth(h);
  await click(h, '保存成员信息');
  assert.match(serviceText(h.render()), /保存已完成，但最新资料读取失败.*岗位目录暂时不可读/);
  await click(h, '重新读取资料');
  assert.equal(writes.length, 1);
  assert.deepEqual(routes, []);
  assert.deepEqual(Array.from(input(h, '项目岗位（可多选）').props.value), ['position-a', 'position-b']);
  assert.equal(serviceButton(h.render(), '保存岗位分配').props.disabled, false);
});
