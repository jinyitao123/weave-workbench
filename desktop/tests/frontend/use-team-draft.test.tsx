// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTeamDraft } from '../../src/pages/team-workspace/useTeamDraft'
import type { TeamWorkspace, TeamWorkspaceBridge, TeamWorkspaceCommand } from '../../src/types/team-workspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement, server: TeamWorkspace
let current: ReturnType<typeof useTeamDraft>
const read = vi.fn(async (): Promise<TeamWorkspace> => structuredClone(server))
const bridge: TeamWorkspaceBridge = async <T,>(command: TeamWorkspaceCommand) => {
  expect(command.action).toBe('get')
  return await read() as T
}

function Harness() {
  current = useTeamDraft('team', bridge)
  return <p>{current.draft?.document.objective}</p>
}
function ready(allowed: boolean): TeamWorkspace['publication_readiness'] {
  return { ready: allowed, workflows: [] }
}
function deferred() {
  let resolve!: (value: TeamWorkspace) => void
  const promise = new Promise<TeamWorkspace>((done) => { resolve = done })
  return { promise, resolve }
}
const trial = { request_id: 'new-trial', revision: 3, workflow_id: 'flow', run_id: 'run', status: 'succeeded', created_at: '' }

beforeEach(async () => {
  read.mockReset().mockImplementation(async () => structuredClone(server))
  server = { revision: 3, published_revision: 2, publishing_revision: 0, prepared_revision: 3, document: { name: '团队', objective: '远端目标', members: [], workflows: [] }, trials: [], updated_at: '' }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(<Harness/>))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

it('refreshes same-revision readiness with trials and clears a previously ready value when the server omits it', async () => {
  server = { ...server, trials: [trial], publication_readiness: ready(true) }
  await act(async () => current.refreshTrials())
  expect(current.draft?.trials).toEqual([trial])
  expect(current.draft?.publication_readiness?.ready).toBe(true)

  delete server.publication_readiness
  server.trials = []
  await act(async () => current.refreshTrials())
  expect(current.draft?.trials).toEqual([])
  expect(current.draft?.publication_readiness).toBeUndefined()

  server.publication_readiness = ready(false)
  await act(async () => current.refreshTrials())
  expect(current.draft?.publication_readiness?.ready).toBe(false)
})

it('preserves unsaved manual edits and publication metadata while refreshing server-derived evidence', async () => {
  await act(async () => current.edit({ ...current.draft!.document, objective: '尚未保存的人工目标' }))
  server = { ...server, trials: [trial], publication_readiness: ready(true), published_revision: 3, publishing_revision: 3, updated_at: 'changed-remotely' }
  await act(async () => current.refreshTrials())
  expect(current.dirty).toBe(true)
  expect(current.draft?.document.objective).toBe('尚未保存的人工目标')
  expect(container.textContent).toBe('尚未保存的人工目标')
  expect(current.draft).toMatchObject({ published_revision: 2, publishing_revision: 0, prepared_revision: 3, updated_at: '', trials: [trial], publication_readiness: ready(true) })
  await act(async () => current.discard())
  expect(current.draft?.document.objective).toBe('远端目标')
  expect(current.draft?.publication_readiness?.ready).toBe(true)
})

it('rejects evidence returned for another revision', async () => {
  server = { ...server, revision: 4, trials: [{ ...trial, revision: 4 }], publication_readiness: ready(true) }
  await act(async () => current.refreshTrials())
  expect(current.draft?.revision).toBe(3)
  expect(current.draft?.trials).toEqual([])
  expect(current.draft?.publication_readiness).toBeUndefined()
})

it.each([3, 4])('ignores an outstanding refresh after replacing the draft with revision %s', async (revision) => {
  const late = deferred()
  read.mockReturnValueOnce(late.promise)
  let refreshing!: Promise<void>
  await act(async () => { refreshing = current.refreshTrials() })
  await act(async () => current.replace({ ...server, revision, document: { ...server.document, objective: '重新读取后的目标' } }))
  await act(async () => { late.resolve({ ...server, trials: [trial], publication_readiness: ready(true) }); await refreshing })
  expect(current.draft?.revision).toBe(revision)
  expect(current.draft?.document.objective).toBe('重新读取后的目标')
  expect(current.draft?.trials).toEqual([])
  expect(current.draft?.publication_readiness).toBeUndefined()
})

it('does not let an older concurrent ready response undo a newer missing result', async () => {
  const old = deferred(), newer = deferred()
  read.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise)
  let first!: Promise<void>, second!: Promise<void>
  await act(async () => { first = current.refreshTrials(); second = current.refreshTrials() })
  await act(async () => { newer.resolve({ ...server, publication_readiness: ready(false) }); await second })
  await act(async () => { old.resolve({ ...server, trials: [trial], publication_readiness: ready(true) }); await first })
  expect(current.draft?.publication_readiness?.ready).toBe(false)
  expect(current.draft?.trials).toEqual([])
})
