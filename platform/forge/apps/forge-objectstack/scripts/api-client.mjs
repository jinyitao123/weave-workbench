/** Require an explicitly configured secret for local acceptance logins. */
export function requireTestPassword() {
  const password = process.env.FORGE_TEST_PASSWORD;
  if (!password) throw new Error('FORGE_TEST_PASSWORD is required for local acceptance tests.');
  return password;
}

/** Local acceptance client. Sends credentials only to an allowed loopback server. */
export async function connect(base = process.env.FORGE_URL || 'http://localhost:4310') {
  let target;
  try {
    target = new URL(base);
  } catch {
    throw new Error('Acceptance client requires a valid local HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Acceptance client requires HTTP or HTTPS without embedded credentials.');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('Acceptance client only permits a local Forge server');
  const origin = target.origin;
  const response = await fetch(`${base}/api/v1/auth/sign-in/email`, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: process.env.FORGE_TEST_EMAIL || 'admin@objectos.ai', password: requireTestPassword() }),
  });
  const login = await response.json();
  if (!response.ok || !login.user?.id) throw new Error(`Login failed: HTTP ${response.status}`);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function request(path, method = 'GET', body, authenticated = true) {
    const response = await fetch(`${base}/api/v1${path}`, {
      method, redirect: 'error', headers: { Origin: origin, ...(authenticated ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    return { status: response.status, value };
  }
  return { userId: login.user.id, request };
}
