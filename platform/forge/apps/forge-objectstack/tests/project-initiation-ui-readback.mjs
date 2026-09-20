import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-initiation-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.restartVerification?.status, 'passed', 'restart readback must pass before browser readback');
const api = await connect();
const projectResponse = await api.request(`/data/forge_project/${report.ids.project}`);
assert.equal(projectResponse.status, 200, 'browser-handled project must remain readable');
const project = projectResponse.value.record;
assert.equal(project.status, 'in_progress', 'browser pause and resume must leave the project running');
assert.equal(project.pause_reason, '浏览器动作验收', 'browser pause reason must persist');

const query = new URLSearchParams({ $filter: JSON.stringify({ project_id: report.ids.project }), $top: '50' });
const linksResponse = await api.request(`/data/forge_project_sales_link?${query}`);
assert.equal(linksResponse.status, 200, 'browser-refreshed contract links must be readable');
const links = linksResponse.value.records.filter(item => item.project_id === report.ids.project);
assert.equal(links.length, 1, 'browser relink must remain idempotent');
assert.deepEqual(
  { contract_id: links[0].contract_id, order_id: links[0].order_id, order_amount: links[0].order_amount },
  { contract_id: report.ids.contract, order_id: report.ids.order, order_amount: 243200 },
);

const browserProjectQuery = new URLSearchParams({ $filter: JSON.stringify({ name: '800型柔性线控制柜交付项目（浏览器立项验收）' }), $top: '10' });
const browserProjectsResponse = await api.request(`/data/forge_project?${browserProjectQuery}`);
assert.equal(browserProjectsResponse.status, 200, 'browser-created project must be readable');
const browserProject = browserProjectsResponse.value.records.find(item => item.name === '800型柔性线控制柜交付项目（浏览器立项验收）');
assert.ok(browserProject, 'customer 项目立项 dialog must persist a project');
assert.deepEqual(
  {
    customer: browserProject.customer_id, type: browserProject.type_id, manager: browserProject.manager_id,
    priority: browserProject.priority, start: browserProject.planned_start_on, end: browserProject.planned_end_on,
    revenue: browserProject.expected_revenue, budget: browserProject.budget_amount, status: browserProject.status,
  },
  {
    customer: report.ids.customer, type: report.ids.type, manager: report.ids.manager,
    priority: 'medium', start: '2026-09-10', end: '2026-12-31', revenue: 243200, budget: 180000, status: 'pending',
  },
);
const browserMemberQuery = new URLSearchParams({ $filter: JSON.stringify({ project_id: browserProject.id }), $top: '10' });
const browserMembersResponse = await api.request(`/data/forge_project_member?${browserMemberQuery}`);
assert.equal(browserMembersResponse.status, 200, 'browser-created manager membership must be readable');
const browserMember = browserMembersResponse.value.records.find(item => item.project_id === browserProject.id);
assert.deepEqual(
  { user: browserMember?.user_id, duty: browserMember?.member_duty, active: browserMember?.active },
  { user: report.ids.manager, duty: 'manager', active: true },
);
report.ids.browserProject = browserProject.id;
report.ids.browserMember = browserMember.id;

report.browserVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed', url: `http://localhost:4342/_console/apps/forge/forge_project/record/${report.ids.project}`,
  observed: [
    '暂停 with reason 浏览器动作验收 showed 项目已暂停 and persisted paused state',
    '恢复执行 confirmation showed 项目已恢复执行 and persisted in_progress state',
    'selecting a contract without eligible orders showed 合同下没有可关联的非草稿订单',
    'selecting the eligible workflow contract showed 合同和订单已关联 and retained exactly one link',
    'customer 项目立项 with native date inputs showed 项目已立项 and persisted the project plus manager membership',
  ],
  limitation: 'The main OTC project was created by API before browser verification. The customer action itself is proven with a separate same-customer acceptance project so the running OTC chain remains intact.',
};
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS OTC project browser actions persisted and remained readable after restart');
