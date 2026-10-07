import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { ProjectCenterPage } from '../src/pages/project-center.page.ts';
import { ProjectTaskWorkspacePage } from '../src/pages/project-task-workspace.page.ts';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@objectstack/cli'));
const { transformSync } = cliRequire('esbuild');

function task(id, status, projectId = 'project-1') {
  return {
    id,
    name: id,
    item_key: id.toUpperCase(),
    project_id: projectId,
    plan_id: projectId === 'project-1' ? 'plan-1' : 'plan-2',
    item_type: 'task',
    task_type: 'project_task_type_2',
    status,
    priority: 'medium',
    owner_id: 'user-1',
    planned_start_on: '2026-10-01',
    planned_end_on: '2026-10-10',
    estimated_hours: 6,
    progress: status === 'completed' ? 100 : 0,
  };
}

function runtimeComponent(name) {
  return Object.defineProperty(function RuntimeComponent() {}, 'name', { value: name });
}

function createHarness(pageSource, { search = '', seed, fetchImpl, permissions = ['forge_project_manager'] } = {}) {
  const slots = [];
  const navigation = [];
  const effects = [];
  const requests = [];
  const downloads = [];
  let cursor = 0;
  const React = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      const normalized = { ...(props || {}) };
      const flatChildren = children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false);
      if (flatChildren.length) normalized.children = flatChildren.length === 1 ? flatChildren[0] : flatChildren;
      return { type, props: normalized, children: flatChildren };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) {
        let value = typeof initial === 'function' ? initial() : initial;
        if (value && value.loading === true && Array.isArray(value.projects)) {
          value = { ...value, ...seed, permissions: seed?.permissions || { systemPermissions: ['forge_project_manager'] }, loading: false };
        }
        slots[index] = value;
      }
      return [slots[index], next => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect) { const index = cursor++; if (!(index in effects)) effects[index] = effect; },
    useMemo(factory) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = factory();
      return slots[index];
    },
  };
  const transport = async (...args) => {
    requests.push(String(args[0]));
    if (String(args[0]).endsWith('/api/v1/auth/me/permissions')) return { ok: true, status: 200, json: async () => ({ systemPermissions: permissions }) };
    if (!fetchImpl) throw new Error('Unexpected API request');
    return fetchImpl(...args);
  };
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    __name: (target, value) => Object.defineProperty(target, 'name', { value, configurable: true }),
    React,
    Icon: runtimeComponent('Icon'),
    WorkspaceHeader: runtimeComponent('WorkspaceHeader'),
    WorkspaceToolbar: runtimeComponent('WorkspaceToolbar'),
    StatusTabs: runtimeComponent('StatusTabs'),
    RecordTable: runtimeComponent('RecordTable'),
    ListSummary: runtimeComponent('ListSummary'),
    ListView: runtimeComponent('ListView'),
    GanttView: runtimeComponent('GanttView'),
    ExportConfigurationDialog: runtimeComponent('ExportConfigurationDialog'),
    useAdapter: () => ({ baseUrl: 'http://forge.test', getAuthHeaders: () => ({}), fetchImpl: transport }),
    navigate: path => navigation.push(path),
    URL,
    URLSearchParams,
    Headers,
    Blob,
    document: {
      getElementById: () => null,
      head: { appendChild() {} },
      createElement: () => ({ click() { downloads.push({ href: this.href, download: this.download }); } }),
    },
    window: {
      location: { search, pathname: '/_console/apps/com.inoforge.forge.project/page_project_center', href: 'http://forge.test/_console/apps/com.inoforge.forge.project/page_project_center' + search },
      history: { pushState() {} },
      addEventListener() {},
      removeEventListener() {},
    },
    location: { origin: 'http://forge.test', pathname: '/_console/apps/com.inoforge.forge.project/page_project_center', href: 'http://forge.test/_console/apps/com.inoforge.forge.project/page_project_center' + search },
    setTimeout,
    clearTimeout,
    console,
  };
  const code = transformSync(pageSource, { loader: 'jsx', format: 'cjs' }).code;
  vm.runInNewContext(code, context);
  const App = module.exports.default;
  return {
    navigation,
    requests,
    downloads,
    render() {
      cursor = 0;
      return App();
    },
    async runEffects() { await Promise.all(effects.filter(Boolean).map(effect => effect())); await new Promise(resolve => setTimeout(resolve, 0)); },
  };
}

function findNodes(tree, predicate, results = [], visited = new Set()) {
  if (!tree || typeof tree !== 'object' || visited.has(tree)) return results;
  visited.add(tree);
  if (predicate(tree)) results.push(tree);
  for (const child of tree.children || []) findNodes(child, predicate, results, visited);
  const visitProp = value => {
    if (Array.isArray(value)) {
      for (const entry of value) visitProp(entry);
    } else if (value && typeof value === 'object' && 'type' in value && 'props' in value) {
      findNodes(value, predicate, results, visited);
    }
  };
  for (const value of Object.values(tree.props || {})) visitProp(value);
  return results;
}

function taskTable(tree) {
  return findNodes(tree, node => node.type?.name === 'RecordTable' && node.props?.schema?.className === 'pt-task-record-table')[0]?.props.schema;
}

function textContent(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node.type === 'style') return '';
  return (node.children || []).map(textContent).join('');
}

function calendarParts(date) { return [date.getFullYear(), date.getMonth() + 1, date.getDate()]; }

const projects = [
  { id: 'project-1', code: 'PRJ-1', name: 'Project One', organization_id: 'org-1', customer_id: 'customer-1', manager_id: 'user-1', created_by: 'user-1', status: 'in_progress', planned_start_on: '2026-10-01', planned_end_on: '2026-10-31', progress: 0 },
  { id: 'project-2', code: 'PRJ-2', name: 'Project Two', organization_id: 'org-1', customer_id: 'customer-1', manager_id: 'user-1', status: 'in_progress', planned_start_on: '2026-10-01', planned_end_on: '2026-10-31', progress: 0 },
];
const taskTypeNames = ['方案设计', '测试验证', '文档编写', '培训交付', '问题处理', '沟通协调', '评审会议', '开发实施', '其他', '外部协调', '需求分析'];
const taskTypes = taskTypeNames.map((name, index) => ({ id: 'project_task_type_' + String(index + 1), code: 'project_task_type_' + String(index + 1), name, organization_id: 'org-1', scope: 'project', setting_type: 'task_type', enabled: true, sort_order: index + 1 }));

test('project detail task status filter is controlled and task links retain project scope', () => {
  const harness = createHarness(ProjectCenterPage.source, {
    search: '?project=project-1',
    seed: {
      currentUserId: 'user-1',
      permissions: { systemPermissions: ['forge_project_operator', 'sales_contract_operator'] },
      projects,
      customers: [{ id: 'customer-1', name: 'Customer One' }],
      users: [{ id: 'user-1', name: 'Project Manager' }],
      items: [task('active-task', 'in_progress'), task('cancelled-task', 'cancelled')],
    },
  });
  let tree = harness.render();
  const tasksTab = findNodes(tree, node => node.type === 'button' && textContent(node) === '任务管理')[0];
  assert.ok(tasksTab, 'the project detail exposes its task section');
  tasksTab.props.onClick();

  tree = harness.render();
  const statusSelect = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '任务状态')[0];
  assert.ok(statusSelect, 'the status filter is an accessible controlled selector');
  assert.equal(statusSelect.props.value, '');
  const table = findNodes(tree, node => Array.isArray(node.props?.rows))[0];
  const initialRows = table.props.rows.map(textContent);
  assert.equal(initialRows.length, 2);
  assert.match(initialRows[0], /active-task.*进行中/);
  assert.match(initialRows[1], /cancelled-task.*已取消/);

  statusSelect.props.onChange({ target: { value: 'cancelled' } });
  tree = harness.render();
  const filteredTable = findNodes(tree, node => Array.isArray(node.props?.rows))[0];
  assert.equal(filteredTable.props.rows.length, 1);
  assert.match(textContent(filteredTable.props.rows[0]), /cancelled-task/);

  const viewTask = findNodes(filteredTable.props.rows[0], node => node.type === 'button' && textContent(node) === '查看')[0];
  viewTask.props.onClick();
  assert.equal(harness.navigation.at(-1), '/apps/com.inoforge.forge.project/page_project_task_workspace?project=project-1&search=cancelled-task');
});

test('task workspace reads project scope from its route and filters cancelled tasks', () => {
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1',
    seed: {
      projects,
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }, { id: 'plan-2', project_id: 'project-2', status: 'active' }],
      items: [task('active-task', 'in_progress'), task('cancelled-task', 'cancelled'), task('other-project-task', 'cancelled', 'project-2')],
      members: [{ id: 'member-1', project_id: 'project-1', user_id: 'user-1', member_duty: 'manager', active: true }],
      taskTypes,
      users: [{ id: 'user-1', name: 'Project Manager' }],
      evidence: [],
      error: '',
    },
  });
  let tree = harness.render();
  const projectSelect = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '项目筛选')[0];
  assert.ok(projectSelect);
  assert.equal(projectSelect.props.value, 'project-1');
  assert.deepEqual(taskTable(tree).data.map(row => row.name), ['active-task', 'cancelled-task']);
  assert.equal(taskTable(tree).pageSize, 10);
  assert.equal(taskTable(tree).manualPagination, true);

  const statusTabs = findNodes(tree, node => node.type?.name === 'StatusTabs' && node.props['aria-label'] === '任务状态')[0];
  assert.ok(statusTabs, 'task state remains a selectable status tab');
  statusTabs.props.onValueChange('cancelled');
  tree = harness.render();
  assert.deepEqual(taskTable(tree).data.map(row => row.name), ['cancelled-task']);

  const createButton = findNodes(tree, node => node.type === 'button' && textContent(node) === '新建任务')[0];
  createButton.props.onClick();
  tree = harness.render();
  assert.equal(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && ['任务项目', '任务计划', '所属阶段'].includes(node.props['aria-label'])).length, 0,
    'the originating project and its active plan remain implicit in the project-scoped form');
  assert.ok(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '任务类别')[0]);
});

test('task Gantt uses the current project, search, and status scope on one date axis and remains read-only', () => {
  const ganttRows = [
    { ...task('范围内-零进度', 'pending'), planned_start_on: '2026-10-05', planned_end_on: '2026-10-05', progress: 0 },
    { ...task('范围内-第二项', 'pending'), planned_start_on: '2026-10-12', planned_end_on: '2026-10-16', progress: 35 },
    { ...task('范围内-坏日期', 'pending'), planned_start_on: '2026-02-30', planned_end_on: '2026-10-20', progress: 10 },
    { ...task('范围内-坏进度', 'pending'), planned_start_on: '2026-10-08', planned_end_on: '2026-10-09', progress: 101 },
    task('范围内-已完成', 'completed'),
    task('范围内-其他项目', 'pending', 'project-2'),
  ];
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1',
    seed: {
      projects,
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: ganttRows,
      members: [{ id: 'member-1', project_id: 'project-1', user_id: 'user-1', member_duty: 'manager', active: true }],
      taskTypes,
      users: [{ id: 'user-1', name: 'Project Manager' }],
      errors: {},
    },
  });

  let tree = harness.render();
  findNodes(tree, node => node.type?.name === 'StatusTabs' && node.props['aria-label'] === '任务状态')[0].props.onValueChange('pending');
  tree = harness.render();
  findNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '搜索任务')[0].props.onChange({ target: { value: '范围内' } });
  tree = harness.render();
  findNodes(tree, node => node.type?.name === 'StatusTabs' && node.props['aria-label'] === '任务视图')[0].props.onValueChange('gantt');
  tree = harness.render();

  const gantt = findNodes(tree, node => node.type?.name === 'GanttView')[0];
  assert.ok(gantt, 'the selected Gantt view renders the shared date-based renderer');
  assert.equal(gantt.props.readOnly, true);
  assert.equal(gantt.props.showToolbar, false);
  assert.equal(gantt.props.viewMode, 'day');
  assert.deepEqual(Array.from(gantt.props.tasks, row => row.id), ['范围内-零进度', '范围内-第二项'],
    'Gantt input stays within the current project, status, and title search filters');
  assert.equal(gantt.props.tasks[0].progress, 0, 'zero progress is not inflated to a minimum bar width');
  assert.deepEqual(calendarParts(gantt.props.tasks[0].start), [2026, 10, 5]);
  assert.deepEqual(calendarParts(gantt.props.tasks[0].end), [2026, 10, 5], 'the original same-day end is preserved');
  assert.deepEqual(calendarParts(gantt.props.startDate), [2026, 10, 2]);
  assert.deepEqual(calendarParts(gantt.props.endDate), [2026, 10, 23]);
  assert.ok(gantt.props.tasks.every(row => Object.prototype.toString.call(row.start) === '[object Date]' && Object.prototype.toString.call(row.end) === '[object Date]'),
    'tasks use Date values on the shared axis');

  const unavailable = findNodes(tree, node => node.props?.['aria-label'] === '未排入甘特图的任务')[0];
  assert.ok(unavailable);
  assert.match(textContent(unavailable), /范围内-坏日期.*计划开始日期未填写或无效/);
  assert.match(textContent(unavailable), /范围内-坏进度.*任务进度暂不可用/);
  assert.match(textContent(unavailable), /有 2 条任务暂不能显示日期排程/);
  assert.doesNotMatch(textContent(gantt), /坏日期|坏进度|其他项目|已完成/);

  for (const callback of ['onTaskUpdate', 'onTaskDelete', 'onDependencyChange', 'onDependencyCreate', 'onTaskMove']) {
    assert.equal(gantt.props[callback], undefined, `read-only Gantt does not expose ${callback}`);
  }
  gantt.props.onTaskClick(gantt.props.tasks[0]);
  assert.equal(harness.navigation.at(-1), '/apps/com.inoforge.forge.project/page_project_plan_risemap?id=plan-1');
  assert.equal(harness.requests.some(path => path.includes('/actions/')), false, 'opening a task only navigates to its existing plan');
});

test('task import is shown only to project managers and submits the native insert-only ImportJob with scoped references', async () => {
  const importPermission = { systemPermissions: ['forge_project_manager'], objects: { forge_project_work_item: { allowCreate: true } } };
  const seed = {
    permissions: importPermission,
    projects: [projects[0]],
    plans: [{ id: 'plan-1', project_id: 'project-1', organization_id: 'org-1', status: 'active', name: '执行计划' }],
    items: [{ id: 'phase-1', project_id: 'project-1', plan_id: 'plan-1', item_type: 'phase', name: '启动阶段' }],
    members: [{ id: 'member-1', name: 'Team Member', project_id: 'project-1', user_id: 'user-2', member_duty: 'member', active: true }],
    taskTypes: [{ id: 'type-1', code: 'type-1', name: '测试验证', organization_id: 'org-1', scope: 'project', setting_type: 'task_type', enabled: true }],
    users: [{ id: 'user-2', name: 'Team Member' }],
  };
  let sent;
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    seed,
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/data/forge_project_work_item/import/jobs')) {
        sent = JSON.parse(options.body || '{}');
        return { ok: true, status: 201, json: async () => ({ jobId: 'native-task-import-job' }) };
      }
      throw new Error('Unexpected task import request ' + parsed.pathname);
    },
  });
  let tree = harness.render();
  const importButton = findNodes(tree, node => node.type === 'button' && textContent(node) === '导入任务')[0];
  assert.ok(importButton, 'a project manager with effective create capability can open task import');
  importButton.props.onClick();
  tree = harness.render();
  const projectSelect = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '导入任务项目')[0];
  assert.equal(projectSelect.props.value, 'project-1');
  const planSelect = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '导入任务计划')[0];
  assert.equal(planSelect.props.value, 'plan-1');
  const fileInput = findNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '选择任务CSV文件')[0];
  assert.ok(fileInput);
  const csv = '任务标题,详细描述,任务类别,负责人,优先级,计划开始,计划结束,预估工时,所属阶段\r\n现场接口检查,完成前核对协议,测试验证,Team Member,高,2026-10-04,2026-10-06,6.5,启动阶段';
  fileInput.props.onChange({ target: { files: [{ name: '任务.csv', size: csv.length, text: async () => csv }], value: 'selected' } });
  tree = harness.render();
  const importDialog = findNodes(tree, node => node.type?.name === 'ForgeDialog' && node.props.title === '导入任务')[0];
  assert.ok(importDialog);
  assert.match(textContent(importDialog), /任务\.csv/);
  assert.equal(importDialog.props.confirmLabel, '开始导入');
  await importDialog.props.onConfirm();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(sent, JSON.stringify({ requests: harness.requests, error: findNodes(harness.render(), node => node.type?.name === 'ForgeDialog' && node.props.title === '导入任务')[0]?.props?.error }));
  assert.equal(sent.writeMode, 'insert');
  assert.equal(sent.runAutomations, false, 'trusted code lifecycle hooks still validate ImportJob rows when metadata automations are disabled');
  assert.equal(sent.mapping['任务标题'], 'name');
  assert.equal(sent.mapping['项目'], 'project_id');
  assert.equal(sent.mapping['计划'], 'plan_id');
  assert.doesNotMatch(sent.csv, /完成度|状态|实际开始|实际结束/);
  assert.match(sent.csv, /project-1/);
  assert.match(sent.csv, /plan-1/);

  const workMemberHarness = createHarness(ProjectTaskWorkspacePage.source, {
    permissions: ['forge_solution_operator', 'forge_project_work_member'],
    seed: { ...seed, permissions: { systemPermissions: ['forge_solution_operator', 'forge_project_work_member'], objects: { forge_project_work_item: { allowRead: true, allowCreate: false } } } },
  });
  const workMemberTree = workMemberHarness.render();
  assert.equal(findNodes(workMemberTree, node => node.type === 'button' && textContent(node) === '导入任务').length, 0,
    'a work member does not receive a generic create/import entry');
});

test('task creation lists only active team members for the selected project and labels project priority accurately', () => {
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    seed: {
      projects,
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }, { id: 'plan-2', project_id: 'project-2', status: 'active' }],
      items: [],
      members: [
        { id: 'manager-member', project_id: 'project-1', user_id: 'user-1', member_duty: 'manager', active: true },
        { id: 'team-member', project_id: 'project-1', user_id: 'user-2', member_duty: 'member', active: true },
        { id: 'inactive-member', project_id: 'project-1', user_id: 'user-3', member_duty: 'member', active: false },
        { id: 'other-project-member', project_id: 'project-2', user_id: 'user-4', member_duty: 'member', active: true },
      ],
      taskTypes,
      users: [
        { id: 'user-1', name: 'Project Manager' }, { id: 'user-2', name: 'Team Member' },
        { id: 'user-3', name: 'Inactive Member' }, { id: 'user-4', name: 'Other Project Member' },
      ],
      evidence: [],
      error: '',
    },
  });
  let tree = harness.render();
  findNodes(tree, node => node.type === 'button' && textContent(node) === '新建任务')[0].props.onClick();
  tree = harness.render();
  const owner = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '任务负责人')[0];
  assert.deepEqual(findNodes(owner, node => node.type === 'option').map(option => option.props.value), ['', 'user-1', 'user-2']);
  assert.ok(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '任务优先级')[0]);
  assert.match(textContent(tree), /需求分析/);
  assert.match(textContent(tree), /优先级/);
  const estimate = findNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '预估工时')[0];
  assert.equal(estimate.props.value, '8');
  const category = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '任务类别')[0];
  assert.deepEqual(findNodes(category, node => node.type === 'option').map(option => option.props.value), ['', ...taskTypes.map(option => option.id)]);
  assert.match(ProjectTaskWorkspacePage.source, /project_work_item_update_details/);
});

test('a task launched inside the current project keeps project, plan and phase context implicit', () => {
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1',
    seed: {
      projects,
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: [{ id: 'phase-1', project_id: 'project-1', plan_id: 'plan-1', item_type: 'phase', name: '启动阶段' }],
      members: [{ id: 'manager-member', project_id: 'project-1', user_id: 'user-1', member_duty: 'manager', active: true }],
      taskTypes: [taskTypes[0]],
      users: [{ id: 'user-1', name: 'Project Manager' }],
      evidence: [],
      error: '',
    },
  });
  let tree = harness.render();
  findNodes(tree, node => node.type === 'button' && textContent(node) === '新建任务')[0].props.onClick();
  tree = harness.render();
  assert.equal(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && ['任务项目', '任务计划', '所属阶段'].includes(node.props['aria-label'])).length, 0);
  assert.ok(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '任务类别')[0]);
  assert.ok(findNodes(tree, node => node.type?.name === 'ForgeDateInput' && node.props['aria-label'] === '任务截止日期')[0]);
  assert.match(ProjectTaskWorkspacePage.source, /parent_id:defaultPhase\?\.id\|\|''/);
});

test('task workspace does not fall back to another project when the requested scope is unavailable', () => {
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=unavailable-project',
    seed: {
      projects,
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: [task('active-task', 'in_progress')],
      users: [],
      evidence: [],
      error: '',
    },
  });
  const tree = harness.render();
  assert.doesNotMatch(textContent(tree), /active-task/);
  const createButton = findNodes(tree, node => node.type === 'button' && textContent(node) === '新建任务')[0];
  assert.equal(createButton.props.disabled, true, 'an inaccessible project cannot silently route task creation to a different project');
});

test('task workspace honors a task search passed from a project detail row', () => {
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1&search=CANCELLED-TASK',
    seed: {
      projects,
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: [task('active-task', 'in_progress'), task('cancelled-task', 'cancelled')],
      users: [{ id: 'user-1', name: 'Project Manager' }],
      evidence: [],
      error: '',
    },
  });
  const tree = harness.render();
  const searchInput = findNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '搜索任务')[0];
  assert.equal(searchInput.props.value, 'CANCELLED-TASK');
  assert.deepEqual(taskTable(tree).data.map(row => row.name), ['cancelled-task']);
});

test('task workspace hides internal plan-derived keys and keeps the task heading plain', () => {
  const privateKey = 'plan-private-id:7';
  const row = { ...task('客户现场检查', 'pending'), item_key: privateKey };
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1',
    seed: {
      projects,
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: [row],
      users: [{ id: 'user-1', name: 'Project Manager' }],
      errors: {},
    },
  });
  let tree = harness.render();
  assert.match(textContent(tree), /任务管理/);
  assert.doesNotMatch(textContent(tree), /集中查看任务安排|plan-private-id:7/);
  assert.ok(findNodes(tree, node => node.type === 'input' && node.props.placeholder === '搜索任务标题').length);
  findNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '搜索任务')[0].props.onChange({ target: { value: privateKey } });
  tree = harness.render();
  assert.ok(findNodes(tree, node => node.type?.name === 'ForgeEmpty' && node.props.title === '暂无匹配任务').length);
  assert.doesNotMatch(textContent(tree), /plan-private-id:7/);
});

test('task workspace keeps business rows visible when optional external-plan evidence is forbidden', async () => {
  const records = {
    forge_project: projects,
    forge_project_plan: [{ id: 'plan-1', project_id: 'project-1', organization_id: 'org-1', status: 'active', name: 'Plan One' }],
    forge_project_work_item: Array.from({ length: 101 }, (_, index) => task('http-task-' + index, 'in_progress')),
    forge_project_member: [{ id: 'member-1', project_id: 'project-1', organization_id: 'org-1', user_id: 'user-1', member_duty: 'manager', active: true }],
    forge_business_setting_option: taskTypes,
    sys_user: [{ id: 'user-1', name: 'Project Manager' }],
  };
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1',
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl), object = url.pathname.replace('/api/v1/data/', '');
      if (object === 'forge_project_plan_evidence') return { ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) };
      const allRows = records[object] || [], top = Number(url.searchParams.get('$top') || 100), skip = Number(url.searchParams.get('$skip') || 0), rows = allRows.slice(skip, skip + top);
      return { ok: true, status: 200, json: async () => ({ records: rows, totalCount: allRows.length }) };
    },
  });
  harness.render();
  await harness.runEffects();
  const tree = harness.render();
  assert.equal(taskTable(tree).rowCount, 101);
  assert.equal(taskTable(tree).data.length, 10);
  assert.equal(taskTable(tree).data[0].name, 'http-task-0');
  assert.equal(harness.requests.filter(url => url.includes('/data/forge_project_work_item?')).length, 2, 'the shared reader fetches both pages for 101 tasks');
  assert.equal(harness.requests.some(url => url.includes('forge_project_plan_evidence')), false, 'the employee TaskWorkspace does not fetch reference evidence');
  assert.doesNotMatch(textContent(tree), /计划任务概览|来源外部计划/);
  const createButton = findNodes(tree, node => node.type === 'button' && textContent(node) === '新建任务')[0];
  assert.equal(createButton.props.disabled, false);
});

test('task workspace distinguishes a task-list 403 from a real empty list and offers retry', async () => {
  const records = {
    forge_project: projects,
    forge_project_plan: [{ id: 'plan-1', project_id: 'project-1', organization_id: 'org-1', status: 'active', name: 'Plan One' }],
    forge_project_member: [{ id: 'member-1', project_id: 'project-1', organization_id: 'org-1', user_id: 'user-1', member_duty: 'manager', active: true }],
    forge_business_setting_option: taskTypes,
    sys_user: [{ id: 'user-1', name: 'Project Manager' }],
  };
  let itemReadAttempts = 0;
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1',
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl), object = url.pathname.replace('/api/v1/data/', '');
      if (object === 'forge_project_work_item') { itemReadAttempts++; return { ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) }; }
      const rows = records[object] || [];
      return { ok: true, status: 200, json: async () => ({ records: rows, totalCount: rows.length }) };
    },
  });
  harness.render();
  await harness.runEffects();
  let tree = harness.render();
  assert.match(textContent(tree), /任务列表读取失败/);
  assert.doesNotMatch(textContent(tree), /暂无匹配任务/);
  const retry = findNodes(tree, node => node.type === 'button' && textContent(node) === '重试')[0];
  assert.ok(retry);
  await retry.props.onClick();
  tree = harness.render();
  assert.equal(itemReadAttempts, 2);
  assert.match(textContent(tree), /当前账号无权读取任务列表/);
});

test('task workspace gives an explicit plan-management route when a project has no plan', () => {
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1',
    seed: { projects, plans: [], items: [], members: [{ id: 'member-1', project_id: 'project-1', user_id: 'user-1', member_duty: 'manager', active: true }], taskTypes, users: [{ id: 'user-1', name: 'Project Manager' }], errors: {} },
  });
  const tree = harness.render();
  assert.match(textContent(tree), /尚未创建正式计划/);
  const createButton = findNodes(tree, node => node.type === 'button' && textContent(node) === '新建任务')[0];
  assert.equal(createButton.props.disabled, true);
  const planButton = findNodes(tree, node => node.type === 'button' && textContent(node) === '前往项目计划')[0];
  assert.ok(planButton);
  planButton.props.onClick();
  assert.equal(harness.navigation.at(-1), '/apps/com.inoforge.forge.project/page_project_center?project=project-1&tab=plan');
});

test('a project WorkMember can read their task list but cannot create or edit plan structure', () => {
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1',
    seed: {
      permissions: { systemPermissions: ['forge_project_work_member'] },
      projects,
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: [task('worker-task', 'in_progress')],
      members: [{ id: 'member-1', project_id: 'project-1', user_id: 'user-1', member_duty: 'member', active: true, name: 'Team Member' }],
      taskTypes,
      users: [],
      errors: {},
    },
  });
  const tree = harness.render();
  assert.deepEqual(taskTable(tree).data.map(row => row.name), ['worker-task']);
  assert.equal(findNodes(tree, node => node.type === 'button' && textContent(node) === '新建任务')[0].props.disabled, true);
  assert.equal(findNodes(tree, node => node.type === 'button' && textContent(node) === '编辑').length, 0);
});

test('task owner position choices require an active native PermissionSet with project task capability', async () => {
  const members = [
    { id: 'manager-member', project_id: 'project-1', user_id: 'user-1', member_duty: 'manager', active: true, name: 'Project Manager' },
    { id: 'sales-member', project_id: 'project-1', user_id: 'user-2', member_duty: 'member', active: true, name: 'Sales Owner' },
    { id: 'engineer-member', project_id: 'project-1', user_id: 'user-3', member_duty: 'member', active: true, name: 'Project Engineer' },
  ];
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    search: '?project=project-1',
    seed: {
      projects: [projects[0]],
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: [], members, taskTypes, users: members.map(member => ({ id: member.user_id, name: member.name })), errors: {},
    },
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      const match = /project_task_owner_position_assignments_read\/([^/?]+)/.exec(url.pathname);
      assert.ok(match, 'only the task-owner native position reader is expected');
      const memberId = decodeURIComponent(match[1]);
      const rows = memberId === 'sales-member'
        ? [{ id: 'sales-role', active: true, appointed: true, projectTaskCapable: false, positionLabel: '销售负责人', isDefault: true }]
        : [{ id: 'engineering-role', active: true, appointed: true, projectTaskCapable: true, positionLabel: '项目工程师', isDefault: true }];
      return { ok: true, status: 200, json: async () => ({ result: { assignments: rows, project_task_capable: rows.some(row => row.projectTaskCapable), default_assignment_id: rows[0].id } }) };
    },
  });
  let tree = harness.render();
  findNodes(tree, node => node.type === 'button' && textContent(node) === '新建任务')[0].props.onClick();
  tree = harness.render();
  const owner = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '任务负责人')[0];
  owner.props.onChange({ target: { value: 'user-2' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  tree = harness.render();
  assert.match(textContent(tree), /该岗位没有项目执行权限/);
  let role = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '负责人项目岗位')[0];
  assert.deepEqual(findNodes(role, node => node.type === 'option').map(option => option.props.value), ['']);
  const nextOwner = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '任务负责人')[0];
  nextOwner.props.onChange({ target: { value: 'user-3' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  tree = harness.render();
  role = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '负责人项目岗位')[0];
  assert.deepEqual(findNodes(role, node => node.type === 'option').map(option => option.props.value), ['', 'engineering-role']);
});

const taskExportPermissions = {
  systemPermissions: ['forge_project_manager'],
  objects: { forge_project_work_item: { allowCreate: true, allowExport: true } },
};

async function openTaskExportDialog(harness) {
  let tree = harness.render();
  const button = findNodes(tree, node => node.type === 'button' && textContent(node) === '导出')[0];
  assert.ok(button, 'the public workspace toolbar exposes task export');
  assert.equal(button.props.disabled, false);
  await button.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  tree = harness.render();
  const dialog = findNodes(tree, node => node.type?.name === 'ExportConfigurationDialog')[0];
  assert.ok(dialog, 'the registered export configuration component receives the live page scope');
  return { tree, dialog: dialog.props };
}

test('task list uses real 10-row RecordTable pages and the export dialog captures the page IDs', async () => {
  const records = Array.from({ length: 13 }, (_, index) => task('task-' + String(index + 1).padStart(2, '0'), 'in_progress'));
  const countFilters = [];
  const exportCalls = [];
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    seed: {
      permissions: taskExportPermissions,
      projects: [projects[0]],
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: records,
      members: [{ id: 'member-1', project_id: 'project-1', user_id: 'user-1', member_duty: 'manager', active: true, name: 'Project Manager' }],
      taskTypes,
      users: [{ id: 'user-1', name: 'Project Manager' }],
      errors: {},
    },
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/data/forge_project_work_item/export')) {
        const params = url.searchParams;
        const filter = JSON.parse(params.get('filter'));
        exportCalls.push({ filter, format: params.get('format'), orderby: params.get('orderby'), fields: params.get('fields'), limit: params.get('limit') });
        const count = Number(params.get('limit'));
        const mime = params.get('format') === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : params.get('format') === 'json' ? 'application/json' : 'text/csv; charset=utf-8';
        return { ok: true, status: 200, headers: new Headers({ 'X-Export-Limit': String(count), 'Content-Type': mime }), blob: async () => new Blob(['file'], { type: mime }) };
      }
      if (url.pathname.endsWith('/data/forge_project_work_item')) {
        const filter = JSON.parse(url.searchParams.get('$filter'));
        countFilters.push(filter);
        const idClause = filter?.$and?.find(part => part.id)?.id?.$in;
        return { ok: true, status: 200, json: async () => ({ records: [], totalCount: Array.isArray(idClause) ? idClause.length : records.length }) };
      }
      throw new Error('Unexpected URL ' + url.pathname);
    },
  });

  let tree = harness.render();
  let schema = taskTable(tree);
  assert.equal(schema.manualPagination, true);
  assert.equal(schema.pageSize, 10);
  assert.equal(schema.rowCount, 13);
  assert.deepEqual(schema.data.map(row => row.name), records.slice(0, 10).map(row => row.name));
  schema.onPageChange(2);
  tree = harness.render();
  schema = taskTable(tree);
  assert.equal(schema.page, 2);
  assert.deepEqual(schema.data.map(row => row.name), records.slice(10, 13).map(row => row.name));

  const { dialog } = await openTaskExportDialog(harness);
  assert.equal(dialog.initialScope, 'all');
  assert.equal(dialog.initialFormat, 'csv');
  assert.equal(dialog.initialFileName, '项目任务');
  assert.equal(dialog.currentPageCount, 3);
  assert.equal(dialog.filteredTotalCount, 13);
  assert.equal(dialog.previewRows.length, 3);
  assert.deepEqual(dialog.previewRows.map(row => row.name), records.slice(10, 13).map(row => row.name));
  assert.equal(dialog.previewRows[0].project_id, 'Project One');
  assert.equal(dialog.previewRows[0].plan_id, '—', 'a lookup without a read name stays a dash instead of showing its ID');
  assert.equal(dialog.previewRows[0].owner_id, 'Project Manager');
  assert.ok(dialog.permittedFields.some(field => field.key === 'project_id' && field.label === '项目'));
  assert.ok(dialog.permittedFields.some(field => field.key === 'owner_id' && field.label === '负责人'));
  assert.equal(dialog.permittedFields.some(field => field.key === 'id' || field.key === 'organization_id'), false,
    'the selection contains no internal or organization IDs');

  await dialog.onExport('page', ['name', 'project_id', 'owner_id'], 'xlsx', '当前页任务');
  assert.equal(countFilters.length, 2, 'opening and submitting use server-side count preflights');
  const pageIds = records.slice(10, 13).map(row => row.id);
  const pageFilter = exportCalls[0].filter;
  assert.deepEqual(pageFilter.$and[0], { item_type: { $in: ['task', 'milestone'] } });
  assert.deepEqual(pageFilter.$and[1], { id: { $in: pageIds } });
  assert.equal(exportCalls[0].format, 'xlsx');
  assert.equal(exportCalls[0].orderby, 'id:asc');
  assert.equal(exportCalls[0].limit, '3');
  assert.equal(exportCalls[0].fields, 'name,project_id,owner_id', 'the user-selected field order reaches Native export unchanged');
  assert.equal(harness.downloads[0].download, '当前页任务.xlsx');

  await dialog.onExport('all', ['owner_id', 'name'], 'json', '全部任务');
  assert.equal(exportCalls[1].format, 'json');
  assert.equal(exportCalls[1].orderby, 'id:asc');
  assert.equal(exportCalls[1].limit, '13');
  assert.equal(exportCalls[1].fields, 'owner_id,name');
  assert.equal(harness.downloads[1].download, '全部任务.json');
});

test('task export shares the visible filters with count and native CSV requests', async () => {
  const record = { ...task('deploy task', 'in_progress'), priority: 'urgent' };
  const countFilters = [];
  let exportCall;
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    seed: {
      permissions: taskExportPermissions,
      projects: [projects[0]],
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active', name: 'Plan One' }],
      items: [record],
      members: [{ id: 'member-1', project_id: 'project-1', user_id: 'user-1', member_duty: 'manager', active: true, name: 'Project Manager' }],
      taskTypes,
      users: [{ id: 'user-1', name: 'Project Manager' }],
      errors: {},
    },
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/data/forge_project_work_item/export')) {
        exportCall = { filter: JSON.parse(url.searchParams.get('filter')), params: url.searchParams };
        return { ok: true, status: 200, headers: new Headers({ 'X-Export-Limit': '1', 'Content-Type': 'text/csv; charset=utf-8' }), blob: async () => new Blob(['file'], { type: 'text/csv' }) };
      }
      if (url.pathname.endsWith('/data/forge_project_work_item')) {
        countFilters.push(JSON.parse(url.searchParams.get('$filter')));
        return { ok: true, status: 200, json: async () => ({ records: [], totalCount: 1 }) };
      }
      throw new Error('Unexpected URL ' + url.pathname);
    },
  });

  let tree = harness.render();
  findNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '搜索任务')[0].props.onChange({ target: { value: 'deploy' } });
  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '项目筛选')[0].props.onChange({ target: { value: 'project-1' } });
  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '负责人筛选')[0].props.onChange({ target: { value: 'user-1' } });
  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '优先级筛选')[0].props.onChange({ target: { value: 'urgent' } });
  tree = harness.render();
  findNodes(tree, node => node.type?.name === 'StatusTabs' && node.props['aria-label'] === '任务状态')[0].props.onValueChange('in_progress');
  tree = harness.render();
  const { dialog } = await openTaskExportDialog(harness);
  const expected = { $and: [
    { item_type: { $in: ['task', 'milestone'] } },
    { project_id: 'project-1' },
    { owner_id: 'user-1' },
    { priority: 'urgent' },
    { status: 'in_progress' },
    { name: { $icontains: 'deploy' } },
  ] };
  await dialog.onExport('all', ['name', 'task_type', 'project_id', 'owner_id'], 'csv', '任务筛选结果');
  assert.deepEqual(countFilters, [expected, expected]);
  assert.deepEqual(exportCall.filter, expected, 'the count and download retain every visible filter');
  assert.equal(exportCall.params.get('format'), 'csv');
  assert.equal(exportCall.params.get('orderby'), 'id:asc');
  assert.equal(exportCall.params.get('limit'), '1');
  assert.equal(exportCall.params.get('fields'), 'name,task_type,project_id,owner_id');
  assert.equal(harness.downloads[0].download, '任务筛选结果.csv');
});

test('task export offers only fields present in the current FLS-filtered read projection', async () => {
  const restricted = task('limited fields task', 'pending');
  delete restricted.owner_id;
  delete restricted.estimated_hours;
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    seed: {
      permissions: taskExportPermissions,
      projects: [projects[0]],
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: [restricted],
      members: [],
      taskTypes,
      users: [],
      errors: {},
    },
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/data/forge_project_work_item')) return { ok: true, status: 200, json: async () => ({ records: [], totalCount: 1 }) };
      throw new Error('Unexpected URL ' + url.pathname);
    },
  });
  const { dialog } = await openTaskExportDialog(harness);
  const fieldKeys = dialog.permittedFields.map(field => field.key);
  assert.equal(fieldKeys.includes('owner_id'), false);
  assert.equal(fieldKeys.includes('estimated_hours'), false);
  assert.ok(fieldKeys.includes('name'));
  assert.equal(fieldKeys.some(key => key === 'id' || key === 'organization_id'), false);
});

test('task export reports an empty readable field set without leaking a rejected dialog event', async () => {
  const unreadable = { id: 'task-with-no-readable-fields', organization_id: 'org-1' };
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    seed: {
      permissions: taskExportPermissions,
      projects: [projects[0]],
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active' }],
      items: [unreadable],
      members: [],
      taskTypes: [],
      users: [],
      errors: {},
    },
    fetchImpl: async rawUrl => {
      throw new Error('The no-field preflight must fail before any request: ' + new URL(rawUrl).pathname);
    },
  });
  const tree = harness.render();
  const button = findNodes(tree, node => node.type === 'button' && textContent(node) === '导出')[0];
  assert.ok(button);
  assert.equal(button.props.disabled, true);
  await button.props.onClick();
  const updated = harness.render();
  assert.match(textContent(updated), /当前账号没有可导出的任务字段/);
  const dialog = findNodes(updated, node => node.type?.name === 'ExportConfigurationDialog')[0];
  assert.equal(dialog.props.open, false);
  assert.equal(harness.downloads.length, 0);
});

test('task export rejects server ranges above 50,000 and keeps Native permission errors visible', async () => {
  const responses = [];
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    seed: {
      permissions: taskExportPermissions,
      projects: [projects[0]],
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active', name: 'Plan One' }],
      items: [task('protected task', 'pending')],
      members: [],
      taskTypes,
      users: [],
      errors: {},
    },
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/data/forge_project_work_item/export')) {
        responses.push('export');
        return { ok: false, status: 403, headers: new Headers(), json: async () => ({ error: { message: '当前账号无权导出任务' } }) };
      }
      if (url.pathname.endsWith('/data/forge_project_work_item')) {
        responses.push(url.searchParams.get('$filter'));
        const isPage = url.searchParams.get('$filter')?.includes('id');
        return { ok: true, status: 200, json: async () => ({ records: [], totalCount: isPage ? 2 : 50001 }) };
      }
      throw new Error('Unexpected URL ' + url.pathname);
    },
  });

  const { dialog } = await openTaskExportDialog(harness);
  assert.equal(dialog.filteredTotalCount, 50001);
  await assert.rejects(dialog.onExport('all', ['name'], 'csv', '全部任务'), /50,000/);
  assert.equal(responses.includes('export'), false, 'the 50,000-row limit blocks the stream before download');
  assert.equal(harness.downloads.length, 0);

  await assert.rejects(dialog.onExport('page', ['name'], 'csv', '当前页'), /当前页的任务范围已变化/);
  assert.equal(harness.downloads.length, 0);
});

test('task export shows a native 403 and does not download a partial file', async () => {
  const harness = createHarness(ProjectTaskWorkspacePage.source, {
    seed: {
      permissions: taskExportPermissions,
      projects,
      plans: [{ id: 'plan-1', project_id: 'project-1', status: 'active', name: 'Plan One' }],
      items: [task('protected task', 'pending')],
      members: [{ id: 'member-1', project_id: 'project-1', user_id: 'user-1', member_duty: 'manager', active: true, name: 'Project Manager' }],
      taskTypes,
      users: [{ id: 'user-1', name: 'Project Manager' }],
      errors: {},
    },
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/data/forge_project_work_item')) return { ok: true, status: 200, json: async () => ({ records: [], totalCount: 1 }) };
      if (url.pathname.endsWith('/data/forge_project_work_item/export')) return { ok: false, status: 403, headers: new Headers(), json: async () => ({ error: { message: '当前账号无权导出任务' } }) };
      throw new Error('Unexpected URL ' + url.pathname);
    },
  });
  const { dialog } = await openTaskExportDialog(harness);
  await assert.rejects(dialog.onExport('all', ['name'], 'csv', '受限任务'));
  assert.equal(harness.downloads.length, 0);
  assert.match(textContent(harness.render()), /当前账号无权导出任务/);
});

test('project cost management link always follows the currently opened project', async () => {
  const response = payload => ({ ok: true, status: 200, json: async () => payload });
  const routeFetch = async rawUrl => {
    const url = new URL(rawUrl), path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/get-session') return response({ user: { id: 'user-1' } });
    if (path === '/auth/me/permissions') return response({ systemPermissions: ['forge_project_manager'] });
    if (path.startsWith('/data/')) {
      const object = path.slice('/data/'.length), filter = JSON.parse(url.searchParams.get('$filter') || '{}');
      const values = object === 'forge_project' ? projects : object === 'forge_project_cost_entry'
        ? [{ id: 'cost-1', project_id: 'project-1', status: 'allocated', allocated_amount: 10 }, { id: 'cost-2', project_id: 'project-2', status: 'allocated', allocated_amount: 20 }]
        : [];
      const matches = (row, where) => {
        if (Array.isArray(where.$and)) return where.$and.every(item => matches(row, item));
        return Object.entries(where).every(([key, expected]) => {
          if (expected && typeof expected === 'object') {
            if ('$in' in expected) return expected.$in.includes(row[key]);
            if ('$ne' in expected) return row[key] !== expected.$ne;
            return false;
          }
          return row[key] === expected;
        });
      };
      const records = values.filter(row => matches(row, filter));
      return response({ records, total: records.length, totalCount: records.length });
    }
    throw new Error('Unexpected route during project navigation: ' + path);
  };
  const harness = createHarness(ProjectCenterPage.source, {
    search: '?project=project-1&tab=cost',
    seed: {
      currentUserId: 'user-1',
      permissions: { systemPermissions: ['forge_project_manager'] },
      projects,
      customers: [{ id: 'customer-1', name: 'Customer One' }],
      users: [{ id: 'user-1', name: 'Project Manager' }],
      costs: [
        { id: 'cost-1', project_id: 'project-1', status: 'allocated', allocated_amount: 10 },
        { id: 'cost-2', project_id: 'project-2', status: 'allocated', allocated_amount: 20 },
      ],
    },
    fetchImpl: routeFetch,
  });
  let tree = harness.render();
  let costPanel = findNodes(tree, node => node.type?.name === 'ProjectCostPanel')[0];
  assert.ok(costPanel, 'the rendered cost tab contains the shared project cost panel');
  assert.equal(typeof costPanel.props.onManageCosts, 'function');
  costPanel.props.onManageCosts();
  assert.equal(harness.navigation.at(-1), '/apps/com.inoforge.forge.project/page_project_expense_cost?project=project-1');

  const projectCenterCrumb = findNodes(tree, node => node.type === 'button' && textContent(node) === '项目中心')[0];
  assert.ok(projectCenterCrumb);
  projectCenterCrumb.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  tree = harness.render();
  const projectList = findNodes(tree, node => node.type?.name === 'ListView')[0];
  assert.ok(projectList, 'the project list is available after returning to the center');
  projectList.props.onRowClick({ id: 'project-2' });
  await new Promise(resolve => setTimeout(resolve, 0));
  tree = harness.render();
  const costTab = findNodes(tree, node => node.type === 'button' && textContent(node) === '项目成本')[0];
  assert.ok(costTab);
  costTab.props.onClick();
  tree = harness.render();
  costPanel = findNodes(tree, node => node.type?.name === 'ProjectCostPanel')[0];
  assert.ok(costPanel);
  costPanel.props.onManageCosts();
  assert.equal(harness.navigation.at(-1), '/apps/com.inoforge.forge.project/page_project_expense_cost?project=project-2');
  assert.deepEqual(harness.navigation, [
    '/apps/com.inoforge.forge.project/page_project_expense_cost?project=project-1',
    '/apps/com.inoforge.forge.project/page_project_expense_cost?project=project-2',
  ], 'the second project never reuses the first project id');
  assert.equal(harness.requests.some(path => path.includes('/actions/')), false, 'opening cost management issues no business action');
});

test('project log creation uses the native project_id prefill from the current detail page', () => {
  for (const project of projects) {
    const harness = createHarness(ProjectCenterPage.source, {
      search: '?project=' + encodeURIComponent(project.id) + '&tab=logs',
      seed: {
        currentUserId: 'user-1',
        permissions: { systemPermissions: ['forge_project_manager'] },
        projects,
        customers: [{ id: 'customer-1', name: 'Customer One' }],
        users: [{ id: 'user-1', name: 'Project Manager' }],
        logs: [],
      },
    });
    const tree = harness.render();
    const createLog = findNodes(tree, node => node.type === 'button' && textContent(node) === '写日志')[0];
    assert.ok(createLog, 'the current project log tab exposes its native create route');
    createLog.props.onClick();
    assert.deepEqual(harness.navigation, [
      '/apps/com.inoforge.forge.project/forge_project_log/new?project_id=' + encodeURIComponent(project.id),
    ]);
    const target = new URL('http://forge.test' + harness.navigation[0]);
    assert.equal(target.searchParams.get('project_id'), project.id);
    assert.equal(target.searchParams.has('project'), false, 'the Native form receives the object field name');
    assert.equal(harness.requests.some(path => path.includes('/actions/')), false, 'opening the form route issues no business action');
  }
});


test('project sales summary counts unique current orders and exposes one refresh for both read surfaces', async () => {
  const fixtureOrders = [
    { id: 'order-1', code: 'SO-1', total_amount: 1000, invoiced_amount: 250, collected_amount: 500 },
    { id: 'order-2', code: 'SO-2', total_amount: 500, invoiced_amount: 100, collected_amount: 0 },
  ];
  const links = [
    { id: 'link-1', project_id: 'project-1', order_id: 'order-1', contract_id: 'contract-1', order_amount: 9000 },
    { id: 'link-duplicate', project_id: 'project-1', order_id: 'order-1', contract_id: 'contract-2', order_amount: 9000 },
    { id: 'link-2', project_id: 'project-1', order_id: 'order-2', order_amount: 500 },
    { id: 'contract-only', project_id: 'project-1', contract_id: 'contract-3', order_amount: 7000 },
  ];
  const fetchImpl = async rawUrl => {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith('/auth/get-session')) return { ok: true, status: 200, json: async () => ({ user: { id: 'user-1' } }) };
    if (url.pathname.endsWith('/actions/forge_project/project_read_delivery_scope')) return { ok: true, status: 200, json: async () => ({ result: { sources: [], lines: [], warnings: [] } }) };
    const object = url.pathname.split('/data/')[1];
    const records = object === 'forge_project' ? [projects[0]] : object === 'forge_project_sales_link' ? links : object === 'forge_sales_order' ? fixtureOrders : [];
    return { ok: true, status: 200, json: async () => ({ records, total: records.length }) };
  };
  const harness = createHarness(ProjectCenterPage.source, { search: '?project=project-1&tab=orders', seed: { projects: [projects[0]], links, orders: fixtureOrders }, fetchImpl });
  let tree = harness.render();
  const orderTabs = findNodes(tree, node => node.type?.name === 'StatusTabs' && node.props['aria-label'] === '项目订单类型')[0];
  assert.ok(orderTabs);
  assert.equal(orderTabs.props.value, 'sales');
  assert.equal(orderTabs.props.panelId, 'project-orders-content');
  assert.deepEqual(Array.from(orderTabs.props.items, item => item.icon), ['ShoppingCart', 'ShoppingBag']);
  const summary = findNodes(tree, node => node.type?.name === 'ListSummary' && node.props['aria-label'] === '项目销售订单统计')[0];
  assert.ok(summary);
  assert.equal(textContent(summary.props.items[0].value), '2张订单');
  assert.equal(summary.props.items[1].value, '¥1,500.00');
  assert.equal(summary.props.items[2].value, '¥350.00');
  assert.equal(summary.props.items[3].value, '¥500.00');
  const orderTable = findNodes(tree, node => node.type?.name === 'ProjectRelatedRecordTable' && node.props.headers[0] === '订单编号')[0];
  assert.equal(orderTable.props.rows.length, 2, 'the same order is not repeated under two contract links');
  const refresh = findNodes(tree, node => node.type === 'button' && node.props['aria-label'] === '刷新销售订单');
  assert.equal(refresh.length, 1);
  assert.equal(findNodes(tree, node => node.type === 'button' && textContent(node) === '刷新范围').length, 0);
  await harness.runEffects();
  assert.ok(harness.requests.some(url => url.includes('/actions/forge_project/project_read_delivery_scope')), 'direct entry loads the current project scope');
  harness.requests.length = 0;
  tree = harness.render();
  findNodes(tree, node => node.type === 'button' && node.props['aria-label'] === '刷新销售订单')[0].props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(harness.requests.some(url => url.includes('/data/forge_project_sales_link')), 'refresh rereads the native project associations');
  assert.ok(harness.requests.some(url => url.includes('/actions/forge_project/project_read_delivery_scope')), 'the same refresh rereads the formal delivery scope');
  assert.equal(harness.requests.some(url => /project_link_contract|project_create/.test(url)), false, 'refresh performs no business mutation');
});
