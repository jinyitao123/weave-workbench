import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import test from 'node:test';
import { Project, ProjectMember, ProjectPlan, ProjectWorkItem, ProjectDailyReport, ProjectCostEntry } from '../src/objects/project.object.ts';
import { ProjectSettlement } from '../src/objects/finance.object.ts';
import { ProjectMemberPositionAssignment } from '../src/objects/project-member-position-assignment.object.ts';
import { Bom, BomNode } from '../src/objects/bom.object.ts';
import { createProjectMembershipRlsResolver, projectPositionReadScopeKey } from '../src/plugins/project-rls-membership.plugin.ts';

const requireFromTest = createRequire(import.meta.url);
const requireFromCli = createRequire(requireFromTest.resolve('@objectstack/cli'));
const betterAuthCrypto = await import(pathToFileURL(requireFromCli.resolve('better-auth/crypto')).href);
const hashPassword = betterAuthCrypto.hashPassword;

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const DATABASE_PORT = Number(process.env.FORGE_INTEGRATION_PG_PORT || 5432);
const RUNTIME_PORT = 4636;
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 14);
const DATABASE = 'forge_project_position_' + RUN_ID.toLowerCase();
const ORIGIN = `http://127.0.0.1:${RUNTIME_PORT}`;
const SECRET_KEY = randomBytes(32).toString('hex');
const AUTH_SECRET = randomBytes(32).toString('hex');
const TRANSIENT_SECRETS = [];
const POSITION_ROLE_NAMES = {
  manager: 'project_manager_' + RUN_ID.toLowerCase(),
  technical: 'hardware_engineer_' + RUN_ID.toLowerCase(),
};

function safeOutput(output) {
  let safe = String(output || '').replaceAll(SECRET_KEY, '[temporary secret key omitted]').replaceAll(AUTH_SECRET, '[temporary auth secret omitted]');
  for (const secret of TRANSIENT_SECRETS) if (secret) safe = safe.replaceAll(secret, '[temporary password omitted]');
  return safe.slice(-7000);
}

function id() { return randomUUID(); }

function rowMatches(row, where = {}) {
  if (!where || typeof where !== 'object') return true;
  if (Array.isArray(where.$and) && !where.$and.every(part => rowMatches(row, part))) return false;
  if (Array.isArray(where.$or) && !where.$or.some(part => rowMatches(row, part))) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === '$and' || key === '$or') return true;
    const actual = row[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$in' in value && !value.$in.includes(actual)) return false;
      if ('$eq' in value && actual !== value.$eq) return false;
      if ('$ne' in value && actual === value.$ne) return false;
      if ('$gte' in value && String(actual) < String(value.$gte)) return false;
      if ('$lt' in value && String(actual) >= String(value.$lt)) return false;
      return true;
    }
    return actual === value;
  });
}

test('project position RLS is enforced through official Runtime, PostgreSQL and ordinary REST callers', { timeout: 300_000 }, async t => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-project-position-rls-'));
  let databaseCreated = false;
  let postgres;
  let child;
  let output = '';
  let organizationId = '';
  let fixtureActorId = '';
  const schemas = new Map();
  const employees = [];
  let syntheticClientIp = 20;

  const portProbe = createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(RUNTIME_PORT, '127.0.0.1', resolve);
  });
  await new Promise(resolve => portProbe.close(resolve));

  await run('createdb', ['-h', '127.0.0.1', '-p', String(DATABASE_PORT), DATABASE]);
  databaseCreated = true;
  const databaseUrl = `postgresql://${encodeURIComponent(os.userInfo().username)}@127.0.0.1:${DATABASE_PORT}/${DATABASE}`;
  postgres = new Client({ connectionString: databaseUrl });
  await postgres.connect();

  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve));
      child.kill('SIGTERM');
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 10_000))]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await closed;
      }
    }
    await postgres?.end().catch(() => {});
    if (databaseCreated) await run('dropdb', ['-h', '127.0.0.1', '-p', String(DATABASE_PORT), DATABASE]).catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-project-position-rls-test","type":"module"}\n');
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `export { default } from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};\n`);
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');
  child = spawn(process.execPath, [
    path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'),
    'serve', 'objectstack.config.ts', '--port', String(RUNTIME_PORT), '--log-level', 'error',
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      OS_HOME: path.join(tempDir, '.os-home'),
      OS_DATABASE_URL: databaseUrl,
      OS_SECRET_KEY: SECRET_KEY,
      OS_AUTH_SECRET: AUTH_SECRET,
      OS_BASE_URL: ORIGIN,
      OS_TRUSTED_ORIGINS: ORIGIN,
      OS_ENVIRONMENT_ID: `project-position-rls-${RUN_ID}`,
      OS_TENANCY_POSTURE: 'single',
      OS_SEED_ADMIN: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-9000); });
  child.stderr.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-9000); });

  const deadline = Date.now() + 150_000;
  let health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated official Runtime exited (${child.exitCode}).\n${safeOutput(output)}`);
    try {
      health = await fetch(`${ORIGIN}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(health?.ok, `Official Runtime on ${RUNTIME_PORT} did not become ready.\n${safeOutput(output)}`);

  async function signIn(email, password) {
    const clientIp = `198.51.100.${syntheticClientIp++}`;
    const response = await fetch(`${ORIGIN}/api/v1/auth/sign-in/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Forwarded-For': clientIp },
      body: JSON.stringify({ email, password }),
    });
    const value = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, `Sign-in returned HTTP ${response.status}; code=${String(value.code || '')}; message=${String(value.message || value.error || '').slice(0, 120)}\n${safeOutput(output)}`);
    const cookie = response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    assert.ok(value.user?.id && cookie, 'Native sign-in must issue an ordinary session');
    return { id: value.user.id, cookie };
  }

  function apiFor(client) {
    return {
      id: client.id,
      async request(resource, method = 'GET', body) {
        const response = await fetch(`${ORIGIN}/api/v1${resource}`, {
          method,
          headers: { Cookie: client.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, value: await response.json().catch(() => null) };
      },
      async raw(resource, method = 'GET') {
        return fetch(`${ORIGIN}/api/v1${resource}`, { method, headers: { Cookie: client.cookie } });
      },
    };
  }

  async function tableSchema(tableName) {
    if (schemas.has(tableName)) return schemas.get(tableName);
    const result = await postgres.query(`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
    `, [tableName]);
    assert.ok(result.rows.length, `Runtime must register native object table ${tableName}`);
    const value = new Map(result.rows.map(row => [row.column_name, row]));
    schemas.set(tableName, value);
    return value;
  }

  async function insertFixture(tableName, values) {
    const definition = await tableSchema(tableName);
    const now = new Date().toISOString();
    const candidate = { id: id(), created_at: now, updated_at: now, ...values };
    if (!tableName.startsWith('sys_')) {
      if (fixtureActorId) {
        candidate.created_by ??= fixtureActorId;
        candidate.updated_by ??= fixtureActorId;
        candidate.owner_id ??= fixtureActorId;
      }
      if (organizationId && candidate.organization_id === undefined) candidate.organization_id = organizationId;
    }
    const columns = [...definition.keys()].filter(name => candidate[name] !== undefined);
    const missing = [...definition.entries()].filter(([name, column]) =>
      column.is_nullable === 'NO' && column.column_default == null && !columns.includes(name),
    ).map(([name]) => name);
    assert.deepEqual(missing, [], `Fixture fields for ${tableName} must satisfy its registered PostgreSQL schema`);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const quotedColumns = columns.map(name => `"${name.replaceAll('"', '""')}"`).join(', ');
    await postgres.query(`INSERT INTO "${tableName}" (${quotedColumns}) VALUES (${placeholders})`, columns.map(name => candidate[name]));
    return candidate.id;
  }

  async function createNativeCaller(label) {
    const email = `project-position-${label}-${RUN_ID}@example.test`;
    const password = `Employee-${randomBytes(24).toString('hex')}!`;
    TRANSIENT_SECRETS.push(password);
    const userId = id();
    const hashedPassword = await hashPassword(password);
    await insertFixture('sys_user', {
      id: userId, name: `项目权限隔离${label}`, email, email_verified: true, banned: false, role: 'user', organization_id: null,
    });
    await insertFixture('sys_account', {
      user_id: userId, provider_id: 'credential', account_id: userId, password: hashedPassword,
      access_token: null, refresh_token: null, id_token: null,
    });
    await insertFixture('sys_member', { user_id: userId, organization_id: organizationId, role: 'member' });
    const storedUser = await postgres.query('SELECT id, email_verified, banned FROM sys_user WHERE id = $1', [userId]);
    const storedAccount = await postgres.query('SELECT user_id, provider_id, account_id, (password IS NOT NULL) AS has_password FROM sys_account WHERE user_id = $1', [userId]);
    const passwordCheck = storedAccount.rows[0]?.has_password
      ? await betterAuthCrypto.verifyPassword({ hash: hashedPassword, password }) : false;
    assert.ok(storedUser.rows.length === 1 && storedAccount.rows.length === 1 && passwordCheck,
      'Synthetic native identity has a real user, local credential account and official BetterAuth hash');
    const client = apiFor(await signIn(email, password));
    assert.equal(client.id, userId, 'The HTTP session resolves to the native sys_user row');
    employees.push(userId);
    return { id: userId, client };
  }

  organizationId = await insertFixture('sys_organization', {
    name: `项目岗位隔离组织-${RUN_ID}`, slug: `project-position-${RUN_ID.toLowerCase()}`,
  });
  const manager = await createNativeCaller('manager');
  fixtureActorId = manager.id;
  const technician = await createNativeCaller('technician');
  const legacyManager = await createNativeCaller('legacy-manager');
  const projectBManager = await createNativeCaller('project-b-manager');
  const productionOperator = await createNativeCaller('production-operator');

  async function createPosition(positionName, permissionSetNames) {
    const positionId = await insertFixture('sys_position', {
      name: positionName, label: `隔离验证${positionName}`, active: true,
    });
    const ids = await postgres.query('SELECT id, name FROM sys_permission_set WHERE name = ANY($1::text[])', [permissionSetNames]);
    const byName = new Map(ids.rows.map(row => [row.name, row.id]));
    assert.deepEqual(permissionSetNames.filter(name => !byName.has(name)), [], 'Application PermissionSets are loaded by the official Runtime');
    for (const permissionName of permissionSetNames) await insertFixture('sys_position_permission_set', {
      position_id: positionId, permission_set_id: byName.get(permissionName),
    });
    return positionId;
  }

  async function appoint(userId, positionName) {
    await insertFixture('sys_user_position', {
      user_id: userId, position: positionName, organization_id: organizationId, active: true,
      valid_from: new Date(Date.now() - 60_000).toISOString(), valid_until: null,
    });
  }

  const managerPositionId = await createPosition(POSITION_ROLE_NAMES.manager, ['forge_project_operator', 'forge_project_manager']);
  const technicalPositionId = await createPosition(POSITION_ROLE_NAMES.technical, ['forge_solution_operator']);
  const productionPositionName = 'production_operator_' + RUN_ID.toLowerCase();
  await createPosition(productionPositionName, ['forge_production_operator']);
  await appoint(manager.id, POSITION_ROLE_NAMES.manager);
  await appoint(manager.id, POSITION_ROLE_NAMES.technical);
  await appoint(technician.id, POSITION_ROLE_NAMES.technical);
  await appoint(legacyManager.id, POSITION_ROLE_NAMES.manager);
  await appoint(productionOperator.id, productionPositionName);

  const categoryId = await insertFixture('forge_customer_category', { name: '项目岗位隔离类别', code: 'PPR-' + RUN_ID, status: 'active' });
  const customerId = await insertFixture('forge_customer', { name: '项目岗位隔离客户', category_id: categoryId, responsible_id: fixtureActorId, status: 'active' });
  const typeId = await insertFixture('forge_project_type', { name: '项目岗位隔离类型', code: 'PPT-' + RUN_ID, active: true });
  const projectA = await insertFixture('forge_project', {
    name: '项目岗位隔离A', type_id: typeId, customer_id: customerId,
    manager_id: manager.id, status: 'in_progress', planned_start_on: '2026-10-01', planned_end_on: '2026-10-31',
  });
  const projectB = await insertFixture('forge_project', {
    name: '项目岗位隔离B', type_id: typeId, customer_id: customerId,
    manager_id: projectBManager.id, status: 'in_progress', planned_start_on: '2026-10-01', planned_end_on: '2026-10-31',
  });
  const memberManagerA = await insertFixture('forge_project_member', {
    name: '项目经理A', membership_key: `${RUN_ID}:manager-a`, project_id: projectA,
    user_id: manager.id, member_duty: 'manager', joined_on: '2026-10-01', active: true,
  });
  const memberManagerB = await insertFixture('forge_project_member', {
    name: '项目经理兼技术成员B', membership_key: `${RUN_ID}:manager-b`, project_id: projectB,
    user_id: manager.id, member_duty: 'member', joined_on: '2026-10-01', active: true,
  });
  const memberTechnicianB = await insertFixture('forge_project_member', {
    name: '技术成员B', membership_key: `${RUN_ID}:technician-b`, project_id: projectB,
    user_id: technician.id, member_duty: 'member', joined_on: '2026-10-01', active: true,
  });
  const assignmentManagerA = await insertFixture('forge_project_member_position_assignment', {
    name: '项目A经理岗位', assignment_key: `${RUN_ID}:assignment-manager-a`, project_id: projectA,
    member_id: memberManagerA, position_id: managerPositionId, position_name_snapshot: POSITION_ROLE_NAMES.manager,
    is_default: true, active: true, assigned_at: new Date().toISOString(),
  });
  await insertFixture('forge_project_member_position_assignment', {
    name: '项目B技术岗位-经理', assignment_key: `${RUN_ID}:assignment-manager-b`, project_id: projectB,
    member_id: memberManagerB, position_id: technicalPositionId, position_name_snapshot: POSITION_ROLE_NAMES.technical,
    is_default: true, active: true, assigned_at: new Date().toISOString(),
  });
  const assignmentTechnicianB = await insertFixture('forge_project_member_position_assignment', {
    name: '项目B技术岗位', assignment_key: `${RUN_ID}:assignment-technician-b`, project_id: projectB,
    member_id: memberTechnicianB, position_id: technicalPositionId, position_name_snapshot: POSITION_ROLE_NAMES.technical,
    is_default: true, active: true, assigned_at: new Date().toISOString(),
  });

  const planA = await insertFixture('forge_project_plan', {
    name: '项目A计划', plan_key: RUN_ID + 'PLAN-A', project_id: projectA, source: 'manual', revision: 1,
    planned_start_on: '2026-10-01', planned_end_on: '2026-10-31', status: 'active',
  });
  const planB = await insertFixture('forge_project_plan', {
    name: '项目B计划', plan_key: RUN_ID + 'PLAN-B', project_id: projectB, source: 'manual', revision: 1,
    planned_start_on: '2026-10-01', planned_end_on: '2026-10-31', status: 'active',
  });
  const phaseA = await insertFixture('forge_project_work_item', {
    name: '项目A阶段', item_key: RUN_ID + 'PHASE-A', project_id: projectA, plan_id: planA,
    item_type: 'phase', planned_start_on: '2026-10-01', planned_end_on: '2026-10-31', status: 'pending',
  });
  const phaseB = await insertFixture('forge_project_work_item', {
    name: '项目B阶段', item_key: RUN_ID + 'PHASE-B', project_id: projectB, plan_id: planB,
    item_type: 'phase', planned_start_on: '2026-10-01', planned_end_on: '2026-10-31', status: 'pending',
  });
  const taskA = await insertFixture('forge_project_work_item', {
    name: '项目A技术任务', item_key: RUN_ID + 'TASK-A', project_id: projectA, plan_id: planA,
    item_type: 'task', parent_id: phaseA, priority: 'medium', owner_id: manager.id, planned_start_on: '2026-10-01',
    planned_end_on: '2026-10-10', status: 'pending',
  });
  const taskB = await insertFixture('forge_project_work_item', {
    name: '项目B技术任务', item_key: RUN_ID + 'TASK-B', project_id: projectB, plan_id: planB,
    item_type: 'task', parent_id: phaseB, priority: 'medium', owner_id: technician.id, owner_position_assignment_id: assignmentTechnicianB,
    planned_start_on: '2026-10-01', planned_end_on: '2026-10-10', status: 'pending',
  });
  const taskBPeer = await insertFixture('forge_project_work_item', {
    name: '项目B同事任务', item_key: RUN_ID + 'TASK-B-PEER', project_id: projectB, plan_id: planB,
    item_type: 'task', parent_id: phaseB, priority: 'medium', owner_id: manager.id,
    planned_start_on: '2026-10-01', planned_end_on: '2026-10-12', status: 'pending',
  });
  const bomA = await insertFixture('forge_bom', {
    name: '项目A BOM', code: RUN_ID + 'BOM-A', product_name: '隔离设备A', bom_type: '项目',
    version: 'V1.0', project_id: projectA, status: 'active',
  });
  const bomB = await insertFixture('forge_bom', {
    name: '项目B BOM', code: RUN_ID + 'BOM-B', product_name: '隔离设备B', bom_type: '项目',
    version: 'V1.0', project_id: projectB, status: 'active',
  });
  const bomNodeA = await insertFixture('forge_bom_node', {
    name: '项目A BOM子项', bom_id: bomA, parent_id: null, node_type: '物料', quantity: 1,
    is_key_part: false, is_leaf: true, bom_status: 'active',
  });
  const bomNodeB = await insertFixture('forge_bom_node', {
    name: '项目B BOM子项', bom_id: bomB, parent_id: null, node_type: '物料', quantity: 1,
    is_key_part: false, is_leaf: true, bom_status: 'active',
  });
  const costA = await insertFixture('forge_project_cost_entry', {
    name: '项目A成本', code: RUN_ID + 'COST-A', project_id: projectA, customer_id: customerId,
    source_type: 'manual', cost_type: 'other',
    source_id: RUN_ID + 'SRC-A', occurred_on: '2026-10-03', total_amount: 100, allocated_amount: 100,
    remaining_amount: 0, status: 'allocated', responsible_id: fixtureActorId,
  });
  const costB = await insertFixture('forge_project_cost_entry', {
    name: '项目B成本', code: RUN_ID + 'COST-B', project_id: projectB, customer_id: customerId,
    source_type: 'manual', cost_type: 'other',
    source_id: RUN_ID + 'SRC-B', occurred_on: '2026-10-03', total_amount: 200, allocated_amount: 200,
    remaining_amount: 0, status: 'allocated', responsible_id: fixtureActorId,
  });
  const settlementA = await insertFixture('forge_project_settlement', {
    name: '项目A结算', code: RUN_ID + 'SET-A', project_id: projectA, settled_on: '2026-10-03',
    contract_amount: 1000, invoiced_amount: 1000, collected_amount: 1000, production_cost: 100,
    labor_cost: 0, manufacturing_cost: 0, travel_cost: 0, subcontract_cost: 0, other_cost: 0,
    total_cost: 100, gross_margin: 900, gross_margin_rate: 90, status: 'settled', responsible_id: manager.id,
  });
  const settlementB = await insertFixture('forge_project_settlement', {
    name: '项目B结算', code: RUN_ID + 'SET-B', project_id: projectB, settled_on: '2026-10-03',
    contract_amount: 2000, invoiced_amount: 2000, collected_amount: 2000, production_cost: 200,
    labor_cost: 0, manufacturing_cost: 0, travel_cost: 0, subcontract_cost: 0, other_cost: 0,
    total_cost: 200, gross_margin: 1800, gross_margin_rate: 90, status: 'settled', responsible_id: projectBManager.id,
  });
  const organizationB = await insertFixture('sys_organization', {
    name: `项目岗位隔离外部组织-${RUN_ID}`, slug: `project-position-outside-${RUN_ID.toLowerCase()}`,
  });
  const categoryB = await insertFixture('forge_customer_category', {
    name: '外部组织客户类别', code: 'PPX-' + RUN_ID, status: 'active', organization_id: organizationB,
  });
  const customerB = await insertFixture('forge_customer', {
    name: '外部组织客户', category_id: categoryB, responsible_id: manager.id, status: 'active', organization_id: organizationB,
  });
  const typeB = await insertFixture('forge_project_type', {
    name: '外部组织项目类型', code: 'PPX-T-' + RUN_ID, active: true, organization_id: organizationB,
  });
  const projectOutsideOrg = await insertFixture('forge_project', {
    name: '外部组织项目', type_id: typeB, customer_id: customerB, manager_id: manager.id,
    status: 'in_progress', planned_start_on: '2026-10-01', planned_end_on: '2026-10-31', organization_id: organizationB,
  });
  const costOutsideOrg = await insertFixture('forge_project_cost_entry', {
    name: '外部组织成本', code: RUN_ID + 'COST-X', project_id: projectOutsideOrg, customer_id: customerB,
    source_type: 'manual', cost_type: 'other', source_id: RUN_ID + 'SRC-X', occurred_on: '2026-10-03',
    total_amount: 300, allocated_amount: 300, remaining_amount: 0, status: 'allocated', responsible_id: manager.id,
    organization_id: organizationB,
  });

  const managerApi = manager.client;
  const technicianApi = technician.client;
  const legacyManagerApi = legacyManager.client;
  const productionApi = productionOperator.client;
  const permissionRead = await managerApi.request('/auth/me/permissions');
  assert.equal(permissionRead.status, 200, 'manager permission context is resolved by the official auth runtime');
  const technicianPermissionRead = await technicianApi.request('/auth/me/permissions');
  const productionPermissionRead = await productionApi.request('/auth/me/permissions');
  const technicianSession = await technicianApi.request('/auth/get-session');
  const taskOwnership = await postgres.query('SELECT owner_id = $1 AS owner_matches, project_id = $2 AS project_matches, organization_id = $3 AS organization_matches FROM forge_project_work_item WHERE id = $4', [technician.id, projectB, organizationId, taskB]);
  const resolvedAuth = permissionRead.value?.data || permissionRead.value || {};
  const resolvedTechnicianAuth = technicianPermissionRead.value?.data || technicianPermissionRead.value || {};
  const resolvedProductionAuth = productionPermissionRead.value?.data || productionPermissionRead.value || {};
  t.diagnostic(`runtime identity summary ${JSON.stringify({
    systemPermissions: resolvedAuth.systemPermissions || [],
    permissionSets: (resolvedAuth.permissionSets || []).map(row => row.name || row),
    positions: resolvedAuth.positions || [],
    technician: {
      systemPermissions: resolvedTechnicianAuth.systemPermissions || [],
      permissionSets: (resolvedTechnicianAuth.permissionSets || []).map(row => row.name || row),
      positions: resolvedTechnicianAuth.positions || [],
      sessionUserMatches: (technicianSession.value?.user?.id || technicianSession.value?.data?.user?.id) === technician.id,
      taskOwnership: taskOwnership.rows[0],
    },
    production: {
      systemPermissions: resolvedProductionAuth.systemPermissions || [],
      permissionSets: (resolvedProductionAuth.permissionSets || []).map(row => row.name || row),
      positions: resolvedProductionAuth.positions || [],
    },
  })}`);

  const rlsSchemas = [Project, ProjectMember, ProjectPlan, ProjectWorkItem, ProjectDailyReport, ProjectCostEntry, ProjectSettlement, ProjectMemberPositionAssignment, Bom, BomNode];
  const resolverCalls = [];
  const scopedEngine = {
    getSchema(objectName) { return rlsSchemas.find(schema => schema.name === objectName); },
    async find(objectName, query = {}) {
      const fields = query.fields || ['id'];
      const quoted = fields.map(field => `"${String(field).replaceAll('"', '""')}"`).join(', ');
      const result = await postgres.query(`SELECT ${quoted} FROM "${objectName.replaceAll('"', '""')}"`);
      const rows = result.rows.filter(row => rowMatches(row, query.where || {}));
      resolverCalls.push({ object: objectName, count: rows.length });
      if (Array.isArray(query.orderBy)) for (const sort of [...query.orderBy].reverse()) {
        rows.sort((a, b) => String(a[sort.field] ?? '').localeCompare(String(b[sort.field] ?? '')) * (sort.order === 'desc' ? -1 : 1));
      }
      return rows.slice(query.offset || 0, (query.offset || 0) + (query.limit || rows.length));
    },
  };
  const projectScopeResolver = createProjectMembershipRlsResolver(() => scopedEngine);
  const appointmentProbe = await postgres.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE user_id = $1)::int AS for_user, count(*) FILTER (WHERE user_id = $1 AND organization_id = $2)::int AS for_org FROM sys_user_position', [technician.id, organizationId]);
  const resolvedTechnicianScopes = await projectScopeResolver.resolve({
    userId: technician.id, tenantId: organizationId, accessible_org_ids: [organizationId],
    positions: resolvedTechnicianAuth.positions || [], permissions: resolvedTechnicianAuth.systemPermissions || [],
  });
  t.diagnostic(`PostgreSQL-backed position row IDs ${JSON.stringify({
    tasks: resolvedTechnicianScopes[projectPositionReadScopeKey('forge_project_work_item')],
    bomNodes: resolvedTechnicianScopes[projectPositionReadScopeKey('forge_bom_node')],
  })}; appointment probe ${JSON.stringify(appointmentProbe.rows[0])}; resolver reads ${JSON.stringify(resolverCalls)}`);
  assert.deepEqual(resolvedTechnicianScopes[projectPositionReadScopeKey('forge_project_work_item')].sort(), [phaseB, taskB, taskBPeer].sort());
  assert.deepEqual(resolvedTechnicianScopes[projectPositionReadScopeKey('forge_bom_node')], [], 'the project technical PermissionSet has no BOM grant');

  async function listIds(client, objectName) {
    const params = new URLSearchParams({ '$top': '1000' });
    const response = await client.request(`/data/${objectName}?${params}`);
    if (response.status >= 400) return { status: response.status, ids: [], code: response.value?.code };
    return { status: response.status, ids: (response.value?.records || response.value?.data?.records || []).map(row => row.id), code: null };
  }

  await t.test('ordinary project manager can download only managed task, cost and settlement rows with Native stream metadata', async () => {
    const filter = { $and: [{ project_id: projectA }, { item_type: { $in: ['task', 'milestone'] } }] };
    const countQuery = new URLSearchParams({ '$top': '1', '$skip': '0', '$count': 'true', '$orderby': 'id asc', '$filter': JSON.stringify(filter) });
    const count = await managerApi.request('/data/forge_project_work_item?' + countQuery);
    assert.equal(count.status, 200);
    const total = Number(count.value?.totalCount ?? count.value?.count ?? count.value?.total ?? count.value?.['@odata.count']);
    assert.equal(total, 1, 'native count applies project RLS and the selected project filter');
    const params = new URLSearchParams({ format: 'csv', limit: String(total), orderby: 'planned_end_on:asc,id:asc', fields: 'name,item_key,item_type,priority,planned_start_on,planned_end_on,estimated_hours,status' });
    params.set('filter', JSON.stringify(filter));
    const download = await managerApi.raw('/data/forge_project_work_item/export?' + params);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type') || '', /text\/csv/i);
    assert.equal(download.headers.get('X-Export-Limit'), '1');
    const bytes = Buffer.from(await download.arrayBuffer());
    const csv = bytes.toString('utf8');
    assert.ok(bytes.length > 0, 'ordinary HTTP download has CSV bytes');
    assert.match(csv, /项目A技术任务/);
    assert.doesNotMatch(csv, /项目B技术任务/);
    assert.doesNotMatch(csv, /owner_position_assignment_id|approval_flow_run_id_snapshot/, 'the requested export field projection omits internal columns');

    const costFilter = { $and: [{ project_id: projectA }, { source_type: 'manual' }, { status: 'allocated' }] };
    const costParams = new URLSearchParams({ format: 'csv', limit: '1', orderby: 'occurred_on:desc,id:asc', fields: 'code,name,project_id,source_type,cost_type,occurred_on,allocated_amount,status' });
    costParams.set('filter', JSON.stringify(costFilter));
    const costDownload = await managerApi.raw('/data/forge_project_cost_entry/export?' + costParams);
    assert.equal(costDownload.status, 200);
    assert.equal(costDownload.headers.get('X-Export-Limit'), '1');
    const costCsv = Buffer.from(await costDownload.arrayBuffer()).toString('utf8');
    assert.match(costCsv, /项目A成本/);
    assert.doesNotMatch(costCsv, /项目B成本/);

    const settlementFilter = { $and: [{ status: 'settled' }, { project_id: projectA }, { settled_on: { $gte: '2026-10-01' } }, { settled_on: { $lte: '2026-10-04' } }] };
    const settlementParams = new URLSearchParams({ format: 'csv', limit: '1', orderby: 'settled_on:desc,id:asc', fields: 'code,project_id,settled_on,contract_amount,invoiced_amount,collected_amount,production_cost,total_cost,gross_margin,status' });
    settlementParams.set('filter', JSON.stringify(settlementFilter));
    const settlementDownload = await managerApi.raw('/data/forge_project_settlement/export?' + settlementParams);
    assert.equal(settlementDownload.status, 200, 'the project manager can export own managed-project settlement facts');
    assert.equal(settlementDownload.headers.get('X-Export-Limit'), '1');
    const settlementCsv = Buffer.from(await settlementDownload.arrayBuffer()).toString('utf8');
    assert.ok(settlementCsv.includes('SET-A') || settlementCsv.includes(RUN_ID + 'SET-A'));
    assert.doesNotMatch(settlementCsv, /SET-B/);

    const deniedParams = new URLSearchParams({ format: 'csv', limit: '1', fields: 'code,name,allocated_amount,status' });
    deniedParams.set('filter', JSON.stringify({ project_id: projectB }));
    const denied = await technicianApi.raw('/data/forge_project_cost_entry/export?' + deniedParams);
    assert.ok(denied.status >= 400, 'a technical project member cannot export cost rows');
    assert.notEqual(denied.headers.get('content-type')?.split(';')[0], 'text/csv', 'a denied export never returns a CSV file');
  });

  await t.test('work member can update only their own current-project task and manager scope stays separate', async () => {
    const params = { progress: 40, status: 'in_progress', actual_start_on: '2026-10-04' };
    const coworker = await technicianApi.request('/actions/forge_project_work_item/project_work_item_update_progress/' + taskA, 'POST', { params });
    assert.ok(coworker.status >= 400, 'a work member cannot update a task from another project');
    const sameProjectCoworker = await technicianApi.request('/actions/forge_project_work_item/project_work_item_update_progress/' + taskBPeer, 'POST', { params });
    assert.ok(sameProjectCoworker.status >= 400, 'a work member cannot update a different owner’s task in the same project');
    const saved = await technicianApi.request('/actions/forge_project_work_item/project_work_item_update_progress/' + taskB, 'POST', { params });
    assert.equal(saved.status, 200, JSON.stringify(saved.value));
    const readback = await technicianApi.request('/data/forge_project_work_item/' + encodeURIComponent(taskB));
    assert.equal(readback.status, 200);
    const item = readback.value?.record || readback.value?.data?.record || readback.value?.data;
    assert.equal(Number(item.progress), 40, 'the real ordinary B session reads back its own completed action');
  });

  await t.test('work member submits only their own project daily report; manager reads only the managed project', async () => {
    const body = { params: { work_item_id: taskB, reporter_id: technician.id, report_on: '2026-10-04', completed_today: '完成接口联调', completion_percent: 40, expected_finish_changed: false } };
    const created = await technicianApi.request('/actions/forge_project_plan/project_plan_submit_daily_report/' + planB, 'POST', body);
    assert.equal(created.status, 200, JSON.stringify(created.value));
    const reportId = created.value?.result?.id || created.value?.data?.result?.id || created.value?.data?.id || created.value?.id;
    assert.ok(reportId, 'the ordinary WorkMember action returned the persisted daily report id: ' + JSON.stringify(created.value));
    const visibleToOwner = await listIds(technicianApi, 'forge_project_daily_report');
    assert.equal(visibleToOwner.status, 200);
    assert.ok(visibleToOwner.ids.includes(reportId), 'the reporter reads the report they created');
    const visibleToManager = await listIds(managerApi, 'forge_project_daily_report');
    assert.equal(visibleToManager.status, 200);
    const report = await managerApi.request('/data/forge_project_daily_report/' + encodeURIComponent(reportId));
    assert.equal(report.status, 404, 'manager A cannot read project B report');
    const reportIds = await listIds(managerApi, 'forge_project_daily_report');
    assert.ok(!reportIds.ids.includes(reportId), 'manager daily-report row scope excludes project B');
  });

  await t.test('manager A reads only A cost even while a separate technical position is assigned on B', async () => {
    const visible = await listIds(managerApi, 'forge_project_cost_entry');
    assert.equal(visible.status, 200, 'ordinary manager REST request is authorized');
    assert.deepEqual(visible.ids.filter(value => value === costA || value === costB || value === costOutsideOrg).sort(), [costA]);
  });

  await t.test('manager REST scope rejects same-person records from an unadmitted organization', async () => {
    const visible = await listIds(managerApi, 'forge_project_cost_entry');
    assert.equal(visible.status, 200);
    assert.ok(!visible.ids.includes(costOutsideOrg), 'an accessible organization does not admit a different native organization');
  });

  await t.test('technician B reads its complete project plan tree but no other project or cost', async () => {
    const tasks = await listIds(technicianApi, 'forge_project_work_item');
    assert.equal(tasks.status, 200, 'ordinary technician REST request has the native task read grant');
    assert.deepEqual(tasks.ids.filter(value => [phaseA, phaseB, taskA, taskB, taskBPeer].includes(value)).sort(), [phaseB, taskB, taskBPeer].sort(),
      'the project member can read the parent phase and every row needed for the own project tree, while project A stays excluded');
    const phaseReadback = await technicianApi.request('/data/forge_project_work_item/' + encodeURIComponent(phaseB));
    assert.equal(phaseReadback.status, 200, 'ordinary plan-page record lookup can read the B parent phase');
    const foreignPhase = await technicianApi.request('/data/forge_project_work_item/' + encodeURIComponent(phaseA));
    assert.equal(foreignPhase.status, 404, 'the same lookup hides an unrelated project phase');
    const costs = await listIds(technicianApi, 'forge_project_cost_entry');
    assert.ok(costs.status >= 400 || !costs.ids.some(value => value === costA || value === costB), 'project work membership does not grant cost access');
  });

  await t.test('technical B does not gain BOM access from its task assignment', async () => {
    const nodes = await listIds(technicianApi, 'forge_bom_node');
    assert.ok(nodes.status >= 400 || !nodes.ids.some(value => value === bomNodeA || value === bomNodeB));
    const costs = await listIds(technicianApi, 'forge_project_cost_entry');
    assert.ok(costs.status >= 400 || !costs.ids.some(value => value === costA || value === costB));
  });

  await t.test('explicit production position retains native organization-wide BOM reads', async () => {
    assert.ok((resolvedProductionAuth.systemPermissions || []).includes('forge_production_operator'));
    const nodes = await listIds(productionApi, 'forge_bom_node');
    assert.equal(nodes.status, 200, 'native production PermissionSet grants organization-wide BOM child reads');
    assert.deepEqual(nodes.ids.filter(value => value === bomNodeA || value === bomNodeB).sort(), [bomNodeA, bomNodeB].sort());
    const costs = await listIds(productionApi, 'forge_project_cost_entry');
    assert.ok(costs.status >= 400 || !costs.ids.some(value => value === costA || value === costB));
    const tasks = await listIds(productionApi, 'forge_project_work_item');
    assert.ok(tasks.status >= 400 || !tasks.ids.some(value => value === taskA || value === taskB));
  });

  await t.test('manager without project position assignment still reads its managed project cost', async () => {
    await postgres.query('UPDATE forge_project SET manager_id = $1 WHERE id = $2', [legacyManager.id, projectA]);
    const visible = await listIds(legacyManagerApi, 'forge_project_cost_entry');
    assert.equal(visible.status, 200, 'native project manager PermissionSet remains effective without local position assignment');
    assert.deepEqual(visible.ids.filter(value => value === costA || value === costB), [costA]);
    const team = await listIds(legacyManagerApi, 'forge_project_member');
    assert.equal(team.status, 200, 'project manager can read current managed project team through native manager scope');
    assert.ok(team.ids.includes(memberManagerA), 'manager can read the member row attached to the managed project without a project-position assignment');
    assert.ok(!team.ids.includes(memberManagerB) && !team.ids.includes(memberTechnicianB), 'manager team visibility remains restricted to managed project A');
    const settlements = await listIds(legacyManagerApi, 'forge_project_settlement');
    assert.equal(settlements.status, 200, 'legacy manager with no project position assignment can read managed settlement records');
    assert.deepEqual(settlements.ids.filter(value => value === settlementA || value === settlementB), [settlementA]);
    const formerManager = await listIds(managerApi, 'forge_project_cost_entry');
    assert.ok(formerManager.status >= 400 || !formerManager.ids.includes(costA), 'manager change revokes the old manager read');
  });

  await t.test('raw project-position assignment CRUD stays denied to ordinary employees', async () => {
    const body = {
      name: '未经授权的项目岗位', assignment_key: RUN_ID + 'UNAUTH', project_id: projectB,
      member_id: memberTechnicianB, position_id: technicalPositionId, position_name_snapshot: POSITION_ROLE_NAMES.technical,
      is_default: false, active: true, assigned_at: new Date().toISOString(), organization_id: organizationId,
    };
    const created = await technicianApi.request('/data/forge_project_member_position_assignment', 'POST', body);
    const changed = await technicianApi.request(`/data/forge_project_member_position_assignment/${assignmentTechnicianB}`, 'PATCH', { active: false });
    const deleted = await technicianApi.request(`/data/forge_project_member_position_assignment/${assignmentTechnicianB}`, 'DELETE');
    assert.ok(created.status >= 400, `raw create returned HTTP ${created.status}`);
    assert.ok(changed.status >= 400, `raw update returned HTTP ${changed.status}`);
    assert.ok(deleted.status >= 400, `raw delete returned HTTP ${deleted.status}`);
  });

  await t.test('member and native position revocation shrink ordinary REST reads on the next request', async () => {
    let before = await listIds(technicianApi, 'forge_project_work_item');
    assert.ok(before.ids.includes(taskB));
    await postgres.query('UPDATE forge_project_member SET active = false WHERE id = $1', [memberTechnicianB]);
    let afterMemberRevocation = await listIds(technicianApi, 'forge_project_work_item');
    assert.ok(afterMemberRevocation.status >= 400 || !afterMemberRevocation.ids.includes(taskB));
    const progressAfterMemberRevocation = await technicianApi.request('/actions/forge_project_work_item/project_work_item_update_progress/' + taskB, 'POST', { params: { progress: 75, status: 'in_progress', actual_start_on: '2026-10-04' } });
    assert.ok(progressAfterMemberRevocation.status >= 400, 'the trusted progress Action rejects immediately after membership revocation');
    await postgres.query('UPDATE forge_project_member SET active = true WHERE id = $1', [memberTechnicianB]);
    before = await listIds(technicianApi, 'forge_project_work_item');
    assert.ok(before.ids.includes(taskB), 'reactivating the real project membership restores only its current position scope');
    await postgres.query('UPDATE sys_user_position SET valid_until = $1 WHERE user_id = $2 AND position = $3 AND organization_id = $4', [new Date(Date.now() - 1000).toISOString(), technician.id, POSITION_ROLE_NAMES.technical, organizationId]);
    const afterAppointmentRevocation = await listIds(technicianApi, 'forge_project_work_item');
    assert.ok(afterAppointmentRevocation.status >= 400 || !afterAppointmentRevocation.ids.includes(taskB));
    const progressAfterAppointmentRevocation = await technicianApi.request('/actions/forge_project_work_item/project_work_item_update_progress/' + taskB, 'POST', { params: { progress: 80, status: 'in_progress', actual_start_on: '2026-10-04' } });
    assert.ok(progressAfterAppointmentRevocation.status >= 400, 'revoked native appointment cannot call the trusted progress Action');
  });

  await t.test('native Approval Center and decision REST routes resolve at the current paths', async () => {
    const list = await legacyManagerApi.request('/approvals/requests');
    assert.equal(list.status, 200, 'GET /api/v1/approvals/requests is mounted by the official REST plugin');
    const decision = await legacyManagerApi.request('/approvals/requests/' + id() + '/approve', 'POST', {});
    assert.equal(decision.status, 500, JSON.stringify(decision.value));
    assert.equal(decision.value?.code, 'APPROVAL_APPROVE_FAILED', '17.5 POST approve reached the official decision wrapper rather than an unregistered page route');
    assert.match(decision.value?.error || '', /NOT_FOUND/, 'the native decision service refused the missing request; 17.5 wraps this refusal as HTTP 500');
  });

  t.diagnostic(`isolated database ${DATABASE}; official runtime port ${RUNTIME_PORT}; temporary objects use current native schemas`);
  assert.ok(manager.id && technician.id && legacyManager.id && productionOperator.id && managerPositionId && technicalPositionId && taskA && taskB && bomNodeA && bomNodeB && costA && costB && settlementA && settlementB && costOutsideOrg);
  assert.ok(employees.length === 5);
  void assignmentManagerA;
});
