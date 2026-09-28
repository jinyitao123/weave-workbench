import { basename } from 'node:path'

const specialNames = new Set([
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE.md', 'SKILL.md',
])

// This compatibility symlink points to the tracked Chinese account document,
// which is checked under its canonical path below.
export const localOnlyDocuments = new Set(['scenarios/sales-contract-handoff/test-accounts.md'])

export function validateDocumentPaths(paths) {
  const recordIds = new Set()
  for (const path of paths) {
    const name = basename(path)
    if (specialNames.has(name)) continue
    if (!/\p{Script=Han}/u.test(name)) throw new Error(`文档须使用中文用途名: ${path}`)
    if (/(?:19|20)\d{2}[-_]?\d{2}[-_]?\d{2}|(?:^|[-_ ])v\d+(?:[.\-_]|$)|最终版|最新版|修改版|副本/i.test(name)) {
      throw new Error(`禁止以日期或副本版本命名文档: ${path}`)
    }
    const archive = /^(docs\/(?:acceptance|releases|decisions)|desktop\/docs\/history)\//.exec(path)
    if (archive) {
      const record = /^(\d{3,})-.+\.md$/.exec(name)
      if (!record || Number(record[1]) === 0) throw new Error(`历史记录须有稳定正整数编号: ${path}`)
      const id = `${archive[1]}/${Number(record[1])}`
      if (recordIds.has(id)) throw new Error(`历史编号重复: ${path}`)
      recordIds.add(id)
    }
  }
}
