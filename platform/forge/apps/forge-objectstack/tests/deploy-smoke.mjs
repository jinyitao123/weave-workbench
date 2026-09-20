// Deployment smoke test for a running Forge instance.
//
// Why this exists: the Console SPA is a separate, prebuilt artifact that ships
// inside the platform runtime image, while the menus come from this repo's
// metadata artifact. A deployment can therefore be healthy, serve the right
// menus, and still render the wrong thing because the image carried an older
// Console build — or because a stray row makes an auth endpoint fail and the
// Console never leaves its "initializing" splash. Each check below was added
// after exactly that failure happened on the live box.
//
// Usage:
//   FORGE_URL=http://<host> \
//   FORGE_SMOKE_EMAIL=<admin email> FORGE_SMOKE_PASSWORD=<password> \
//   FORGE_EXPECTED_CONSOLE_ASSET=index-XXXXXXXX.js \
//   node tests/deploy-smoke.mjs
//
// Optional:
//   FORGE_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright/index.mjs
//     enables the UI leg (login + deep link + active menu trail). Skipped when
//     Playwright is unavailable, so the HTTP legs still run anywhere.
//
// Exit code is non-zero when any check fails: a failed check is a failed
// deployment, not a warning.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.FORGE_URL || '').replace(/\/$/, '');
assert.ok(BASE, 'FORGE_URL is required, e.g. FORGE_URL=http://127.0.0.1:8080');

const EMAIL = process.env.FORGE_SMOKE_EMAIL || '';
const PASSWORD = process.env.FORGE_SMOKE_PASSWORD || '';
const EXPECTED_ASSET = process.env.FORGE_EXPECTED_CONSOLE_ASSET || '';
const DEEP_LINK_PATH = process.env.FORGE_SMOKE_DEEP_LINK
  || '/_console/apps/forge/page/page_purchase_request_pool';
const DEEP_LINK_TEXT = process.env.FORGE_SMOKE_DEEP_LINK_TEXT || '采购申请';

const results = [];
const pass = (name) => { results.push(`PASS ${name}`); };
const skip = (name, why) => { results.push(`SKIP ${name} — ${why}`); };

async function request(pathname, options = {}) {
  // Anonymous browser requests land on /_console/login with a 302, so the
  // caller chooses whether to follow; everything else wants the raw status.
  const { follow = false, ...init } = options;
  const response = await fetch(BASE + pathname, { ...init, redirect: follow ? 'follow' : 'manual' });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty body */ }
  return { status: response.status, text, json };
}

// 1. The runtime answers at all.
const health = await request('/api/v1/health');
assert.equal(health.status, 200, `health returned ${health.status}`);
assert.equal(health.json?.success, true, 'health payload is not ok');
pass('runtime health is 200');

// 2. The Console we expect is the Console being served. Without this, a rebuilt
//    image silently reverts to its bundled SPA and every path-mapping fix is gone.
const index = await request('/', { follow: true });
assert.equal(index.status, 200, `console index returned ${index.status}`);
const servedAsset = /index-[A-Za-z0-9_-]+\.js/.exec(index.text)?.[0] || '';
assert.ok(servedAsset, 'console index does not reference an entry bundle');
if (EXPECTED_ASSET) {
  assert.equal(servedAsset, EXPECTED_ASSET, `served console bundle ${servedAsset} != expected ${EXPECTED_ASSET}`);
  pass(`console bundle matches the expected build (${servedAsset})`);
} else {
  results.push(`INFO console bundle served: ${servedAsset} (set FORGE_EXPECTED_CONSOLE_ASSET to pin it)`);
}

// 3. Sign-in works with the browser's Origin header. A base URL that does not
//    match the public address makes every first-party login fail INVALID_ORIGIN.
let token = '';
if (EMAIL && PASSWORD) {
  const origin = new URL(BASE).origin;
  const signIn = await request('/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Referer: origin + '/' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(signIn.status, 200, `sign-in returned ${signIn.status}: ${signIn.text.slice(0, 160)}`);
  token = signIn.json?.token || '';
  assert.ok(token, 'sign-in returned no token');
  pass(`sign-in succeeds from origin ${origin}`);
} else {
  skip('sign-in and authenticated checks', 'FORGE_SMOKE_EMAIL/FORGE_SMOKE_PASSWORD not set');
}

const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

if (token) {
  // 4. The Console's initialization gates. A 500 here parks the SPA on its
  //    splash screen forever, which looks like "menus are broken" to a user.
  for (const endpoint of ['/api/v1/runtime/config', '/api/v1/auth/organization/get-full-organization', '/api/v1/auth/me/permissions']) {
    const response = await request(endpoint, { headers: authHeaders });
    assert.equal(response.status, 200, `${endpoint} returned ${response.status}: ${response.text.slice(0, 160)}`);
    pass(`${endpoint} is 200`);
  }

  // 5. Menus on the live instance must equal the menus in this build. Catches a
  //    stale artifact and a navigation entry whose page name drifted.
  const liveApps = await request('/api/v1/meta/apps', { headers: authHeaders });
  assert.equal(liveApps.status, 200, `meta/apps returned ${liveApps.status}`);
  const liveApp = (liveApps.json?.items || []).find((item) => item.name === 'forge');
  assert.ok(liveApp, 'meta/apps does not expose the forge app');
  const flatten = (app) => {
    const rows = [];
    for (const area of app.areas || []) {
      for (const group of area.navigation || []) {
        for (const entry of group.children || []) {
          rows.push([area.id, group.id, entry.id, entry.pageName || entry.objectName || entry.type].join('|'));
        }
      }
    }
    return rows;
  };
  const liveNav = flatten(liveApp);
  assert.ok(liveNav.length > 0, 'live navigation is empty');
  try {
    const artifact = JSON.parse(await readFile(path.resolve('dist/objectstack.json'), 'utf8'));
    const builtApp = (artifact.apps || []).find((item) => item.name === 'forge') || artifact.apps?.[0];
    const builtNav = flatten(builtApp || {});
    assert.deepEqual(liveNav, builtNav, 'live navigation differs from dist/objectstack.json');
    pass(`live menus match this build (${liveNav.length} entries)`);
  } catch (error) {
    if (error?.code === 'ENOENT') skip('live menus match this build', 'dist/objectstack.json not built');
    else throw error;
  }
}

// 6. The UI leg: the fixes under test are front-end path mapping, so the only
//    honest proof is a browser opening a deep link and landing on the right page
//    with the right menu trail selected.
const playwrightModule = process.env.FORGE_PLAYWRIGHT_MODULE || 'playwright';
let chromium = null;
try {
  ({ chromium } = await import(playwrightModule));
} catch {
  chromium = null;
}
if (!chromium) skip('browser deep-link check', 'Playwright not available');
else if (!token) skip('browser deep-link check', 'no credentials provided');
else {
  const browser = await chromium.launch({ headless: true, channel: process.env.FORGE_CHROME_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 60000 });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => document.querySelectorAll('a[href]').length > 3 && !document.body.innerText.includes('正在初始化'),
    null,
    { timeout: 180000 },
  );
  pass('console leaves its initializing splash after login');

  await page.goto(BASE + DEEP_LINK_PATH, { waitUntil: 'commit', timeout: 60000 });
  // The app shell re-initializes on a direct URL load and the first paint is
  // slow on small hosts, so allow a long tail and retry once on a fresh load.
  const deepLinkVisible = async () => {
    try {
      await page.waitForFunction(
        (needle) => document.body.innerText.includes(needle),
        DEEP_LINK_TEXT,
        { timeout: 180000 },
      );
      return true;
    } catch {
      return false;
    }
  };
  if (!(await deepLinkVisible())) {
    await page.reload({ waitUntil: 'commit', timeout: 60000 });
    assert.ok(await deepLinkVisible(), `deep link did not render ${DEEP_LINK_TEXT}`);
  }
  // The sidebar marks the active entry through the app shell's own
  // conventions, not a fixed attribute value, so accept any of them.
  const trail = await page.evaluate(() => [...document.querySelectorAll(
    '[aria-current], [data-active="true"], [data-state="active"], .active',
  )].map((node) => (node.innerText || '').trim().split('\n')[0]).filter(Boolean));
  assert.ok(trail.length > 0, 'deep link rendered without marking any menu entry active');
  const breadcrumb = await page.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, ' ');
    return text.slice(0, text.indexOf('搜索') > 0 ? text.indexOf('搜索') : 160);
  });
  assert.ok(
    breadcrumb.includes(DEEP_LINK_TEXT),
    `deep link breadcrumb does not name the page: ${breadcrumb.slice(0, 120)}`,
  );
  pass(`deep link renders ${DEEP_LINK_TEXT} with an active menu trail`);
  await browser.close();
}

console.log(results.join('\n'));
