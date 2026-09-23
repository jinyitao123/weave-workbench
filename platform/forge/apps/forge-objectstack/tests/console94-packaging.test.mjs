import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyConsolePackagingPatches, treeSha256, verifyConsoleArtifact } from '../scripts/console94-artifact.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(APP_DIR, 'console94.lock.json'), 'utf8'));

test('Console packaging patch fixes nested-route manifest resolution and stamps the pinned source', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'console94-patch-test-'));
  const distDir = path.join(tempDir, 'dist');
  try {
    await mkdir(path.join(distDir, 'assets'), { recursive: true });
    await writeFile(path.join(distDir, 'index.html'), '<link rel="manifest" href="./manifest.json"><script src="/_console/assets/app.js"></script>');
    await writeFile(path.join(distDir, 'manifest.json'), '{"start_url":"./"}');
    await writeFile(path.join(distDir, 'assets/app.js'), 'console.log("ready")');

    const testLock = structuredClone(lock);
    await applyConsolePackagingPatches(distDir, testLock);
    const index = await readFile(path.join(distDir, 'index.html'), 'utf8');
    assert.ok(index.includes('href="/_console/manifest.json"'));
    assert.ok(!index.includes('href="./manifest.json"'));
    assert.equal((await readFile(path.join(distDir, '.objectui-sha'), 'utf8')).trim(), lock.source.revision);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('artifact verifier accepts only the locked Console tree and rejects byte drift', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'console94-verify-test-'));
  const distDir = path.join(tempDir, 'dist');
  try {
    await mkdir(path.join(distDir, 'assets'), { recursive: true });
    await writeFile(path.join(distDir, 'index.html'), '<link rel="manifest" href="./manifest.json">');
    await writeFile(path.join(distDir, 'manifest.json'), '{}');
    await writeFile(path.join(distDir, 'assets/app.js'), 'version one');

    const testLock = structuredClone(lock);
    await applyConsolePackagingPatches(distDir, testLock);
    const digest = await treeSha256(distDir);
    testLock.artifact.packagedTreeSha256 = digest.sha256;
    const manifest = {
      sourceRevision: testLock.source.revision,
      sourceTreeSha256: testLock.artifact.runtimeSourceTreeSha256,
      rawIndexSha256: testLock.artifact.rawIndexSha256,
      basePath: testLock.artifact.basePath,
      forgeRuntimeImage: testLock.forge.runtimeImageReference,
      files: digest.files,
      bytes: digest.bytes,
    };
    assert.equal((await verifyConsoleArtifact({ distDir, manifest, lock: testLock })).sha256, digest.sha256);

    await writeFile(path.join(distDir, 'assets/app.js'), 'changed bytes');
    await assert.rejects(verifyConsoleArtifact({ distDir, manifest, lock: testLock }), /tree digest mismatch/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('runtime and build inputs stay pinned to the verified 17.3 Console host', async () => {
  const [dockerfile, compose, deploy, nginx] = await Promise.all([
    readFile(path.join(APP_DIR, 'Dockerfile'), 'utf8'),
    readFile(path.join(APP_DIR, 'docker-compose.yml'), 'utf8'),
    readFile(path.join(APP_DIR, 'scripts/deploy.sh'), 'utf8'),
    readFile(path.join(APP_DIR, 'transport/nginx.conf'), 'utf8'),
  ]);
  assert.match(dockerfile, new RegExp(lock.forge.runtimeImageReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(dockerfile, /verify-console94\.mjs/);
  assert.match(dockerfile, /org\.opencontainers\.image\.console\.source-revision/);
  assert.match(dockerfile, /org\.opencontainers\.image\.console\.tree-sha256/);
  assert.match(compose, /additional_contexts:[\s\S]*console94:/);
  assert.match(deploy, /docker buildx build[\s\S]*--build-context "console94=/);
  assert.match(deploy, /CONSOLE_SOURCE_REVISION=\$CONSOLE_SOURCE_REVISION/);
  assert.match(deploy, /CONSOLE_TREE_SHA256=\$CONSOLE_TREE_SHA256/);
  assert.match(nginx, /map "\$http_accept\|\$request_uri" \$forge_stream_request[\s\S]*\/mcp/);
  assert.match(nginx, /location \/\s*\{[\s\S]*?proxy_pass http:\/\/forge_app;/);
  assert.match(nginx, /upstream forge_app\s*\{\s*server app:8080;/);
});
