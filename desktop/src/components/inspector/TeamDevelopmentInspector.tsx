import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { ProductField, ProductSelect, ProductTextArea } from '@/components/ui'
import { TeamDevelopmentWorkspace } from './TeamDevelopmentWorkspace'
import type { EnterpriseBusinessCapabilityCatalog, EnterpriseDevelopmentOverview, PrimeWorkApi, RuntimeInfo } from '@/types/api'
import type { TeamDevelopmentProposalResult } from '@/types/team-workspace'
import './team-development.css'

interface Props {
  enterprise: PrimeWorkApi['enterprise']
  agent: PrimeWorkApi['agent']
  accountId: string
  runtime?: RuntimeInfo | null
  sessionFile?: string
  overview?: EnterpriseDevelopmentOverview
  loading: boolean
  onRefresh(): void
}

export function TeamDevelopmentInspector({ enterprise, agent, accountId, runtime, sessionFile, overview, loading, onRefresh, view }: Props & { view: 'division' | 'workflow' }) {
  const [teamId, setTeamId] = useState('')
  const [bindRequested, setBindRequested] = useState(false)
  const [proposal, setProposal] = useState<TeamDevelopmentProposalResult>()
  const [error, setError] = useState('')
  const [catalog, setCatalog] = useState<EnterpriseBusinessCapabilityCatalog>()
  const [catalogError, setCatalogError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newObjective, setNewObjective] = useState('')
  const [createdTeam, setCreatedTeam] = useState<{ id: string; name: string; objective: string }>()
  const [createProposal, setCreateProposal] = useState<{ name: string; objective: string }>()
  const [createBusy, setCreateBusy] = useState(false)
  const dirtyRef = useRef(false)
  const teamIdRef = useRef(teamId)
  teamIdRef.current = teamId

  const refreshAgentState = useCallback(async () => {
    if (!runtime?.runtimeId && !sessionFile) return
    try {
      const state = runtime?.runtimeId ? await enterprise.getTeamDevelopmentState(runtime.runtimeId) : await enterprise.getTeamDevelopmentStateForSession(sessionFile!)
      if (state.teamId && state.teamId !== teamIdRef.current && dirtyRef.current) { setError('当前团队仍有未保存修改，请先保存或放弃修改，再查看 Pi 打开的团队'); return }
      if (state.teamId) { setTeamId(state.teamId); setBindRequested(false) }
      setProposal(state.proposal)
      setCreateProposal(state.createProposal)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取 Pi 的团队开发状态') }
  }, [enterprise, runtime?.runtimeId, sessionFile])

  useEffect(() => { void refreshAgentState() }, [refreshAgentState])
  useEffect(() => agent.onEvent(({ runtimeId, event }) => { if (runtimeId === runtime?.runtimeId && event.type === 'agent_end') void refreshAgentState() }), [agent, runtime?.runtimeId, refreshAgentState])
  useEffect(() => {
    let active = true
    void enterprise.getBusinessCapabilityCatalog().then((value) => { if (active) setCatalog(value) }).catch((cause) => { if (active) setCatalogError(cause instanceof Error ? cause.message : '无法读取业务动作目录') })
    return () => { active = false }
  }, [enterprise, accountId])

  const teams = [...(overview?.teams ?? []).filter((team) => team.status !== 'archived'), ...(createdTeam && !overview?.teams.some((team) => team.id === createdTeam.id) ? [{ ...createdTeam, status: 'active' }] : [])]
  const selected = teamId || teams[0]?.id || ''
  const createTeam = async (name: string, objective: string) => {
    if (createBusy || teams.some((team) => team.name === name.trim())) { setError('已有同名团队，请选择现有团队继续开发'); return }
    setCreateBusy(true); setError('')
    try {
      const team = await enterprise.createDevelopmentTeam({ version: '1', name: name.trim(), objective: objective.trim() })
      setCreatedTeam(team); setTeamId(team.id); setBindRequested(Boolean(runtime?.runtimeId && !runtime.isStreaming))
      setCreateProposal(undefined); setCreating(false); setNewName(''); setNewObjective(''); onRefresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建团队失败') }
    finally { setCreateBusy(false) }
  }

  return <div className="team-development-inspector">
    {createProposal && <section className="team-development-inspector__proposal"><strong>Pi 建议新建团队</strong><p>{createProposal.name}</p><small>{createProposal.objective}</small><button type="button" className="button button--primary" disabled={createBusy} onClick={() => void createTeam(createProposal.name, createProposal.objective)}>创建团队</button></section>}
    {creating && <section className="team-development-inspector__create"><ProductField label="团队名称" value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)}/><ProductTextArea label="团队目标" rows={4} value={newObjective} onChange={(event) => setNewObjective(event.target.value)}/><span><button type="button" className="button" onClick={() => setCreating(false)}>取消</button><button type="button" className="button button--primary" disabled={createBusy || !newName.trim() || !newObjective.trim()} onClick={() => void createTeam(newName, newObjective)}>创建团队</button></span></section>}
    {teams.length ? <><div className="team-development-inspector__team-context"><ProductSelect className="team-development-inspector__team-select" label="团队" value={selected} options={teams.map((team) => ({ value: team.id, label: team.name }))} onChange={(id) => { if (dirtyRef.current) { setError('请先保存或放弃当前团队的修改'); return }; setTeamId(id); setProposal(undefined); setBindRequested(Boolean(runtime?.runtimeId && !runtime.isStreaming)) }}/><button type="button" className="button team-development-inspector__context-action" aria-label="新建团队" title="新建团队" onClick={() => setCreating(true)}><Plus size={15}/></button><button type="button" className="button team-development-inspector__context-action" aria-label="刷新团队" title="刷新团队" onClick={onRefresh} disabled={loading}><RefreshCw size={14}/></button></div><TeamDevelopmentWorkspace key={`${accountId}:${selected}`} teamId={selected} accountId={accountId} runtime={runtime} enterprise={enterprise} overview={overview} catalog={catalog} catalogError={catalogError} proposal={proposal} bindRequested={bindRequested} view={view} onBound={() => { setBindRequested(false); void refreshAgentState() }} onClearProposal={() => setProposal(undefined)} onDirtyChange={(value) => { dirtyRef.current = value }} onError={setError} onPublish={() => { onRefresh(); void refreshAgentState() }}/></> : <div className="team-development-inspector__empty"><p>{loading ? '正在读取团队…' : '当前没有可开发的团队。'}</p><button type="button" className="button" onClick={() => setCreating(true)}><Plus size={13}/>新建团队</button></div>}
    {error && <p className="team-development-inspector__error" role="alert">{error}</p>}
  </div>
}
