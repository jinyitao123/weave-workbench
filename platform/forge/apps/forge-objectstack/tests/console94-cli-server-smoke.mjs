import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyConsoleArtifact } from '../scripts/console94-artifact.mjs';
import { resolveForgeConsolePackage } from '../scripts/console94-runtime.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTEXT_DIR = path.resolve(process.env.FORGE_CONSOLE_BUILD_CONTEXT || path.join(APP_DIR, '.generated/console94'));
const lock = JSON.parse(await readFile(path.join(APP_DIR, 'console94.lock.json'), 'utf8'));
const contextLock = JSON.parse(await readFile(path.join(CONTEXT_DIR, 'console94.lock.json'), 'utf8'));
assert.deepEqual(contextLock, lock);
const manifest = JSON.parse(await readFile(path.join(CONTEXT_DIR, 'console94-build.json'), 'utf8'));
const resolvedConsole = await resolveForgeConsolePackage(APP_DIR, lock);
await verifyConsoleArtifact({ distDir: path.join(resolvedConsole.consoleDir, 'dist'), manifest, lock });

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-console94-cli-server-'));
const portProbe = createServer();
let port;
let child;
let output = '';

try {
  await mkdir(path.join(tempDir, '.objectstack/data/uploads'), { recursive: true });
  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-console94-cli-smoke","type":"module"}\n');
  await cp(path.join(APP_DIR, 'objectstack.config.ts'), path.join(tempDir, 'objectstack.config.ts'));
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');

  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));

  child = spawn(process.execPath, [
    path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'),
    'serve', 'objectstack.config.ts', '--port', String(port), '--log-level', 'error',
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      OS_PORT: String(port),
      OS_DATABASE_URL: `file:${path.join(tempDir, '.objectstack/data/console94.sqlite')}`,
      OS_AUTH_SECRET: 'console94-smoke-auth-secret-7e42ca101a044a5b',
      OS_SECRET_KEY: 'console94-smoke-secret-key-8ce6cb8f3059472f',
      OS_BASE_URL: `http://127.0.0.1:${port}`,
      OS_TRUSTED_ORIGINS: `http://127.0.0.1:${port}`,
      FORGE_WEAVE_EVENT_SECRET: 'console94-smoke-weave-secret-3bd43057b6ad4d45',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-8000); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-8000); });

  const deadline = Date.now() + 60_000;
  let health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`ObjectStack CLI exited before health became ready (code ${child.exitCode}).\n${output}`);
    try {
      health = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(health?.ok, `ObjectStack CLI did not become healthy on its private SQLite database.\n${output}`);

  const [home, nested, manifestResponse] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/_console/`),
    fetch(`http://127.0.0.1:${port}/_console/approvals/requests/returned`),
    fetch(`http://127.0.0.1:${port}/_console/manifest.json`),
  ]);
  assert.equal(home.status, 200);
  assert.equal(nested.status, 200);
  assert.equal(manifestResponse.status, 200);
  const html = await nested.text();
  assert.match(html, /\/_console\/assets\//);
  const assetPath = html.match(/src="(\/_console\/assets\/[^\"]+\.js)"/)?.[1];
  assert.ok(assetPath, 'served index must reference a JavaScript asset below /_console/');
  assert.equal((await fetch(`http://127.0.0.1:${port}${assetPath}`)).status, 200);
  console.log(`ObjectStack CLI served the pnpm-resolved Console at /_console/ and a nested SPA route on loopback port ${port}.`);
} finally {
  if (portProbe.listening) await new Promise((resolve) => portProbe.close(resolve));
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000)),
    ]);
  }
  await rm(tempDir, { recursive: true, force: true });
}
