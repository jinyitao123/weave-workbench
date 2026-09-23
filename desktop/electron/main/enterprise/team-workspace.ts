import type { TeamDefinition, TeamWorkspaceCommand } from '../../../src/types/team-workspace'

// Only configuration keys are translated. Graph bindings and schema keys belong
// to Weave and must survive editing without desktop reinterpretation.
function keys(value: unknown, convert: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => keys(item, convert))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [convert(key), key === 'output_schema' || key === 'outputSchema' ? item : keys(item, convert)]))
}
function documentToWire(doc: TeamDefinition) {
  return { ...doc, members: doc.members.map((member) => {
    const { businessCapabilityBindings, ...configuration } = member.configuration
    return { ...member,
      configuration: keys({ ...configuration,
        ...(businessCapabilityBindings.length ? { businessCapabilityBindings } : {}),
        outputSchema: member.configuration.outputSchema.trim() ? JSON.parse(member.configuration.outputSchema) : null,
      }, (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)),
      relationship: keys(member.relationship, (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)),
    }
  }) }
}
export async function teamWorkspaceRequest(command: TeamWorkspaceCommand, read: (path: string) => Promise<unknown>, write: (path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => Promise<{ body: unknown }>) {
  if (!command || typeof command.teamId !== 'string' || !command.teamId.trim()) throw new Error('请选择团队')
  const base = `/v1/teams/${encodeURIComponent(command.teamId)}/development`
  let result: unknown
  switch (command.action) {
    case 'get': result = await read(base); break
    case 'save': result = (await write(base, 'PUT', { expected_revision: command.revision, document: documentToWire(command.document) })).body; break
    case 'publish': result = (await write(`${base}/publish`, 'POST', { revision: command.revision })).body; break
    case 'trial': return (await write(`${base}/trials`, 'POST', {
      revision: command.revision, workflow_id: command.workflowId, request_id: command.requestId, input: command.input,
      business_actions: command.businessActions.map((action) => ({
        capability_id: action.id, name: action.actionName, object_name: action.objectName, label: action.name,
        description: action.description, requires_record: action.requiresRecord === true,
        requires_confirmation: action.requiresConfirmation === true, params: action.params ?? [],
      })),
    })).body
    case 'input': return read(`${base}/trials/${encodeURIComponent(command.requestId)}/input`)
    case 'activity': {
      const activity = await read(`/v1/runs/${encodeURIComponent(command.runId)}/activity`) as { deliverables?: Array<{ id: string }> }
      const outputs = await Promise.all((activity.deliverables ?? []).map((item) => read(`/v1/deliverables/${encodeURIComponent(item.id)}`)))
      return { ...activity, outputs }
    }
    case 'delete': return (await write(`${base}/team`, 'DELETE')).body
    default: throw new Error('无法识别的团队操作')
  }
  type WireDocument = { members?: Array<{ configuration: Record<string, unknown>; relationship: unknown }> }
  const response = result as { document?: WireDocument; published_document?: WireDocument }
  if (!response?.document?.members) throw new Error('Weave 返回的团队草稿不完整')
  const decode = (doc: WireDocument) => ({ ...doc, members: (doc.members ?? []).map((member) => {
    const schema = member.configuration.output_schema
    const configuration = keys(member.configuration, (key) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())) as Record<string, unknown>
    for (const field of ['skillNames', 'skills', 'mcpServerIds', 'businessCapabilityIds', 'businessCapabilityBindings', 'permissionAllow', 'permissionAsk', 'permissionDeny']) if (!Array.isArray(configuration[field])) configuration[field] = []
    return { ...member,
      configuration: { ...configuration, outputSchema: schema == null ? '' : JSON.stringify(schema, null, 2) },
      relationship: keys(member.relationship, (key) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())),
    }
  }) })
  return { ...response, document: decode(response.document), ...(response.published_document ? { published_document: decode(response.published_document) } : {}) }
}
