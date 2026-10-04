// Run the committed Nginx configuration against a local HTTP fixture.
//
//   NGINX_BIN=/path/to/nginx \
//   FORGE_TRANSPORT_UPSTREAM_PORT=4612 \
//   FORGE_TRANSPORT_PORT=14612 \
//   node tests/transport-smoke.mjs
//
// The fixture covers compressed and identity bodies, Vary merging, cache
// policy, ETag/304, auth headers, uploads, 404/HTML fallback and MCP/SSE timing.
// It never connects to Forge or a database.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NGINX_CONFIG = path.resolve(HERE, '../transport/nginx.conf');
const NGINX_BIN = process.env.NGINX_BIN || 'nginx';
const PROXY_PORT = Number(process.env.FORGE_TRANSPORT_PORT || 14612);
const UPSTREAM_PORT = Number(process.env.FORGE_TRANSPORT_UPSTREAM_PORT || 4612);
const LARGE_JS = '/* fixture */\n' + 'export const transportSmoke = true;\n'.repeat(600);
const LARGE_JSON = JSON.stringify({ rows: Array.from({ length: 500 }, (_, index) => ({ id: index, label: 'Permission row ' + index })) });
const LARGE_UPLOAD = Buffer.alloc(2 * 1024 * 1024, 0x46);
const OBSERVED = { auth: null, uploadBytes: 0, streamBody: '', streamPath: '' };

function response(res, status, headers, body = '') {
  res.writeHead(status, headers);
  res.end(body);
}

const fixture = createServer((req, res) => {
  const bodyParts = [];
  req.on('data', (part) => bodyParts.push(part));
  req.on('end', () => {
    const body = Buffer.concat(bodyParts);
    const pathname = new URL(req.url, 'http://fixture.local').pathname;
    const commonVary = 'Accept-Language, Origin';

    if (pathname === '/api/v1/health') {
      response(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ success: true }));
      return;
    }
    if (pathname === '/') {
      response(res, 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: '"html-v1"',
      }, '<html><body>' + 'Forge entry '.repeat(120) + '</body></html>');
      return;
    }
    if (pathname === '/assets/app-AbCdEfgh.js') {
      const headers = {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
        ETag: '"asset-v1"',
        Vary: commonVary,
      };
      if (['"asset-v1"', 'W/"asset-v1"'].includes(req.headers['if-none-match'])) response(res, 304, headers);
      else response(res, 200, headers, LARGE_JS);
      return;
    }
    if (pathname === '/assets/fallback-Qwerty123.js') {
      response(res, 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: '"fallback-v1"',
      }, '<html><body>SPA fallback</body></html>');
      return;
    }
    if (pathname === '/assets/missing-A1B2C3D4.css') {
      response(res, 404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
      }, '<html><body>Not found</body></html>');
      return;
    }
    if (pathname === '/assets/auth-AbCdEfgh.js') {
      response(res, 200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Set-Cookie': 'forge-session=fixture; Path=/; HttpOnly',
      }, LARGE_JS);
      return;
    }
    if (pathname === '/api/v1/meta/permissions') {
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        ETag: '"permission-v1"',
        Vary: commonVary,
      };
      if (['"permission-v1"', 'W/"permission-v1"'].includes(req.headers['if-none-match'])) response(res, 304, headers);
      else response(res, 200, headers, LARGE_JSON);
      return;
    }
    if (pathname === '/api/v1/meta/notice') {
      response(res, 200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600',
        'Set-Cookie': 'notice-seen=1; Path=/; HttpOnly',
      }, JSON.stringify({ notice: 'account-specific' }));
      return;
    }
    if (pathname === '/api/v1/auth/sign-in/email') {
      OBSERVED.auth = {
        method: req.method,
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
        body: body.toString('utf8'),
      };
      response(res, 401, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'WWW-Authenticate': 'Bearer realm="forge-fixture"',
        'Set-Cookie': 'login-attempt=seen; Path=/; HttpOnly',
      }, JSON.stringify({ error: 'fixture rejected sign-in' }));
      return;
    }
    if (pathname === '/api/v1/storage/upload') {
      OBSERVED.uploadBytes = body.length;
      response(res, 201, { 'Content-Type': 'application/json' }, JSON.stringify({ bytes: body.length }));
      return;
    }
    if (pathname === '/api/v1/mcp') {
      OBSERVED.streamBody = body.toString('utf8');
      OBSERVED.streamPath = req.url;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Vary: 'Accept-Language',
      });
      res.flushHeaders();
      res.write('event: ready\ndata: first\n\n');
      setTimeout(() => {
        res.write('event: done\ndata: second\n\n');
        res.end();
      }, 600);
      return;
    }
    response(res, 404, { 'Content-Type': 'text/html; charset=utf-8' }, '<html><body>Not found</body></html>');
  });
});

function request(pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: PROXY_PORT, path: pathname, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function pass(label) {
  console.log('PASS ' + label);
}

async function waitForProxy() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const result = await request('/_forge_transport_health');
      if (result.status === 204) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error('Nginx did not become ready: ' + (lastError?.message || 'health endpoint unavailable'));
}

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', resolve));
}

let tempDir;
let proxy;
let fixtureListening = false;
try {
  assert.ok(Number.isInteger(PROXY_PORT) && PROXY_PORT > 1024 && PROXY_PORT < 65536, 'FORGE_TRANSPORT_PORT must be an unused port above 1024');
  assert.ok(Number.isInteger(UPSTREAM_PORT) && UPSTREAM_PORT > 1024 && UPSTREAM_PORT < 65536, 'FORGE_TRANSPORT_UPSTREAM_PORT must be an unused port above 1024');
  assert.notEqual(PROXY_PORT, UPSTREAM_PORT, 'proxy and fixture ports must differ');

  tempDir = await mkdtemp(path.join(tmpdir(), 'forge-transport-smoke-'));
  await Promise.all(['client', 'logs', 'proxy'].map((name) => mkdir(path.join(tempDir, name))));

  await new Promise((resolve, reject) => {
    fixture.once('error', reject);
    fixture.listen(UPSTREAM_PORT, '127.0.0.1', resolve);
  });
  fixtureListening = true;

  const [dockerfile, composeFile, deployScript] = await Promise.all([
    readFile(path.resolve(HERE, '../Dockerfile'), 'utf8'),
    readFile(path.resolve(HERE, '../docker-compose.yml'), 'utf8'),
    readFile(path.resolve(HERE, '../scripts/deploy.sh'), 'utf8'),
  ]);
  const stages = [...dockerfile.matchAll(/^FROM\s+.*?\s+AS\s+([A-Za-z0-9_-]+)\s*$/gim)].map((match) => match[1]);
  assert.equal(stages.at(-1), 'app', 'plain docker buildx build must still produce the Forge app image');
  assert.ok(stages.includes('proxy'), 'Dockerfile must define a separately targetable proxy stage');
  assert.match(composeFile, /services:\s*\n\s+app:\s*[\s\S]*?target:\s*app/, 'Compose app build must explicitly target the app stage');
  assert.match(composeFile, /x-forge-proxy:[\s\S]*?target:\s*proxy/, 'Compose proxy build must explicitly target the proxy stage');
  assert.match(composeFile, /127\.0\.0\.1:\$\{FORGE_CANDIDATE_PORT:-14612\}:80/, 'candidate port must bind to loopback');
  assert.match(deployScript, /docker buildx build \\\n\s+--progress=plain \\\n\s+--target app/, 'deploy.sh must explicitly build the Forge app stage');
  assert.match(deployScript, /docker buildx build \\\n\s+--progress=plain \\\n\s+--target proxy/, 'deploy.sh must explicitly build the Nginx stage');
  assert.match(deployScript, /--build-context \"console94=\$CONSOLE_BUILD_CONTEXT\"/, 'deploy.sh must pass the verified Console context to Buildx');
  pass('Compose and deploy keep app/proxy image targets and loopback candidate separate');

  let serverConfig = await readFile(NGINX_CONFIG, 'utf8');
  assert.match(serverConfig, /^\s*server app:8080;\s*$/m, 'Nginx config must keep the app upstream private to Compose');
  assert.match(serverConfig, /^\s*listen 80;\s*$/m, 'Nginx config must listen on its container port');
  serverConfig = serverConfig
    .replace(/^\s*server app:8080;\s*$/m, '    server 127.0.0.1:' + UPSTREAM_PORT + ';')
    .replace(/^\s*listen 80;\s*$/m, '    listen 127.0.0.1:' + PROXY_PORT + ';');

  const includedConfig = path.join(tempDir, 'forge.conf');
  await writeFile(includedConfig, serverConfig);
  const nginxConfigPath = path.join(tempDir, 'nginx.conf');
  const configLines = [
    'worker_processes 1;',
    'pid ' + path.join(tempDir, 'nginx.pid') + ';',
    'error_log ' + path.join(tempDir, 'error.log') + ' info;',
    'events { worker_connections 512; }',
    'http {',
    '    default_type application/octet-stream;',
    '    access_log off;',
    '    client_body_temp_path ' + path.join(tempDir, 'client') + ';',
    '    proxy_temp_path ' + path.join(tempDir, 'proxy') + ';',
    '    include ' + includedConfig + ';',
    '}',
    '',
  ];
  await writeFile(nginxConfigPath, configLines.join('\n'));

  const nginxPrefix = tempDir.endsWith(path.sep) ? tempDir : tempDir + path.sep;
  const configCheck = spawnSync(NGINX_BIN, ['-p', nginxPrefix, '-t', '-c', nginxConfigPath], { encoding: 'utf8' });
  if (configCheck.error?.code === 'ENOENT') {
    throw new Error('Nginx binary not found (' + NGINX_BIN + '); set NGINX_BIN to a local or temporary-build nginx executable.');
  }
  assert.equal(configCheck.status, 0, 'nginx -t failed:\n' + configCheck.stdout + '\n' + configCheck.stderr);
  proxy = spawn(NGINX_BIN, ['-p', nginxPrefix, '-c', nginxConfigPath, '-g', 'daemon off;'], { stdio: 'ignore' });
  await waitForProxy();
  pass('candidate Nginx starts with the committed config');

  const html = await request('/', { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(html.status, 200);
  assert.match(String(html.headers['content-type']), /^text\/html/i);
  assert.equal(html.headers['cache-control'], 'private, no-cache');
  assert.equal(html.headers.etag, '"html-v1"');
  assert.equal(html.body.toString(), '<html><body>' + 'Forge entry '.repeat(120) + '</body></html>');
  pass('HTML fallback revalidates privately and keeps its ETag');

  const assetGzip = await request('/assets/app-AbCdEfgh.js', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(assetGzip.status, 200);
  assert.equal(assetGzip.headers['content-encoding'], 'gzip');
  assert.equal(assetGzip.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(assetGzip.headers.etag, 'W/"asset-v1"', 'gzip must weaken a strong upstream ETag for the transformed representation');
  assert.ok(assetGzip.body.length <= LARGE_JS.length * 0.4, 'gzip should reduce this repetitive text fixture by at least 60 percent');
  assert.match(assetGzip.headers.vary, /accept-language/i);
  assert.match(assetGzip.headers.vary, /origin/i);
  assert.match(assetGzip.headers.vary, /accept-encoding/i);
  assert.equal(gunzipSync(assetGzip.body).toString(), LARGE_JS);
  pass('hashed JS compresses, keeps its body/ETag, merges Vary and becomes immutable');

  const assetIdentity = await request('/assets/app-AbCdEfgh.js', { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(assetIdentity.status, 200);
  assert.equal(assetIdentity.headers['content-encoding'], undefined);
  assert.equal(assetIdentity.body.toString(), LARGE_JS);
  assert.equal(assetIdentity.headers.etag, '"asset-v1"');
  const assetNotModified = await request('/assets/app-AbCdEfgh.js', {
    headers: { 'Accept-Encoding': 'identity', 'If-None-Match': assetIdentity.headers.etag },
  });
  assert.equal(assetNotModified.status, 304);
  assert.equal(assetNotModified.body.length, 0);
  assert.equal(assetNotModified.headers.etag, '"asset-v1"');
  assert.equal(assetNotModified.headers['cache-control'], 'no-cache');
  const gzipNotModified = await request('/assets/app-AbCdEfgh.js', {
    headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': assetGzip.headers.etag },
  });
  assert.equal(gzipNotModified.status, 304);
  assert.equal(gzipNotModified.body.length, 0);
  assert.equal(gzipNotModified.headers.etag, '"asset-v1"');
  assert.equal(gzipNotModified.headers['cache-control'], 'no-cache');
  pass('identity and gzip conditional asset requests preserve 304 and representation-specific ETags');

  const htmlFallback = await request('/assets/fallback-Qwerty123.js', { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(htmlFallback.status, 200);
  assert.match(String(htmlFallback.headers['content-type']), /^text\/html/i);
  assert.equal(htmlFallback.headers['cache-control'], 'private, no-cache');
  assert.doesNotMatch(htmlFallback.headers['cache-control'], /immutable/);
  const missing = await request('/assets/missing-A1B2C3D4.css', { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers['cache-control'], 'no-store');
  assert.doesNotMatch(missing.headers['cache-control'], /immutable/);
  pass('hashed-looking HTML fallbacks and 404s never receive immutable caching');

  const credentialedAsset = await request('/assets/auth-AbCdEfgh.js', {
    headers: { Cookie: 'forge-session=account-a', 'Accept-Encoding': 'identity' },
  });
  assert.equal(credentialedAsset.status, 200);
  assert.equal(credentialedAsset.headers['cache-control'], 'no-store');
  assert.ok(credentialedAsset.headers['set-cookie']);
  pass('credentialed or Set-Cookie assets are not made public immutable');

  const permission = await request('/api/v1/meta/permissions', {
    headers: { Authorization: 'Bearer smoke-token', 'Accept-Encoding': 'gzip' },
  });
  assert.equal(permission.status, 200);
  assert.equal(permission.headers['content-encoding'], 'gzip');
  assert.equal(permission.headers['cache-control'], 'private, no-cache');
  assert.equal(gunzipSync(permission.body).toString(), LARGE_JSON);
  assert.match(permission.headers.vary, /accept-language/i);
  assert.match(permission.headers.vary, /origin/i);
  assert.match(permission.headers.vary, /accept-encoding/i);
  assert.equal(permission.headers.etag, 'W/"permission-v1"');
  const permissionNotModified = await request('/api/v1/meta/permissions', {
    headers: { Authorization: 'Bearer smoke-token', 'Accept-Encoding': 'identity', 'If-None-Match': '"permission-v1"' },
  });
  assert.equal(permissionNotModified.status, 304);
  assert.equal(permissionNotModified.body.length, 0);
  assert.equal(permissionNotModified.headers.etag, '"permission-v1"');
  const permissionGzipNotModified = await request('/api/v1/meta/permissions', {
    headers: { Authorization: 'Bearer smoke-token', 'Accept-Encoding': 'gzip', 'If-None-Match': permission.headers.etag },
  });
  assert.equal(permissionGzipNotModified.status, 304);
  assert.equal(permissionGzipNotModified.body.length, 0);
  assert.equal(permissionGzipNotModified.headers.etag, '"permission-v1"');
  assert.equal(permissionGzipNotModified.headers['cache-control'], 'private, no-cache');
  pass('permission JSON compresses privately and both identity/gzip validators retain 304');

  const cookieResponse = await request('/api/v1/meta/notice', { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(cookieResponse.status, 200);
  assert.equal(cookieResponse.headers['cache-control'], 'no-store');
  assert.ok(cookieResponse.headers['set-cookie']);
  pass('dynamic responses carrying Set-Cookie cannot pass through a public cache policy');

  const loginBody = JSON.stringify({ email: 'operator@example.test', password: 'test-only' });
  const login = await request('/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer original-auth-header',
      Cookie: 'existing-session=kept',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginBody),
      'Accept-Encoding': 'identity',
    },
    body: loginBody,
  });
  assert.equal(login.status, 401);
  assert.equal(OBSERVED.auth?.method, 'POST');
  assert.equal(OBSERVED.auth?.authorization, 'Bearer original-auth-header');
  assert.equal(OBSERVED.auth?.cookie, 'existing-session=kept');
  assert.equal(OBSERVED.auth?.body, loginBody);
  assert.equal(login.headers['www-authenticate'], 'Bearer realm="forge-fixture"');
  assert.ok(login.headers['set-cookie']);
  assert.equal(login.headers['cache-control'], 'no-store');
  pass('authentication status, credentials, challenge and cookies pass through');

  const upload = await request('/api/v1/storage/upload', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': LARGE_UPLOAD.length, 'Accept-Encoding': 'identity' },
    body: LARGE_UPLOAD,
  });
  assert.equal(upload.status, 201);
  assert.equal(OBSERVED.uploadBytes, LARGE_UPLOAD.length);
  assert.equal(JSON.parse(upload.body.toString()).bytes, LARGE_UPLOAD.length);
  assert.equal(upload.headers['cache-control'], 'no-store');
  pass('2 MiB upload passes without a proxy size limit or cache');

  const streamStarted = Date.now();
  const stream = await new Promise((resolve, reject) => {
    let firstChunkMs = null;
    const chunks = [];
    const req = httpRequest({
      host: '127.0.0.1', port: PROXY_PORT, path: '/api/v1/mcp?session=smoke', method: 'POST', agent: false,
      headers: {
        Accept: 'application/json, text/event-stream',
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength('{"method":"initialize"}'),
      },
    }, (res) => {
      res.on('data', (chunk) => {
        if (firstChunkMs === null) firstChunkMs = Date.now() - streamStarted;
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), firstChunkMs }));
    });
    req.on('error', reject);
    req.end('{"method":"initialize"}');
  });
  assert.equal(stream.status, 200);
  assert.ok(stream.firstChunkMs < 400, 'first MCP event took ' + stream.firstChunkMs + ' ms (buffering suspected)');
  assert.equal(stream.headers['content-encoding'], undefined);
  assert.match(String(stream.headers['content-type']), /^text\/event-stream/i);
  assert.equal(stream.headers['cache-control'], 'no-store');
  assert.equal(OBSERVED.streamBody, '{"method":"initialize"}');
  assert.equal(OBSERVED.streamPath, '/api/v1/mcp?session=smoke');
  assert.match(stream.body.toString(), /data: first/);
  assert.match(stream.body.toString(), /data: second/);
  pass('MCP/SSE stays uncompressed and unbuffered (first event in ' + stream.firstChunkMs + ' ms)');

  console.log('Nginx transport smoke passed.');
} catch (error) {
  if (tempDir) {
    try {
      const log = await readFile(path.join(tempDir, 'error.log'), 'utf8');
      if (log.trim()) console.error('Nginx log:\n' + log);
    } catch { /* no Nginx log */ }
  }
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  if (proxy && proxy.exitCode === null) {
    proxy.kill('SIGTERM');
    await Promise.race([waitForExit(proxy), delay(3000)]);
    if (proxy.exitCode === null) proxy.kill('SIGKILL');
  }
  if (fixtureListening) await new Promise((resolve) => fixture.close(resolve));
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
}
