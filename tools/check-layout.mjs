import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { repositoryRoot, validateLock } from './project-status.mjs'

process.chdir(repositoryRoot)

const required = [
  'AGENTS.md',
  'docs/project-status.md',
  'docs/architecture/product-architecture.md',
  'docs/architecture/delivery-model.md',
  'docs/engineering/README.md',
  'docs/environments/development.md',
  '.github/workflows/project-check.yml',
  'desktop/package.json',
  'platform/weave/go.mod',
  'platform/forge/apps/forge-objectstack/package.json',
  'contracts/v1/work-request.schema.json',
  'contracts/v1/business-action.schema.json',
  'contracts/v1/task-notification.schema.json',
  'contracts/v1/delivery-receipt.schema.json',
  'scenarios/sales-contract-handoff/README.md',
]

await Promise.all(required.map((path) => access(path)))
const lock = JSON.parse(await readFile('components.lock.json', 'utf8'))
validateLock(lock)

async function markdownFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    else if (entry.name.endsWith('.md')) files.push(path)
  }
  return files
}
const documents = ['README.md', 'AGENTS.md',
  ...await markdownFiles('docs'), ...await markdownFiles('contracts'), ...await markdownFiles('scenarios')]
for (const file of documents) {
  const content = (await readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '')
  for (const [, target] of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue
    const path = decodeURIComponent(target.split('#')[0])
    if (path) await access(resolve(dirname(file), path)).catch(() => {
      throw new Error(`Broken local document link: ${file} -> ${target}`)
    })
  }
}
console.log(`Workbench layout, component lock and ${documents.length} document links checked (file targets only).`)
