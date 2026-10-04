import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const createPage = readFileSync(new URL('../src/pages/sales-contract-create.page.ts', import.meta.url), 'utf8');
const workspacePage = readFileSync(new URL('../src/pages/sales-contract-workspace.page.ts', import.meta.url), 'utf8');

function functionSource(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing page function: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing page function boundary: ${end}`);
  return source.slice(startAt, endAt);
}

test('create page uploads private contract attachments and submits the explicit primary plus selected material set', () => {
  const save = functionSource(createPage, 'async function save(submit){', '\n if(data.loading)');
  assert.match(createPage, /scope:'attachments'/);
  assert.match(createPage, /type="checkbox" checked=\{packageFiles\.includes\(file\)\}/);
  assert.match(createPage, /type="radio" name="contract-primary-file"/);
  assert.match(createPage, /请选择本次合同正文，并明确勾选全部提交附件/);
  assert.match(createPage, /contract_submit_material_package/);
  assert.match(createPage, /primary_file_id:submission\.primaryFileId/);
  assert.match(createPage, /material_file_ids:submission\.materialFileIds/);
  assert.match(save, /await submitMaterialPackage\(pendingSubmission\)/);
  assert.match(save, /materialIds\.includes\(primaryId\)/);
  assert.match(save, /primaryFileId:primaryId/);
});

test('a failed package submission keeps the saved draft and retries it without another draft create', () => {
  const save = functionSource(createPage, 'async function save(submit){', '\n if(data.loading)');
  const retryBranch = save.indexOf('if(pendingSubmission)');
  const draftCreate = save.indexOf('sales_contract_draft_create');
  assert.ok(retryBranch >= 0 && draftCreate > retryBranch, 'the existing-draft path must run before the create request');
  assert.equal((save.match(/sales_contract_draft_create/g) || []).length, 1, 'the create request appears only in the no-draft branch');
  assert.match(save, /await submitMaterialPackage\(pendingSubmission\)/);
  assert.match(save, /const pending=\{contractId,code,name:header\.name,primaryFileId:primaryId,materialFileIds/);
  assert.match(save, /setPendingSubmission\(pending\);await submitMaterialPackage\(pending\)/);
  assert.match(createPage, /disabled=\{Boolean\(pendingSubmission\)\}/);
  assert.match(createPage, /继续提交审批/);
  assert.match(createPage, /不会再次创建合同/);
});

test('workspace submission uses named existing attachments, requires a chosen primary, and passes the full selected set', () => {
  assert.match(workspacePage, /contractSubmissionFiles\(contract\)/);
  assert.match(workspacePage, /contract\.attachment_ids/);
  assert.match(workspacePage, /<strong>\{file\.name\|\|'附件名称不可用'\}<\/strong>/);
  assert.match(workspacePage, /type="radio" name="contract-submission-primary"/);
  assert.match(workspacePage, /请选择一份文件作为合同正文/);
  assert.match(workspacePage, /material_file_ids:materialIds/);
  assert.match(workspacePage, /primary_file_id:primaryId/);
  assert.doesNotMatch(workspacePage, /['"]contract_submit['"]/);
});
