import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { LiteKernel } from '@objectstack/core';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL } from '@objectstack/objectql';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { ApprovalService, ApprovalsServicePlugin, SysApprovalAction, SysApprovalApprover, SysApprovalRequest } from '@objectstack/plugin-approvals';
import { SharingServicePlugin, SysRecordShare } from '@objectstack/plugin-sharing';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { ContractType, SalesContract, SalesContractLine, SalesContractRevisionMaterial, SalesContractSubmission } from '../src/objects/sales.object.ts';
import { SalesContractApprovalFlow } from '../src/flows/sales-contract-approval.flow.ts';
import { ContractMaterialSubmissionPlugin } from '../src/plugins/contract-material-submission.plugin.ts';
import { CONTRACT_MATERIAL_SUBMISSION_TARGET, readContractSubmissionReceipt } from '../src/plugins/contract-material-submission.ts';

const DATABASE = process.env.FORGE_CONTRACT_MATERIAL_PG_DATABASE || 'forge_material_holder_test';
const HOST = '127.0.0.1';
const PORT = Number(process.env.FORGE_CONTRACT_MATERIAL_PG_PORT || 55439);
const DB_USER = process.env.FORGE_CONTRACT_MATERIAL_PG_USER || 'postgres';
const ORG = randomUUID();
const ACTOR = randomUUID();
const DELIVERY_REVIEWER = randomUUID();
const COMMERCIAL_REVIEWER = randomUUID();
const SYSTEM = { isSystem: true, positions: [], permissions: [] };

const serviceStoragePath = '../node_modules/.pnpm/@objectstack+service-storage@17.5.0/node_modules/@objectstack/service-storage/dist/index.js';
const platformObjectsPath = '../node_modules/.pnpm/@objectstack+platform-objects@17.5.0/node_modules/@objectstack/platform-objects/dist/index.mjs';
const { LocalStorageAdapter, SystemFile } = await import(serviceStoragePath);
const { SysAttachment } = await import(platformObjectsPath);
const auditPluginPath = '../node_modules/.pnpm/@objectstack+plugin-audit@17.5.0/node_modules/@objectstack/plugin-audit/dist/index.mjs';
const { installAuditWriters } = await import(auditPluginPath);

function simpleObject(name, fields) {
  return ObjectSchema.create({ name, label: name, fields: { ...fields, organization_id: Field.text({ label: 'Organization' }) }, enable: { apiEnabled: true } });
}

function makeObjects() {
  const TestContractType = ObjectSchema.create({ ...ContractType, fields: { ...ContractType.fields, organization_id: Field.text({ label: 'Organization' }) } });
  const TestContract = ObjectSchema.create({
    ...SalesContract,
    fields: { ...SalesContract.fields, owner_id: Field.user({ label: 'Record owner' }), organization_id: Field.text({ label: 'Organization' }) },
  });
  const TestContractLine = ObjectSchema.create({
    ...SalesContractLine,
    fields: { ...SalesContractLine.fields, organization_id: Field.text({ label: 'Organization' }) },
  });
  const TestSystemFile = ObjectSchema.create({ ...SystemFile, fields: { ...SystemFile.fields, organization_id: Field.text({ label: 'Organization' }) } });
  return [
    TestContractType,
    ObjectSchema.create({ ...SysRecordShare, fields: { ...SysRecordShare.fields, organization_id: Field.text({}) } }),
    simpleObject('sys_user', { name: Field.text({ label: 'Name' }), email: Field.email({ label: 'Email' }), banned: Field.boolean({}), ban_expires: Field.datetime({}) }),
    simpleObject('forge_customer', { name: Field.text({ label: 'Name' }) }),
    simpleObject('forge_quotation', {
      name: Field.text({ label: 'Name' }), status: Field.text({ label: 'Status' }),
      customer_acceptance_evidence_attachment: Field.text({ label: 'Acceptance evidence' }),
      accepted_pricing_version: Field.number({ label: 'Accepted price version' }), pricing_version: Field.number({ label: 'Price version' }),
    }),
    simpleObject('forge_material_sku', { material_id: Field.text({ label: 'Material' }), enabled: Field.boolean({ label: 'Enabled' }) }),
    simpleObject('forge_material', { unit_id: Field.text({ label: 'Unit' }), status: Field.text({ label: 'Status' }) }),
    simpleObject('forge_unit', { status: Field.text({ label: 'Status' }) }),
    simpleObject('sys_user_position', {
      user_id: Field.text({ label: 'User' }), position: Field.text({ label: 'Position' }),
      valid_from: Field.datetime({ label: 'Valid from' }), valid_until: Field.datetime({ label: 'Valid until' }),
    }),
    simpleObject('sys_position', { name: Field.text({ label: 'Position name' }), active: Field.boolean({}) }),
    simpleObject('sys_member', { user_id: Field.text({ label: 'User' }), role: Field.text({ label: 'Role' }) }),
    simpleObject('sys_user_permission_set', { user_id: Field.text({ label: 'User' }), permission_set_id: Field.text({ label: 'Permission set' }) }),
    simpleObject('sys_organization', { name: Field.text({ label: 'Name' }) }),
    // AuditPlugin installs its real attachment gate alongside writers; provision the writer tables for a clean native transaction.
    simpleObject('sys_audit_log', {
      action: Field.text({}), user_id: Field.text({}), object_name: Field.text({}), record_id: Field.text({}),
      old_value: Field.text({}), new_value: Field.text({}), tenant_id: Field.text({}), actor: Field.text({}),
    }),
    simpleObject('sys_activity', {
      type: Field.text({}), timestamp: Field.datetime({}), summary: Field.text({}), actor_id: Field.text({}),
      object_name: Field.text({}), record_id: Field.text({}), record_label: Field.text({}), metadata: Field.text({}),
    }),
    simpleObject('sys_approval_request', SysApprovalRequest.fields),
    simpleObject('sys_approval_action', SysApprovalAction.fields),
    simpleObject('sys_approval_approver', SysApprovalApprover.fields),
    TestSystemFile,
    SysAttachment,
    TestContract,
    TestContractLine,
    SalesContractSubmission,
    ObjectSchema.create({ ...SalesContractRevisionMaterial, fields: { ...SalesContractRevisionMaterial.fields, organization_id: Field.text({ label: 'Organization' }) } }),
  ];
}

test('unscoped legacy ledger permits only an exact read-only three-scalar receipt', async () => {
  const contractId = randomUUID();
  const actorId = randomUUID();
  const organizationId = randomUUID();
  const legacy = {
    id: randomUUID(), contract_id: contractId, submitted_by: actorId, organization_id: null,
    material_file_id: randomUUID(), material_name: '旧版合同.pdf', material_sha256: 'a'.repeat(64),
    material_manifest: null, package_sha256: null, submitted_at: '2026-09-29T10:00:00.000Z',
  };
  const writes = [];
  const engine = {
    async findOne(object, query, options) {
      assert.equal(object, 'forge_sales_contract_submission');
      assert.deepEqual(query.where, { contract_id: contractId });
      assert.equal(options.context.isSystem, true);
      return { ...legacy };
    },
    async insert(...args) { writes.push(['insert', ...args]); },
    async update(...args) { writes.push(['update', ...args]); },
  };
  const context = {
    record: { id: contractId, responsible_id: actorId, owner_id: actorId, organization_id: organizationId },
    recordLoadDenied: false,
    user: { id: actorId, organizationId },
    session: { userId: actorId, organizationId },
    params: {
      recordId: contractId, material_file_id: legacy.material_file_id,
      material_name: legacy.material_name, material_sha256: legacy.material_sha256,
    },
  };
  const receipt = await readContractSubmissionReceipt(engine, context);
  assert.equal(receipt.legacy, true);
  assert.equal(receipt.repeated, true);
  assert.equal(receipt.material_file_id, legacy.material_file_id);
  assert.deepEqual(writes, [], 'reading the old receipt never creates a manifest or writes to the ledger');
  await assert.rejects(() => readContractSubmissionReceipt(engine, {
    ...context, params: { ...context.params, material_sha256: 'b'.repeat(64) },
  }), /ACTION_RETIRED|CONFLICT|完全一致/);
  await assert.rejects(() => readContractSubmissionReceipt(engine, {
    ...context, params: { recordId: contractId },
  }), /exact three-scalar|精确读取|ACTION_RETIRED/);
  assert.deepEqual(writes, []);
});

test('registered package action creates one native approval request for the sales submitter and exact replay adds none', {
  skip: process.env.FORGE_CONTRACT_MATERIAL_PG_TEST !== '1'
    ? 'set FORGE_CONTRACT_MATERIAL_PG_TEST=1 against the isolated local PostgreSQL database'
    : false,
}, async (t) => {
  assert.ok(Number.isInteger(PORT) && PORT > 0 && PORT < 65536);
  const storageRoot = mkdtempSync(join(tmpdir(), 'forge-contract-submit-storage-'));
  const storage = new LocalStorageAdapter({ rootDir: storageRoot });
  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'pg', connection: { host: HOST, port: PORT, database: DATABASE, user: DB_USER } });
  const objects = makeObjects();
  assert.equal(SalesContractSubmission.enable.files, true, 'the immutable first-submission ledger must advertise native attachment support');
  assert.equal(SalesContractRevisionMaterial.enable.files, true, 'the immutable revision ledger must advertise native attachment support');
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(objects);
  // Install the same ObjectStack attachment-capability hook loaded by AuditPlugin at runtime.
  installAuditWriters(engine, 'com.objectstack.audit');
  t.after(async () => { await driver.disconnect(); rmSync(storageRoot, { recursive: true, force: true }); });
  assert.equal(engine.getObject('forge_sales_contract_submission')?.enable?.files, true);
  assert.equal(engine.getObject('forge_sales_contract_revision_material')?.enable?.files, true);

  const manifest = { register() {} };
  const basePlugin = {
    name: 'com.objectstack.engine.objectql', version: '1.0.0', type: 'standard', dependencies: [],
    init(ctx) {
      ctx.registerService('objectql', engine);
      ctx.registerService('storage', storage);
      ctx.registerService('manifest', manifest);
      ctx.registerService('http.server', { get() {}, post() {}, put() {}, patch() {}, delete() {} });
    },
  };
  const automationPlugin = new AutomationServicePlugin({ suspendedRunStore: 'memory' });
  const approvalsPlugin = new ApprovalsServicePlugin({ disableAutoHooks: true });
  const triggerPlugin = new RecordChangeTriggerPlugin();
  const materialPlugin = new ContractMaterialSubmissionPlugin();
  const kernel = new LiteKernel({ logger: { level: 'error' } });
  kernel.use(basePlugin).use(new SharingServicePlugin()).use(automationPlugin).use(approvalsPlugin).use(triggerPlugin).use(materialPlugin);
  await kernel.bootstrap();
  t.after(() => kernel.shutdown());
  assert.ok(approvalsPlugin.service instanceof ApprovalService);

  const automation = kernel.getService('automation');
  automation.registerFlow(SalesContractApprovalFlow.name, SalesContractApprovalFlow);

  const context = { ...SYSTEM, userId: ACTOR, tenantId: ORG };
  const insert = (object, row) => engine.insert(object, { id: randomUUID(), ...row }, { context });
  await insert('sys_organization', { id: ORG, name: 'Local submission test organization', organization_id: ORG });
  await insert('sys_user', { id: ACTOR, name: 'Contract submitter', email: `${ACTOR}@example.invalid`, organization_id: ORG });
  await insert('sys_user', { id: DELIVERY_REVIEWER, name: 'Delivery reviewer', email: `${DELIVERY_REVIEWER}@example.invalid`, organization_id: ORG });
  await insert('sys_user', { id: COMMERCIAL_REVIEWER, name: 'Commercial reviewer', email: `${COMMERCIAL_REVIEWER}@example.invalid`, organization_id: ORG });
  for (const reviewer of [ACTOR, DELIVERY_REVIEWER, COMMERCIAL_REVIEWER]) await insert('sys_member', { user_id: reviewer, organization_id: ORG, role: 'member' });
  for (const position of ['contract_delivery_reviewer', 'contract_commercial_reviewer']) await insert('sys_position', { name: position, active: true, organization_id: ORG });
  await insert('sys_user_position', { user_id: DELIVERY_REVIEWER, position: 'contract_delivery_reviewer', organization_id: ORG });
  await insert('sys_user_position', { user_id: COMMERCIAL_REVIEWER, position: 'contract_commercial_reviewer', organization_id: ORG });

  const customerId = randomUUID();
  const typeId = randomUUID();
  const contractId = randomUUID();
  const lineId = randomUUID();
  await engine.insert('forge_customer', { id: customerId, name: 'Test customer', organization_id: ORG }, { context });
  await engine.insert('forge_contract_type', { id: typeId, name: 'Test contract type', organization_id: ORG }, { context });

  const primaryId = randomUUID();
  const attachmentId = randomUUID();
  const primaryBytes = Buffer.from('%PDF-1.7\nNative action contract');
  const attachmentBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x44, 0x4f, 0x43, 0x58]);
  const materials = [
    { id: primaryId, name: '销售合同.pdf', mime_type: 'application/pdf', bytes: primaryBytes },
    { id: attachmentId, name: '技术附件.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: attachmentBytes },
  ];
  for (const file of materials) {
    const key = `attachments/${file.id}/${file.name}`;
    await storage.upload(key, file.bytes, { contentType: file.mime_type });
    await engine.insert('sys_file', {
      id: file.id, key, name: file.name, mime_type: file.mime_type, size: file.bytes.length,
      scope: 'attachments', acl: 'private', status: 'committed', owner_id: ACTOR, organization_id: ORG,
      ref_object: null, ref_id: null,
    }, { context });
  }

  await engine.insert('forge_sales_contract', {
    id: contractId, name: 'Native action contract', code: `HT-${contractId}`,
    contract_type_id: typeId, customer_id: customerId, responsible_id: ACTOR, owner_id: ACTOR,
    organization_id: ORG, status: 'draft', payment_term: '合同签订后30日付款', requires_legal_review: false,
  }, { context });
  await engine.insert('forge_sales_contract_line', {
    id: lineId, name: 'Consulting service', contract_id: contractId,
    line_type: 'service', quantity_limit: 1, taxed_subtotal: 1200, sku_id: null, organization_id: ORG,
  }, { context });

  await assert.rejects(engine.insert('sys_attachment', {
    id: randomUUID(), parent_object: 'forge_sales_contract', parent_id: contractId,
    file_id: randomUUID(), file_name: 'disabled.txt', mime_type: 'text/plain', size: 1,
    uploaded_by: ACTOR,
  }, { context }), (error) => error?.code === 'FILES_DISABLED');

  const callerContext = { isSystem: false, userId: ACTOR, tenantId: ORG, positions: [], permissions: ['sales_contract_operator'] };
  const callerRecord = await engine.findOne('forge_sales_contract', { where: { id: contractId } }, { context: callerContext });
  assert.ok(callerRecord, 'the invoking employee can read the submitted contract before the handler uses its trusted engine');
  const actionContext = {
    record: callerRecord, recordLoadDenied: false,
    user: { id: ACTOR, name: 'Contract submitter', organizationId: ORG },
    session: { userId: ACTOR, organizationId: ORG },
    params: {
      objectName: 'forge_sales_contract', recordId: contractId,
      primary_file_id: primaryId, material_file_ids: [primaryId, attachmentId],
    },
    engine: {},
  };

  const nativeInsert = engine.insert;
  let injectAttachmentFailure = true;
  engine.insert = async (objectName, data, options) => {
    if (injectAttachmentFailure && objectName === 'sys_attachment' && data?.file_id === attachmentId) {
      injectAttachmentFailure = false;
      throw new Error('simulated native attachment insert failure');
    }
    return nativeInsert.call(engine, objectName, data, options);
  };
  try {
    await assert.rejects(engine.executeAction('forge_sales_contract', CONTRACT_MATERIAL_SUBMISSION_TARGET, actionContext), /simulated native attachment insert failure/);
  } finally {
    engine.insert = nativeInsert;
  }

  assert.equal((await engine.find('forge_sales_contract_submission', { where: { contract_id: contractId }, fields: ['id'], limit: 10 }, { context })).length, 0,
    'a failed attachment write rolls back the immutable submission ledger');
  assert.equal((await engine.find('sys_attachment', {
    where: { parent_object: 'forge_sales_contract_submission', file_id: { $in: [primaryId, attachmentId] } },
    fields: ['id'], limit: 10,
  }, { context })).length, 0, 'a failed attachment write rolls back any earlier native holder link');
  const unsubmittedContract = await engine.findOne('forge_sales_contract', { where: { id: contractId } }, { context });
  assert.equal(unsubmittedContract.status, 'draft', 'a failed attachment write leaves the contract in draft');
  assert.ok(!unsubmittedContract.submitted_material_id, 'a failed attachment write leaves the submitted material unset');
  assert.equal((await engine.find('sys_approval_request', {
    where: { object_name: 'forge_sales_contract', record_id: contractId }, fields: ['id'], limit: 10,
  }, { context })).length, 0, 'a failed first submission creates no native approval request');

  const first = await engine.executeAction('forge_sales_contract', CONTRACT_MATERIAL_SUBMISSION_TARGET, actionContext);
  assert.equal(first.status, 'pending_approval');
  assert.equal(first.material_file_id, primaryId);
  assert.deepEqual(new Set(first.material_file_ids), new Set([primaryId, attachmentId]));
  const savedSubmission = await engine.findOne('forge_sales_contract_submission', { where: { contract_id: contractId } }, { context });
  assert.ok(savedSubmission);
  const retainedFiles = await engine.find('sys_attachment', {
    where: { parent_object: 'forge_sales_contract_submission', parent_id: savedSubmission.id },
    fields: ['file_id'], limit: 10,
  }, { context });
  assert.deepEqual(new Set(retainedFiles.map((row) => row.file_id)), new Set([primaryId, attachmentId]));

  const approvalRows = async () => engine.find('sys_approval_request', {
    where: { object_name: 'forge_sales_contract', record_id: contractId }, fields: ['id', 'submitter_id', 'status', 'organization_id'], limit: 10,
  }, { context });
  let requests = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    requests = await approvalRows();
    if (requests.length) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(requests.length, 1, 'native record-change automation creates exactly one approval request');
  assert.equal(requests[0].submitter_id, ACTOR, 'approval request retains the authenticated sales submitter');
  assert.equal(requests[0].organization_id, ORG);

  const repeated = await engine.executeAction('forge_sales_contract', CONTRACT_MATERIAL_SUBMISSION_TARGET, actionContext);
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.package_sha256, first.package_sha256);
  requests = await approvalRows();
  assert.equal(requests.length, 1, 'exact full-package replay returns its receipt without creating another native request');
  assert.equal(requests[0].submitter_id, ACTOR);
});
