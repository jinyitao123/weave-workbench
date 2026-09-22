import { useCallback, useEffect, useRef, useState } from 'react'
import type { TeamDefinition, TeamWorkspace, TeamWorkspaceBridge } from '@/types/team-workspace'

export function useTeamDraft(teamId: string, bridge: TeamWorkspaceBridge) {
  const [draft, setDraft] = useState<TeamWorkspace>()
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const state = useRef<{ remote?: TeamWorkspace; document?: TeamDefinition; generation: number; saved: number; flight?: Promise<TeamWorkspace | undefined> }>({ generation: 0, saved: 0 })
  const alive = useRef(true)
  const flush = useCallback(async (): Promise<TeamWorkspace | undefined> => {
    const s = state.current
    if (s.flight) return s.flight
    if (!s.remote || !s.document || s.saved === s.generation) return s.remote
    setSaving(true); setError('')
    s.flight = (async () => {
      try {
        {
          const generation = s.generation
          const document = structuredClone(s.document!)
          const remote = await bridge({ action: 'save', teamId, revision: s.remote!.revision, document })
          s.remote = remote; s.saved = generation
          if (alive.current) { setDraft({ ...remote, document: s.document! }); setDirty(s.saved !== s.generation) }
        }
        return s.remote
      } catch (cause) {
        if (alive.current) setError(cause instanceof Error ? cause.message : '保存失败，请重试')
        throw cause
      } finally { s.flight = undefined; if (alive.current) setSaving(false) }
    })()
    return s.flight
  }, [bridge, teamId])
  const replace = useCallback((remote: TeamWorkspace) => {
    state.current.remote = remote; state.current.document = remote.document
    state.current.generation = 0; state.current.saved = 0
    setDraft(remote); setDirty(false); setError('')
  }, [])
  const load = useCallback(async () => {
    try { replace(await bridge({ action: 'get', teamId })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败') }
  }, [bridge, teamId, replace])
  useEffect(() => {
    alive.current = true
    let cancelled = false
    void bridge({ action: 'get', teamId }).then((remote) => { if (!cancelled) replace(remote) }).catch((cause: Error) => { if (!cancelled) setError(cause.message) })
    return () => { cancelled = true; alive.current = false;  }
  }, [bridge, teamId, replace])
  const edit = (document: TeamDefinition) => {
    const s = state.current
    if (!s.remote || s.remote.publishing_revision) return
    s.document = document; s.generation += 1
    setDraft({ ...s.remote, document }); setDirty(true)
  }
  const refreshTrials = async () => {
    const remote = await bridge({ action: 'get', teamId })
    if (state.current.remote && remote.revision === state.current.remote.revision) {
      state.current.remote = { ...state.current.remote, trials: remote.trials }
      setDraft((d) => d ? { ...d, trials: remote.trials } : d)
    }
  }
  const discard = () => { if (state.current.remote && !state.current.flight) replace(state.current.remote) }
  return { discard, draft, saving, dirty, error, edit, flush, replace, load, refreshTrials }
}
