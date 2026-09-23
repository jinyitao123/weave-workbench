import assert from 'node:assert/strict'
import test from 'node:test'
import { validateDocumentPaths } from './documentation-policy.mjs'

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
