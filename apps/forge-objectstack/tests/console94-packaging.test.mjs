import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { constants, gunzipSync, gzipSync } from 'node:zlib';
import { applyConsolePackagingPatches, canonicalizeConsoleGzip, consoleBuildEnvironment, treeSha256, verifyConsoleArtifact } from '../scripts/console94-artifact.mjs';
import { installConsoleDist } from '../scripts/console94-install.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(APP_DIR, 'console94.lock.json'), 'utf8'));

test('Mac and Linux gzip headers canonicalize to the same complete tree without changing payload or other bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'console94-gzip-platform-'));
  const original = Buffer.from('console.log("locked Console payload");\n'.repeat(50));
  const compressed = gzipSync(original, { level: constants.Z_BEST_COMPRESSION });
  const roots = [path.join(root, 'darwin'), path.join(root, 'linux')];
  try {
    for (const [index, directory] of roots.entries()) {
      await mkdir(path.join(directory, 'assets'), { recursive: true });
      const platformBytes = Buffer.from(compressed);
      platformBytes[9] = index === 0 ? 19 : 3;
      await writeFile(path.join(directory, 'assets/app.js'), original);
      await writeFile(path.join(directory, 'assets/app.js.gz'), platformBytes);
      await writeFile(path.join(directory, 'assets/unrelated.br'), 'unchanged bytes');
    }
    assert.notEqual((await treeSha256(roots[0])).sha256, (await treeSha256(roots[1])).sha256);
    for (const directory of roots) {
      const file = path.join(directory, 'assets/app.js.gz');
      const before = await readFile(file);
      assert.deepEqual(await canonicalizeConsoleGzip(directory, lock), { gzipFiles: 1, changedFiles: 1 });
      const after = await readFile(file);
      assert.equal(after[9], 255);
      assert.deepEqual(after.subarray(0, 9), before.subarray(0, 9));
      assert.deepEqual(after.subarray(10), before.subarray(10), 'compressed data, CRC and size stay byte-identical');
      assert.deepEqual(gunzipSync(after), original);
      const once = await treeSha256(directory);
      assert.deepEqual(await canonicalizeConsoleGzip(directory, lock), { gzipFiles: 1, changedFiles: 0 });
      assert.deepEqual(await treeSha256(directory), once, 'normalization is idempotent');
    }
    assert.deepEqual(await treeSha256(roots[0]), await treeSha256(roots[1]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('gzip normalization rejects corrupt data, optional headers, additional members and payload mismatch before writing', async (t) => {
  const original = Buffer.from('Console original asset'.repeat(50));
  const clean = gzipSync(original, { level: constants.Z_BEST_COMPRESSION });
  clean[9] = 3;
  const cases = [
    ['magic', (bytes) => { bytes[0] = 0; return bytes; }],
    ['compression method', (bytes) => { bytes[2] = 7; return bytes; }],
    ['FHCRC', (bytes) => { bytes[3] = 2; return bytes; }],
    ['FNAME', (bytes) => { bytes[3] = 8; return bytes; }],
    ['reserved flag', (bytes) => { bytes[3] = 32; return bytes; }],
    ['CRC', (bytes) => { bytes[bytes.length - 8] ^= 255; return bytes; }],
    ['size', (bytes) => { bytes[bytes.length - 4] ^= 255; return bytes; }],
    ['truncated', (bytes) => bytes.subarray(0, 17)],
    ['trailing padding', (bytes) => Buffer.concat([bytes, Buffer.alloc(1)])],
    ['additional member', (bytes) => Buffer.concat([bytes, clean]), Buffer.concat([original, original])],
    ['different original', (bytes) => bytes, Buffer.alloc(original.length)],
  ];
  for (const [name, mutate, source = original] of cases) await t.test(name, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'console94-gzip-refusal-'));
    try {
      await writeFile(path.join(directory, 'a-valid.js'), original);
      await writeFile(path.join(directory, 'a-valid.js.gz'), clean);
      await writeFile(path.join(directory, 'z-invalid.js'), source);
      const invalid = mutate(Buffer.from(clean));
      await writeFile(path.join(directory, 'z-invalid.js.gz'), invalid);
      const before = await treeSha256(directory);
      await assert.rejects(canonicalizeConsoleGzip(directory, lock), /gzip|Gzip/);
      assert.deepEqual(await treeSha256(directory), before, 'failure must not partially normalize the set');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test('only the Console build child omits CI/Vercel and uses the locked UI profile', () => {
  const parent = { CI: 'true', VERCEL: 'false', PATH: '/pinned/bin', NPM_CONFIG_USERCONFIG: '/private/npmrc' };
  const snapshot = { ...parent };
  const child = consoleBuildEnvironment(parent, lock);
  assert.deepEqual(parent, snapshot);
  assert.ok(!Object.hasOwn(child, 'CI') && !Object.hasOwn(child, 'VERCEL'));
  assert.equal(child.PATH, parent.PATH);
  assert.equal(child.NPM_CONFIG_USERCONFIG, parent.NPM_CONFIG_USERCONFIG);
  assert.equal(child.VITE_BASE_PATH, lock.artifact.basePath);
  assert.equal(child.VITE_UI_PROFILE, lock.source.uiProfile);
});

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

test('Console replacement falls back to copy on EXDEV and restores the previous dist on verification failure', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'console94-exdev-test-'));
  const packageDir = path.join(tempDir, 'node_modules/@objectstack/console');
  const targetDist = path.join(packageDir, 'dist');
  const sourceDist = path.join(tempDir, 'context/dist');
  const renameExdev = async () => {
    const error = new Error('simulated overlayfs cross-device rename');
    error.code = 'EXDEV';
    throw error;
  };
  try {
    await mkdir(targetDist, { recursive: true });
    await mkdir(sourceDist, { recursive: true });
    await writeFile(path.join(targetDist, 'index.html'), 'old Console');
    await writeFile(path.join(sourceDist, 'index.html'), 'Console 94');

    await installConsoleDist({
      sourceDist,
      targetDist,
      renameImpl: renameExdev,
      verify: async (distDir) => {
        assert.equal(await readFile(path.join(distDir, 'index.html'), 'utf8'), 'Console 94');
        return { sha256: 'new-tree' };
      },
    });
    assert.equal(await readFile(path.join(targetDist, 'index.html'), 'utf8'), 'Console 94');
    assert.deepEqual((await readdir(packageDir)).sort(), ['dist']);

    await writeFile(path.join(targetDist, 'index.html'), 'old Console');
    await assert.rejects(installConsoleDist({
      sourceDist,
      targetDist,
      renameImpl: renameExdev,
      verify: async () => { throw new Error('digest check failed'); },
    }), /digest check failed/);
    assert.equal(await readFile(path.join(targetDist, 'index.html'), 'utf8'), 'old Console');
    assert.deepEqual((await readdir(packageDir)).sort(), ['dist']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('runtime and build inputs stay pinned to the locked Console host', async () => {
  const [dockerfile, compose, deploy, nginx, resolver, runtimeCheck] = await Promise.all([
    readFile(path.join(APP_DIR, 'Dockerfile'), 'utf8'),
    readFile(path.join(APP_DIR, 'docker-compose.yml'), 'utf8'),
    readFile(path.join(APP_DIR, 'scripts/deploy.sh'), 'utf8'),
    readFile(path.join(APP_DIR, 'transport/nginx.conf'), 'utf8'),
    readFile(path.join(APP_DIR, 'scripts/console94-runtime.mjs'), 'utf8'),
    readFile(path.join(APP_DIR, 'scripts/verify-console94-runtime.mjs'), 'utf8'),
  ]);
  assert.match(dockerfile, new RegExp(lock.forge.runtimeImageReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(dockerfile, /scripts\/inject-console94\.mjs/);
  assert.match(dockerfile, /verify-console94-runtime\.mjs/);
  assert.doesNotMatch(dockerfile, /node_modules\/@objectstack\/console\/dist/, 'Dockerfile must not assume Console is hoisted to app node_modules');
  const runtimeNodeModulesCopy = dockerfile.indexOf('/app/node_modules ./node_modules');
  const runtimeConsoleVerify = dockerfile.indexOf('verify-console94-runtime.mjs /srv/app');
  assert.ok(runtimeNodeModulesCopy >= 0 && runtimeConsoleVerify > runtimeNodeModulesCopy, 'final image must re-resolve and verify Console after copying node_modules');
  assert.match(resolver, /resolveConsolePath\(/);
  assert.match(runtimeCheck, /consoleRelativePath/);
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
