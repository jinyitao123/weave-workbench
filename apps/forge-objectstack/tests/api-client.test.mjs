import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { connect } from '../scripts/api-client.mjs';

test('local acceptance API client requires an explicit password and never echoes it', async () => {
  const hadPassword = Object.hasOwn(process.env, 'FORGE_TEST_PASSWORD');
  const previousPassword = process.env.FORGE_TEST_PASSWORD;
  const hadEmail = Object.hasOwn(process.env, 'FORGE_TEST_EMAIL');
  const previousEmail = process.env.FORGE_TEST_EMAIL;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    delete process.env.FORGE_TEST_PASSWORD;
    process.env.FORGE_TEST_EMAIL = 'acceptance@example.invalid';
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return Response.json({ user: { id: 'unexpected' } });
    };

    await assert.rejects(connect('http://localhost:4310'), /FORGE_TEST_PASSWORD is required/);
    assert.equal(fetchCalls, 0);

    process.env.FORGE_TEST_PASSWORD = `acceptance-${randomUUID()}`;
    await assert.rejects(connect('https://forge.example.invalid'), /only permits a local Forge server/);
    await assert.rejects(connect('file:///tmp/forge-test'), /requires HTTP or HTTPS/);
    await assert.rejects(connect(`http://acceptance:${process.env.FORGE_TEST_PASSWORD}@localhost:4310`), (error) => {
      assert.equal(error.message.includes(process.env.FORGE_TEST_PASSWORD), false);
      return true;
    });
    assert.equal(fetchCalls, 0);

    const password = process.env.FORGE_TEST_PASSWORD;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      if (requests.length === 1) {
        return Response.json(
          { user: { id: 'local-test-user' } },
          { status: 200, headers: { 'Set-Cookie': 'session=local-test-session; Path=/; HttpOnly' } },
        );
      }
      return Response.json({ ok: true }, { status: 200 });
    };

    const client = await connect('http://localhost:4310');
    assert.equal(client.userId, 'local-test-user');
    const loginBody = JSON.parse(requests[0].options.body);
    assert.equal(loginBody.password === password, true);
    assert.equal(requests[0].url, 'http://localhost:4310/api/v1/auth/sign-in/email');
    assert.equal(requests[0].options.redirect, 'error');
    assert.equal(requests[0].options.headers.Origin, 'http://localhost:4310');
    const result = await client.request('/acceptance-probe');
    assert.equal(result.status, 200);
    assert.deepEqual(result.value, { ok: true });
    assert.equal(requests[1].options.redirect, 'error');
    assert.equal(requests[1].options.headers.Origin, 'http://localhost:4310');
    assert.equal(requests[1].options.headers.cookie, 'session=local-test-session');

    const failedPassword = `failed-${randomUUID()}`;
    process.env.FORGE_TEST_PASSWORD = failedPassword;
    globalThis.fetch = async () => Response.json({ message: 'unauthorized' }, { status: 401 });
    await assert.rejects(connect('http://127.0.0.1:4310'), (error) => {
      assert.equal(error.message, 'Login failed: HTTP 401');
      assert.equal(error.message.includes(failedPassword), false);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (hadPassword) process.env.FORGE_TEST_PASSWORD = previousPassword;
    else delete process.env.FORGE_TEST_PASSWORD;
    if (hadEmail) process.env.FORGE_TEST_EMAIL = previousEmail;
    else delete process.env.FORGE_TEST_EMAIL;
  }
});

test('HTTP 307 redirects never forward login or API credentials to a second origin', async () => {
  const hadPassword = Object.hasOwn(process.env, 'FORGE_TEST_PASSWORD');
  const previousPassword = process.env.FORGE_TEST_PASSWORD;
  const hadEmail = Object.hasOwn(process.env, 'FORGE_TEST_EMAIL');
  const previousEmail = process.env.FORGE_TEST_EMAIL;
  const password = `redirect-${randomUUID()}`;
  process.env.FORGE_TEST_PASSWORD = password;
  process.env.FORGE_TEST_EMAIL = 'redirect-test@example.invalid';
  const downstreamRequests = [];
  const primaryRequests = [];
  let authAttempts = 0;
  const downstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    downstreamRequests.push({
      path: request.url,
      cookie: request.headers.cookie ?? '',
      body: Buffer.concat(chunks).toString('utf8'),
    });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"received":true}');
  });
  const primary = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    primaryRequests.push({ path: request.url, origin: request.headers.origin ?? '', cookie: request.headers.cookie ?? '', body });
    if (request.url === '/api/v1/auth/sign-in/email' && authAttempts === 0) {
      authAttempts += 1;
      response.writeHead(307, { Location: `http://127.0.0.1:${downstream.address().port}/auth-capture` });
      response.end();
      return;
    }
    if (request.url === '/api/v1/auth/sign-in/email') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=primary-session; Path=/; HttpOnly' });
      response.end('{"user":{"id":"primary-user"}}');
      return;
    }
    if (request.url === '/api/v1/redirect') {
      response.writeHead(307, { Location: `http://127.0.0.1:${downstream.address().port}/api-capture` });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end('{}');
  });

  const listen = async (server) => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  };
  const close = async (server) => {
    if (!server.listening) return;
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  };

  try {
    await listen(downstream);
    await listen(primary);
    const base = `http://127.0.0.1:${primary.address().port}`;
    await assert.rejects(connect(base), (error) => {
      assert.equal(error.message.includes(password), false);
      return true;
    });
    assert.equal(primaryRequests[0].body.includes(password), true);
    assert.equal(primaryRequests[0].origin, base);
    assert.equal(downstreamRequests.length, 0);

    const client = await connect(base);
    assert.equal(client.userId, 'primary-user');
    await assert.rejects(client.request('/redirect'));
    assert.equal(primaryRequests[2].origin, base);
    assert.equal(primaryRequests[2].cookie.includes('session=primary-session'), true);
    assert.equal(downstreamRequests.length, 0);
  } finally {
    await Promise.all([close(primary), close(downstream)]);
    if (hadPassword) process.env.FORGE_TEST_PASSWORD = previousPassword;
    else delete process.env.FORGE_TEST_PASSWORD;
    if (hadEmail) process.env.FORGE_TEST_EMAIL = previousEmail;
    else delete process.env.FORGE_TEST_EMAIL;
  }
});
