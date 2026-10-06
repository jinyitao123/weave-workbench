import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import test from 'node:test';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const requireFromTest = createRequire(import.meta.url);
const requireFromCli = createRequire(requireFromTest.resolve('@objectstack/cli'));
const betterAuthCrypto = await import(pathToFileURL(requireFromCli.resolve('better-auth/crypto')).href);
const hashPassword = betterAuthCrypto.hashPassword;
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 12).toLowerCase();
const DATABASE = 'forge_project_attachment_' + RUN_ID;
const DATABASE_PORT = Number(process.env.FORGE_INTEGRATION_PG_PORT || 5432);
const SECRET_KEY = randomBytes(32).toString('hex');
const AUTH_SECRET = randomBytes(32).toString('hex');
const TRANSIENT_PASSWORDS = [];

function id() { return randomUUID(); }
function safeOutput(output, databaseUrl) {
  let safe = String(output || '').replaceAll(SECRET_KEY, '[temporary secret omitted]').replaceAll(AUTH_SECRET, '[temporary auth secret omitted]');
  if (databaseUrl) safe = safe.replaceAll(databaseUrl, '[temporary database URL omitted]');
  for (const password of TRANSIENT_PASSWORDS) if (password) safe = safe.replaceAll(password, '[temporary password omitted]');
  return safe.slice(-7000);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('native PostgreSQL project attachment uses project-bound Action, 17.5 storage ownership and member sharing', { timeout: 360_000 }, async t => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-project-attachment-native-'));
  const runtimePort = await freePort();
  const origin = 'http://127.0.0.1:' + runtimePort;
  const databaseUrl = 'postgresql://' + encodeURIComponent(os.userInfo().username) + '@127.0.0.1:' + DATABASE_PORT + '/' + DATABASE;
  const failedFileName = 'rollback-' + RUN_ID + '.txt';
  let databaseCreated = false, child, postgres, output = '', syntheticIp = 30;
  const schemas = new Map();

  await run('createdb', ['-h', '127.0.0.1', '-p', String(DATABASE_PORT), DATABASE]);
  databaseCreated = true;
  postgres = new Client({ connectionString: databaseUrl });
  await postgres.connect();
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve));
      child.kill('SIGTERM');
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 10_000))]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    }
    await postgres?.end().catch(() => {});
    if (databaseCreated) await run('dropdb', ['-h', '127.0.0.1', '-p', String(DATABASE_PORT), DATABASE]).catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-project-attachment-native-test","type":"module"}\n');
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');
  await writeFile(path.join(tempDir, 'project-attachment-failure-probe.ts'), `
export class ProjectAttachmentFailureProbePlugin {
  name = 'com.inoforge.test.project-attachment-failure-probe';
  version = '1.0.0';
  type = 'standard';
  init() {}
  start(ctx) {
    ctx.hook('kernel:ready', () => {
      const engine = ctx.getService('objectql');
      engine.registerHook('afterInsert', async hook => {
        if (hook.object !== 'forge_project_attachment' || String(hook.result?.name || '') !== ${JSON.stringify(failedFileName)}) return;
        const raw = hook.result?.attachment;
        const fileId = typeof raw === 'string' ? raw : String(raw?.id || '');
        const file = await engine.findOne('sys_file', { where: { id: fileId } }, { context: {
          isSystem: true, tenantId: String(hook.result?.organization_id || ''), transaction: hook.transaction,
        } });
        if (file?.ref_object !== 'forge_project_attachment' || String(file.ref_id || '') !== String(hook.result?.id || '') || file.ref_field !== 'attachment') {
          throw new Error('failure probe did not observe the native sys_file claim');
        }
        throw new Error('forced HTTP rollback after native file claim');
      }, { object: 'forge_project_attachment', priority: 200, packageId: 'com.inoforge.test.project-attachment-failure-probe' });
    });
  }
}
`);
  const baseConfigUrl = pathToFileURL(path.join(APP_DIR, 'objectstack.config.ts')).href;
  const actionPluginUrl = pathToFileURL(path.join(APP_DIR, 'src/apps/project-attachment-native-actions.ts')).href;
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `
import base from ${JSON.stringify(baseConfigUrl)};
import { projectAttachmentNativeActionsPlugin } from ${JSON.stringify(actionPluginUrl)};
import { ProjectAttachmentFailureProbePlugin } from './project-attachment-failure-probe.ts';
export default { ...base, plugins: [...(base.plugins || []), projectAttachmentNativeActionsPlugin, new ProjectAttachmentFailureProbePlugin()] };
`);
  child = spawn(process.execPath, [
    path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'), 'serve', 'objectstack.config.ts', '--port', String(runtimePort), '--log-level', 'error',
  ], {
    cwd: tempDir,
    env: {
      ...process.env, NODE_ENV: 'production', OS_HOME: path.join(tempDir, '.os-home'), OS_DATABASE_URL: databaseUrl,
      OS_SECRET_KEY: SECRET_KEY, OS_AUTH_SECRET: AUTH_SECRET, OS_BASE_URL: origin, OS_TRUSTED_ORIGINS: origin,
      OS_ENVIRONMENT_ID: 'project-attachment-native-' + RUN_ID, OS_TENANCY_POSTURE: 'single', OS_SEED_ADMIN: 'false',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import tsx'].filter(Boolean).join(' '),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-10_000); });
  child.stderr.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-10_000); });
  const deadline = Date.now() + 180_000;
  let health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Official Runtime exited (' + child.exitCode + ').\n' + safeOutput(output, databaseUrl));
    try { health = await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(1000) }); if (health.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(health?.ok, 'Official ObjectStack 17.5 Runtime did not start.\n' + safeOutput(output, databaseUrl));

  async function tableSchema(name) {
    if (schemas.has(name)) return schemas.get(name);
    const result = await postgres.query('SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1', [name]);
    assert.ok(result.rows.length, 'Runtime registered native table ' + name);
    const columns = new Map(result.rows.map(row => [row.column_name, row]));
    schemas.set(name, columns);
    return columns;
  }
  async function insertFixture(name, values) {
    const schema = await tableSchema(name), now = new Date().toISOString();
    const candidate = { id: id(), created_at: now, updated_at: now, ...values };
    if (!name.startsWith('sys_')) { candidate.organization_id ??= organizationId; candidate.created_by ??= managerId; candidate.updated_by ??= managerId; candidate.owner_id ??= managerId; }
    const columns = [...schema.keys()].filter(key => candidate[key] !== undefined);
    const missing = [...schema.entries()].filter(([key, column]) => column.is_nullable === 'NO' && column.column_default == null && !columns.includes(key)).map(([key]) => key);
    assert.deepEqual(missing, [], 'Fixture fields satisfy actual ' + name + ' PostgreSQL schema');
    const quoted = columns.map(key => '"' + key.replaceAll('"', '""') + '"').join(', ');
    const markers = columns.map((_, index) => '$' + (index + 1)).join(', ');
    await postgres.query('INSERT INTO "' + name.replaceAll('"', '""') + '" (' + quoted + ') VALUES (' + markers + ')', columns.map(key => candidate[key]));
    return candidate.id;
  }
  async function signIn(email, password) {
    const response = await fetch(origin + '/api/v1/auth/sign-in/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-For': '198.51.100.' + syntheticIp++ },
      body: JSON.stringify({ email, password }),
    });
    const value = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, 'Native sign-in failed: ' + String(value.message || value.error || '').slice(0, 160) + '\n' + safeOutput(output, databaseUrl));
    return { id: value.user?.id, cookie: response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ') };
  }
  function clientFor(client) {
    return { ...client, async request(resource, method = 'GET', body) {
      const response = await fetch(origin + '/api/v1' + resource, {
        method, headers: { Cookie: client.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, value: await response.json().catch(() => null) };
    } };
  }
  async function createCaller(label, orgId, positionName = '') {
    const email = 'project-attachment-' + label + '-' + RUN_ID + '@example.test';
    const password = 'Employee-' + randomBytes(24).toString('hex') + '!';
    TRANSIENT_PASSWORDS.push(password);
    const userId = id();
    const passwordHash = await hashPassword(password);
    await insertFixture('sys_user', { id: userId, name: '项目附件' + label, email, email_verified: true, banned: false, role: 'user', organization_id: null });
    await insertFixture('sys_account', {
      user_id: userId, provider_id: 'credential', account_id: userId, password: passwordHash,
      access_token: null, refresh_token: null, id_token: null,
    });
    await insertFixture('sys_member', { user_id: userId, organization_id: orgId, role: 'member' });
    if (positionName) await insertFixture('sys_user_position', {
      user_id: userId, position: positionName, organization_id: orgId, active: true,
      valid_from: new Date(Date.now() - 60_000).toISOString(), valid_until: null,
    });
    const client = clientFor(await signIn(email, password));
    assert.equal(client.id, userId);
    return client;
  }
  async function createPosition(positionName, psNames) {
    const positionId = await insertFixture('sys_position', { name: positionName, label: '项目附件隔离验证 ' + positionName, active: true });
    const rows = await postgres.query('SELECT id,name FROM sys_permission_set WHERE name=ANY($1::text[])', [psNames]);
    const byName = new Map(rows.rows.map(row => [row.name, row.id]));
    assert.deepEqual(psNames.filter(name => !byName.has(name)), [], 'Native Project PermissionSets are registered');
    for (const name of psNames) await insertFixture('sys_position_permission_set', { position_id: positionId, permission_set_id: byName.get(name) });
    return { name: positionName, id: positionId };
  }
  async function upload(client, name, bytes) {
    const prepared = await client.request('/storage/upload/presigned', 'POST', { filename: name, mimeType: 'text/plain', size: bytes.length, scope: 'user' });
    assert.equal(prepared.status, 200, 'native storage prepares upload: ' + JSON.stringify(prepared.value?.error || prepared.value?.message || ''));
    const descriptor = prepared.value?.data || prepared.value;
    assert.ok(descriptor.fileId && descriptor.uploadUrl, 'native storage returns file ID and presigned URL');
    const body = await fetch(new URL(descriptor.uploadUrl, origin), { method: descriptor.method || 'PUT', headers: descriptor.headers || {}, body: bytes });
    assert.ok(body.ok, 'presigned storage upload accepts actual bytes');
    const completed = await client.request('/storage/upload/complete', 'POST', { fileId: descriptor.fileId });
    assert.equal(completed.status, 200, 'native storage completes the actual upload');
    return descriptor.fileId;
  }
  async function action(client, projectId, fileId, category = 'technical') {
    return client.request('/actions/forge_project/project_attachment_create/' + encodeURIComponent(projectId), 'POST', {
      params: { file_id: fileId, category, remarks: 'PG 原生附件验证' },
    });
  }
  function resultOf(response) {
    let value = response?.value;
    for (let depth = 0; depth < 4 && value && typeof value === 'object' && 'data' in value; depth++) value = value.data;
    return value?.result || value?.record || value;
  }

  const organizationId = await insertFixture('sys_organization', { name: '项目附件PG验证组织 ' + RUN_ID, slug: 'project-attachment-' + RUN_ID });
  const managerPosition = await createPosition('project_attachment_manager_' + RUN_ID, ['forge_project_operator', 'forge_project_manager']);
  const memberPosition = await createPosition('project_attachment_member_' + RUN_ID, ['forge_solution_operator']);
  const managerClient = await createCaller('manager', organizationId, managerPosition.name);
  const managerId = managerClient.id;
  const memberClient = await createCaller('member', organizationId, memberPosition.name);
  const crossProjectClient = await createCaller('cross', organizationId, memberPosition.name);
  const outsiderClient = await createCaller('outsider', organizationId);
  const categoryId = await insertFixture('forge_customer_category', { name: '附件验证客户类别 ' + RUN_ID, code: 'PAC-' + RUN_ID, status: 'active' });
  const customerId = await insertFixture('forge_customer', { name: '附件验证客户 ' + RUN_ID, category_id: categoryId, responsible_id: managerId, status: 'active' });
  const typeId = await insertFixture('forge_project_type', { name: '附件验证类型 ' + RUN_ID, code: 'PAT-' + RUN_ID, active: true });
  const projectA = await insertFixture('forge_project', {
    name: '附件验证项目甲 ' + RUN_ID, type_id: typeId, customer_id: customerId,
    manager_id: managerId, status: 'in_progress', planned_start_on: '2026-10-01', planned_end_on: '2026-12-31',
  });
  const projectB = await insertFixture('forge_project', {
    name: '附件验证项目乙 ' + RUN_ID, type_id: typeId, customer_id: customerId,
    manager_id: managerId, status: 'in_progress', planned_start_on: '2026-10-01', planned_end_on: '2026-12-31',
  });
  async function addMember(projectId, userId, duty, suffix) {
    const response = await managerClient.request('/data/forge_project_member', 'POST', {
      name: duty === 'manager' ? '项目经理 ' + suffix : '项目成员 ' + suffix,
      membership_key: 'PAM-' + RUN_ID + '-' + suffix, project_id: projectId, user_id: userId,
      member_duty: duty, joined_on: '2026-10-04', active: true,
    });
    assert.ok(response.status >= 200 && response.status < 300, 'Native manager creates project membership: ' + JSON.stringify(response.value?.error || response.value?.message || ''));
    const member = resultOf(response);
    assert.ok(member?.id, 'Native project membership returns its record ID');
    return member.id;
  }
  async function assignProjectPosition(projectId, memberId, position, suffix) {
    await insertFixture('forge_project_member_position_assignment', {
      name: '项目岗位 ' + suffix, assignment_key: 'PAA-' + RUN_ID + '-' + suffix,
      project_id: projectId, member_id: memberId, position_id: position.id,
      position_name_snapshot: position.name, is_default: true, active: true, assigned_at: new Date().toISOString(),
    });
  }
  const managerMembershipA = await addMember(projectA, managerId, 'manager', 'manager-a');
  const memberMembershipA = await addMember(projectA, memberClient.id, 'member', 'member-a');
  const crossMembershipB = await addMember(projectB, crossProjectClient.id, 'member', 'cross-b');
  // A project manager's attachment read follows managed_project_ids, even
  // when their manager membership has no project-position binding. Members
  // still require their explicit native project-position assignment.
  await assignProjectPosition(projectA, memberMembershipA, memberPosition, 'member-a');
  await assignProjectPosition(projectB, crossMembershipB, memberPosition, 'cross-b');

  const memberBytes = Buffer.from('Actual project attachment bytes ' + RUN_ID);
  const memberFileId = await upload(memberClient, 'technical-' + RUN_ID + '.txt', memberBytes);
  const createdResponse = await action(memberClient, projectA, memberFileId);
  assert.equal(createdResponse.status, 200, 'project member Action accepted: ' + JSON.stringify(createdResponse.value?.error || createdResponse.value?.message || ''));
  const created = resultOf(createdResponse);
  assert.ok(created?.id, 'Action returns the new attachment record');
  assert.match(String(created.attachment_key || ''), /^PFA-\d{8}-\d{4}$/);
  const attachmentRead = await managerClient.request('/data/forge_project_attachment/' + encodeURIComponent(created.id));
  assert.equal(attachmentRead.status, 200, 'native project manager reads member attachment');
  const attachment = resultOf(attachmentRead);
  assert.equal(attachment.project_id, projectA);
  assert.equal(attachment.name, 'technical-' + RUN_ID + '.txt');
  assert.equal(attachment.uploaded_by, memberClient.id, 'uploader is taken from authenticated session');
  assert.ok(attachment.uploaded_at, 'upload time is set by the server');
  const managerBytesResponse = await fetch(origin + '/api/v1/storage/files/' + encodeURIComponent(memberFileId), { headers: { Cookie: managerClient.cookie } });
  assert.equal(managerBytesResponse.status, 200, 'native manager can download a project-shared file from a member');
  assert.deepEqual(Buffer.from(await managerBytesResponse.arrayBuffer()), memberBytes);
  const outsiderBytesResponse = await fetch(origin + '/api/v1/storage/files/' + encodeURIComponent(memberFileId), { headers: { Cookie: outsiderClient.cookie } });
  assert.ok(outsiderBytesResponse.status >= 400, 'same-organization outsider cannot download the project file');

  const managerBytes = Buffer.from('Manager uploaded project attachment ' + RUN_ID);
  const managerFileId = await upload(managerClient, 'manager-' + RUN_ID + '.txt', managerBytes);
  const managerUpload = await action(managerClient, projectA, managerFileId, 'delivery');
  assert.equal(managerUpload.status, 200, 'assigned project manager can upload within their project scope');
  const managerAttachment = resultOf(managerUpload);
  assert.equal(resultOf(await memberClient.request('/data/forge_project_attachment/' + encodeURIComponent(managerAttachment.id))).project_id, projectA);

  const crossBytes = Buffer.from('Cross-project request remains unheld ' + RUN_ID);
  const crossFileId = await upload(crossProjectClient, 'cross-' + RUN_ID + '.txt', crossBytes);
  const crossResponse = await action(crossProjectClient, projectA, crossFileId);
  assert.ok(crossResponse.status >= 400, 'member of another project cannot use the project-bound Action');
  const crossFile = await postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [crossFileId]);
  assert.deepEqual(crossFile.rows[0], { ref_object: null, ref_id: null, ref_field: null }, 'denied cross-project Action leaves the uploaded file unheld');
  const outsiderResponse = await action(outsiderClient, projectA, crossFileId);
  assert.ok(outsiderResponse.status >= 400, 'unrelated employee cannot invoke the Action');

  const failureBytes = Buffer.from('This byte upload is committed but its business claim must roll back ' + RUN_ID);
  const failureFileId = await upload(memberClient, failedFileName, failureBytes);
  const failedWrite = await action(memberClient, projectA, failureFileId);
  assert.ok(failedWrite.status >= 400, 'injected failure after native claim is reported');
  const rollbackState = await postgres.query('SELECT f.ref_object,f.ref_id,f.ref_field,(SELECT count(*)::int FROM forge_project_attachment a WHERE a.name=$2 AND a.project_id=$3) AS attachment_count FROM sys_file f WHERE f.id=$1', [failureFileId, failedFileName, projectA]);
  assert.deepEqual(rollbackState.rows[0], { ref_object: null, ref_id: null, ref_field: null, attachment_count: 0 }, 'the 17.5 file holding and business attachment both roll back');

  // Generic object creation must not let an employee forge upload identity or
  // attach a file across the member's project scope; only the Action owns writes.
  const genericBytes = Buffer.from('generic data API must not create project evidence ' + RUN_ID);
  const genericFileId = await upload(memberClient, 'generic-' + RUN_ID + '.txt', genericBytes);
  const genericWrite = await memberClient.request('/data/forge_project_attachment', 'POST', {
    name: 'generic-forged-' + RUN_ID + '.txt', project_id: projectB, attachment: genericFileId,
    category: 'technical', uploaded_by: managerId, uploaded_at: '2000-01-01T00:00:00.000Z',
  });
  t.diagnostic('cross-project generic attachment POST HTTP ' + genericWrite.status);
  assert.ok(genericWrite.status >= 400, 'generic attachment POST cannot forge uploader/time or target another project');
  const genericFile = await postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [genericFileId]);
  assert.deepEqual(genericFile.rows[0], { ref_object: null, ref_id: null, ref_field: null }, 'rejected generic create leaves the uploaded file unheld');

  const forgedMetadataBytes = Buffer.from('generic API must not forge uploader or time ' + RUN_ID);
  const forgedMetadataFileId = await upload(memberClient, 'forged-metadata-' + RUN_ID + '.txt', forgedMetadataBytes);
  const forgedMetadataWrite = await memberClient.request('/data/forge_project_attachment', 'POST', {
    name: 'generic-forged-metadata-' + RUN_ID + '.txt', project_id: projectA, attachment: forgedMetadataFileId,
    category: 'technical', uploaded_by: managerId, uploaded_at: '2000-01-01T00:00:00.000Z',
  });
  t.diagnostic('same-project generic attachment POST with forged uploader/time HTTP ' + forgedMetadataWrite.status);
  assert.ok(forgedMetadataWrite.status >= 400, 'generic create in an accessible project cannot forge server-owned uploader or time (HTTP ' + forgedMetadataWrite.status + ')');
  const forgedMetadataFile = await postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [forgedMetadataFileId]);
  assert.deepEqual(forgedMetadataFile.rows[0], { ref_object: null, ref_id: null, ref_field: null }, 'rejected forged metadata create leaves the file unheld');

  const attachmentRows = await postgres.query('SELECT id,attachment_key,project_id,name,uploaded_by,uploaded_at FROM forge_project_attachment WHERE id=ANY($1::text[]) ORDER BY id', [[created.id, managerAttachment.id]]);
  assert.equal(attachmentRows.rows.length, 2, 'PostgreSQL independently reads the two committed attachment records');
  assert.ok(attachmentRows.rows.every(row => row.project_id === projectA && row.uploaded_at && row.attachment_key.startsWith('PFA-')));
});
