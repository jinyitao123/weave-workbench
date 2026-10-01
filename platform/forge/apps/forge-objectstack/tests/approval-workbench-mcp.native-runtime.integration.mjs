import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from 'pg';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PG_PORT = Number(process.env.FORGE_APPROVAL_MCP_PG_PORT || 55439);
const PG_USER = process.env.FORGE_APPROVAL_MCP_PG_USER || 'postgres';
const CONTRACT_OBJECT = 'forge_sales_contract';
const FLOW_NAME = 'sales_contract_approval';
const APPROVE_ACTION = 'contract_approval_mcp_approve';
const SEND_BACK_ACTION = 'contract_approval_mcp_send_back';

assert.ok(Number.isInteger(PG_PORT) && PG_PORT > 0 && PG_PORT < 65536);

function safeOutput(output, secrets) {
  let result = output;
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(secret, '[secret omitted]');
  return result.slice(-6_000);
}

function mcpText(result) {
  return String(result?.content?.find((item) => item.type === 'text')?.text || result?._rpcError?.message || '');
}

function mcpData(result) {
  try { return JSON.parse(mcpText(result)); } catch { return null; }
}

test('native approval MCP actions use caller identity, PostgreSQL lock, and the native approval flow', {
  skip: process.env.FORGE_APPROVAL_MCP_PG_TEST !== '1'
    ? 'set FORGE_APPROVAL_MCP_PG_TEST=1 for the isolated local PostgreSQL 16 runtime test'
    : false,
  timeout: 240_000,
}, async (t) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const database = `forge_approval_mcp_${suffix}`;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-approval-mcp-runtime-'));
  const adminEmail = `approval-mcp-admin-${suffix}@example.test`;
  const adminPassword = `Am-${randomBytes(18).toString('hex')}!`;
  const secretKey = randomBytes(32).toString('hex');
  const authSecret = randomBytes(32).toString('hex');
  const launcherSecret = randomBytes(32).toString('hex');
  const runtimeId = `approval-mcp-${suffix}`;
  const secrets = [adminEmail, adminPassword, secretKey, authSecret, launcherSecret];
  const pgAdmin = new Client({ host: HOST, port: PG_PORT, database: 'postgres', user: PG_USER });
  let databaseClient;
  let child;
  let output = '';
  let port;
  await pgAdmin.connect();
  await pgAdmin.query(`CREATE DATABASE "${database}"`);

  async function stopRuntime() {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 8_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }

  async function stopAndDrop() {
    await stopRuntime();
    if (databaseClient) await databaseClient.end().catch(() => {});
    await pgAdmin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [database]);
    await pgAdmin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await pgAdmin.end();
    await rm(tempDir, { recursive: true, force: true });
  }
  t.after(stopAndDrop);

  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-approval-mcp-runtime-test","type":"module"}\n');
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');
  await writeFile(path.join(tempDir, 'approval-flow-launcher.plugin.mjs'), `
export class ApprovalFlowLauncherPlugin {
  name = 'com.inocube.forge.test.approval-flow-launcher';
  version = '1.0.0';
  type = 'standard';
  init(ctx) {
    ctx.hook('kernel:ready', () => {
      const server = ctx.getService('http.server');
      const engine = ctx.getService('objectql');
      const automation = ctx.getService('automation');
      server.post('/api/v1/__test/approval-flow', async (req, res) => {
        if (req.headers?.authorization !== 'Bearer ${launcherSecret}') {
          await res.status(403).json({ error: 'test bootstrap authorization required' });
          return;
        }
        const { recordId, actorId, organizationId } = req.body ?? {};
        if (![recordId, actorId, organizationId].every((value) => typeof value === 'string' && value.length > 0)) {
          await res.status(400).json({ error: 'recordId, actorId, and organizationId are required' });
          return;
        }
        try {
          const systemContext = { isSystem: true, userId: actorId, tenantId: organizationId, positions: [], permissions: [], skipAutomations: true, skipTriggers: true };
          await engine.update('${CONTRACT_OBJECT}', { id: recordId, status: 'pending_approval' }, { context: systemContext });
          const record = await engine.findOne('${CONTRACT_OBJECT}', { where: { id: recordId } }, { context: systemContext });
          if (!record) throw new Error('test contract was not found');
          const result = await automation.execute('${FLOW_NAME}', {
            object: '${CONTRACT_OBJECT}', record, previous: { status: 'draft' },
            userId: actorId, tenantId: organizationId, organizationId,
            positions: [], permissions: [],
          });
          await res.status(200).json(result);
        } catch (error) {
          await res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        }
      });
    });
  }
}
`);
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `
import stack from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};
import { ApprovalFlowLauncherPlugin } from './approval-flow-launcher.plugin.mjs';
stack.plugins.push(new ApprovalFlowLauncherPlugin());
export default stack;
`);

  const portProbe = createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, HOST, resolve);
  });
  port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  child = spawn(process.execPath, [
    path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'),
    'dev', '--seed-admin', '--port', String(port), '--database-driver', 'postgres',
    '--admin-email', adminEmail, '--admin-password', adminPassword,
    '--auth-secret', authSecret, '--log-level', 'error',
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      OS_HOME: path.join(tempDir, '.os-home'),
      OS_DATABASE_URL: `postgres://${PG_USER}@${HOST}:${PG_PORT}/${database}`,
      OS_SECRET_KEY: secretKey,
      OS_BASE_URL: `http://${HOST}:${port}`,
      OS_TRUSTED_ORIGINS: `http://${HOST}:${port}`,
      OS_ENVIRONMENT_ID: runtimeId,
      FORGE_APPROVAL_TEST_BOOTSTRAP_TOKEN: launcherSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-10_000); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-10_000); });
  const deadline = Date.now() + 120_000;
  let health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated ObjectStack runtime exited (${child.exitCode}).\n${safeOutput(output, secrets)}`);
    try {
      health = await fetch(`http://${HOST}:${port}/api/v1/health`, { signal: AbortSignal.timeout(1_000) });
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(health?.ok, `Isolated ObjectStack runtime did not become ready.\n${safeOutput(output, secrets)}`);

  databaseClient = new Client({ host: HOST, port: PG_PORT, database, user: PG_USER });
  await databaseClient.connect();
  async function clientFor(email, password) {
    const origin = `http://${HOST}:${port}`;
    const response = await fetch(`${origin}/api/v1/auth/sign-in/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email, password }),
    });
    const value = await response.json();
    assert.ok(response.ok && value.user?.id, `Local sign-in failed with HTTP ${response.status}`);
    const cookie = response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
    let requestId = 0;
    let mcpSessionId = '';
    let mcpInitialized = false;
    async function request(resource, method = 'GET', body, extraHeaders = {}) {
      const result = await fetch(`${origin}/api/v1${resource}`, {
        method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: result.status, value: await result.json().catch(() => null) };
    }
    async function mcpRequest(method, params = {}, notification = false) {
      const message = { jsonrpc: '2.0', method, params };
      if (!notification) message.id = ++requestId;
      const result = await fetch(`${origin}/api/v1/mcp`, {
        method: 'POST',
        headers: {
          Cookie: cookie, Origin: origin, Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-03-26',
          ...(mcpSessionId ? { 'MCP-Session-Id': mcpSessionId } : {}),
        },
        body: JSON.stringify(message),
      });
      mcpSessionId ||= result.headers.get('MCP-Session-Id') || '';
      const raw = await result.text();
      const dataLines = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
      const payload = dataLines.length ? dataLines.at(-1) : raw;
      return { status: result.status, value: payload ? JSON.parse(payload) : null };
    }
    async function callMcpTool(name, arguments_ = {}) {
      if (!mcpInitialized) {
        const initialized = await mcpRequest('initialize', {
          protocolVersion: '2025-03-26', capabilities: {},
          clientInfo: { name: 'forge-approval-mcp-native-test', version: '1.0.0' },
        });
        assert.equal(initialized.status, 200, `MCP initialize returned ${initialized.status}`);
        await mcpRequest('notifications/initialized', {}, true);
        mcpInitialized = true;
      }
      const result = await mcpRequest('tools/call', { name, arguments: arguments_ });
      assert.equal(result.status, 200, `MCP ${name} transport returned ${result.status}`);
      return result.value?.result ?? { _rpcError: result.value?.error };
    }
    return { userId: value.user.id, request, callMcpTool, cookie };
  }

  async function createEmployee(admin, organizationId, roleName) {
    const email = `approval-mcp-${roleName}-${suffix}@example.test`;
    const password = `Emp-${randomBytes(18).toString('hex')}!`;
    const created = await admin.request('/auth/admin/create-user', 'POST', {
      name: `审批MCP隔离测试-${roleName}`, email, password, role: 'user', mustChangePassword: false,
    });
    assert.ok(created.status >= 200 && created.status < 300, `Employee creation returned HTTP ${created.status}`);
    const userId = created.value?.data?.user?.id;
    assert.ok(userId, 'Employee creation must return an id');
    const setPassword = await admin.request('/auth/admin/set-user-password', 'POST', {
      userId, newPassword: password, mustChangePassword: false,
    });
    assert.ok(setPassword.status >= 200 && setPassword.status < 300, 'Employee password setup succeeded');
    const membership = await databaseClient.query('SELECT id FROM sys_member WHERE user_id = $1 AND organization_id = $2 LIMIT 1', [userId, organizationId]);
    if (!membership.rows[0]?.id) {
      await databaseClient.query('INSERT INTO sys_member (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)', [randomUUID(), organizationId, userId, 'member']);
    }
    const employee = await clientFor(email, password);
    const employeeSession = await employee.request('/auth/get-session');
    if (employeeSession.value?.session?.activeOrganizationId !== organizationId) {
      const switched = await employee.request('/auth/organization/set-active', 'POST', { organizationId });
      assert.ok(switched.status >= 200 && switched.status < 300,
        `Employee active organization setup returned HTTP ${switched.status}`);
    }
    return employee;
  }

  function idOf(response, label) {
    const id = response?.value?.id || response?.value?.record?.id || response?.value?.data?.id || response?.value?.data?.record?.id;
    assert.ok(response.status >= 200 && response.status < 300 && id, `${label} HTTP ${response.status}`);
    return id;
  }

  const admin = await clientFor(adminEmail, adminPassword);
  const session = await admin.request('/auth/get-session');
  const organizationId = session.value?.session?.activeOrganizationId || session.value?.session?.organizationId;
  assert.ok(organizationId, 'Seeded administrator has an active organization');
  const delivery = await createEmployee(admin, organizationId, 'delivery');
  const commercial = await createEmployee(admin, organizationId, 'commercial');
  const unrelated = await createEmployee(admin, organizationId, 'unrelated');

  const positionAssignments = [
    [delivery.userId, 'contract_delivery_reviewer'],
    [commercial.userId, 'contract_commercial_reviewer'],
  ];
  for (const [userId, position] of positionAssignments) {
    await databaseClient.query(
      'INSERT INTO sys_user_position (id, user_id, position, organization_id) VALUES ($1, $2, $3, $4)',
      [randomUUID(), userId, position, organizationId],
    );
  }
  const category = await admin.request('/data/forge_customer_category', 'POST', {
    name: `审批MCP客户分类-${suffix}`, code: `AMCAT-${suffix}`, status: 'active',
  });
  const categoryId = idOf(category, 'Customer category created');
  const customer = await admin.request('/data/forge_customer', 'POST', {
    name: `审批MCP客户-${suffix}`, category_id: categoryId, responsible_id: admin.userId,
  });
  const customerId = idOf(customer, 'Customer created');
  const contractType = await admin.request('/data/forge_contract_type', 'POST', {
    name: `审批MCP合同类型-${suffix}`, code: `AMCT-${suffix}`, status: 'active',
  });
  const contractTypeId = idOf(contractType, 'Contract type created');

  async function createContract(label) {
    const result = await admin.request('/data/forge_sales_contract', 'POST', {
      name: `${label}-${suffix}`, code: `AMSC-${suffix}-${label}`, contract_type_id: contractTypeId,
      customer_id: customerId, responsible_id: admin.userId,
    });
    return idOf(result, `Contract created (${label})`);
  }

  async function openApproval(contractId) {
    const launched = await admin.request('/__test/approval-flow', 'POST', {
      recordId: contractId, actorId: admin.userId, organizationId,
    }, { Authorization: `Bearer ${launcherSecret}` });
    assert.equal(launched.status, 200, `Native approval flow launch returned HTTP ${launched.status}`);
    assert.equal(launched.value?.status, 'paused', `Native approval flow must pause at its approval node: ${JSON.stringify(launched.value)}`);
    const rows = await databaseClient.query(
      'SELECT id, flow_run_id, status FROM sys_approval_request WHERE object_name = $1 AND record_id = $2 ORDER BY created_at DESC LIMIT 1',
      [CONTRACT_OBJECT, contractId],
    );
    assert.equal(rows.rows.length, 1, 'Native approval service created one request');
    assert.equal(rows.rows[0].status, 'pending');
    return String(rows.rows[0].id);
  }

  async function workbenchContext(client, requestId) {
    return client.request(`/approvals/requests/${requestId}/workbench-context`);
  }

  async function invokeMcp(client, action, recordId, params) {
    return client.callMcpTool('run_action', {
      actionName: action,
      objectName: CONTRACT_OBJECT,
      recordId,
      params,
    });
  }

  const sendBackContractId = await createContract('send-back');
  const sendBackRequestId = await openApproval(sendBackContractId);
  const list = mcpData(await delivery.callMcpTool('list_actions'));
  assert.ok(list?.actions?.some((action) => action.name === APPROVE_ACTION));
  assert.ok(list?.actions?.some((action) => action.name === SEND_BACK_ACTION));
  const deliveryContext = await workbenchContext(delivery, sendBackRequestId);
  assert.equal(deliveryContext.status, 200, 'the native current approver receives the workbench context');
  assert.equal(deliveryContext.value.viewer, 'current_approver');
  assert.equal(deliveryContext.value.availableActions.length, 2);
  const sendBackAction = deliveryContext.value.availableActions.find((item) => item.execution.actionName === SEND_BACK_ACTION);
  assert.ok(sendBackAction);
  assert.match(sendBackAction.execution.params.itemVersion, /^v1-[0-9a-f]{64}$/);
  assert.match(sendBackAction.execution.params.sourceMaterialVersion, /^[0-9a-f]{64}$/);

  const unreadableRecord = await delivery.request(`/data/${CONTRACT_OBJECT}/${sendBackContractId}`);
  assert.ok(unreadableRecord.status >= 400, `reviewer has no generic contract read access (HTTP ${unreadableRecord.status})`);
  const noWrite = await delivery.request(`/data/${CONTRACT_OBJECT}/${sendBackContractId}`, 'PATCH', { remarks: 'should be denied' });
  assert.ok(noWrite.status >= 400, `reviewer has no generic contract write access (HTTP ${noWrite.status})`);

  const injectedActor = await invokeMcp(delivery, SEND_BACK_ACTION, sendBackContractId, {
    ...sendBackAction.execution.params,
    comment: '请补充附件签字页',
    actorId: unrelated.userId,
  });
  assert.equal(injectedActor.isError, true, 'the generic action param contract rejects caller-supplied actor identity');
  assert.equal((await databaseClient.query('SELECT id FROM sys_approval_action WHERE request_id = $1 AND action = $2', [sendBackRequestId, 'revise'])).rows.length, 0);

  const unrelatedAction = await invokeMcp(unrelated, SEND_BACK_ACTION, sendBackContractId, {
    ...sendBackAction.execution.params,
    comment: '未授权员工意见',
  });
  assert.equal(unrelatedAction.isError, true, 'an unrelated employee cannot use another employee\'s native approval request');
  assert.equal((await databaseClient.query('SELECT id FROM sys_approval_action WHERE request_id = $1 AND action = $2', [sendBackRequestId, 'revise'])).rows.length, 0);

  const sendBackArgs = {
    ...sendBackAction.execution.params,
    comment: '请补充附件签字页',
  };
  const [sendBackFirst, sendBackConcurrent] = await Promise.all([
    invokeMcp(delivery, SEND_BACK_ACTION, sendBackContractId, sendBackArgs),
    invokeMcp(delivery, SEND_BACK_ACTION, sendBackContractId, sendBackArgs),
  ]);
  const sendBackReceipts = [sendBackFirst, sendBackConcurrent].map(mcpData);
  assert.equal(sendBackReceipts.filter((value) => value?.result?.status === 'returned').length, 1,
    `exactly one native send-back is applied: ${JSON.stringify(sendBackReceipts)}`);
  assert.equal(sendBackReceipts.filter((value) => value?.result?.status === 'history_observed' && value?.result?.decision === 'unknown').length, 1,
    `the racing duplicate is only reported as history observed: ${JSON.stringify(sendBackReceipts)}`);
  assert.equal((await databaseClient.query('SELECT id FROM sys_approval_action WHERE request_id = $1 AND action = $2', [sendBackRequestId, 'revise'])).rows.length, 1,
    'the PostgreSQL advisory transaction lock prevents duplicate native revise writes');
  const returned = await databaseClient.query('SELECT status FROM sys_approval_request WHERE id = $1', [sendBackRequestId]);
  assert.equal(returned.rows[0]?.status, 'returned', 'native sendBack finalized the original request');

  const approveContractId = await createContract('approve');
  const approveRequestId = await openApproval(approveContractId);
  const approvalContext = await workbenchContext(delivery, approveRequestId);
  assert.equal(approvalContext.status, 200);
  const approveAction = approvalContext.value.availableActions.find((item) => item.execution.actionName === APPROVE_ACTION);
  assert.ok(approveAction);
  const approveArgs = { ...approveAction.execution.params, comment: '材料已核对' };
  const firstApproval = mcpData(await invokeMcp(delivery, APPROVE_ACTION, approveContractId, approveArgs));
  assert.equal(firstApproval?.result?.decision, 'approve');
  assert.equal(firstApproval?.result?.status, 'pending', 'the native per-group approval waits for the commercial reviewer');
  assert.equal(firstApproval?.result?.resumed, false);
  assert.equal((await databaseClient.query('SELECT id FROM sys_approval_action WHERE request_id = $1 AND action = $2', [approveRequestId, 'approve'])).rows.length, 1);

  const staleRepeat = await invokeMcp(delivery, APPROVE_ACTION, approveContractId, approveArgs);
  const staleRepeatValue = mcpData(staleRepeat);
  assert.notEqual(staleRepeat.isError, true, mcpText(staleRepeat));
  assert.equal(staleRepeatValue?.result?.status, 'history_observed', `native history is not misrepresented as a versioned receipt: ${mcpText(staleRepeat)}`);
  assert.equal(staleRepeatValue?.result?.decision, 'unknown');
  assert.equal((await databaseClient.query('SELECT id FROM sys_approval_action WHERE request_id = $1 AND action = $2', [approveRequestId, 'approve'])).rows.length, 1);

  const staleSendBackAction = approvalContext.value.availableActions.find((item) => item.execution.actionName === SEND_BACK_ACTION);
  const staleSendBack = await invokeMcp(delivery, SEND_BACK_ACTION, approveContractId, {
    ...staleSendBackAction.execution.params,
    comment: '旧版本不应再退回',
  });
  assert.equal(staleSendBack.isError, true, 'the previous item version cannot execute a different native decision');
  assert.match(mcpText(staleSendBack), /APPROVAL_ACTION_(?:FORBIDDEN|STALE)/);
  assert.equal((await databaseClient.query('SELECT id FROM sys_approval_action WHERE request_id = $1 AND action = $2', [approveRequestId, 'revise'])).rows.length, 0);

  const commercialContext = await workbenchContext(commercial, approveRequestId);
  assert.equal(commercialContext.status, 200);
  const commercialAction = commercialContext.value.availableActions.find((item) => item.execution.actionName === APPROVE_ACTION);
  assert.ok(commercialAction);
  const secondApproval = mcpData(await invokeMcp(commercial, APPROVE_ACTION, approveContractId, {
    ...commercialAction.execution.params,
    comment: '商务条款已核对',
  }));
  assert.equal(secondApproval?.result?.decision, 'approve');
  assert.equal(secondApproval?.result?.status, 'approved');
  assert.equal(secondApproval?.result?.resumed, true, 'the native approval service resumed the paused approval flow');
  const finalRequest = await databaseClient.query('SELECT status FROM sys_approval_request WHERE id = $1', [approveRequestId]);
  assert.equal(finalRequest.rows[0]?.status, 'approved');
  const finalRecord = await databaseClient.query('SELECT status FROM forge_sales_contract WHERE id = $1', [approveContractId]);
  assert.equal(finalRecord.rows[0]?.status, 'active', 'the native flow continued through its existing approval branch');

  await databaseClient.end();
  databaseClient = undefined;
  await stopRuntime();
  t.diagnostic('Verified through the ObjectStack CLI runtime and MCP HTTP transport using an ephemeral database on the existing isolated PostgreSQL instance.');
});
