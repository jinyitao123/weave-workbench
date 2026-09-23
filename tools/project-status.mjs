import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const componentPaths = { desktop: 'desktop', weave: 'platform/weave', forge: 'platform/forge' }
export const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export function validateLock(lock) {
  if (lock.schemaVersion !== 1) throw new Error('Unsupported components.lock.json schema version')
  for (const [name, path] of Object.entries(componentPaths)) {
    const item = lock.components?.[name]
    if (!item || !/^[0-9a-f]{40}$/.test(item.revision) || item.importPath !== path) {
      throw new Error(`Invalid revision or importPath for ${name}`)
    }
    const source = new URL(item.source)
    if (source.protocol !== 'https:' || source.username || source.password) {
      throw new Error(`Invalid source URL for ${name}`)
    }
  }
  return lock
}

function git(root, ...args) {
  return execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024,
  }).trimEnd()
}

export function inspectRepository(root) {
  const lock = validateLock(JSON.parse(readFileSync(resolve(root, 'components.lock.json'), 'utf8')))
  const components = []
  for (const name of ['weave', 'forge']) {
    const item = lock.components[name]
    const dirty = git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--', item.importPath)
    let difference = ''
    let error = ''
    try {
      git(root, 'cat-file', '-e', `${item.revision}^{commit}`)
      difference = git(root, 'diff', '--no-ext-diff', '--no-textconv', '--name-status',
        `${item.revision}^{tree}`, `HEAD:${item.importPath}`, '--')
    } catch {
      error = '无法比较来源树；检查锁定提交是否已获取、导入目录是否已提交（浅克隆需补齐历史）。'
    }
    components.push({ name, ...item, dirty, difference, error, aligned: !dirty && !difference && !error })
  }
  return {
    head: git(root, 'rev-parse', 'HEAD'),
    branch: git(root, 'branch', '--show-current') || '(detached HEAD)',
    dirty: git(root, 'status', '--porcelain=v1', '--untracked-files=all'),
    hasRemote: Boolean(git(root, 'remote')),
    desktop: lock.components.desktop,
    components,
  }
}

export function checkReadiness(report, release = false) {
  return report.components.every(item => item.aligned) && (!release || !report.dirty)
}

function main() {
  const mode = process.argv[2] || '--status'
  if (!['--status', '--check-components', '--check-release'].includes(mode) || process.argv.length > 3) {
    throw new Error('Usage: node tools/project-status.mjs [--status|--check-components|--check-release]')
  }
  const report = inspectRepository(repositoryRoot)
  console.log(`分支: ${report.branch}\nHEAD: ${report.head}\n远端: ${report.hasRemote ? '已配置（未联网核验）' : '未配置'}`)
  console.log(`桌面来源基线: ${report.desktop.revision}（产品改造由总仓提交承载）`)
  for (const item of report.components) {
    console.log(`\n${item.name}: ${item.revision} ${item.aligned ? '来源一致' : '待核对'}`)
    if (item.error) console.log(item.error)
    if (item.difference) console.log(`已提交的集成偏差:\n${item.difference}`)
    if (item.dirty) console.log(`组件未提交改动:\n${item.dirty}`)
  }
  if (mode !== '--check-components') console.log(`\n工作树:\n${report.dirty || '干净'}`)
  console.log('\n只核对本地 Git 与文件，不证明远端版本、部署或业务验收。接手见 docs/项目状态.md。')
  if (mode !== '--status' && !checkReadiness(report, mode === '--check-release')) {
    console.error('检查未通过：先处理来源偏差；发布候选还要求整个工作树干净。')
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
