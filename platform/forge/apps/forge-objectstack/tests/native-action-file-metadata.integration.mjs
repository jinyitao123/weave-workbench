import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js');
const adminEmail = `native-action-file-${randomUUID().slice(0, 8)}@example.test`;
const adminPassword = `Native-${randomBytes(18).toString('hex')}!`;
const authSecret = randomBytes(32).toString('hex');
const secretKey = randomBytes(32).toString('hex');

function captureBodyConfigSource() {
  const salesActionModule = JSON.stringify(path.join(APP_DIR, 'src/actions/sales.action.ts'));
  return `
import { defineAction, defineStack } from '@objectstack/spec';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { MCPServerPlugin } from '@objectstack/mcp';
import { SalesLeadConvertToOpportunity, QuotationAdjustLinePrice } from ${salesActionModule};

const captureAction = action => {
  const { visible: _visible, ...declared } = action;
  return {
    ...declared,
    requiredPermissions: [],
    body: { language: 'js', capabilities: [], source: 'return { received: ctx.input };' },
  };
};

const contractMaterialPackage = defineAction({
  name: 'contract_submit_material_package',
  label: '提交指定合同材料包',
  objectName: 'forge_sales_contract',
  locations: ['record_more'],
  requiredPermissions: [],
  ai: {
    exposed: true,
    description: '仅接收本轮冻结的主合同正文和全部材料文件，供隔离运行时验证注册Action的原生文件参数声明、单值及多值行为。',
    category: 'action',
    requiresConfirmation: false,
  },
  params: [
    { name: 'primary_file_id', label: '合同正文', type: 'file', required: true },
    { name: 'material_file_ids', label: '本轮材料集合', type: 'file', multiple: true, required: true },
  ],
  body: { language: 'js', capabilities: [], source: 'return { received: ctx.input };' },
});

const objects = [
  ObjectSchema.create({ name: 'forge_sales_contract', label: '测试合同', sharingModel: 'private', fields: { name: Field.text({ required: true }) }, actions: [contractMaterialPackage], enable: { apiEnabled: true } }),
  ObjectSchema.create({ name: 'forge_sales_lead', label: '测试线索', sharingModel: 'private', fields: { name: Field.text({ required: true }), status: Field.text() }, actions: [captureAction(SalesLeadConvertToOpportunity)], enable: { apiEnabled: true } }),
  ObjectSchema.create({ name: 'forge_sales_opportunity', label: '测试商机', sharingModel: 'private', fields: { name: Field.text({ required: true }), amount: Field.currency(), expected_close_on: Field.date() }, enable: { apiEnabled: true } }),
  ObjectSchema.create({ name: 'forge_quotation', label: '测试报价', sharingModel: 'private', fields: { name: Field.text({ required: true }), status: Field.text(), pricing_version: Field.number() }, actions: [captureAction(QuotationAdjustLinePrice)], enable: { apiEnabled: true } }),
];

export default defineStack({
  manifest: { id: 'com.inoforge.native-action-file-metadata-test', version: '1.0.0', type: 'app', name: 'Native Action File Metadata Test' },
  objects,
  plugins: [new MCPServerPlugin()],
});
`;
}

function mcpText(result) {
  return String(result?.content?.find(item => item.type === 'text')?.text || result?._rpcError?.message || '');
}

function mcpData(result) {
  try { return JSON.parse(mcpText(result)); } catch { return null; }
}

function actionResult(value) {
  return value?.result ?? value?.data?.result ?? value?.data ?? value;
}

async function clientFor(port, email, password) {
  const origin = `http://127.0.0.1:${port}`;
  const signIn = await fetch(`${origin}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  const value = await signIn.json();
  assert.ok(signIn.ok && value.user?.id, `Isolated sign-in failed with HTTP ${signIn.status}`);
  const cookie = signIn.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  let requestId = 0;
  let mcpSessionId = '';
  let mcpInitialized = false;
  async function request(resource, method = 'GET', body) {
    const response = await fetch(`${origin}/api/v1${resource}`, {
      method,
      headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, value: await response.json().catch(() => null) };
  }
  async function mcpRequest(method, params = {}, notification = false) {
    const message = { jsonrpc: '2.0', method, params };
    if (!notification) message.id = ++requestId;
    const response = await fetch(`${origin}/api/v1/mcp`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-03-26',
        ...(mcpSessionId ? { 'MCP-Session-Id': mcpSessionId } : {}),
      },
      body: JSON.stringify(message),
    });
    mcpSessionId ||= response.headers.get('MCP-Session-Id') || '';
    const raw = await response.text();
    const dataLines = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean);
    const payload = dataLines.length ? dataLines.at(-1) : raw;
    return { status: response.status, value: payload ? JSON.parse(payload) : null };
  }
  async function initializeMcp() {
    if (mcpInitialized) return;
    const initialized = await mcpRequest('initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'native-action-file-metadata-test', version: '1.0.0' },
    });
    assert.equal(initialized.status, 200, `MCP initialize returned ${initialized.status}`);
    await mcpRequest('notifications/initialized', {}, true);
    mcpInitialized = true;
  }
  async function callMcpTool(name, arguments_ = {}) {
    await initializeMcp();
    const response = await mcpRequest('tools/call', { name, arguments: arguments_ });
    assert.equal(response.status, 200, `MCP ${name} transport returned ${response.status}`);
    return response.value?.result ?? { _rpcError: response.value?.error };
  }
  return { userId: value.user.id, request, callMcpTool };
}

async function createRecord(api, objectName, name, extra = {}) {
  const response = await api.request(`/data/${objectName}`, 'POST', { name, ...extra });
  assert.ok(response.status >= 200 && response.status < 300, `Create ${objectName} returned HTTP ${response.status}`);
  const id = response.value?.id || response.value?.record?.id || response.value?.data?.id;
  assert.ok(id, `Create ${objectName} returned no record ID`);
  return id;
}

async function startRuntime(tempDir, port) {
  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-native-action-file-metadata-test","type":"module"}\n');
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), captureBodyConfigSource());
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');

  const child = spawn(process.execPath, [
    cliPath, 'dev', '--seed-admin', '--port', String(port), '--database-driver', 'memory',
    '--admin-email', adminEmail, '--admin-password', adminPassword,
    '--auth-secret', authSecret, '--log-level', 'error', '--environment-id', `native-action-file-${randomUUID()}`,
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      OS_HOME: path.join(tempDir, '.os-home'),
      OS_BASE_URL: `http://127.0.0.1:${port}`,
      OS_TRUSTED_ORIGINS: `http://127.0.0.1:${port}`,
      OS_SECRET_KEY: secretKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const collect = chunk => { output = (output + chunk).slice(-4000); };
  child.stdout.setEncoding('utf8').on('data', collect);
  child.stderr.setEncoding('utf8').on('data', collect);
  const safeOutput = () => output.replaceAll(authSecret, '[auth secret omitted]').replaceAll(secretKey, '[secret key omitted]').replaceAll(adminPassword, '[password omitted]');

  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated ObjectStack runtime exited (${child.exitCode}).\n${safeOutput()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Isolated ObjectStack runtime did not become ready.\n${safeOutput()}`);
  return child;
}

async function stopRuntime(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise(resolve => child.once('exit', resolve));
  }
}

test('ObjectStack 17.3 native MCP preserves declared file cardinality and accepts file arrays', { timeout: 120_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-native-action-file-metadata-'));
  const portProbe = createServer();
  let child;
  try {
    await new Promise((resolve, reject) => {
      portProbe.once('error', reject);
      portProbe.listen(0, '127.0.0.1', resolve);
    });
    const port = portProbe.address().port;
    await new Promise(resolve => portProbe.close(resolve));
    child = await startRuntime(tempDir, port);
    const admin = await clientFor(port, adminEmail, adminPassword);

    const contractId = await createRecord(admin, 'forge_sales_contract', '本地Action参数探针合同');
    const leadId = await createRecord(admin, 'forge_sales_lead', '本地Action参数探针线索', { status: 'new' });
    const quotationId = await createRecord(admin, 'forge_quotation', '本地Action参数探针报价', { status: 'draft', pricing_version: 0 });

    const listing = mcpData(await admin.callMcpTool('list_actions', {}));
    assert.ok(Array.isArray(listing?.actions), 'Native MCP list_actions must be available to the fixture employee');
    const listed = (objectName, name) => listing.actions.find(action => action.objectName === objectName && action.name === name);
    const fileSummary = listed('forge_sales_contract', 'contract_submit_material_package');
    assert.ok(fileSummary, 'The registered file Action must be present in the employee MCP allowlist');
    assert.equal(fileSummary.params.find(param => param.name === 'primary_file_id')?.type, 'string', 'Native MCP summary currently collapses a file parameter to string');
    assert.equal(Object.hasOwn(fileSummary.params.find(param => param.name === 'material_file_ids') || {}, 'multiple'), false, 'Native MCP summary currently drops multiple');

    const rawContract = await admin.request('/meta/objects/forge_sales_contract');
    assert.equal(rawContract.status, 200);
    assert.equal(rawContract.value?.type, 'object');
    assert.equal(rawContract.value?.name, 'forge_sales_contract');
    assert.equal(rawContract.value?.item?.name, 'forge_sales_contract');
    const rawFileAction = rawContract.value?.item?.actions?.find(action => action.name === 'contract_submit_material_package');
    assert.ok(rawFileAction, 'Native object metadata must preserve the registered Action declaration');
    assert.deepEqual(rawFileAction.params.map(({ name, type, multiple, required }) => ({ name, type, multiple: Boolean(multiple), required })), [
      { name: 'primary_file_id', type: 'file', multiple: false, required: true },
      { name: 'material_file_ids', type: 'file', multiple: true, required: true },
    ]);

    const rawLead = await admin.request('/meta/objects/forge_sales_lead');
    const leadAction = rawLead.value?.item?.actions?.find(action => action.name === 'sales_lead_convert_to_opportunity');
    assert.equal(rawLead.status, 200);
    assert.ok(leadAction);
    assert.equal(leadAction.params.find(param => param.field === 'amount')?.objectOverride, 'forge_sales_opportunity');
    const targetObject = await admin.request('/meta/objects/forge_sales_opportunity');
    assert.equal(targetObject.status, 200);
    assert.equal(targetObject.value?.item?.fields?.amount?.type, 'currency');
    assert.equal(targetObject.value?.item?.fields?.expected_close_on?.type, 'date');

    const quotationAction = listed('forge_quotation', 'quotation_adjust_line_price');
    assert.ok(quotationAction);
    assert.equal(quotationAction.params.find(param => param.name === 'expected_pricing_version')?.type, 'number');
    assert.equal(quotationAction.params.find(param => param.name === 'taxed_unit_price')?.type, 'number');

    const primary = randomUUID();
    const materials = [primary, randomUUID(), randomUUID()];
    const submitted = await admin.callMcpTool('run_action', {
      actionName: 'contract_submit_material_package', objectName: 'forge_sales_contract', recordId: contractId,
      params: { primary_file_id: primary, material_file_ids: materials },
    });
    assert.notEqual(submitted?.isError, true, `Native run_action rejected file UUID values: ${mcpText(submitted)}`);
    const captured = actionResult(mcpData(submitted))?.received;
    assert.equal(captured?.primary_file_id, primary);
    assert.deepEqual(captured?.material_file_ids, materials);

    const scalarArray = await admin.callMcpTool('run_action', {
      actionName: 'contract_submit_material_package', objectName: 'forge_sales_contract', recordId: contractId,
      params: { primary_file_id: primary, material_file_ids: randomUUID() },
    });
    assert.equal(scalarArray?.isError, true, 'Native run_action must reject a scalar for multiple:true');
    assert.match(mcpText(scalarArray), /material_file_ids|multiple|array/i, 'Scalar rejection should identify the multi-file shape');

    const arrayScalar = await admin.callMcpTool('run_action', {
      actionName: 'contract_submit_material_package', objectName: 'forge_sales_contract', recordId: contractId,
      params: { primary_file_id: [randomUUID(), randomUUID()], material_file_ids: materials },
    });
    assert.equal(arrayScalar?.isError, true, 'Native run_action must reject an array for the single file parameter');
    assert.match(mcpText(arrayScalar), /primary_file_id|expected.*string|array/i, 'Single-file rejection should identify the scalar shape');
    assert.doesNotMatch(mcpText(arrayScalar), /"received"\s*:/i, 'Rejected shapes must not return the capture handler payload');

    const leadCall = await admin.callMcpTool('run_action', {
      actionName: 'sales_lead_convert_to_opportunity', objectName: 'forge_sales_lead', recordId: leadId,
      params: { amount: 125000, expected_close_on: '2026-10-30' },
    });
    assert.notEqual(leadCall?.isError, true, `Native run_action rejected objectOverride number/date values: ${mcpText(leadCall)}`);
    const leadCaptured = actionResult(mcpData(leadCall))?.received;
    assert.equal(typeof leadCaptured?.amount, 'number');
    assert.equal(leadCaptured?.expected_close_on, '2026-10-30');

    const quoteCall = await admin.callMcpTool('run_action', {
      actionName: 'quotation_adjust_line_price', objectName: 'forge_quotation', recordId: quotationId,
      params: { line_id: 'fixture-line', expected_pricing_version: 0, taxed_unit_price: 900.25, idempotency_key: randomUUID() },
    });
    assert.notEqual(quoteCall?.isError, true, `Native run_action rejected the existing quote number contract: ${mcpText(quoteCall)}`);
    const quoteCaptured = actionResult(mcpData(quoteCall))?.received;
    assert.equal(typeof quoteCaptured?.expected_pricing_version, 'number');
    assert.equal(typeof quoteCaptured?.taxed_unit_price, 'number');
    assert.equal(quoteCaptured?.line_id, 'fixture-line');
  } finally {
    await stopRuntime(child);
    await new Promise(resolve => portProbe.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});
