// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EnterpriseWorkPage } from '../../src/pages/EnterpriseWorkPage'
import { APPROVAL_REVIEW_SESSION_MARKER, openApprovalReviewInPi } from '../../src/lib/approval-review'
import type { EnterpriseApprovalContextView, EnterpriseWorkOverview, ProjectRecord, SessionRecord } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
const refresh = vi.fn()
const continueWork = vi.fn()
const assistPi = vi.fn(async () => undefined)

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
  assistPi.mockClear()
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
    onAssist={assistPi}
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
    onAssist={assistPi}
    onContinue={continueWork}
  />))

  const continueButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '交给 Pi 查看')
  expect(continueButton?.disabled).toBe(false)
  await act(async () => continueButton?.click())
  expect(continueWork).toHaveBeenCalledWith(item)
})

it('opens a typed Forge result message through the source resolver without inferring a record from its text', async () => {
  const item = { ...overview.items[0]!, source: 'forge' as const, kind: 'result' as const, notificationType: 'sales.contract.approved' }
  await act(async () => root.render(<EnterpriseWorkPage
    overview={{ ...overview, items: [item], reads: { ...overview.reads, notifications: { status: 'loaded' } } }}
    loading={false} error="" onRefresh={refresh}
    onComplete={vi.fn(async () => undefined)} onInspect={vi.fn(async () => ({ title: '', step: '', fields: [], files: [] }))}
    onAssist={assistPi} onContinue={continueWork}
  />))

  const continueButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '交给 Pi 查看')
  expect(continueButton?.disabled).toBe(false)
  await act(async () => continueButton?.click())
  expect(continueWork).toHaveBeenCalledWith(item)
})

it('lets a reviewer send the verified approval snapshot and files to Pi for read-only analysis', async () => {
  const context: EnterpriseApprovalContextView = {
    title: '合同交付复核', step: '交付与商务会签',
    fields: [{ label: '合同编号', value: 'MVP1-C-001' }],
    files: [{ name: '合同正文.md', content: '合同正文原文', verified: true }],
  }
  const inspect = vi.fn(async () => context)
  await act(async () => root.render(<EnterpriseWorkPage
    overview={{ ...overview, items: [], reads: { ...overview.reads, weaveTasks: { status: 'loaded' }, notifications: { status: 'loaded' } } }}
    loading={false} error="" onRefresh={refresh}
    onComplete={vi.fn(async () => undefined)} onInspect={inspect} onAssist={assistPi} onContinue={continueWork}
  />))

  const viewMaterials = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '查看材料')
  await act(async () => viewMaterials?.click())
  const assistButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '让 Pi 协助复核')
  expect(assistButton?.disabled).toBe(false)
  await act(async () => assistButton?.click())
  expect(assistPi).toHaveBeenCalledWith(overview.tasks[0])
})

it('opens the clicked Forge approval in a fresh renderer session and queues only its pinned snapshot', async () => {
  const context: EnterpriseApprovalContextView = {
    title: '本轮审批', step: '交付会签', returnReason: '补充验收范围',
    fields: [{ label: '版本', value: 'R2' }],
    files: [{ name: 'R2合同.docx', content: 'R2 原文', verified: true }],
  }
  const enterprise = { pinApprovalReviewContext: vi.fn(async () => ({ handle: 'review-context-handle', context })) }
  const workspaceRef = { current: { project: { id: 'project' } as ProjectRecord, session: undefined as SessionRecord | undefined, sessionFile: undefined as string | undefined } }
  const queuePrompt = vi.fn()
  const workspace = { workspaceRef, queuePrompt } as unknown as Parameters<typeof openApprovalReviewInPi>[1]['workspace']
  const newSession = vi.fn((_project?: ProjectRecord, _options?: { preserveComposerDraft?: boolean }) => true)
  const setToast = vi.fn()
  const onAssist = vi.fn((task) => openApprovalReviewInPi(task, { enterprise, newSession, workspace, setToast }))
  const inspect = vi.fn(async () => context)

  await act(async () => root.render(<EnterpriseWorkPage
    overview={{ ...overview, items: [], reads: { ...overview.reads, weaveTasks: { status: 'loaded' }, notifications: { status: 'loaded' } } }}
    loading={false} error="" onRefresh={refresh}
    onComplete={vi.fn(async () => undefined)} onInspect={inspect} onAssist={onAssist} onContinue={continueWork}
  />))
  const viewMaterials = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '查看材料')
  await act(async () => viewMaterials?.click())
  const assistButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '让 Pi 协助复核')
  await act(async () => assistButton?.click())

  expect(enterprise.pinApprovalReviewContext).toHaveBeenCalledWith('approval-1')
  expect(newSession).toHaveBeenCalledWith(undefined, { preserveComposerDraft: true })
  expect(queuePrompt).toHaveBeenCalledOnce()
  const [prompt, intent, , , , , contextHandle] = queuePrompt.mock.calls[0] as unknown as [string, string, unknown, unknown, unknown, unknown, string]
  expect(intent).toBe('queue')
  expect(contextHandle).toBe('review-context-handle')
  expect(prompt).toContain('R2 原文')
  expect(prompt).toContain('历史聊天不作为当前事实')
  expect(prompt).toContain(APPROVAL_REVIEW_SESSION_MARKER)
  expect(setToast).toHaveBeenCalledWith('已打开本次审批材料，可继续和 Pi 核对。')
})

it('keeps the approval on the work page when a fresh renderer session cannot be opened', async () => {
  const context: EnterpriseApprovalContextView = {
    title: '本轮审批', step: '交付会签', fields: [],
    files: [{ name: 'R2合同.docx', content: 'R2 原文', verified: true }],
  }
  const enterprise = { pinApprovalReviewContext: vi.fn(async () => ({ handle: 'review-context-handle', context })) }
  const workspace = {
    workspaceRef: { current: { project: { id: 'project' } as ProjectRecord, session: undefined as SessionRecord | undefined, sessionFile: undefined as string | undefined } },
    queuePrompt: vi.fn(),
  } as unknown as Parameters<typeof openApprovalReviewInPi>[1]['workspace']
  const newSession = vi.fn(() => false)
  const onAssist = (task: (typeof overview.tasks)[number]) => openApprovalReviewInPi(task, { enterprise, newSession, workspace, setToast: vi.fn() })

  await act(async () => root.render(<EnterpriseWorkPage
    overview={{ ...overview, items: [], reads: { ...overview.reads, weaveTasks: { status: 'loaded' }, notifications: { status: 'loaded' } } }}
    loading={false} error="" onRefresh={refresh}
    onComplete={vi.fn(async () => undefined)} onInspect={vi.fn(async () => context)} onAssist={onAssist} onContinue={continueWork}
  />))
  const viewMaterials = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '查看材料')
  await act(async () => viewMaterials?.click())
  const assistButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '让 Pi 协助复核')
  await act(async () => assistButton?.click())

  expect(workspace.queuePrompt).not.toHaveBeenCalled()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('无法创建独立审批辅助会话')
})
