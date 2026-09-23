import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyConsoleArtifact } from './console94-artifact.mjs';
import { resolveForgeConsolePackage } from './console94-runtime.mjs';

const [appArg, lockArg, manifestArg, layoutArg] = process.argv.slice(2);
if (!appArg || !lockArg || !manifestArg || !layoutArg) {
  throw new Error('Usage: node scripts/verify-console94-runtime.mjs <app-dir> <lock.json> <build.json> <layout.json>');
}
const appDir = path.resolve(appArg);
const lockPath = path.resolve(lockArg);
const manifestPath = path.resolve(manifestArg);
const layoutPath = path.resolve(layoutArg);
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const layout = JSON.parse(await readFile(layoutPath, 'utf8'));

const resolved = await resolveForgeConsolePackage(appDir, lock);
assert.equal(layout.cliVersion, resolved.cliVersion, 'Runtime CLI version differs from the build-stage resolution.');
assert.equal(layout.cliRelativePath, resolved.cliRelativePath, 'Runtime CLI package path differs from the build stage.');
assert.equal(layout.consoleRelativePath, resolved.consoleRelativePath, 'Runtime CLI resolves Console from a different package path than the build stage.');
assert.equal(layout.sourceRevision, lock.source.revision, 'Runtime Console source revision differs from the lock.');
assert.equal(layout.treeSha256, lock.artifact.packagedTreeSha256, 'Runtime Console tree digest in the layout marker differs from the lock.');

const result = await verifyConsoleArtifact({ distDir: path.join(resolved.consoleDir, 'dist'), manifest, lock });
console.log(`Runtime CLI resolved and verified Console 94 at ${resolved.consoleRelativePath}; tree_sha256=${result.sha256}`);
