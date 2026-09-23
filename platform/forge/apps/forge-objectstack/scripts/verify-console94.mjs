import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSha256, verifyConsoleArtifact } from './console94-artifact.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(APP_DIR, 'console94.lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const [contextDir, packageDir, cliPackagePath] = process.argv.slice(2);
if (!contextDir) throw new Error('Usage: node scripts/verify-console94.mjs <build-context> [console-package-dir] [cli-package.json]');

const resolvedContext = path.resolve(contextDir);
const contextLock = JSON.parse(await readFile(path.join(resolvedContext, 'console94.lock.json'), 'utf8'));
assert.deepEqual(contextLock, lock, 'Generated Console build context was created from a different lock file.');
const manifest = JSON.parse(await readFile(path.join(resolvedContext, 'console94-build.json'), 'utf8'));
const result = await verifyConsoleArtifact({ distDir: path.join(resolvedContext, 'dist'), manifest, lock });

if (packageDir) {
  const consolePackage = JSON.parse(await readFile(path.join(path.resolve(packageDir), 'package.json'), 'utf8'));
  assert.equal(consolePackage.name, lock.forge.consolePackageName, 'Injected package name differs from the ObjectStack package.');
  assert.equal(consolePackage.version, lock.forge.cliVersion, 'Injected Console package version must match the CLI version.');
  const injectedDigest = await treeSha256(path.join(path.resolve(packageDir), 'dist'));
  assert.equal(injectedDigest.sha256, result.sha256, 'Injected Console files differ from the verified build context.');
}

if (cliPackagePath) {
  const cliPackage = JSON.parse(await readFile(path.resolve(cliPackagePath), 'utf8'));
  assert.equal(cliPackage.name, '@objectstack/cli');
  assert.equal(cliPackage.version, lock.forge.cliVersion, 'Local Forge CLI must match the locked Console runtime version.');
}

console.log(`Console 94 verified: source=${result.sourceRevision} tree_sha256=${result.sha256} files=${result.files} bytes=${result.bytes}`);
