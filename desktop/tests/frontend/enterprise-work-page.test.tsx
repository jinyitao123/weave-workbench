// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EnterpriseWorkPage } from '../../src/pages/EnterpriseWorkPage'
import type { EnterpriseWorkOverview } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
const refresh = vi.fn()
const continueWork = vi.fn()

const overview: EnterpriseWorkOverview = {
  loadedAt: '2026-09-23T01:00:00Z',
  choices: [],
  tasks: [{ interactionId: 'approval-1', runId: 'forge:approval:approval-1', teamId: 'forge', workflowId: 'business-approval', workflowVersion: 1, title: '合同交付复核', instructions: '请核对合同', updatedAt: '2026-09-23T01:00:00Z', source: 'forge', mode: 'approval' }],
  items: [{ id: 'notice-1', kind: 'result', title: '合同团队已完成', status: 'unread', actionable: false, read: false, source: 'forge', createdAt: '2026-09-23T01:00:00Z' }],
  runs: [{ id: 'run-1', status: 'running', startedAt: '2026-09-23T01:00:00Z', durationMs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }],
  reads: {
    runs: { status: 'loaded' }, teamChoices: { status: 'loaded' }, weaveTasks: { status: 'failed', error: '团队信息读取失败（503）' },
    forgeApprovals: { status: 'loaded' }, notifications: { status: 'failed', error: '通知读取失败（503）' },
  },
}

beforeEach(() => {
  refresh.mockClear()
  continueWork.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it('shows available work beside source-specific errors and offers retry without claiming the inbox is empty', async () => {
  await act(async () => root.render(<EnterpriseWorkPage
    overview={overview} loading={false} error="" onRefresh={refresh}
    onComplete={vi.fn(async () => undefined)} onInspect={vi.fn(async () => ({ title: '', step: '', fields: [], files: [] }))}
    onContinue={continueWork}
  />))

  expect(container.textContent).toContain('合同交付复核')
  expect(container.textContent).toContain('合同团队已完成')
  expect(container.textContent).toContain('团队执行 · 处理中')
  expect(container.textContent).toContain('Forge 业务通知')
  expect(container.textContent).toContain('团队人工步骤暂时不可用：团队信息读取失败（503）')
  expect(container.textContent).toContain('工作通知暂时不可用：通知读取失败（503）')
  expect(container.textContent).not.toContain('当前没有待处理事项。')

  const unsafeContinuation = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '原工作暂不可续接')
  expect(unsafeContinuation?.disabled).toBe(true)
  await act(async () => unsafeContinuation?.click())
  expect(continueWork).not.toHaveBeenCalled()

  const retries = [...container.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent === '重试读取')
  expect(retries).toHaveLength(2)
  await act(async () => retries[0]!.click())
  expect(refresh).toHaveBeenCalledOnce()
})

it('keeps a native Weave team-run notification openable when its source is resolved on click', async () => {
  const item = { ...overview.items[0]!, source: 'weave' as const, notificationType: 'weave.team_run.result' }
  await act(async () => root.render(<EnterpriseWorkPage
    overview={{ ...overview, items: [item], reads: { ...overview.reads, notifications: { status: 'loaded' } } }}
    loading={false} error="" onRefresh={refresh}
    onComplete={vi.fn(async () => undefined)} onInspect={vi.fn(async () => ({ title: '', step: '', fields: [], files: [] }))}
    onContinue={continueWork}
  />))

  const continueButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '交给 Pi 查看')
  expect(continueButton?.disabled).toBe(false)
  await act(async () => continueButton?.click())
  expect(continueWork).toHaveBeenCalledWith(item)
})
