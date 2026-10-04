import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyConsoleArtifact } from '../scripts/console94-artifact.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTEXT_DIR = path.resolve(process.env.FORGE_CONSOLE_BUILD_CONTEXT || path.join(APP_DIR, '.generated/console94'));
const lock = JSON.parse(await readFile(path.join(APP_DIR, 'console94.lock.json'), 'utf8'));
const contextLock = JSON.parse(await readFile(path.join(CONTEXT_DIR, 'console94.lock.json'), 'utf8'));
assert.deepEqual(contextLock, lock, 'Console build context must match the tracked lock.');
const manifest = JSON.parse(await readFile(path.join(CONTEXT_DIR, 'console94-build.json'), 'utf8'));
const distDir = path.join(CONTEXT_DIR, 'dist');
await verifyConsoleArtifact({ distDir, manifest, lock });

const cliModule = pathToFileURL(path.join(APP_DIR, 'node_modules/@objectstack/cli/dist/utils/console.js')).href;
const { resolveConsolePath } = await import(cliModule);
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'console94-resolve-smoke-'));
const packageDir = path.join(tempDir, 'node_modules/@objectstack/console');
const localDist = path.join(packageDir, 'dist');
let server;
try {
  await mkdir(localDist, { recursive: true });
  await writeFile(path.join(tempDir, 'package.json'), '{"name":"console94-resolution-fixture","type":"module"}\n');
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({
    name: lock.forge.consolePackageName,
    version: lock.forge.cliVersion,
    type: 'module',
    exports: { './package.json': './package.json', '.': './plugin.js' },
  }));
  await cp(distDir, localDist, { recursive: true });

  const resolved = resolveConsolePath({ cwd: tempDir, cliVersion: lock.forge.cliVersion });
  assert.equal(await realpath(resolved), await realpath(packageDir), 'CLI must resolve the app-local @objectstack/console package first.');

  const index = await readFile(path.join(localDist, 'index.html'), 'utf8');
  const scriptPath = index.match(/src="(\/_console\/assets\/[^\"]+\.js)"/)?.[1];
  assert.ok(scriptPath, 'built Console index must use the /_console base path for JavaScript assets');

  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    let relative = url.pathname === '/_console/' ? 'index.html' : url.pathname.replace(/^\/_console\//, '');
    let filePath = path.resolve(localDist, relative);
    if (!filePath.startsWith(path.resolve(localDist) + path.sep) && filePath !== path.join(localDist, 'index.html')) {
      response.writeHead(404).end();
      return;
    }
    try {
      response.setHeader('Content-Type', filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
      response.end(await readFile(filePath));
    } catch {
      // Mirror an SPA static mount: route-like requests return index.html;
      // existing manifest and asset URLs remain ordinary files.
      if (!path.extname(url.pathname)) {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(await readFile(path.join(localDist, 'index.html')));
      } else {
        response.writeHead(404).end();
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const [home, nested, manifestResponse, asset] = await Promise.all([
    fetch(`${base}/_console/`),
    fetch(`${base}/_console/approvals/requests/returned`),
    fetch(`${base}/_console/manifest.json`),
    fetch(`${base}${scriptPath}`),
  ]);
  assert.equal(home.status, 200);
  assert.equal(nested.status, 200);
  assert.match(await nested.text(), /\/_console\/assets\//);
  assert.equal(manifestResponse.status, 200);
  assert.equal(asset.status, 200);
  console.log(`CLI resolved ${resolved}; local /_console/ and nested-route smoke passed on loopback port ${address.port}.`);
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
