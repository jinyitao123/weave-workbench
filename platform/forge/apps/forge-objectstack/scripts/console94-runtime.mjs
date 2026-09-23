import assert from 'node:assert/strict';
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function resolveForgeConsolePackage(appDir, lock) {
  const appRoot = await realpath(path.resolve(appDir));
  const nodeModulesDir = path.join(appRoot, 'node_modules');
  const cliPackagePath = path.join(nodeModulesDir, '@objectstack/cli/package.json');
  const cliPackage = JSON.parse(await readFile(cliPackagePath, 'utf8'));
  assert.equal(cliPackage.name, '@objectstack/cli', 'Installed CLI package name is not @objectstack/cli.');
  assert.equal(cliPackage.version, lock.forge.cliVersion, 'Installed CLI version differs from the Console lock.');

  const cliDir = path.dirname(await realpath(cliPackagePath));
  const cliUtilsUrl = pathToFileURL(path.join(cliDir, 'dist/utils/console.js')).href;
  const { resolveConsolePath } = await import(cliUtilsUrl);
  let drift;
  const consoleDir = resolveConsolePath({
    cwd: appRoot,
    cliVersion: cliPackage.version,
    warn(message) {
      throw new Error(`ObjectStack CLI rejected a Console candidate: ${message}`);
    },
    onDrift(value) {
      drift = value;
    },
  });
  if (!consoleDir) throw new Error('ObjectStack CLI could not resolve an installed Console package.');
  if (drift) throw new Error(`ObjectStack CLI detected Console source drift: ${drift.stamp} != ${drift.pin}`);

  const resolvedConsoleDir = await realpath(consoleDir);
  const relativeToNodeModules = path.relative(nodeModulesDir, resolvedConsoleDir);
  if (relativeToNodeModules === '..' || relativeToNodeModules.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToNodeModules)) {
    throw new Error(`ObjectStack CLI resolved Console outside the app's node_modules: ${resolvedConsoleDir}`);
  }

  const consolePackagePath = path.join(resolvedConsoleDir, 'package.json');
  const consolePackage = JSON.parse(await readFile(consolePackagePath, 'utf8'));
  assert.equal(consolePackage.name, lock.forge.consolePackageName, 'Resolved package name differs from @objectstack/console.');
  assert.equal(consolePackage.version, lock.forge.cliVersion, 'Resolved Console package version differs from the Forge CLI.');
  await readFile(path.join(resolvedConsoleDir, 'dist/index.html'));

  return {
    appRoot,
    cliVersion: cliPackage.version,
    cliRelativePath: path.relative(appRoot, cliDir).split(path.sep).join('/'),
    consoleRelativePath: path.relative(appRoot, resolvedConsoleDir).split(path.sep).join('/'),
    consoleDir: resolvedConsoleDir,
    consolePackage,
  };
}
