import { expect, it } from 'vitest'
import { TEAM_RECORD_SOURCE_BOUNDARY_NOTE, teamRunContinuationBoundary, teamRunResultNotice } from '../../src/lib/team-work-continuation'

it('keeps a generic business-record provenance boundary in team-message continuation guidance', () => {
  const boundary = teamRunContinuationBoundary('2026-09-30T00:00:00Z')

  expect(boundary).toContain('记录的是当时这一次团队运行')
  expect(boundary).toContain(TEAM_RECORD_SOURCE_BOUNDARY_NOTE)
  expect(boundary).toContain('不自动等于客户确认')
  expect(boundary).toContain('记录载明')
  expect(boundary).toContain('待核实')
})

const modelNeedsInput = { kind: 'weave' as const, task: '核对合同', runStatus: 'succeeded' as const, materials: [], finalResult: { title: '检查意见', contentType: 'text/markdown', content: '补日期', disposition: 'needs_input' as const, summary: '补日期', missingItems: ['日期'] } }

it('uses completed server result over model needs-input without claiming approval', () => {
  const notice = teamRunResultNotice({ ...modelNeedsInput, businessResult: 'completed' })
  expect(notice).toContain('本轮团队工作已完成')
  expect(notice).toContain('不构成补材料待办')
  expect(notice).toContain('不能据此声称审批通过')
  expect(notice).not.toContain('本轮需要补充的内容')
})

it.each(['action_failed', 'action_unknown'] as const)('does not request model missing items for server result %s', (businessResult) => {
  const notice = teamRunResultNotice({ ...modelNeedsInput, businessResult })
  expect(notice).toContain('不要补件重跑或重放原业务动作')
  expect(notice).not.toContain('本轮需要补充的内容')
})

it('keeps needs-input and absent-field compatibility', () => {
  expect(teamRunResultNotice({ ...modelNeedsInput, businessResult: 'needs_input' })).toContain('本轮需要补充的内容')
  expect(teamRunResultNotice(modelNeedsInput)).toContain('本轮需要补充的内容')
  expect(teamRunResultNotice({ ...modelNeedsInput, actionOutcomes: [{ actionName: '提交', objectName: '合同', status: 'succeeded', summary: '已提交' }] })).toContain('不构成团队补材料待办')
})
