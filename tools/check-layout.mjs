import { access, readFile } from 'node:fs/promises'

const required = [
  'desktop/package.json',
  'platform/weave/go.mod',
  'platform/forge/package.json',
  'contracts/v1/work-request.schema.json',
  'contracts/v1/business-action.schema.json',
  'contracts/v1/task-notification.schema.json',
  'contracts/v1/delivery-receipt.schema.json',
  'scenarios/sales-contract-handoff/README.md',
]

await Promise.all(required.map((path) => access(path)))
const lock = JSON.parse(await readFile('components.lock.json', 'utf8'))
if (lock.schemaVersion !== 1) throw new Error('Unsupported components.lock.json schema version')
for (const name of ['desktop', 'weave', 'forge']) {
  const component = lock.components?.[name]
  if (!component || !/^[0-9a-f]{40}$/.test(component.revision)) {
    throw new Error(`Component ${name} is not locked to an exact Git revision`)
  }
}
console.log('Workbench repository layout and component lock are valid.')

