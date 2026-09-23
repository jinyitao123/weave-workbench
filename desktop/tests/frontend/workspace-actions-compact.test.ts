import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceActions, type WorkspaceActionsDeps } from '../../src/hooks/useWorkspaceActions'
import type { PrimeWorkApi, RuntimeInfo, SessionRecord, TranscriptMessage, WorkspaceMaterialReference } from '../../src/types/api'

const project = {
  id: 'compact-project',
  harness: 'prime' as const,
  name: 'Compact project',
  path: '/compact-project',
  folders: ['/compact-project'],
  primaryFolder: '/compact-project',
  pinned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
  sessionCount: 1,
}

const session = (status: SessionRecord['status'] = 'idle'): SessionRecord => ({
  id: 'compact-session',
  harness: 'prime',
  filePath: '/compact-project/session.jsonl',
  projectPath: '/compact-project',
  title: 'Compact session',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status,
  depth: 0,
})

const runtime = (runtimeId = 'idle-runtime', isStreaming = false): RuntimeInfo => ({
  runtimeId,
  harness: 'prime',
  cwd: project.primaryFolder,
  sessionFile: session().filePath,
  isStreaming,
})

interface FixtureOptions {
  runtime?: RuntimeInfo | null
  sessionStatus?: SessionRecord['status']
  ownsStreaming?: boolean
  withSession?: boolean
}

function fixture({ runtime: configuredRuntime = null, sessionStatus = 'idle', ownsStreaming = false, withSession = true }: FixtureOptions = {}) {
  let currentRuntime = configuredRuntime
  let messages: TranscriptMessage[] = []
  const currentSession = withSession ? session(sessionStatus) : undefined
  const workspaceRef = {
    current: {
      generation: 1,
      project,
      session: currentSession,
      cwd: project.primaryFolder,
      sessionFile: currentSession?.filePath,
    },
  }
  const runtimeIdRef = { current: ownsStreaming && configuredRuntime ? configuredRuntime.runtimeId : null as string | null }
  const runtimeOwnerRef = {
    current: ownsStreaming && configuredRuntime
      ? { runtimeId: configuredRuntime.runtimeId, generation: 1 }
      : null as { runtimeId: string; generation: number } | null,
  }
  const command = vi.fn(async (_runtimeId: string, _command: Record<string, unknown>) => ({}))
  const start = vi.fn(async () => runtime('started-runtime'))
  const followUp = vi.fn(async () => true)
  const queuePrompt = vi.fn()
  const invalidateHandoff = vi.fn(async () => {})
  const setToast = vi.fn()
  const reportError = vi.fn()
  const workspace = {
    runtime: currentRuntime,
    workspaceRef,
    runtimeIdRef,
    runtimeOwnerRef,
    prepareForPrompt: () => true,
    attachRuntime: (next: RuntimeInfo | undefined) => { currentRuntime = next ?? null },
    setRuntime: (next: RuntimeInfo | ((current: RuntimeInfo | null) => RuntimeInfo | null)) => {
      currentRuntime = typeof next === 'function' ? next(currentRuntime) : next
    },
    setMessages: (next: TranscriptMessage[] | ((current: TranscriptMessage[]) => TranscriptMessage[])) => {
      messages = typeof next === 'function' ? next(messages) : next
    },
    queuePrompt,
    removeQueuedPrompt: vi.fn(),
    markQueuedPromptFlushFailed: vi.fn(),
  }
  const agentList = vi.fn(async () => configuredRuntime ? [configuredRuntime] : [])
  const bridge = {
    enterprise: { invalidateHandoff },
    agent: { list: agentList, command, start, stop: vi.fn(async () => false) },
    sessions: { followUp },
  } as unknown as PrimeWorkApi
  const workspaceSessions = currentSession ? [currentSession] : []
  const actions = createWorkspaceActions(() => ({
    bridge,
    projects: [project],
    sessions: workspaceSessions,
    activeProject: project,
    workspace,
    settingsState: { settings: { activeHarness: 'prime' } },
    provider: { model: 'auto', effort: 'medium', fast: false },
    submissionAdmissionRef: { current: { active: false, run: async (task: () => Promise<void>) => { await task(); return true } } },
    initialized: true,
    layout: {},
    pluginSkills: {},
    gitRequestRef: { current: 0 },
    demoTimerRef: { current: [] },
    setProjects: vi.fn(),
    setSessions: vi.fn(),
    setGitSnapshot: vi.fn(),
    setView: vi.fn(),
    setPaletteOpen: vi.fn(),
    setToast,
    setSubmitting: vi.fn(),
    refreshSchedules: vi.fn(),
    refreshHeartbeats: vi.fn(),
    resetBrowserView: vi.fn(),
    closeTerminalForSession: vi.fn(),
    clearSessionAttention: vi.fn(),
    reportError,
  } as unknown as WorkspaceActionsDeps))

  return { actions, command, start, followUp, queuePrompt, invalidateHandoff, setToast, reportError, workspaceRef, messages: () => messages }
}

describe('/compact dispatch', () => {
  it('sends compact to an idle runtime without a prompt command or user message', async () => {
    const fixtureState = fixture({ runtime: runtime() })

    await fixtureState.actions.sendPrompt('/compact')

    expect(fixtureState.command).toHaveBeenCalledOnce()
    expect(fixtureState.command).toHaveBeenCalledWith('idle-runtime', { type: 'compact' })
    expect(fixtureState.command).not.toHaveBeenCalledWith('idle-runtime', expect.objectContaining({ type: 'prompt' }))
    expect(fixtureState.messages().filter((message) => message.role === 'user')).toHaveLength(0)
  })

  it('passes custom instructions to compact', async () => {
    const fixtureState = fixture({ runtime: runtime() })

    await fixtureState.actions.sendPrompt('/compact focus on auth')

    expect(fixtureState.command).toHaveBeenCalledWith('idle-runtime', { type: 'compact', customInstructions: 'focus on auth' })
  })

  it('queues compact for an owned streaming runtime', async () => {
    const fixtureState = fixture({ runtime: runtime('streaming-runtime', true), ownsStreaming: true })

    await fixtureState.actions.sendPrompt('/compact', [], 'steer')

    expect(fixtureState.command).not.toHaveBeenCalled()
    expect(fixtureState.queuePrompt).toHaveBeenCalledWith('/compact', 'queue')
    expect(fixtureState.setToast).toHaveBeenCalledWith('Compaction will run when the current turn finishes.')
  })

  it('does not start a runtime when there is nothing to compact', async () => {
    const fixtureState = fixture({ withSession: false })

    await fixtureState.actions.sendPrompt('/compact')

    expect(fixtureState.start).not.toHaveBeenCalled()
    expect(fixtureState.command).not.toHaveBeenCalled()
    expect(fixtureState.setToast).toHaveBeenCalledWith('Nothing to compact yet.')
  })

  it('does not follow up an externally running session', async () => {
    const fixtureState = fixture({ sessionStatus: 'running' })

    await fixtureState.actions.sendPrompt('/compact')

    expect(fixtureState.followUp).not.toHaveBeenCalled()
    expect(fixtureState.start).not.toHaveBeenCalled()
    expect(fixtureState.setToast).toHaveBeenCalledWith('Compaction is unavailable while this session is running outside GooeyPi.')
  })

  it('rejects image attachments', async () => {
    const fixtureState = fixture({ runtime: runtime() })

    await expect(fixtureState.actions.sendPrompt('/compact', [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }])).rejects.toThrow(/does not accept attachments/)

    expect(fixtureState.reportError).toHaveBeenCalledWith('/compact does not accept attachments. Remove the attachment and try again.')
    expect(fixtureState.command).not.toHaveBeenCalled()
    expect(fixtureState.start).not.toHaveBeenCalled()
  })

  it('queues compact for a non-owned streaming runtime instead of steering it', async () => {
    const fixtureState = fixture({ runtime: runtime('external-streaming-runtime', true) })

    await fixtureState.actions.sendPrompt('/compact', [], 'steer')

    expect(fixtureState.command).not.toHaveBeenCalled()
    expect(fixtureState.followUp).not.toHaveBeenCalled()
    expect(fixtureState.queuePrompt).toHaveBeenCalledWith('/compact', 'queue')
    expect(fixtureState.setToast).toHaveBeenCalledWith('Compaction will run when the current turn finishes.')
  })
})


describe('queued employee input invalidates enterprise handoff', () => {
  it('revokes before storing a local queue entry even though no runtime command is sent', async () => {
    const f = fixture({ runtime: runtime('streaming', true), ownsStreaming: true })
    let finish!: () => void
    f.invalidateHandoff.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const sending = f.actions.sendPrompt('先别发', [], 'queue')
    expect(f.invalidateHandoff).toHaveBeenCalledWith('streaming')
    expect(f.queuePrompt).not.toHaveBeenCalled()
    finish()
    await sending
    expect(f.queuePrompt).toHaveBeenCalledWith('先别发', 'queue')
    expect(f.command).not.toHaveBeenCalled()
  })
  it('does not silently queue an employee change when revocation fails', async () => {
    const f = fixture({ runtime: runtime('streaming', true), ownsStreaming: true })
    f.invalidateHandoff.mockRejectedValueOnce(new Error('bridge disconnected'))
    await expect(f.actions.sendPrompt('先别发', [], 'queue')).rejects.toThrow('bridge disconnected')
    expect(f.queuePrompt).not.toHaveBeenCalled()
  })
})

describe('workspace text attachment prompt binding', () => {
  const attachment: WorkspaceMaterialReference = {
    projectId: project.id,
    harness: 'prime',
    workspacePath: project.primaryFolder,
    name: 'source.md',
    path: '材料/附件/opaque/source.md',
    sha256: 'a'.repeat(64),
    bytes: 14,
    mimeType: 'text/markdown',
  }

  it('sends the exact attachment reference block that is stored in the Pi user turn', async () => {
    const f = fixture({ runtime: runtime() })

    await f.actions.sendPrompt('请阅读这个文件', [], 'queue', undefined, undefined, [attachment])

    const command = f.command.mock.calls[0]?.[1] as { type?: string; message?: string }
    const userMessage = f.messages().find((message) => message.role === 'user')
    expect(command.type).toBe('prompt')
    expect(command.message).toContain('材料/附件/opaque/source.md')
    expect(command.message).toContain(attachment.sha256)
    expect(userMessage?.parts.find((part) => part.type === 'text')?.text).toBe(command.message)
  })

  it('rejects a file reference after the active project changes', async () => {
    const f = fixture({ runtime: runtime() })
    f.workspaceRef.current.project = { ...project, id: 'another-project' }

    await expect(f.actions.sendPrompt('请阅读这个文件', [], 'queue', undefined, undefined, [attachment])).rejects.toThrow(/different workspace/)

    expect(f.command).not.toHaveBeenCalled()
    expect(f.messages().some((message) => message.role === 'user')).toBe(false)
  })
})
