import { execFileSync } from 'node:child_process'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { repositoryRoot, validateLock } from './project-status.mjs'
import { localOnlyDocuments, validateDocumentPaths, validateStatusPage } from './documentation-policy.mjs'

process.chdir(repositoryRoot)
const trackedPaths = new Set(execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean))

const required = [
  'AGENTS.md',
  'docs/README.md',
  'docs/acceptance/README.md',
  'docs/releases/README.md',
  'desktop/docs/README.md',
  'docs/项目状态.md',
  'docs/architecture/系统架构设计.md',
  'docs/architecture/开发与发布方式.md',
  'docs/engineering/README.md',
  'docs/environments/开发联调环境.md',
  '.github/workflows/project-check.yml',
  'desktop/package.json',
  'platform/weave/go.mod',
  'platform/forge/apps/forge-objectstack/package.json',
  'contracts/v1/work-request.schema.json',
  'contracts/v1/business-action.schema.json',
  'contracts/v1/business-capability-catalog.schema.json',
  'contracts/v1/task-notification.schema.json',
  'contracts/v1/delivery-receipt.schema.json',
  'scenarios/sales-contract-handoff/合同场景设计.md',
]

await Promise.all(required.map((path) => access(path)))
const lock = JSON.parse(await readFile('components.lock.json', 'utf8'))
validateLock(lock)
validateStatusPage(await readFile('docs/项目状态.md', 'utf8'), Object.values(lock.components).map(item => item.revision))

async function markdownFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    else if (entry.name.endsWith('.md')) files.push(path)
  }
  return files
}
const rootDocuments = (await readdir('.', { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => entry.name)
const documents = [...rootDocuments, 'desktop/README.md', 'desktop/AGENTS.md', 'desktop/CONTRIBUTING.md',
  ...await markdownFiles('docs'), ...await markdownFiles('contracts'), ...await markdownFiles('scenarios'),
  ...await markdownFiles('desktop/docs')].filter(path => !localOnlyDocuments.has(path))
validateDocumentPaths(documents)
for (const file of documents) {
  const content = (await readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '')
  for (const [, target] of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue
    const path = decodeURIComponent(target.split('#')[0])
    if (path.startsWith('/')) throw new Error(`Nonportable absolute document link: ${file} -> ${target}`)
    if (!path) continue
    const absoluteTarget = resolve(dirname(file), path)
    await access(absoluteTarget).catch(() => {
      throw new Error(`Broken local document link: ${file} -> ${target}`)
    })
    const repositoryPath = relative(repositoryRoot, absoluteTarget).replaceAll('\\', '/')
    if (repositoryPath === '..' || repositoryPath.startsWith('../')) {
      throw new Error(`Document link leaves the repository: ${file} -> ${target}`)
    }
    const targetStat = await stat(absoluteTarget)
    const tracked = targetStat.isDirectory()
      ? [...trackedPaths].some((entry) => entry.startsWith(`${repositoryPath ? `${repositoryPath}/` : ''}`))
      : trackedPaths.has(repositoryPath)
    if (!tracked) throw new Error(`Document link targets an untracked file: ${file} -> ${target}`)
  }
}
console.log(`Workbench layout, component lock, document names, archive numbers and ${documents.length} document links checked (file targets only).`)
