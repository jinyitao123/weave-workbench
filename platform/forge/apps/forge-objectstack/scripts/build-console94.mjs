import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyConsolePackagingPatches, treeSha256 } from './console94-artifact.mjs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = path.join(APP_DIR, 'console94.lock.json');
const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'));
const OUTPUT_DIR = path.resolve(process.env.FORGE_CONSOLE_BUILD_CONTEXT || path.join(APP_DIR, '.generated/console94'));
const sourceRepo = process.env.OBJECTUI_SOURCE_DIR;

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim();
}

if (process.version !== `v${lock.source.nodeVersion}`) {
  throw new Error(`Console build requires Node ${lock.source.nodeVersion}; current runtime is ${process.version}.`);
}
if (!sourceRepo) {
  throw new Error('Set OBJECTUI_SOURCE_DIR to a local ObjectUI Git checkout that contains the locked source commit.');
}
capture('git', ['-C', sourceRepo, 'cat-file', '-e', `${lock.source.revision}^{commit}`]);

const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'forge-console94-'));
try {
  const sourceDir = path.join(temporaryDir, 'objectui');
  const tarPath = path.join(temporaryDir, 'source.tar');
  await mkdir(sourceDir, { recursive: true });
  run('git', ['-C', sourceRepo, 'archive', '--format=tar', '--output', tarPath, lock.source.revision]);
  run('tar', ['-xf', tarPath, '-C', sourceDir]);
  const actualPnpm = capture('pnpm', ['--version'], { cwd: sourceDir });
  if (actualPnpm !== lock.source.pnpmVersion) {
    throw new Error(`Console source requires pnpm ${lock.source.pnpmVersion}; current version is ${actualPnpm}.`);
  }

  const sourcePackagePath = path.join(sourceDir, 'apps/console/package.json');
  const sourcePackage = JSON.parse(await readFile(sourcePackagePath, 'utf8'));
  if (sourcePackage.name !== lock.source.packageName || sourcePackage.version !== lock.source.packageVersion) {
    throw new Error(`Locked ObjectUI package mismatch: expected ${lock.source.packageName}@${lock.source.packageVersion}, got ${sourcePackage.name}@${sourcePackage.version}.`);
  }

  run('pnpm', ['install', '--frozen-lockfile'], { cwd: sourceDir });
  run('pnpm', ['-r', '--filter', '@object-ui/console...', 'build'], {
    cwd: sourceDir,
    env: { ...process.env, VITE_BASE_PATH: lock.artifact.basePath },
  });

  const builtDist = path.join(sourceDir, 'apps/console/dist');
  await rm(path.join(builtDist, 'stats.html'), { force: true });
  const rawDigest = await treeSha256(builtDist);
  if (rawDigest.sha256 !== lock.artifact.runtimeSourceTreeSha256) {
    if (process.env.FORGE_CONSOLE_KEEP_BUILD === '1') {
      const diagnosticPath = path.join(APP_DIR, '.generated/console94-diagnostic');
      await rm(diagnosticPath, { recursive: true, force: true });
      await cp(builtDist, diagnosticPath, { recursive: true });
      console.error(`Preserved diagnostic dist at ${diagnosticPath}`);
    }
    throw new Error(`ObjectUI runtime files differ from the locked clean build: expected ${lock.artifact.runtimeSourceTreeSha256}, got ${rawDigest.sha256} (${rawDigest.files} files, ${rawDigest.bytes} bytes).`);
  }
  const rawIndex = await readFile(path.join(builtDist, 'index.html'));
  const rawIndexDigest = (await import('node:crypto')).createHash('sha256').update(rawIndex).digest('hex');
  if (rawIndexDigest !== lock.artifact.rawIndexSha256) {
    throw new Error(`ObjectUI index digest differs from the locked clean build: expected ${lock.artifact.rawIndexSha256}, got ${rawIndexDigest}.`);
  }

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });
  await cp(builtDist, path.join(OUTPUT_DIR, 'dist'), { recursive: true });

  await applyConsolePackagingPatches(path.join(OUTPUT_DIR, 'dist'), lock);
  const packagedDigest = await treeSha256(path.join(OUTPUT_DIR, 'dist'));
  if (packagedDigest.sha256 !== lock.artifact.packagedTreeSha256) {
    throw new Error(`Packaged Console tree differs from the lock: expected ${lock.artifact.packagedTreeSha256}, got ${packagedDigest.sha256}.`);
  }

  const manifest = {
    schemaVersion: 1,
    sourceRevision: lock.source.revision,
    sourceTreeSha256: rawDigest.sha256,
    rawIndexSha256: rawIndexDigest,
    packagedTreeSha256: packagedDigest.sha256,
    files: packagedDigest.files,
    bytes: packagedDigest.bytes,
    basePath: lock.artifact.basePath,
    forgeRuntimeImage: lock.forge.runtimeImageReference,
  };
  await writeFile(path.join(OUTPUT_DIR, 'console94-build.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(OUTPUT_DIR, 'console94-build.env'), [
    `source_revision=${manifest.sourceRevision}`,
    `tree_sha256=${manifest.packagedTreeSha256}`,
    `base_path=${manifest.basePath}`,
    `runtime_image=${manifest.forgeRuntimeImage}`,
    '',
  ].join('\n'));
  await cp(LOCK_PATH, path.join(OUTPUT_DIR, 'console94.lock.json'));
  console.log(`Console 94 context: ${OUTPUT_DIR}`);
  console.log(`source=${manifest.sourceRevision} raw_tree_sha256=${manifest.sourceTreeSha256}`);
  console.log(`packaged_tree_sha256=${manifest.packagedTreeSha256} files=${manifest.files} bytes=${manifest.bytes}`);
} finally {
  if (process.env.FORGE_CONSOLE_KEEP_BUILD !== '1') await rm(temporaryDir, { recursive: true, force: true });
}
