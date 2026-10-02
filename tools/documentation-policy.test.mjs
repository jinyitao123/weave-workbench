import assert from 'node:assert/strict'
import test from 'node:test'
import { statusLimits, statusRegistry, validateDocumentPaths, validateStatusPage } from './documentation-policy.mjs'

test('allows Chinese purpose names, product phases, protocol versions and conventional entry files', () => {
  assert.doesNotThrow(() => validateDocumentPaths([
    'AGENTS.md', 'docs/README.md', 'docs/plans/MVP1阶段说明.md',
    'contracts/v1/团队工作区契约.md', 'desktop/docs/Pi接入设计.md',
    'docs/acceptance/001-合同复核.md', 'docs/releases/001-阶段里程碑.md',
  ]))
})

test('rejects English-only, dated and competing version filenames', () => {
  for (const path of [
    'docs/design.md', 'docs/合同场景-20260923.md', 'docs/合同场景-2026-09-23.md',
    'docs/合同场景-v2.md', 'docs/合同场景-最新版.md', 'docs/合同场景-最终版.md',
    'docs/合同场景-修改版.md', 'docs/合同场景-副本.md',
  ]) assert.throws(() => validateDocumentPaths([path]), /文档/)
})

test('rejects missing, zero and reused historical record numbers within a collection', () => {
  for (const paths of [
    ['docs/acceptance/合同评审.md'], ['docs/releases/000-阶段说明.md'],
    ['docs/acceptance/001-登录评审.md', 'docs/acceptance/001-合同评审.md'],
    ['desktop/docs/history/桌面里程碑.md'],
  ]) assert.throws(() => validateDocumentPaths(paths), /历史/)
})

const statusPage = (body = {}) => [
  '# 当前项目状态', '',
  '## 现在做到哪', body.now ?? '合同场景待续办。', '',
  '## 谁在做什么', body.who ?? '| 负责人 | 分支 | 退出条件 |', '',
  '## 卡在哪', body.blocked ?? '无。', '',
  '## 下一步', body.next ?? '继续合同续办。', '',
].join('\n')
const revision = '5a47d405f844a1edf480607b296ce8c1f9b0a1ca'

test('accepts a short status page with the four fixed sections and lock-backed versions', () => {
  assert.doesNotThrow(() => validateStatusPage(statusPage({ now: 'Weave 锁定 5a47d405，见[锁](../a.md)。' }), [revision]))
})

test('accepts CRLF status pages and extracts only the active registry', () => {
  const content = statusPage({ who: '`codex/hygiene`', next: '`codex/other`' }).replaceAll('\n', '\r\n')
  assert.doesNotThrow(() => validateStatusPage(content))
  assert.match(statusRegistry(content), /codex\/hygiene/)
  assert.doesNotMatch(statusRegistry(content), /codex\/other/)
})

test('rejects long, historical, unstructured or version-carrying status pages', () => {
  for (const [content, pattern] of [
    [statusPage() + '\n'.repeat(statusLimits.lines), /行/],
    [statusPage({ now: '证'.repeat(statusLimits.paragraph + 1) }), /单段/],
    [statusPage({ blocked: '### 旧环境记录' }), /历史章节/],
    [statusPage() + '\n## 历史联调证据\n', /历史章节/],
    [statusPage() + '\n## 工作队列\n', /四个栏目/],
    [statusPage({ now: '124 运行 3ed7ec36。' }), /版本号/],
  ]) assert.throws(() => validateStatusPage(content, [revision]), pattern)
})

test('ignores long link targets, plain numbers and words when measuring the status page', () => {
  const link = `[环境说明](${'x'.repeat(400)}.md)`
  assert.doesNotThrow(() => validateStatusPage(statusPage({ now: `${link} CI 36811921493 deadbeef` }), [revision]))
})

test('reads the branch registry only from the who-is-doing-what section', () => {
  const registry = statusRegistry(statusPage({ who: '| 本会话 | `docs/repo-hygiene-rules` | 合入 |', next: '`codex/elsewhere`' }))
  assert.match(registry, /docs\/repo-hygiene-rules/)
  assert.doesNotMatch(registry, /codex\/elsewhere/)
})
