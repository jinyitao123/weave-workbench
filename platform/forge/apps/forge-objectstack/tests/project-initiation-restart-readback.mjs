import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-initiation-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true, 'project initiation acceptance must pass before restart readback');
const api = await connect();
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id} persisted across restart`);
  return response.value.record;
}
const project = await read('forge_project', report.ids.project);
const member = await read('forge_project_member', report.ids.member);
const link = await read('forge_project_sales_link', report.ids.link);
const type = await read('forge_project_type', report.ids.type);
const browserProject = report.ids.browserProject ? await read('forge_project', report.ids.browserProject) : null;
const browserMember = report.ids.browserMember ? await read('forge_project_member', report.ids.browserMember) : null;
assert.deepEqual({ name: type.name, code: type.code, active: type.active }, { name: '标准柜机项目', code: 'CABINET_OTC', active: true });
assert.deepEqual({ status: project.status, customer_id: project.customer_id, manager_id: project.manager_id, contract_amount: project.contract_amount, invoice_amount: project.invoice_amount, collected_amount: project.collected_amount },
  { status: 'in_progress', customer_id: report.ids.customer, manager_id: report.ids.manager, contract_amount: 243200, invoice_amount: 0, collected_amount: 0 });
assert.deepEqual({ project_id: member.project_id, user_id: member.user_id, member_duty: member.member_duty, active: member.active },
  { project_id: report.ids.project, user_id: report.ids.manager, member_duty: 'manager', active: true });
assert.deepEqual({ project_id: link.project_id, contract_id: link.contract_id, order_id: link.order_id, order_amount: link.order_amount },
  { project_id: report.ids.project, contract_id: report.ids.contract, order_id: report.ids.order, order_amount: 243200 });
if (browserProject) assert.deepEqual(
  { customer: browserProject.customer_id, type: browserProject.type_id, manager: browserProject.manager_id, start: browserProject.planned_start_on, end: browserProject.planned_end_on, status: browserProject.status },
  { customer: report.ids.customer, type: report.ids.type, manager: report.ids.manager, start: '2026-09-10', end: '2026-12-31', status: 'pending' },
);
if (browserMember) assert.deepEqual(
  { project: browserMember.project_id, user: browserMember.user_id, duty: browserMember.member_duty, active: browserMember.active },
  { project: report.ids.browserProject, user: report.ids.manager, duty: 'manager', active: true },
);
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: '.objectstack/otc-project.sqlite', recordsRead: browserProject ? 6 : 4,
  assertion: browserProject
    ? 'main OTC project link plus the browser-created acceptance project and its manager membership survived a full stop/start'
    : 'project type, running project, manager membership and exact contract/order link survived a full stop/start' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS OTC project initiation survived full server restart');
