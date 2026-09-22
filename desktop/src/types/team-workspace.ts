import type { EnterpriseBusinessCapability, EnterpriseTeamMemberAgentConfiguration, EnterpriseTeamMemberRelationshipConfiguration, EnterpriseWorkflowGraphDefinition } from './api'

export interface TeamDefinition {
  name: string
  objective: string
  members: Array<{ id: string; configuration: EnterpriseTeamMemberAgentConfiguration; relationship: EnterpriseTeamMemberRelationshipConfiguration }>
  workflows: Array<{ id: string; name: string; description: string; graph_definition: EnterpriseWorkflowGraphDefinition; trigger_config: Record<string, unknown> }>
}
export interface TeamTrial {
  request_id: string; revision: number; workflow_id: string; run_id: string; status: string; created_at: string
}
export interface TeamWorkspace {
  revision: number; published_revision: number; publishing_revision: number; prepared_revision: number
  document: TeamDefinition; published_document?: TeamDefinition; updated_at: string; trials: TeamTrial[]
}
export type TeamWorkspaceCommand = (
  | { action: 'get' | 'delete'; teamId: string }
  | { action: 'save'; teamId: string; revision: number; document: TeamDefinition }
  | { action: 'trial'; teamId: string; revision: number; workflowId: string; requestId: string; input: string; businessActions: EnterpriseBusinessCapability[] }
  | { action: 'publish'; teamId: string; revision: number }
  | { action: 'input'; teamId: string; requestId: string }
  | { action: 'activity'; teamId: string; runId: string }
) & { accountId?: string }
export type TeamWorkspaceBridge = <T = TeamWorkspace>(command: TeamWorkspaceCommand) => Promise<T>
