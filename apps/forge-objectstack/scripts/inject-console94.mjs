import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSha256, verifyConsoleArtifact } from './console94-artifact.mjs';
import { installConsoleDist } from './console94-install.mjs';
import { resolveForgeConsolePackage } from './console94-runtime.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..');
const lock = JSON.parse(await readFile(path.join(APP_DIR, 'console94.lock.json'), 'utf8'));
const [appArg, contextArg, layoutArg] = process.argv.slice(2);
const appDir = path.resolve(appArg || APP_DIR);
const contextDir = path.resolve(contextArg || path.join(appDir, '.generated/console94'));
const layoutPath = path.resolve(layoutArg || path.join(appDir, '.generated/console94-layout.json'));

const contextLock = JSON.parse(await readFile(path.join(contextDir, 'console94.lock.json'), 'utf8'));
assert.deepEqual(contextLock, lock, 'Console build context was created from a different lock file.');
const manifest = JSON.parse(await readFile(path.join(contextDir, 'console94-build.json'), 'utf8'));
const sourceDist = path.join(contextDir, 'dist');
await verifyConsoleArtifact({ distDir: sourceDist, manifest, lock });

const resolved = await resolveForgeConsolePackage(appDir, lock);
const targetDist = path.join(resolved.consoleDir, 'dist');
const injected = await installConsoleDist({
  sourceDist,
  targetDist,
  verify: (distDir) => verifyConsoleArtifact({ distDir, manifest, lock }),
});
const packageDigest = await treeSha256(targetDist);
assert.equal(injected.sha256, packageDigest.sha256);

const layout = {
  schemaVersion: 1,
  cliVersion: resolved.cliVersion,
  cliRelativePath: resolved.cliRelativePath,
  consoleRelativePath: resolved.consoleRelativePath,
  sourceRevision: lock.source.revision,
  treeSha256: lock.artifact.packagedTreeSha256,
};
await mkdir(path.dirname(layoutPath), { recursive: true });
await writeFile(layoutPath, `${JSON.stringify(layout, null, 2)}\n`);
console.log(`Injected Console 94 into ${layout.consoleRelativePath}; tree_sha256=${layout.treeSha256}`);
