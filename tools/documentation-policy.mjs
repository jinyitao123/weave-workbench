import { basename } from 'node:path'

const specialNames = new Set([
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE.md', 'SKILL.md',
])

export const statusSections = ['现在做到哪', '谁在做什么', '卡在哪', '下一步']
export const statusLimits = { lines: 150, paragraph: 300 }

// The status page is the hand-off entry, so it stays short and current: evidence lives in
// acceptance and environment documents, versions in components.lock.json, history in Git.
export function validateStatusPage(content, lockRevisions = []) {
  const lines = content.split(/\r?\n/)
  if (lines.length > statusLimits.lines) throw new Error(`状态页超过 ${statusLimits.lines} 行: ${lines.length}`)
  const sections = []
  for (const [index, line] of lines.entries()) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading && /历史|旧/.test(heading[2])) throw new Error(`状态页不保留历史章节: 第 ${index + 1} 行 ${line}`)
    if (heading?.[1] === '##') sections.push(heading[2].trim())
    const visible = line.replace(/\]\([^)]*\)/g, ']')
    if (visible.length > statusLimits.paragraph) {
      throw new Error(`状态页单段超过 ${statusLimits.paragraph} 字: 第 ${index + 1} 行（${visible.length} 字）`)
    }
    for (const [token] of line.matchAll(/(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g)) {
      if (!/\d/.test(token) || !/[a-f]/.test(token)) continue
      if (!lockRevisions.some(revision => revision.startsWith(token))) {
        throw new Error(`状态页不手写版本号，以 components.lock.json 为准: 第 ${index + 1} 行 ${token}`)
      }
    }
  }
  if (sections.join('|') !== statusSections.join('|')) {
    throw new Error(`状态页只保留四个栏目「${statusSections.join('、')}」，当前为「${sections.join('、')}」`)
  }
}

// Returns the part of the status page that registers active write tasks and branches.
export function statusRegistry(content) {
  const start = content.indexOf(`## ${statusSections[1]}`)
  if (start < 0) return ''
  const end = content.indexOf('\n## ', start + 1)
  return content.slice(start, end < 0 ? undefined : end)
}

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
