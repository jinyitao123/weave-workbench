import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = await readFile('objectstack.config.ts', 'utf8');
const pages = await readFile('src/pages/administration-pages.page.ts', 'utf8');
const attendancePages = await readFile('src/pages/attendance-request-pages.page.ts', 'utf8');
const objects = await readFile('src/objects/administration.object.ts', 'utf8');
const manifest = JSON.parse(await readFile('tests/page-polish.manifest.json', 'utf8'));
const pageNames = [...(pages + attendancePages).matchAll(/name:\s*'(page_[a-z_]+)'/g)].map(match => match[1]);
const navTargets = [...config.matchAll(/page\('[^']+', '[^']+', '(page_[a-z_]+)'/g)].map(match => match[1]);

assert.equal(pageNames.length, 32, 'administration must expose 32 independent page definitions');
assert.equal(new Set(pageNames).size, 32, 'administration page names must be unique');
assert.equal(config.includes("'page_administration_gap'"), false, 'navigation must not retain the shared administration gap page');
for (const name of pageNames) assert.ok(navTargets.includes(name), `${name} must be linked from navigation`);
const registered = manifest.administration.flatMap(entry => entry.pages);
for (const name of registered) assert.ok(pageNames.includes(name) || navTargets.includes(name), `${name} must resolve to an administration page`);
for (const name of ['page_overtime_requests','page_leave_management','page_business_trip']) assert.ok(registered.includes(name), `${name} must be registered in the polish manifest`);
assert.ok(manifest.administration.every(entry => entry.designStatus === 'review_required'));
assert.match(pages, /ForgeDialog/);
assert.match(pages, /ForgeDateInput/);
assert.match(pages, /ForgeSelect/);
assert.match(pages, /forge_administration_record/);
for (const name of ['forge_overtime_request','forge_leave_type','forge_leave_request','forge_business_trip_request','forge_business_trip_expense','forge_business_trip_itinerary']) assert.match(objects, new RegExp(`name: '${name}'`));
for (const name of ['page_overtime_requests','page_leave_management','page_business_trip']) {
  assert.match(attendancePages, new RegExp(`name: '${name}'`));
  assert.doesNotMatch(pages, new RegExp(`name:'${name}'`));
}
assert.match(attendancePages, /ForgePageHeader/);
assert.match(attendancePages, /ForgeDateTimeInput/);
assert.match(attendancePages, /360000\)\/10/, 'attendance request pages must convert milliseconds to decimal hours');
assert.match(attendancePages, /ForgeSelectControl/);
assert.match(attendancePages, /ForgeDialog/);
assert.doesNotMatch(pages, /当前业务边界|同材料待确认|实际办理明确后补齐/);
assert.doesNotMatch(pages, /className="admin-contract"/);
console.log(JSON.stringify({ suite: 'administration-pages-static', pages: pageNames.length, status: 'passed' }, null, 2));
