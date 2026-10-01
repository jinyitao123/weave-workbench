import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkReadiness, findUnregisteredBranches, inspectRepository, validateLock } from './project-status.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'workbench-status-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
  }).trim()
  const write = (path, content) => writeFileSync(join(root, path), content)
  git('init', '-q')
  const commit = () => { git('add', '.'); git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture') }
  write('source.txt', 'source\n')
  commit()
  const revision = git('rev-parse', 'HEAD')
  rmSync(join(root, 'source.txt'))
  for (const name of ['weave', 'forge']) {
    mkdirSync(join(root, 'platform', name), { recursive: true })
    write(`platform/${name}/source.txt`, 'source\n')
  }
  const lock = { schemaVersion: 1, components: Object.fromEntries(
    ['desktop', 'weave', 'forge'].map(name => [name, {
      source: `https://example.invalid/${name}.git`, revision,
      importPath: name === 'desktop' ? 'desktop' : `platform/${name}`,
    }])) }
  write('components.lock.json', JSON.stringify(lock))
  commit()
  return { root, git, write, commit, lock }
}

test('clean imported trees pass; unrelated product changes only block release readiness', t => {
  const f = fixture(t)
  assert.equal(checkReadiness(inspectRepository(f.root), true), true)
  f.write('desktop-notes.md', 'draft')
  const report = inspectRepository(f.root)
  assert.equal(checkReadiness(report), true)
  assert.equal(checkReadiness(report, true), false)
})

test('tracked, staged and untracked component changes are reported without modifying the index', t => {
  const f = fixture(t)
  f.write('platform/weave/source.txt', 'local fix\n')
  f.git('add', 'platform/weave/source.txt')
  f.write('platform/weave/source.txt', 'further work\n')
  f.write('platform/weave/database.test', 'regression')
  const indexBefore = readFileSync(join(f.root, '.git/index'))
  const report = inspectRepository(f.root)
  assert.equal(checkReadiness(report), false)
  assert.match(report.components[0].dirty, /MM platform\/weave\/source.txt/)
  assert.match(report.components[0].dirty, /\?\? platform\/weave\/database.test/)
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), indexBefore)
})

test('committing a local component patch does not hide divergence from the source lock', t => {
  const f = fixture(t)
  f.write('platform/weave/source.txt', 'product-only fix\n')
  f.commit()
  const report = inspectRepository(f.root)
  assert.equal(report.dirty, '')
  assert.equal(checkReadiness(report), false)
  assert.match(report.components[0].difference, /source.txt/)
})

test('missing source objects fail closed; incorrect paths cannot bypass source checks', t => {
  const f = fixture(t)
  f.lock.components.weave.revision = 'a'.repeat(40)
  f.write('components.lock.json', JSON.stringify(f.lock))
  const report = inspectRepository(f.root)
  assert.equal(checkReadiness(report), false)
  assert.match(report.components[0].error, /无法比较来源树/)
  f.lock.components.weave.importPath = 'desktop'
  assert.throws(() => validateLock(f.lock), /Invalid revision or importPath/)
})

test('unmerged remote branches must be registered in the status page owner section', t => {
  const f = fixture(t)
  mkdirSync(join(f.root, 'docs'))
  const status = who => `## 现在做到哪\n\n## 谁在做什么\n${who}\n\n## 卡在哪\n\n## 下一步\n\`codex/later\`\n`
  f.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  f.git('update-ref', 'refs/remotes/origin/merged', 'HEAD')
  f.write('feature.txt', 'feature\n')
  f.commit()
  for (const name of ['codex/active', 'codex/later']) f.git('update-ref', `refs/remotes/origin/${name}`, 'HEAD')
  f.write('docs/项目状态.md', status('| 本会话 | `codex/active` | 合入 |'))
  assert.deepEqual(findUnregisteredBranches(f.root), { error: '', branches: ['codex/later'] })
  f.write('docs/项目状态.md', status('| 本会话 | `codex/active` | 合入 |\n| 待认领 | `codex/later` | 确认后删除 |'))
  assert.deepEqual(findUnregisteredBranches(f.root).branches, [])
  assert.match(findUnregisteredBranches(f.root, 'origin/missing').error, /git fetch/)
})

test('branch registry uses the configured remote when its name is not origin', t => {
  const f = fixture(t)
  mkdirSync(join(f.root, 'docs'))
  f.git('remote', 'add', 'published-workbench', 'https://example.invalid/product.git')
  f.git('update-ref', 'refs/remotes/published-workbench/main', 'HEAD')
  f.write('feature.txt', 'UI feature\n')
  f.commit()
  f.git('update-ref', 'refs/remotes/published-workbench/ui/team-sidebar', 'HEAD')
  f.write('docs/项目状态.md', '## 谁在做什么\n| UI | `ui/team-sidebar` | 验证后合入 |\n## 卡在哪\n')
  assert.deepEqual(findUnregisteredBranches(f.root), { error: '', branches: [] })
  f.write('docs/项目状态.md', '## 谁在做什么\n## 卡在哪\n')
  assert.deepEqual(findUnregisteredBranches(f.root).branches, ['ui/team-sidebar'])
})
