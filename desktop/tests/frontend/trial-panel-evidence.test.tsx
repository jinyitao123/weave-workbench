// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TrialPanel } from '../../src/pages/team-workspace/TrialPanel'
import type { TeamWorkspace, TeamWorkspaceBridge, TeamWorkspaceCommand } from '../../src/types/team-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

function draft(): TeamWorkspace {
  return {
    revision: 2, published_revision: 1, publishing_revision: 0, prepared_revision: 0, updated_at: '',
    trials: [{ request_id: 'trial-1', revision: 2, workflow_id: 'flow-1', run_id: 'run-1', status: 'succeeded', created_at: '2026-09-30T00:00:00Z' }],
    document: {
      name: 'Team', objective: '', members: [{ id: 'member-1', configuration: { businessCapabilityIds: [] } }],
      workflows: [{ id: 'flow-1', name: 'Flow', description: '', trigger_config: {}, graph_definition: {} as TeamWorkspace['document']['workflows'][number]['graph_definition'] }],
    },
  } as unknown as TeamWorkspace
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function renderPanel(activityResult: { status: string; completeness?: { member_tool_activity?: string }; members: Array<{ name: string; status: string; stages: Array<{ name: string; status: string; inputs: Array<{ source: string }>; tools?: Array<{ name: string; status: string }> | null; tool_calls?: number }> }>; outputs: Array<{ title: string; content: string }> } | Error) {
  const snapshot = draft()
  const bridge: TeamWorkspaceBridge = async <T,>(command: TeamWorkspaceCommand) => {
    if (command.action === 'activity') {
      if (activityResult instanceof Error) throw activityResult
      return activityResult as T
    }
    if (command.action === 'input') return { input: '试跑输入', status: 'succeeded', output: '已提交至业务系统' } as T
    return snapshot as T
  }
  return act(async () => root.render(<TrialPanel teamId="team-1" draft={snapshot} bridge={bridge} flush={async () => snapshot} refresh={vi.fn(async () => undefined)}/>))
}

it('uses tools:null as zero calls only when Weave marks tool activity complete', async () => {
  await renderPanel({
    status: 'succeeded',
    completeness: { member_tool_activity: 'complete' },
    members: [{ name: 'Worker', status: 'succeeded', stages: [{ name: 'Submit', status: 'completed', inputs: [], tools: null }] }],
    outputs: [{ title: 'Final summary', content: '已提交至业务系统' }],
  })

  expect(container.textContent).toContain('团队摘要')
  expect(container.textContent).toContain('已提交至业务系统')
  expect(container.textContent).toContain('平台完整活动记录显示本次调用次数为 0')
  expect(container.textContent).toContain('不能据此认定已提交')
  expect(container.textContent).toContain('团队运行完成')
})

it('does not treat tools:[] as zero calls when Weave marks tool activity partial', async () => {
  await renderPanel({
    status: 'succeeded',
    completeness: { member_tool_activity: 'partial' },
    members: [{ name: 'Worker', status: 'succeeded', stages: [{ name: 'Submit', status: 'completed', inputs: [], tools: [] }] }],
    outputs: [{ title: 'Final summary', content: '已提交至业务系统' }],
  })

  expect(container.textContent).toContain('活动记录未证明工具调用清单完整')
  expect(container.textContent).not.toContain('平台完整活动记录显示本次调用次数为 0')
})

it('does not silently present the model summary as verified when activity cannot be read', async () => {
  await renderPanel(new Error('activity unavailable'))

  expect(container.textContent).toContain('活动记录暂时无法读取')
  expect(container.textContent).toContain('团队摘要不能证明业务已提交')
  expect(container.textContent).toContain('已提交至业务系统')
})
