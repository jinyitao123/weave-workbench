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

const overview: EnterpriseWorkOverview = {
  loadedAt: '2026-09-23T01:00:00Z',
  choices: [],
  tasks: [{ interactionId: 'approval-1', runId: 'forge:approval:approval-1', teamId: 'forge', workflowId: 'business-approval', workflowVersion: 1, title: '合同交付复核', instructions: '请核对合同', updatedAt: '2026-09-23T01:00:00Z', source: 'forge', mode: 'approval' }],
  items: [{ id: 'notice-1', kind: 'result', title: '合同团队已完成', status: 'unread', actionable: false, read: false, source: 'forge', createdAt: '2026-09-23T01:00:00Z' }],
  runs: [{ id: 'run-1', status: 'running', startedAt: '2026-09-23T01:00:00Z', durationMs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }],
  reads: {
    runs: { status: 'loaded' }, teamChoices: { status: 'loaded' }, weaveTasks: { status: 'failed', error: 'Weave 读取失败（503）' },
    forgeApprovals: { status: 'loaded' }, notifications: { status: 'failed', error: 'Forge 通知读取失败（503）' },
  },
}

beforeEach(() => {
  refresh.mockClear()
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
    onContinue={vi.fn()}
  />))

  expect(container.textContent).toContain('合同交付复核')
  expect(container.textContent).toContain('合同团队已完成')
  expect(container.textContent).toContain('Weave 人工待办暂时不可用：Weave 读取失败（503）')
  expect(container.textContent).toContain('工作通知暂时不可用：Forge 通知读取失败（503）')
  expect(container.textContent).not.toContain('当前没有待处理事项。')

  const retries = [...container.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent === '重试读取')
  expect(retries).toHaveLength(2)
  await act(async () => retries[0]!.click())
  expect(refresh).toHaveBeenCalledOnce()
})
