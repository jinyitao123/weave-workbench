import { useCallback, useEffect, useRef, useState } from 'react'
import type { TeamDefinition, TeamWorkspace, TeamWorkspaceBridge } from '@/types/team-workspace'
import { stripDerivedJoinOutput, validateWorkflowResultProtocol } from './graph'

function executorConfigurationError(document: TeamDefinition): string | undefined {
  for (const flow of document.workflows) for (const node of flow.graph_definition.nodes) {
    const memberRole = node.type === 'worker' ? 'worker' : node.type === 'lead' ? 'avatar' : undefined
    if (!memberRole) continue
    const member = memberRole === 'worker'
      ? document.members.find((candidate) => candidate.id === String(node.config?.agent_id ?? '').trim() && candidate.configuration.role === memberRole && candidate.relationship.enabled)
      : document.members.find((candidate) => candidate.configuration.role === memberRole && candidate.relationship.enabled)
    if (!member) {
      const label = node.label?.trim() || (memberRole === 'worker' ? '执行步骤' : '负责人步骤')
      const repair = memberRole === 'worker' ? '请重新选择执行成员后再保存。' : '请恢复启用的负责人后再保存。'
      return `流程“${flow.name || '未命名流程'}”中的“${label}”没有可用的${memberRole === 'worker' ? '执行成员' : '负责人'}，${repair}`
    }
  }
  for (const flow of document.workflows) {
    const issue = validateWorkflowResultProtocol(flow)
    if (issue) return `流程“${flow.name || '未命名流程'}”：${issue}`
  }
  return undefined
}

export function useTeamDraft(teamId: string, bridge: TeamWorkspaceBridge) {
  const [draft, setDraft] = useState<TeamWorkspace>()
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const state = useRef<{ remote?: TeamWorkspace; document?: TeamDefinition; generation: number; saved: number; flight?: Promise<TeamWorkspace | undefined> }>({ generation: 0, saved: 0 })
  const alive = useRef(true)
  const trialRefresh = useRef(0)
  const flush = useCallback(async (): Promise<TeamWorkspace | undefined> => {
    const s = state.current
    if (s.flight) return s.flight
    if (!s.remote || !s.document || s.saved === s.generation) return s.remote
    const invalidExecutor = executorConfigurationError(s.document)
    if (invalidExecutor) { setError(invalidExecutor); throw new Error(invalidExecutor) }
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
    trialRefresh.current += 1
    const normalized = stripDerivedJoinOutput(remote.document)
    state.current.remote = remote; state.current.document = normalized.document
    state.current.generation = normalized.changed ? 1 : 0; state.current.saved = 0
    setDraft(normalized.changed ? { ...remote, document: normalized.document } : remote); setDirty(normalized.changed); setError('')
  }, [])
  const load = useCallback(async () => {
    try { replace(await bridge({ action: 'get', teamId })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败') }
  }, [bridge, teamId, replace])
  useEffect(() => {
    alive.current = true
    let cancelled = false
    void bridge({ action: 'get', teamId }).then((remote) => { if (!cancelled) replace(remote) }).catch((cause: Error) => { if (!cancelled) setError(cause.message) })
    return () => { cancelled = true; alive.current = false; trialRefresh.current += 1 }
  }, [bridge, teamId, replace])
  const edit = (document: TeamDefinition) => {
    const s = state.current
    if (!s.remote || s.remote.publishing_revision) return
    s.document = document; s.generation += 1
    setDraft({ ...s.remote, document }); setDirty(true); setError('')
  }
  const refreshTrials = async () => {
    const revision = state.current.remote?.revision
    if (revision === undefined) return
    const request = ++trialRefresh.current
    const remote = await bridge({ action: 'get', teamId })
    if (alive.current && request === trialRefresh.current && state.current.remote?.revision === revision && remote.revision === revision) {
      const derived = { trials: remote.trials, publication_readiness: remote.publication_readiness }
      state.current.remote = { ...state.current.remote, ...derived }
      setDraft((d) => d?.revision === revision ? { ...d, ...derived } : d)
    }
  }
  const discard = () => { if (state.current.remote && !state.current.flight) replace(state.current.remote) }
  return { discard, draft, saving, dirty, error, edit, flush, replace, load, refreshTrials }
}
