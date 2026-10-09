import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, copyFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dependencies = process.env.FORGE_PROBE_NODE_MODULES;
if (!dependencies || !path.isAbsolute(dependencies)) throw new Error('Set FORGE_PROBE_NODE_MODULES to matching Forge dependencies');
const requireForge = createRequire(path.join(dependencies, '../package.json'));
const { Client } = requireForge('pg');
const { chromium } = createRequire(path.join(root, 'desktop/package.json'))('playwright');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'weave-oidc-bridge-'));
const app = path.join(temporary, 'platform/forge/apps/forge-objectstack');
const children = [], databases = [], checks = [], callbacks = new Map();
const secrets = [];
const password = () => { const value = randomBytes(24).toString('base64url'); secrets.push(value); return value; };
const account = { email: 'oidc-admin@example.test', password: password() };
const postgres = { host: '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || os.userInfo().username };
const adminDatabase = new Client({ ...postgres, database: 'postgres' });
let browser, callback, active = 'setup';
const check = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const envBase = { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, TMPDIR: process.env.TMPDIR };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const makePort = async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
async function createDatabase(prefix) {
  const name = `${prefix}_${randomBytes(6).toString('hex')}`;
  await adminDatabase.query(`CREATE DATABASE "${name}"`); databases.push(name);
  return `postgres://${encodeURIComponent(postgres.user)}@127.0.0.1:${postgres.port}/${name}`;
}
function start(binary, args, cwd, env) {
  const child = spawn(binary, args, { cwd, env: { ...envBase, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', data => { log = (log + data).slice(-50_000); });
  child.stderr.on('data', data => { log = (log + data).slice(-50_000); });
  children.push(child); return { child, log: () => log };
}
async function ready(process, url) {
  for (let i = 0; i < 120; i++) {
    if (process.child.exitCode !== null) {
      // Only report a diagnostic code; raw native startup logs can contain secrets.
      let diagnostic = process.log().split('\n').filter(line => /error|failed/i.test(line)).slice(-3).join('\n');
      for (const secret of secrets) diagnostic = diagnostic.replaceAll(secret, '<redacted>');
      diagnostic = diagnostic.replace(/[A-Za-z0-9_-]{30,}/g, '<opaque>').slice(0, 1800);
      throw new Error(`Local service exited ${process.child.exitCode}: ${diagnostic}`);
    }
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await pause(1000);
  }
  throw new Error('Local service readiness timeout');
}
async function request(origin, route, method = 'GET', body, token) {
  const response = await fetch(origin + route, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json', Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, value: await response.json().catch(() => null) };
}
function ok(result, label) { assert.ok(result.status >= 200 && result.status < 300, `${label}: HTTP ${result.status}, ${result.value?.error?.code ?? result.value?.code ?? ''}`); return result.value; }
try {
  await adminDatabase.connect();
  callback = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/callback') callbacks.set(url.searchParams.get('state'), { code: url.searchParams.get('code'), error: url.searchParams.get('error') });
    res.setHeader('Cache-Control', 'no-store'); res.end('Local login verification complete.');
  });
  await new Promise(resolve => callback.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${callback.address().port}/callback`;
  const archive = execFileSync('git', ['archive', 'HEAD', 'platform/forge/apps/forge-objectstack'], { cwd: root, maxBuffer: 100 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
  await symlink(dependencies, path.join(app, 'node_modules'), 'dir');
  const actualCli = JSON.parse(await readFile(path.join(dependencies, '@objectstack/cli/package.json'))).version;
  const expectedCli = JSON.parse(await readFile(path.join(app, 'package.json'))).devDependencies['@objectstack/cli'];
  assert.equal(actualCli, expectedCli, 'Installed CLI must match archived dependency version');
  await copyFile(path.join(here, 'session-bridge.mjs'), path.join(app, 'session-bridge.mjs'));
  const configuration = path.join(temporary, 'client.json');
  const auditFile = path.join(temporary, 'audit.jsonl');
  const original = await readFile(path.join(app, 'objectstack.config.ts'), 'utf8');
  await writeFile(path.join(app, 'objectstack.config.ts'), original.replace('export default defineStack(', 'const probeStack = defineStack(') + `
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { desktopOidcProbe } from './session-bridge.mjs';
import { nativeEmployee } from './src/plugins/native-task-auth.js';
probeStack.plugins.push({name:'local.probe.client-provisioning',init(context){context.hook('kernel:ready',()=>{
 context.getService('http.server').post('/api/v1/apps/forge/probe-provision-client',async(req,res)=>{
  const employee=await nativeEmployee(context,req);
  if(!employee.actor.permissions.includes('admin_full_access'))return res.status(403).json({error:{code:'FORBIDDEN'}});
  const api=await context.getService('auth').getApi();
  const client=await api.adminCreateOAuthClient({headers:new Headers(req.headers),body:{application_type:'native',client_name:'Weave 本地桌面登录验证',
    redirect_uris:[${JSON.stringify(redirectUri)}],grant_types:['authorization_code'],response_types:['code'],
    token_endpoint_auth_method:'none',scope:'openid profile email',enable_end_session:true,require_pkce:true}});
  writeFileSync(${JSON.stringify(configuration)},JSON.stringify({clientId:client.client_id,redirectUri:${JSON.stringify(redirectUri)}}),{mode:0o600});
  return res.status(200).json({configured:!!client.client_id});
 });
});}});
probeStack.plugins.push(desktopOidcProbe({ nativeEmployee,
  loadClient: () => JSON.parse(readFileSync(${JSON.stringify(configuration)}, 'utf8')),
  audit: (event) => appendFileSync(${JSON.stringify(auditFile)}, JSON.stringify(event) + '\\n', {mode:0o600}),
}));
export default probeStack;
`);
  const cli = path.join(app, 'node_modules/@objectstack/cli/bin/run.js');
  active = 'validate isolated stack';
  execFileSync(process.execPath, [cli, 'validate'], { cwd: app, env: { ...envBase, OS_HOME: path.join(temporary, 'validate-home') }, stdio: 'pipe', timeout: 120_000 });
  check('isolated stack metadata validation');
  active = 'build unchanged Weave';
  const weaveBinary = path.join(temporary, 'weave');
  execFileSync('go', ['build', '-o', weaveBinary, './cmd/weave'], { cwd: path.join(root, 'platform/weave'), stdio: 'pipe', timeout: 120_000 });
  const forgePort = await makePort(), weavePort = await makePort();
  const forge = `http://127.0.0.1:${forgePort}`, weave = `http://127.0.0.1:${weavePort}`;
  const forgeDatabase = await createDatabase('forge_oidc_probe'), weaveDatabase = await createDatabase('weave_oidc_probe');
  const forgeProcess = start(process.execPath, [cli, 'dev', '--seed-admin', '--port', String(forgePort), '--database-driver', 'postgres', '--admin-email', account.email,
    '--admin-password', account.password, '--auth-secret', password(), '--log-level', 'error'], app, {
    OS_HOME: path.join(temporary, 'os-home'), OS_DATABASE_URL: forgeDatabase, OS_SECRET_KEY: randomBytes(32).toString('hex'),
    OS_BASE_URL: forge, OS_TRUSTED_ORIGINS: forge, FORGE_IDENTITY_ISSUER: 'forge:oidc-bridge-probe', OS_ENVIRONMENT_ID: 'oidc-bridge-probe',
  });
  const weaveProcess = start(weaveBinary, [], temporary, { DATABASE_URL: `${weaveDatabase}?sslmode=disable`, JWT_SECRET: password(), WEAVE_SECRET_KEY: randomBytes(32).toString('hex'),
    PORT: String(weavePort), WEAVE_FORGE_SESSION_URL: forge + '/api/v1/auth/get-session', WEAVE_FORGE_DEFAULT_WORKSPACE: 'oidc-probe',
    WEAVE_WORKSPACES_ROOT: path.join(temporary, 'workspaces'), WEAVE_DISABLE_LOCAL_LOGIN: 'true', WEAVE_LOCAL_RUNTIME_ENABLED: 'false', LOG_LEVEL: 'error',
  });
  active = 'start isolated services';
  await Promise.all([ready(forgeProcess, forge + '/api/v1/health'), ready(weaveProcess, weave + '/v1/health')]);
  check('real Forge and unchanged Weave with isolated PostgreSQL');
  const register = async (name) => ok(await request(forge, '/api/v1/auth/oauth2/register', 'POST', {
    application_type: 'native', client_name: name, redirect_uris: [redirectUri], grant_types: ['authorization_code'], response_types: ['code'],
    token_endpoint_auth_method: 'none', scope: 'openid profile email', enable_end_session: true,
  }), 'native client registration');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const apiBase = '/api/v1/apps/forge/desktop-oidc-probe';
  const login = async (credentials) => ok(await request(forge, '/api/v1/auth/sign-in/email', 'POST', credentials), 'native control login');
  const admin = await login(account);
  active = 'provision first-party client through native admin API';
  ok(await request(forge, '/api/v1/apps/forge/probe-provision-client', 'POST', {}, admin.token), 'native client provisioning');
  const configuredClient = JSON.parse(await readFile(configuration, 'utf8'));
  assert.ok(configuredClient.clientId, 'native server-side provisioning must return a client');
  const adminSession = ok(await request(forge, '/api/v1/auth/get-session', 'GET', undefined, admin.token), 'native session');
  const organizationId = adminSession.session.activeOrganizationId;
  const member = { email: 'oidc-member@example.test', password: password() };
  active = 'create ordinary member';
  const created = ok(await request(forge, '/api/v1/auth/admin/create-user', 'POST', { ...member, name: '本地普通员工', role: 'user', mustChangePassword: false }, admin.token), 'create member');
  member.userId = created.data?.user?.id ?? created.user?.id; assert.ok(member.userId, 'native create-user must identify member');
  ok(await request(forge, '/api/v1/auth/admin/set-user-password', 'POST', { userId: member.userId, newPassword: member.password, mustChangePassword: false }, admin.token), 'set fixture password');
  // Native create-user already enrolls the user in this single-organization fixture.
  const memberLogin = await login({ email: member.email, password: member.password });
  ok(await request(forge, '/api/v1/auth/organization/set-active', 'POST', { organizationId }, memberLogin.token), 'select fixture organization');
  async function begin(verifier = randomBytes(32).toString('base64url')) {
    const flow = ok(await request(forge, apiBase + '/start', 'POST', { codeChallenge: createHash('sha256').update(verifier).digest('base64url') }), 'start bridge');
    return { ...flow, verifier };
  }
  async function authorize(flow, credentials, rewrite) {
    const context = await browser.newContext(), page = await context.newPage();
    const url = new URL(flow.authorizationUrl); if (rewrite) rewrite(url);
    await page.goto(url.href);
    await page.locator('input[type=email]').fill(credentials.email);
    await page.locator('input[type=password]').fill(credentials.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    let consentClicked = false;
    // Native OIDC reuses prior consent; repeated logins may return directly.
    for (let i = 0; i < 150 && !callbacks.has(flow.state); i++) {
      const consent = page.getByRole('button', { name: '授权', exact: true });
      if (!consentClicked && await consent.isVisible()) { await consent.click(); consentClicked = true; }
      await pause(100);
    }
    const result = callbacks.get(flow.state); assert.ok(result?.code && !result.error, 'browser must return a matching state and authorization code');
    callbacks.delete(flow.state);
    return { context, page, code: result.code };
  }
  const exchange = (flow, code, extra = {}) => request(forge, apiBase + '/exchange', 'POST', { flowId: flow.flowId, code, codeVerifier: flow.verifier, ...extra });
  const paths = ['/api/v1/notifications', '/api/v1/workbench/business-work', '/api/v1/workbench/business-actions/catalog', '/api/v1/workbench/approvals', '/api/v1/data/forge_sales_lead'];
  async function verifySession(credentials, control, label) {
    active = `${label} browser and exchange`;
    const flow = await begin(), authorized = await authorize(flow, credentials);
    const responses = await Promise.all([exchange(flow, authorized.code), exchange(flow, authorized.code)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 401], 'one concurrent exchange must win');
    const issued = responses.find(r => r.status === 200).value;
    assert.ok(issued.token && issued.token !== control.token, 'desktop session must be independently issued');
    const oldSession = ok(await request(forge, '/api/v1/auth/get-session', 'GET', undefined, control.token), 'control identity');
    const newSession = ok(await request(forge, '/api/v1/auth/get-session', 'GET', undefined, issued.token), 'bridge identity');
    assert.ok(newSession.user.id === oldSession.user.id && newSession.session.activeOrganizationId === oldSession.session.activeOrganizationId, 'identity and organization must match');
    const before = ok(await request(forge, '/api/v1/auth/me/permissions', 'GET', undefined, control.token), 'control permissions');
    const after = ok(await request(forge, '/api/v1/auth/me/permissions', 'GET', undefined, issued.token), 'bridge permissions');
    assert.deepEqual(after.permissionSets, before.permissionSets, 'native permission sets must remain unchanged');
    const readStatuses = [];
    for (const route of paths) {
      const old = await request(forge, route, 'GET', undefined, control.token), current = await request(forge, route, 'GET', undefined, issued.token);
      assert.equal(current.status, old.status, `${label} ${route} permission outcome must match`);
      assert.notEqual(current.status, 401, `${label} ${route} must recognize desktop session`);
      readStatuses.push(current.status);
    }
    console.log(`READ_MATRIX ${label}: ${readStatuses.join(',')}`);
    const first = ok(await request(weave, '/v1/auth/external/exchange', 'POST', undefined, control.token), 'native Weave binding');
    const second = ok(await request(weave, '/v1/auth/external/exchange', 'POST', undefined, issued.token), 'OIDC Weave binding');
    assert.ok(first.subject.id === second.subject.id && Boolean(second.token), 'unchanged Weave must bind same account');
    if (label === 'member') {
      const privileged = await request(forge, '/api/v1/auth/admin/create-user', 'POST', {
        email: 'must-not-create@example.test', name: '无权操作验证', password: password(), role: 'user',
      }, issued.token);
      assert.equal(privileged.status, 403, 'ordinary member must not acquire administrator actions');
    }
    check(`${label}: browser PKCE -> independent native session -> five business reads -> same Weave identity; unchanged permissions`);
    ok(await request(forge, '/api/v1/auth/sign-out', 'POST', {}, issued.token), 'desktop sign-out');
    const signedOut = await request(forge, '/api/v1/auth/get-session', 'GET', undefined, issued.token);
    assert.ok(signedOut.status === 401 || !signedOut.value?.user, 'desktop session must be invalid');
    const browserStillSignedIn = await authorized.context.request.get(forge + '/api/v1/auth/get-session');
    assert.ok((await browserStillSignedIn.json())?.user?.id, 'desktop logout must not revoke browser session');
    await authorized.context.close(); check(`${label}: concurrent replay rejected; desktop logout preserves browser login`);
  }
  await verifySession(account, admin, 'admin');
  await verifySession(member, memberLogin, 'member');
  active = 'negative authentication checks';
  const cancelled = await begin(); ok(await request(forge, apiBase + '/cancel', 'POST', { flowId: cancelled.flowId }), 'cancel');
  assert.equal((await exchange(cancelled, 'unused')).status, 401); check('cancelled flow rejected');
  const pkce = await begin(), pkceBrowser = await authorize(pkce, member);
  assert.equal((await exchange(pkce, pkceBrowser.code, { codeVerifier: 'x'.repeat(43) })).status, 401);
  assert.equal((await exchange(pkce, pkceBrowser.code, { userId: admin.user.id })).status, 400);
  await request(forge, apiBase + '/cancel', 'POST', { flowId: pkce.flowId }); await pkceBrowser.context.close();
  check('wrong PKCE and caller-supplied identity rejected');
  const nonce = await begin(), nonceBrowser = await authorize(nonce, member, url => url.searchParams.set('nonce', 'wrong-nonce'));
  assert.equal((await exchange(nonce, nonceBrowser.code)).status, 401); await nonceBrowser.context.close(); check('wrong ID-token nonce rejected');
  const other = await register('另一个本地客户端'), wrongClient = await begin();
  const otherBrowser = await authorize(wrongClient, member, url => url.searchParams.set('client_id', other.client_id));
  assert.equal((await exchange(wrongClient, otherBrowser.code)).status, 401); await otherBrowser.context.close(); check('authorization code from another client rejected');
  const revoked = await begin(), revokedBrowser = await authorize(revoked, member);
  const logout = await revokedBrowser.context.request.post(forge + '/api/v1/auth/sign-out', { data: {}, headers: { Origin: forge } }); assert.equal(logout.status(), 200);
  assert.equal((await exchange(revoked, revokedBrowser.code)).status, 401); await revokedBrowser.context.close(); check('revoked source browser session rejected');
  const banned = await begin(), bannedBrowser = await authorize(banned, member);
  ok(await request(forge, '/api/v1/auth/admin/ban-user', 'POST', { userId: member.userId, banReason: '本地隔离撤销验证' }, admin.token), 'ban fixture employee');
  const refused = await exchange(banned, bannedBrowser.code); assert.ok([401, 403].includes(refused.status), 'disabled member must not receive desktop session');
  await bannedBrowser.context.close(); check('disabled employee rejected');
  const audits = (await readFile(auditFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(audits.filter(row => row.event === 'issued').length, 2, 'only two positive cases issue a session');
  assert.ok(!/(password|token|nonce|verifier|authorizationCode)"\s*:/.test(JSON.stringify(audits)), 'audit contains no credentials');
  check('native session issuance audit: exactly two successful identities, no credentials');
  console.log(JSON.stringify({ result: 'PASS', checks: checks.length, node: process.version, objectstack: actualCli, source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }));
} catch (error) {
  // Assertions use only status/boolean/small non-secret projections.
  let diagnostic = String(error?.message ?? 'unknown failure');
  for (const secret of secrets) diagnostic = diagnostic.replaceAll(secret, '<redacted>');
  diagnostic = diagnostic.replace(/https?:\/\/[^\s]+/g, '<local URL>');
  console.error(`FAIL ${active}: ${diagnostic}`);
  try {
    const rows = (await readFile(path.join(temporary, 'audit.jsonl'), 'utf8')).trim().split('\n').map(row => JSON.parse(row));
    console.error('AUDIT', rows.slice(-4).map(({ event, status, reason }) => ({ event, status, reason })));
  } catch {}
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (callback) await new Promise(resolve => callback.close(resolve));
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await pause(1000);
  for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  for (const database of databases) {
    await adminDatabase.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
    await adminDatabase.query(`DROP DATABASE IF EXISTS "${database}"`);
  }
  await adminDatabase.end();
  await rm(temporary, { recursive: true, force: true });
  console.log(`CLEANUP stopped ${children.length} isolated services; dropped ${databases.length} databases; removed temporary credentials and source copy`);
}
