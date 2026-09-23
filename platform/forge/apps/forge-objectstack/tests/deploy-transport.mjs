// Exercise deploy.sh orchestration with a fake Docker CLI and health endpoint.
// No container runtime, Forge service, database or external port is used.

import assert from 'node:assert/strict';
import { access, chmod, copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DEPLOY = path.resolve(HERE, '../scripts/deploy.sh');
const SOURCE_REVISION = '0123456789abcdef0123456789abcdef01234567';
const SECRETS = ['test-postgres-secret', 'test-auth-secret', 'test-key-secret'];

const dockerScript = [
  '#!/bin/sh',
  'printf "candidatePort=%s proxyImage=%s appImage=%s %s\\n" "$FORGE_CANDIDATE_PORT" "$FORGE_PROXY_IMAGE" "$FORGE_IMAGE" "$*" >> "$FORGE_DEPLOY_TEST_LOG"',
  'if [ "$1" = "compose" ] && [ "$2" = "ps" ]; then',
  '  case "$4" in',
  '    app) if [ -f "$FORGE_DEPLOY_TEST_STATE/app-updated" ]; then echo new-app; else echo old-app; fi ;;',
  '    proxy) if [ "$FORGE_TEST_PREVIOUS_PROXY" = 1 ]; then echo old-proxy; fi ;;',
  '    db) : ;;',
  '  esac',
  '  exit 0',
  'fi',
  'if [ "$1" = "inspect" ]; then',
  '  format=$3',
  '  target=$4',
  '  case "$target" in',
  '    old-app)',
  '      if [ "$format" = "{{.Config.Image}}" ]; then echo inoforge-app:sha-old;',
  '      elif [ "$format" = "{{.Image}}" ]; then echo sha256:old-app;',
  '      else echo healthy; fi ;;',
  '    new-app) case "$format" in *State.Health*) echo healthy ;; *) echo sha256:new-app ;; esac ;;',
  '    old-proxy) if [ "$format" = "{{.Config.Image}}" ]; then echo inoforge-proxy:sha-old; else echo sha256:old-proxy; fi ;;',
  '    *) exit 1 ;;',
  '  esac',
  '  exit 0',
  'fi',
  'if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then',
  '  case "$5" in',
  '    inoforge-app:sha-*) echo sha256:new-app-image ;;',
  '    inoforge-proxy:sha-*) echo sha256:new-proxy-image ;;',
  '    *) exit 1 ;;',
  '  esac',
  '  exit 0',
  'fi',
  'if [ "$1" = "compose" ]; then',
  '  case " $* " in *rollback-compose.yml*) touch "$FORGE_DEPLOY_TEST_STATE/direct-rollback" ;; esac',
  '  case " $* " in',
  '    *" up "*)',
  '      case " $* " in',
  '      *" proxy-candidate "*) touch "$FORGE_DEPLOY_TEST_STATE/candidate-started" ;;',
  '      *" app "*)',
  '        if [ "$FORGE_IMAGE" = "inoforge-app:sha-old" ]; then rm -f "$FORGE_DEPLOY_TEST_STATE/app-updated"; touch "$FORGE_DEPLOY_TEST_STATE/app-rolled-back";',
  '        else touch "$FORGE_DEPLOY_TEST_STATE/app-updated"; fi',
  '        ;;',
  '      *" proxy "*) if [ "$FORGE_PROXY_IMAGE" = "inoforge-proxy:sha-old" ]; then touch "$FORGE_DEPLOY_TEST_STATE/proxy-rolled-back"; fi ;;',
  '      esac ;;',
  '  esac',
  '  exit 0',
  'fi',
  'if [ "$1" = "build" ]; then exit 0; fi',
  'exit 0',
].join('\n') + '\n';

const curlScript = [
  '#!/bin/sh',
  'for arg in "$@"; do url=$arg; done',
  'case "$url" in',
  '  *:14612/api/v1/health) exit 0 ;;',
  '  *:4612/api/v1/health)',
  '    if [ "$FORGE_TEST_FAIL_PUBLIC" = 1 ]; then',
  '      if [ "$FORGE_TEST_PREVIOUS_PROXY" = 1 ] && [ -f "$FORGE_DEPLOY_TEST_STATE/proxy-rolled-back" ]; then exit 0; fi',
  '      if [ "$FORGE_TEST_PREVIOUS_PROXY" = 0 ] && [ -f "$FORGE_DEPLOY_TEST_STATE/direct-rollback" ]; then exit 0; fi',
  '      exit 22',
  '    fi',
  '    exit 0 ;;',
  '  *) exit 22 ;;',
  'esac',
].join('\n') + '\n';

async function runCase({ name, publicFailure, previousProxy }) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'forge-deploy-transport-'));
  try {
    const appDir = path.join(tempDir, 'app');
    const scriptsDir = path.join(appDir, 'scripts');
    const fakeBin = path.join(tempDir, 'bin');
    const stateDir = path.join(tempDir, 'state');
    await Promise.all([mkdir(scriptsDir, { recursive: true }), mkdir(fakeBin), mkdir(stateDir)]);
    await copyFile(SOURCE_DEPLOY, path.join(scriptsDir, 'deploy.sh'));
    await writeFile(path.join(appDir, '.env'), [
      'POSTGRES_PASSWORD=' + SECRETS[0],
      'OS_AUTH_SECRET=' + SECRETS[1],
      'OS_SECRET_KEY=' + SECRETS[2],
      '',
    ].join('\n'));
    await writeFile(path.join(fakeBin, 'docker'), dockerScript);
    await writeFile(path.join(fakeBin, 'curl'), curlScript);
    await writeFile(path.join(fakeBin, 'sleep'), '#!/bin/sh\nexit 0\n');
    await Promise.all(['docker', 'curl', 'sleep'].map((tool) => chmod(path.join(fakeBin, tool), 0o755)));

    const logPath = path.join(tempDir, 'commands.log');
    const env = {
      ...process.env,
      PATH: fakeBin + path.delimiter + process.env.PATH,
      FORGE_SOURCE_REVISION: SOURCE_REVISION,
      FORGE_IMAGE_REPOSITORY: 'inoforge-app',
      FORGE_PROXY_IMAGE_REPOSITORY: 'inoforge-proxy',
      FORGE_HTTP_PORT: '4612',
      FORGE_CANDIDATE_PORT: '14612',
      FORGE_RELEASE_DIR: path.join(tempDir, 'release'),
      FORGE_HEALTH_ATTEMPTS: '1',
      FORGE_DEPLOY_TEST_LOG: logPath,
      FORGE_DEPLOY_TEST_STATE: stateDir,
      FORGE_TEST_FAIL_PUBLIC: publicFailure ? '1' : '0',
      FORGE_TEST_PREVIOUS_PROXY: previousProxy ? '1' : '0',
    };
    const result = spawnSync('/bin/sh', [path.join(scriptsDir, 'deploy.sh')], {
      cwd: appDir,
      env,
      encoding: 'utf8',
      timeout: 15000,
    });
    const output = result.stdout + result.stderr;
    assert.ok(!SECRETS.some((secret) => output.includes(secret)), name + ': deployment output must not print .env secrets');
    const commandLog = await readFile(logPath, 'utf8');
    assert.match(commandLog, /--target app/, name + ': app image must use its explicit Docker stage');
    assert.match(commandLog, /--target proxy/, name + ': proxy image must use its explicit Docker stage');
    assert.match(commandLog, /candidatePort=14612/, name + ': candidate port must reach Compose');
    return { tempDir, stateDir, result, output, commandLog };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

const cases = [];
try {
  const success = await runCase({ name: 'successful release', publicFailure: false, previousProxy: false });
  cases.push(success);
  assert.equal(success.result.status, 0, 'successful release should exit zero:\n' + success.output);
  const releaseFiles = await readdir(path.join(success.tempDir, 'release', 'releases'));
  assert.equal(releaseFiles.length, 1);
  const releaseDir = path.join(success.tempDir, 'release', 'releases', releaseFiles[0]);
  let releaseRecord;
  try {
    releaseRecord = await readFile(path.join(releaseDir, 'release.env'), 'utf8');
  } catch {
    const contents = await readdir(releaseDir);
    throw new Error('release record missing; output=' + success.output + '; files=' + contents.join(','));
  }
  assert.match(releaseRecord, /source_revision=0123456789ab/);
  assert.match(releaseRecord, /app_image_id=sha256:new-app-image/);
  assert.match(releaseRecord, /proxy_image_id=sha256:new-proxy-image/);
  assert.doesNotMatch(releaseRecord, /test-(?:postgres|auth|key)-secret/);
  assert.ok(success.commandLog.includes('proxy-candidate'));
  console.log('PASS release builds, candidate-checks, promotes and records both image IDs');

  const directRollback = await runCase({ name: 'first proxy adoption rollback', publicFailure: true, previousProxy: false });
  cases.push(directRollback);
  assert.equal(directRollback.result.status, 1, 'failed public health should report deployment failure');
  assert.ok(directRollback.output.includes('恢复上一版直连端口'), 'first proxy adoption should restore the prior direct endpoint:\n' + directRollback.output);
  assert.match(directRollback.commandLog, /rollback-compose\.yml/);
  await access(path.join(directRollback.stateDir, 'direct-rollback'));
  console.log('PASS first-adoption failure restores the previous direct app port');

  const proxyRollback = await runCase({ name: 'existing proxy rollback', publicFailure: true, previousProxy: true });
  cases.push(proxyRollback);
  assert.equal(proxyRollback.result.status, 1, 'failed public health should report deployment failure');
  assert.ok(proxyRollback.output.includes('恢复上一应用镜像'));
  assert.match(proxyRollback.commandLog, /proxyImage=inoforge-proxy:sha-old/);
  assert.ok(proxyRollback.output.includes('上一版本公网入口健康检查通过'));
  console.log('PASS failed release restores the previously running app and proxy images');

  console.log('Deploy transport checks passed.');
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  for (const result of cases) await rm(result.tempDir, { recursive: true, force: true });
}
