import assert from 'node:assert/strict';
import test from 'node:test';
import { SalesOpportunitiesPage } from '../src/pages/sales-crm-service-pages.page.ts';

test('scoped CRM pages resolve displayed people only for records visible to the current employee', () => {
  const source = SalesOpportunitiesPage.source;
  assert.match(source, /const scoped=!canManage\|\|spec\.name==='page_service_workspace'/);
  assert.match(source, /loadRelated\('sys_user',rows\.flatMap\(row=>spec\.keys\.filter\(key=>key\.endsWith\('_id'\)&&\['owner','responsible','manager','creator','applicant'\]\.some\(name=>key\.includes\(name\)\)\)\.map\(key=>row\[key\]\)\)\)/);
  assert.match(source, /user=id=>s\.users\.find\(x=>x\.id===id\)\?\.name\|\|'—'/);
  assert.match(source, /"responsible_id","operation"/);
});
