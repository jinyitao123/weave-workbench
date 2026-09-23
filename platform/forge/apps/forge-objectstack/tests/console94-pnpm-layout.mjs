import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveForgeConsolePackage } from '../scripts/console94-runtime.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(APP_DIR, 'console94.lock.json'), 'utf8'));
const resolved = await resolveForgeConsolePackage(APP_DIR, lock);
await assert.rejects(access(path.join(APP_DIR, 'node_modules/@objectstack/console')));
assert.ok(resolved.cliRelativePath.startsWith('node_modules/'));
assert.ok(resolved.consoleRelativePath.startsWith('node_modules/'));
assert.notEqual(resolved.consoleRelativePath, 'node_modules/@objectstack/console');
assert.ok(resolved.consoleRelativePath.includes('node_modules/.pnpm/'));
assert.equal(resolved.consolePackage.version, lock.forge.cliVersion);
console.log(`pnpm layout verified: CLI selected ${resolved.consoleRelativePath} (${resolved.consolePackage.version}).`);
