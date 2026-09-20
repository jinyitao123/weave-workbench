/** Local acceptance client. Never serializes passwords, tokens or cookies. */
export async function connect(base = process.env.FORGE_URL || 'http://localhost:4310') {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Acceptance client only permits a local Forge server');
  const origin = new URL(base).origin;
  const response = await fetch(`${base}/api/v1/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: process.env.FORGE_TEST_EMAIL || 'admin@objectos.ai', password: process.env.FORGE_TEST_PASSWORD || 'admin123' }),
  });
  const login = await response.json();
  if (!response.ok || !login.user?.id) throw new Error(`Login failed: HTTP ${response.status}`);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function request(path, method = 'GET', body, authenticated = true) {
    const response = await fetch(`${base}/api/v1${path}`, {
      method, headers: { ...(authenticated ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    return { status: response.status, value };
  }
  return { userId: login.user.id, request };
}
