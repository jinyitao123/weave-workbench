import type { EnterpriseBusinessCapability, EnterpriseTeamMemberAgentConfiguration, EnterpriseTeamMemberRelationshipConfiguration, EnterpriseWorkflowGraphDefinition } from './api'

export interface TeamDefinition {
  name: string
  objective: string
  /** Forge permission sets that may use the team; empty means the whole organization. */
  audience?: string[]
  members: Array<{ id: string; configuration: EnterpriseTeamMemberAgentConfiguration; relationship: EnterpriseTeamMemberRelationshipConfiguration }>
  workflows: Array<{ id: string; name: string; description: string; graph_definition: EnterpriseWorkflowGraphDefinition; trigger_config: Record<string, unknown> }>
}
export interface TeamTrial {
  request_id: string; revision: number; workflow_id: string; run_id: string; status: string; created_at: string
}
export interface TeamWorkflowPublicationReadiness {
  workflow_id: string
  required_capability_ids: string[]
  covered_capability_ids: string[]
  missing_capability_ids: string[]
  passed: boolean
}
export interface TeamPublicationReadiness {
  ready: boolean
  workflows: TeamWorkflowPublicationReadiness[]
}
export interface TeamWorkspace {
  revision: number; published_revision: number; publishing_revision: number; prepared_revision: number
  document: TeamDefinition; published_document?: TeamDefinition; updated_at: string; trials: TeamTrial[]
  /** Server-derived coverage; older Weave responses may not include it. */
  publication_readiness?: TeamPublicationReadiness
}
export interface TeamDevelopmentContextInput {
  teamId: string
  accountId: string
  revision: number
  document: TeamDefinition
  selected?: { kind: 'member' | 'step'; id: string }
}
export interface TeamDevelopmentProposalResult {
  revision: number
  baseDocument: TeamDefinition
  document: TeamDefinition
  changes: string[]
}
export interface TeamDevelopmentState {
  teamId?: string
  revision?: number
  proposal?: TeamDevelopmentProposalResult
}
export interface DevelopmentTrialAction extends EnterpriseBusinessCapability {
  simulationAuthorized: boolean
}
export type TeamWorkspaceCommand = (
  | { action: 'get' | 'delete'; teamId: string }
  | { action: 'save'; teamId: string; revision: number; document: TeamDefinition }
  | { action: 'trial'; teamId: string; revision: number; workflowId: string; requestId: string; input: string; businessActions: DevelopmentTrialAction[] }
  | { action: 'publish'; teamId: string; revision: number }
  | { action: 'input'; teamId: string; requestId: string }
  | { action: 'activity'; teamId: string; runId: string }
) & { accountId?: string }
export type TeamWorkspaceBridge = <T = TeamWorkspace>(command: TeamWorkspaceCommand) => Promise<T>
