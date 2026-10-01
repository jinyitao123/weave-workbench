import { expect, it } from 'vitest'
import { TEAM_RECORD_SOURCE_BOUNDARY_NOTE, teamRunContinuationBoundary } from '../../src/lib/team-work-continuation'

it('keeps a generic business-record provenance boundary in team-message continuation guidance', () => {
  const boundary = teamRunContinuationBoundary('2026-09-30T00:00:00Z')

  expect(boundary).toContain('记录的是当时这一次团队运行')
  expect(boundary).toContain(TEAM_RECORD_SOURCE_BOUNDARY_NOTE)
  expect(boundary).toContain('不自动等于客户确认')
  expect(boundary).toContain('记录载明')
  expect(boundary).toContain('待核实')
})
