import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import test from 'node:test';
import { LiteKernel } from '@objectstack/core';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL } from '@objectstack/objectql';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { ContractType, SalesContract, SalesContractRevisionMaterial, SalesContractSubmission } from '../src/objects/sales.object.ts';
import {
  retainContractMaterialFiles,
  resolveRetainedContractMaterial,
  resolveRetainedContractMaterialForOwner,
} from '../src/plugins/contract-material-holder.ts';

const serviceStoragePath = '../node_modules/.pnpm/@objectstack+service-storage@17.3.0/node_modules/@objectstack/service-storage/dist/index.js';
const platformObjectsPath = '../node_modules/.pnpm/@objectstack+platform-objects@17.3.0/node_modules/@objectstack/platform-objects/dist/index.mjs';
const { LocalStorageAdapter, SystemFile, createSysFileReapGuard, installAttachmentLifecycleHooks, installFileReferenceHooks } = await import(serviceStoragePath);
const { SysAttachment } = await import(platformObjectsPath);

const DATABASE = 'forge_material_holder_test';
const HOST = '127.0.0.1';
const PORT = Number(process.env.FORGE_CONTRACT_MATERIAL_PG_PORT || 55439);
const SYSTEM = { isSystem: true, positions: [], permissions: [] };
const id = () => randomUUID();

function simpleObject(name, fields) {
  return ObjectSchema.create({
    name, label: name,
    fields: { ...fields, organization_id: Field.text({ label: 'Organization ID' }) },
    enable: { apiEnabled: true },
  });
}

function fixtureObjects({ legacySubmission = false } = {}) {
  const TestContractType = ObjectSchema.create({
    ...ContractType,
    fields: { ...ContractType.fields, organization_id: Field.text({ label: 'Organization ID' }) },
  });
  const TestSalesContract = ObjectSchema.create({
    ...SalesContract,
    fields: {
      ...SalesContract.fields,
      owner_id: Field.lookup('sys_user', { label: 'Owner' }),
      organization_id: Field.text({ label: 'Organization ID' }),
    },
  });
  const TestSystemFile = ObjectSchema.create({
    ...SystemFile,
    fields: { ...SystemFile.fields, organization_id: Field.text({ label: 'Organization ID' }) },
  });
  const submissionFields = { ...SalesContractSubmission.fields, organization_id: Field.text({ label: 'Organization ID' }) };
  if (legacySubmission) {
    delete submissionFields.material_manifest;
    delete submissionFields.package_sha256;
  }
  const TestSubmission = ObjectSchema.create({
    ...SalesContractSubmission,
    fields: submissionFields,
  });
  const TestRevisionMaterial = ObjectSchema.create({
    ...SalesContractRevisionMaterial,
    fields: { ...SalesContractRevisionMaterial.fields, organization_id: Field.text({ label: 'Organization ID' }) },
  });
  return [
    TestContractType,
    simpleObject('forge_customer', { name: Field.text({ label: 'Name', required: true }) }),
    simpleObject('sys_user', { name: Field.text({ label: 'Name' }), email: Field.email({ label: 'Email' }) }),
    TestSystemFile,
    SysAttachment,
    TestSalesContract,
    TestSubmission,
    TestRevisionMaterial,
  ];
}

test('nullable package columns preserve a legacy submission ledger without guessing its old package', {
  skip: process.env.FORGE_CONTRACT_MATERIAL_PG_TEST !== '1'
    ? 'set FORGE_CONTRACT_MATERIAL_PG_TEST=1 against a fresh isolated PostgreSQL database'
    : false,
}, async (t) => {
  const port = Number(process.env.FORGE_CONTRACT_MATERIAL_PG_PORT || 55439);
  const user = process.env.FORGE_CONTRACT_MATERIAL_PG_USER || 'postgres';
  const legacyEngine = new ObjectQL();
  const legacyDriver = new SqlDriver({ client: 'pg', connection: { host: HOST, port, database: DATABASE, user } });
  const legacyObjects = fixtureObjects({ legacySubmission: true });
  for (const object of legacyObjects) legacyEngine.registerObject(object);
  legacyEngine.registerDriver(legacyDriver, true);
  await legacyEngine.init();
  await legacyDriver.initObjects(legacyObjects);
  let legacyDriverClosed = false;
  t.after(async () => { if (!legacyDriverClosed) await legacyDriver.disconnect(); });

  const legacyIds = { organization: id(), customer: id(), type: id(), submitter: id(), contract: id(), submission: id() };
  const tenantContext = { ...SYSTEM, tenantId: legacyIds.organization };
  await legacyEngine.insert('sys_user', {
    id: legacyIds.submitter, name: 'Legacy Submitter', email: `${legacyIds.submitter}@example.invalid`,
    organization_id: legacyIds.organization,
  }, { context: tenantContext });
  await legacyEngine.insert('forge_customer', { id: legacyIds.customer, name: 'Legacy Customer', organization_id: legacyIds.organization }, { context: tenantContext });
  await legacyEngine.insert('forge_contract_type', { id: legacyIds.type, name: 'Legacy Type', organization_id: legacyIds.organization }, { context: tenantContext });
  await legacyEngine.insert('forge_sales_contract', {
    id: legacyIds.contract, name: 'Legacy contract', code: `HT-${legacyIds.contract}`,
    contract_type_id: legacyIds.type, customer_id: legacyIds.customer, responsible_id: legacyIds.submitter,
    owner_id: legacyIds.submitter, organization_id: legacyIds.organization, status: 'pending_approval',
    submitted_material_id: 'legacy-primary', submitted_material_name: '旧合同.pdf', submitted_material_sha256: 'a'.repeat(64),
  }, { context: tenantContext });
  await legacyEngine.insert('forge_sales_contract_submission', {
    id: legacyIds.submission, name: 'Legacy submission', contract_id: legacyIds.contract,
    material_file_id: 'legacy-primary', material_name: '旧合同.pdf', material_sha256: 'a'.repeat(64),
    submitted_by: legacyIds.submitter, submitted_at: new Date().toISOString(), organization_id: legacyIds.organization,
  }, { context: tenantContext });
  await legacyDriver.disconnect();
  legacyDriverClosed = true;

  const schemaProbe = new Client({ host: HOST, port, database: DATABASE, user });
  await schemaProbe.connect();
  const legacyColumns = await schemaProbe.query(
    "select column_name from information_schema.columns where table_name = 'forge_sales_contract_submission'",
  );
  assert.equal(legacyColumns.rows.some((row) => row.column_name === 'material_manifest'), false);
  assert.equal(legacyColumns.rows.some((row) => row.column_name === 'package_sha256'), false);
  await schemaProbe.end();

  const upgradedEngine = new ObjectQL();
  const upgradedDriver = new SqlDriver({ client: 'pg', connection: { host: HOST, port, database: DATABASE, user } });
  const upgradedObjects = fixtureObjects();
  for (const object of upgradedObjects) upgradedEngine.registerObject(object);
  upgradedEngine.registerDriver(upgradedDriver, true);
  await upgradedEngine.init();
  await upgradedDriver.initObjects(upgradedObjects);
  t.after(async () => { await upgradedDriver.disconnect(); });

  const upgradedColumns = new Client({ host: HOST, port, database: DATABASE, user });
  await upgradedColumns.connect();
  const nullableColumns = await upgradedColumns.query(
    "select column_name, is_nullable from information_schema.columns where table_name = 'forge_sales_contract_submission' and column_name in ('material_manifest', 'package_sha256')",
  );
  assert.deepEqual(nullableColumns.rows.map((row) => [row.column_name, row.is_nullable]).sort(), [
    ['material_manifest', 'YES'], ['package_sha256', 'YES'],
  ]);
  await upgradedColumns.end();

  const preserved = await upgradedEngine.findOne('forge_sales_contract_submission', {
    where: { id: legacyIds.submission },
  }, { context: SYSTEM });
  assert.equal(preserved.material_file_id, 'legacy-primary');
  assert.equal(preserved.material_sha256, 'a'.repeat(64));
  assert.equal(preserved.material_manifest, null);
  assert.equal(preserved.package_sha256, null);
  const noInventedHistory = await resolveRetainedContractMaterial(upgradedEngine, {
    contractId: legacyIds.contract, fileId: 'legacy-primary', sha256: 'a'.repeat(64),
    organizationId: legacyIds.organization, submitterId: legacyIds.submitter, context: SYSTEM,
  });
  assert.equal(noInventedHistory, undefined, 'legacy main-only ledger is preserved but not upgraded into a guessed full package');
});

test('native Field.file replacement stays byte-readable through the immutable ledger sys_attachment holder', {
  skip: process.env.FORGE_CONTRACT_MATERIAL_PG_TEST !== '1'
    ? 'set FORGE_CONTRACT_MATERIAL_PG_TEST=1 for the isolated local PostgreSQL run'
    : false,
}, async (t) => {
  assert.ok(Number.isInteger(PORT) && PORT > 0 && PORT < 65536, 'FORGE_CONTRACT_MATERIAL_PG_PORT must be a valid local PostgreSQL port');
  assert.equal(SalesContract.fields.submitted_material_id.type, 'file');
  assert.equal(SalesContract.fields.attachment_ids.type, 'file');
  assert.equal(SalesContract.fields.attachment_ids.multiple, true);
  for (const field of ['parent_object', 'parent_id', 'file_id']) assert.equal(SysAttachment.fields[field].required, true);

  const storageRoot = mkdtempSync(join(tmpdir(), 'forge-contract-material-storage-'));
  const storage = new LocalStorageAdapter({ rootDir: storageRoot });
  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'pg', connection: {
    host: HOST, port: PORT, database: DATABASE,
    user: process.env.FORGE_CONTRACT_MATERIAL_PG_USER || 'postgres',
  } });
  const objects = fixtureObjects();
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(objects);
  engine.isFileReferencesMigrationVerified = async () => true;
  const logger = { info() {}, warn(message) { throw new Error(message); }, debug() {} };
  installFileReferenceHooks(engine, () => storage, logger);
  installAttachmentLifecycleHooks(engine, logger);
  t.after(async () => {
    await driver.disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  const ids = {
    organization: id(), customer: id(), type: id(), submitter: id(), contract: id(), submission: id(),
    oldPrimary: id(), oldAttachment: id(), newPrimary: id(), newAttachment: id(),
  };
  const tenantContext = { ...SYSTEM, tenantId: ids.organization };
  const oldPrimaryBytes = Buffer.from('%PDF-1.7\nR1 contract original');
  const oldAttachmentBytes = Buffer.from('%PDF-1.7\nR1 technical attachment');
  const newPrimaryBytes = Buffer.from('%PDF-1.7\nR2 contract original');
  const newAttachmentBytes = Buffer.from('%PDF-1.7\nR2 technical attachment');
  const fileRows = [
    [ids.oldPrimary, 'R1合同.pdf', oldPrimaryBytes],
    [ids.oldAttachment, 'R1技术协议.pdf', oldAttachmentBytes],
    [ids.newPrimary, 'R2合同.pdf', newPrimaryBytes],
    [ids.newAttachment, 'R2技术协议.pdf', newAttachmentBytes],
  ];
  for (const [fileId, name, bytes] of fileRows) {
    const key = `attachments/${fileId}/${name}`;
    await storage.upload(key, bytes, { contentType: 'application/pdf' });
    await engine.insert('sys_file', {
      id: fileId, key, name, mime_type: 'application/pdf', size: bytes.length,
      scope: 'attachments', acl: 'private', status: 'committed', owner_id: ids.submitter,
    }, { context: tenantContext });
  }
  await engine.insert('sys_user', { id: ids.submitter, name: 'Submitter', email: 'submitter@example.invalid', organization_id: ids.organization }, { context: tenantContext });
  await engine.insert('forge_customer', { id: ids.customer, name: 'Customer', organization_id: ids.organization }, { context: tenantContext });
  await engine.insert('forge_contract_type', { id: ids.type, name: 'Sales Contract', organization_id: ids.organization }, { context: tenantContext });

  const primaryDigest = async (bytes) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const oldFiles = [
    { fileId: ids.oldPrimary, name: 'R1合同.pdf', mediaType: 'application/pdf', bytes: oldPrimaryBytes.length, sha256: await primaryDigest(oldPrimaryBytes) },
    { fileId: ids.oldAttachment, name: 'R1技术协议.pdf', mediaType: 'application/pdf', bytes: oldAttachmentBytes.length, sha256: await primaryDigest(oldAttachmentBytes) },
  ];
  await engine.insert('forge_sales_contract', {
    id: ids.contract, name: 'Native material holder test', code: `HT-${ids.contract}`,
    contract_type_id: ids.type, customer_id: ids.customer, responsible_id: ids.submitter,
    owner_id: ids.submitter,
    status: 'pending_approval', requires_legal_review: false,
    submitted_material_id: ids.oldPrimary, submitted_material_name: oldFiles[0].name,
    submitted_material_sha256: oldFiles[0].sha256, attachment_ids: [ids.oldAttachment],
    submitted_attachment_manifest: JSON.stringify([{ file_id: ids.oldAttachment, name: oldFiles[1].name, sha256: oldFiles[1].sha256 }]),
  }, { context: tenantContext });

  await engine.insert('forge_sales_contract_submission', {
    id: ids.submission, name: 'HT R1 submission', contract_id: ids.contract,
    material_file_id: ids.oldPrimary, material_name: oldFiles[0].name, material_sha256: oldFiles[0].sha256,
    material_manifest: JSON.stringify(oldFiles.map((file, index) => ({
      file_id: file.fileId, name: file.name, media_type: file.mediaType, bytes: file.bytes,
      sha256: file.sha256, role: index === 0 ? 'primary' : 'attachment',
    }))),
    package_sha256: await primaryDigest(Buffer.from(JSON.stringify(oldFiles.map((file, index) => ({ ...file, role: index === 0 ? 'primary' : 'attachment' }))))),
    organization_id: ids.organization,
    submitted_by: ids.submitter, submitted_at: new Date().toISOString(),
  }, { context: tenantContext });
  await retainContractMaterialFiles(engine, {
    parentObject: 'forge_sales_contract_submission', parentId: ids.submission,
    submitterId: ids.submitter, files: oldFiles, context: { ...SYSTEM, tenantId: ids.organization },
  });

  await engine.update('forge_sales_contract', {
    id: ids.contract, status: 'pending_approval',
    submitted_material_id: ids.newPrimary, submitted_material_name: 'R2合同.pdf',
    submitted_material_sha256: await primaryDigest(newPrimaryBytes),
    attachment_ids: [ids.newAttachment],
    submitted_attachment_manifest: JSON.stringify([{ file_id: ids.newAttachment, name: 'R2技术协议.pdf', sha256: await primaryDigest(newAttachmentBytes) }]),
  }, { context: tenantContext });

  const releasedOldPrimary = await engine.findOne('sys_file', { where: { id: ids.oldPrimary } }, { context: SYSTEM });
  const releasedOldAttachment = await engine.findOne('sys_file', { where: { id: ids.oldAttachment } }, { context: SYSTEM });
  assert.equal(releasedOldPrimary.status, 'deleted', 'replacing a native file field releases its previous file');
  assert.equal(releasedOldAttachment.status, 'deleted', 'replacing native multiple-file field releases removed files');
  assert.equal(await storage.exists(releasedOldPrimary.key), true, 'the tombstoned bytes remain during the grace period');

  const retained = await resolveRetainedContractMaterial(engine, {
    contractId: ids.contract, fileId: ids.oldPrimary, sha256: oldFiles[0].sha256,
    organizationId: ids.organization, submitterId: ids.submitter, context: SYSTEM,
  });
  assert.equal(retained?.holderObject, 'forge_sales_contract_submission');
  assert.equal(retained?.holderId, ids.submission);
  assert.equal(await storage.download(releasedOldPrimary.key).then((bytes) => primaryDigest(bytes)), oldFiles[0].sha256,
    'the immutable ledger holder resolves the original bytes after the live field changes');
  assert.equal((await resolveRetainedContractMaterialForOwner(engine, {
    fileId: ids.oldPrimary, sha256: oldFiles[0].sha256,
    organizationId: ids.organization, ownerId: ids.submitter, context: SYSTEM,
  }))?.holderId, ids.submission, 'the original owner can resolve only their retained immutable version');

  const reaper = createSysFileReapGuard(engine, () => storage, logger, async () => true);
  let confirmed = await reaper('sys_file', [releasedOldPrimary]);
  assert.deepEqual(confirmed, [], 'the native holder makes the reaper veto deletion');
  assert.equal((await engine.findOne('sys_file', { where: { id: ids.oldPrimary } }, { context: SYSTEM })).status, 'committed');
  assert.equal(await storage.exists(releasedOldPrimary.key), true);

  const primaryLink = await engine.findOne('sys_attachment', {
    where: { parent_object: 'forge_sales_contract_submission', parent_id: ids.submission, file_id: ids.oldPrimary },
  }, { context: SYSTEM });
  assert.ok(primaryLink);
  await engine.delete('sys_attachment', { where: { id: primaryLink.id } }, { context: SYSTEM });
  assert.equal((await engine.findOne('sys_file', { where: { id: ids.oldPrimary } }, { context: SYSTEM })).status, 'deleted');
  confirmed = await reaper('sys_file', [await engine.findOne('sys_file', { where: { id: ids.oldPrimary } }, { context: SYSTEM })]);
  assert.deepEqual(confirmed, [ids.oldPrimary], 'the reaper collects bytes after the final native holder is removed');
  assert.equal(await storage.exists(releasedOldPrimary.key), false, 'storage bytes are deleted only after the final holder is gone');
});
