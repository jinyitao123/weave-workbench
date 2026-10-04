import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminEmail = 'admin@objectos.ai';
const adminPassword = `Admin-${randomBytes(18).toString('hex')}!`;
const memberPassword = `Member-${randomBytes(18).toString('hex')}!`;
const runId = randomUUID().slice(0, 8);

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

test('native project shares grant and revoke project and evidence read for an assigned employee', { timeout: 120_000 }, async t => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-project-sharing-'));
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  let output = '';
  const child = spawn(process.execPath, [
    path.join(appDir, 'node_modules/@objectstack/cli/bin/run.js'),
    'dev', '--port', String(port), '--compile', '--seed-admin',
    '--admin-email', adminEmail, '--admin-password', adminPassword, '--log-level', 'error',
  ], {
    cwd: appDir,
    env: {
      ...process.env,
      OS_BASE_URL: origin,
      OS_TRUSTED_ORIGINS: origin,
      OS_HOME: path.join(tempDir, '.os-home'),
      OS_DATABASE_URL: `file:${path.join(tempDir, 'data', 'project-sharing.sqlite')}`,
      OS_AUTH_SECRET: randomBytes(32).toString('hex'),
      OS_SECRET_KEY: randomBytes(32).toString('hex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-6000); });
  child.stderr.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-6000); });
  t.after(async () => {
    if (child.exitCode === null && !child.signalCode) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null && !child.signalCode) {
        child.kill('SIGKILL');
        await closed;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  });
  const safeOutput = () => output.replaceAll(adminPassword, '[admin password]').replaceAll(memberPassword, '[member password]');
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`ObjectStack exited ${child.exitCode}: ${safeOutput()}`);
    try {
      const health = await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, `ObjectStack did not start: ${safeOutput()}`);

  async function signIn(email, password) {
    const response = await fetch(`${origin}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: origin },
      body: JSON.stringify({ email, password }),
    });
    const value = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, `sign-in HTTP ${response.status}`);
    return { id: value.user?.id, cookie: response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ') };
  }

  async function request(client, endpoint, method = 'GET', body) {
    const response = await fetch(`${origin}/api/v1${endpoint}`, {
      method,
      headers: { Cookie: client.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, value: await response.json().catch(() => ({})) };
  }

  async function download(client, fileId) {
    const response = await fetch(`${origin}/api/v1/storage/files/${fileId}`, {
      headers: { Cookie: client.cookie },
    });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  }

  function idOf(response, label) {
    const id = response.value.id || response.value.record?.id || response.value.data?.id || response.value.data?.record?.id;
    assert.ok(response.status >= 200 && response.status < 300 && id,
      `${label} HTTP ${response.status}: ${JSON.stringify(response.value.error || response.value.message || {})}`);
    return id;
  }

  const admin = await signIn(adminEmail, adminPassword);
  const session = await request(admin, '/auth/get-session');
  const organizationId = session.value.session?.activeOrganizationId || session.value.session?.organizationId;
  assert.ok(organizationId, 'administrator must belong to a local organization');
  const permissionSets = await request(admin, '/data/sys_permission_set?$top=100');
  assert.equal(permissionSets.status, 200);
  const permissionSet = permissionSets.value.records.find(row => row.name === 'forge_solution_operator');
  assert.ok(permissionSet?.id, 'solution permission must be provisioned');

  async function createEmployee(suffix) {
    const email = `project-share-${suffix}-${runId}@example.test`;
    const created = await request(admin, '/auth/admin/create-user', 'POST', {
      name: `本地项目${suffix}`, email, password: memberPassword, role: 'user', mustChangePassword: false,
    });
    assert.ok(created.status >= 200 && created.status < 300, `create employee HTTP ${created.status}`);
    const userId = created.value.data?.user?.id;
    assert.ok(userId);
    idOf(await request(admin, '/data/sys_user_permission_set', 'POST', {
      user_id: userId, permission_set_id: permissionSet.id, organization_id: organizationId,
      granted_by: admin.id, reason: '隔离原生记录分享验证',
    }), 'grant solution permission');
    const client = await signIn(email, memberPassword);
    assert.equal(client.id, userId);
    return client;
  }

  const member = await createEmployee('member');
  const outsider = await createEmployee('outsider');
  const category = idOf(await request(admin, '/data/forge_customer_category', 'POST', {
    name: '本地分享客户分类', code: `PSC-${runId}`, status: 'active',
  }), 'customer category');
  const customer = idOf(await request(admin, '/data/forge_customer', 'POST', {
    name: '本地分享客户', category_id: category, responsible_id: admin.id,
  }), 'customer');
  const type = idOf(await request(admin, '/data/forge_project_type', 'POST', {
    name: '本地分享项目类型', code: `PST-${runId}`, active: true,
  }), 'project type');
  const project = idOf(await request(admin, '/data/forge_project', 'POST', {
    name: '本地项目成员共享验证', type_id: type, customer_id: customer, manager_id: admin.id,
    planned_start_on: '2026-09-28', planned_end_on: '2026-12-31',
  }), 'project');

  assert.equal((await request(member, `/data/forge_project/${project}`)).status, 404);
  const membership = idOf(await request(admin, '/data/forge_project_member', 'POST', {
    name: '本地项目成员', membership_key: `PSM-${runId}`, project_id: project,
    user_id: member.id, member_duty: 'member', joined_on: '2026-09-28',
  }), 'project membership');
  assert.equal((await request(member, `/data/forge_project/${project}`)).status, 200);
  assert.equal((await request(outsider, `/data/forge_project/${project}`)).status, 404);

  const log = idOf(await request(admin, '/data/forge_project_log', 'POST', {
    name: '本地项目日志', log_key: `PSL-${runId}`, project_id: project,
    content: '只供隔离记录分享验证', category: 'progress',
  }), 'project log');
  assert.equal((await request(member, `/data/forge_project_log/${log}`)).status, 200);
  assert.equal((await request(outsider, `/data/forge_project_log/${log}`)).status, 404);

  const bytes = Buffer.from('project member file readback');
  const presigned = await request(admin, '/storage/upload/presigned', 'POST', {
    filename: 'project-material.txt', mimeType: 'text/plain', size: bytes.length, scope: 'user',
  });
  assert.equal(presigned.status, 200, 'project file descriptor');
  const upload = presigned.value.data || presigned.value;
  const uploaded = await fetch(new URL(upload.uploadUrl, origin), {
    method: upload.method || 'PUT', headers: upload.headers || {}, body: bytes,
  });
  assert.ok(uploaded.ok, `project file upload HTTP ${uploaded.status}`);
  assert.equal((await request(admin, '/storage/upload/complete', 'POST', { fileId: upload.fileId })).status, 200);
  const attachment = idOf(await request(admin, '/data/forge_project_attachment', 'POST', {
    name: '项目技术资料', attachment_key: `PSA-${runId}`, project_id: project,
    attachment: upload.fileId, category: 'technical',
  }), 'project attachment');
  assert.equal((await request(member, `/data/forge_project_attachment/${attachment}`)).status, 200);
  assert.equal((await request(outsider, `/data/forge_project_attachment/${attachment}`)).status, 404);
  const memberFile = await download(member, upload.fileId);
  assert.equal(memberFile.status, 200,
    'assigned project member must read the real attachment bytes');
  assert.deepEqual(memberFile.bytes, bytes);
  assert.ok((await download(outsider, upload.fileId)).status >= 400);

  const deactivated = await request(admin, `/data/forge_project_member/${membership}`, 'PATCH', { active: false });
  assert.ok(deactivated.status >= 200 && deactivated.status < 300, `deactivate HTTP ${deactivated.status}`);
  assert.equal((await request(member, `/data/forge_project/${project}`)).status, 404);
  assert.equal((await request(member, `/data/forge_project_log/${log}`)).status, 404);
  assert.equal((await request(member, `/data/forge_project_attachment/${attachment}`)).status, 404);
  assert.ok((await download(member, upload.fileId)).status >= 400);
});
