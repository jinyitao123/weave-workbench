import type { PluginContext } from '@objectstack/core';
import { HttpDispatcher } from '@objectstack/runtime';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { TaskConnectionFailure, service } from './native-task-auth.js';
import { actionKey, allowedObjectNames, type TaskScope } from './task-delegation-scope.js';

type Action = Record<string, unknown>;
type NativeBridge = {
  listObjects(): Promise<Action[]>; describeObject(name: string): Promise<unknown>;
  query(object: string, query: Record<string, unknown>): Promise<unknown>;
  get(object: string, id: string, fields?: string[]): Promise<unknown>;
  listActions(): Promise<Action[]>; runAction(name: string, input: Record<string, unknown>): Promise<unknown>;
};

/** Only consumes the public SDK's native bridge/metadata helpers. No routes or
 * replacement dispatcher, business handler, permission evaluator or loop are mounted. */
export class TaskMcpAdapter {
  private readonly sdk: HttpDispatcher;
  constructor(private readonly context: PluginContext) {
    this.sdk = new HttpDispatcher(context.getKernel() as ConstructorParameters<typeof HttpDispatcher>[0]);
  }

  private native(actor: ExecutionContext): NativeBridge {
    return this.sdk.buildMcpBridge({ request: { method: 'POST', url: '/api/v1/mcp', headers: {} }, executionContext: actor }) as NativeBridge;
  }

  async actions(actor: ExecutionContext): Promise<Action[]> { return this.native(actor).listActions(); }

  async objectMetadata(actor: ExecutionContext, scope: TaskScope, name: string): Promise<Record<string, unknown>> {
    if (!allowedObjectNames(scope).has(name)) throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '该对象不在本次授权范围');
    const body = await this.nativeObjectMetadata(actor, name);
    const item = body.item as Record<string, unknown>;
    if (Array.isArray(item.actions)) {
      return { ...body, item: { ...item, actions: item.actions.filter((action: Action) =>
        scope.allowed_actions.includes(`forge:action:${name}.${String(action.name)}`)) } };
    }
    return body;
  }

  private async nativeObjectMetadata(actor: ExecutionContext, name: string): Promise<Record<string, unknown>> {
    const result = await this.sdk.handleMetadata(`objects/${encodeURIComponent(name)}`, { request: { method: 'POST', url: '/api/v1/mcp', headers: {} }, executionContext: actor }, 'GET');
    if (result.response?.status !== 200 || !result.response.body || typeof result.response.body !== 'object') {
      throw new TaskConnectionFailure(result.response?.status ?? 503, 'FORGE_TASK_METADATA_UNAVAILABLE', '当前能力定义不可读取');
    }
    const envelope = result.response.body as Record<string, unknown>;
    if (envelope.success !== true || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) throw new TaskConnectionFailure(503, 'FORGE_TASK_METADATA_UNAVAILABLE', '当前能力定义包络无效');
    const body = envelope.data as Record<string, unknown>;
    const item = body.item as Record<string, unknown> | undefined;
    if (!item || item.name !== name) throw new TaskConnectionFailure(503, 'FORGE_TASK_METADATA_UNAVAILABLE', '当前能力定义不完整');
    return body;
  }

  async bridge(actor: ExecutionContext, scope: TaskScope): Promise<NativeBridge> {
    const native = this.native(actor);
    const available = (await native.listActions()).filter((action) => scope.allowed_actions.includes(actionKey(action)));
    if (scope.allowed_actions.some((key) => !available.some((action) => actionKey(action) === key))) {
      throw new TaskConnectionFailure(403, 'FORGE_TASK_ACTION_FORBIDDEN', '本次业务动作权限已不可用');
    }
    const objects = allowedObjectNames(scope);
    const enforceRecord = (object: string, id: string) => {
      if (!scope.business_record || scope.business_record.object_name !== object || scope.business_record.record_id !== id) {
        throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '该记录不在本次授权范围');
      }
    };
    return {
      listObjects: async () => (await native.listObjects()).filter((object) => objects.has(String(object.name))),
      describeObject: async (name) => {
        if (!objects.has(name)) throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '该对象不在本次授权范围');
        return native.describeObject(name);
      },
      get: async (object, id, fields) => { enforceRecord(object, id); if (fields?.some((field) => !/^[a-z_][a-z0-9_]*$/.test(field))) throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '不允许扩展记录范围'); return native.get(object, id); },
      query: async (object, query) => {
        enforceRecord(object, scope.business_record?.record_id ?? '');
        if (Object.keys(query).some((key) => !['where', 'fields', 'orderBy', 'limit', 'offset'].includes(key)) || Array.isArray(query.fields) && query.fields.some((field) => typeof field !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(field))) throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '不允许扩展记录范围');
        return native.query(object, { ...(query.fields ? { fields: query.fields } : {}), where: { $and: [query.where ?? {}, { id: scope.business_record!.record_id }] }, limit: 1, offset: 0 });
      },
      listActions: async () => available,
      runAction: async (name, input) => {
        const action = available.find((candidate) => candidate.name === name && candidate.objectName === input.objectName);
        if (!action) throw new TaskConnectionFailure(403, 'FORGE_TASK_ACTION_FORBIDDEN', '该动作不在本次授权范围');
        const requiresRecord = action.requiresRecord !== false;
        if (requiresRecord) enforceRecord(String(input.objectName), String(input.recordId ?? ''));
        else if (input.recordId != null) throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '该动作不允许切换业务记录');
        const params = input.params && typeof input.params === 'object' && !Array.isArray(input.params) ? input.params as Record<string, unknown> : {};
        // Read the native typed declaration, not the flattened MCP string hint.
        const metadata = await this.objectMetadata(actor, scope, String(input.objectName));
        const item = metadata.item as Record<string, unknown>;
        const declarations = Array.isArray(item.actions) ? item.actions as Action[] : [];
        const definition = declarations.find((entry) => entry.name === name);
        if (!definition) throw new TaskConnectionFailure(503, 'FORGE_TASK_METADATA_UNAVAILABLE', '当前动作参数不可核验');
        const definitions = Array.isArray(definition.params) ? definition.params as Action[] : [];
        const allowedFiles = new Set(scope.resources.map((resource) => resource.id));
        for (const parameter of definitions) {
          let field: Action | undefined;
          if (typeof parameter.field === 'string') {
            const fieldItem = parameter.objectOverride && parameter.objectOverride !== input.objectName
              // The target comes from the selected native action declaration, never caller input.
              // Inspect its field internally without exposing target objects or records.
              ? (await this.nativeObjectMetadata(actor, String(parameter.objectOverride))).item as Action : item;
            field = (fieldItem.fields as Record<string, Action> | undefined)?.[parameter.field];
            if (!field) throw new TaskConnectionFailure(503, 'FORGE_TASK_METADATA_UNAVAILABLE', '当前字段参数不可核验');
          }
          if (parameter.type !== 'file' && field?.type !== 'file') continue;
          const value = params[String(parameter.name ?? parameter.field)];
          if (value == null) continue; // Native parameter validation decides requiredness.
          const ids = (parameter.multiple ?? field?.multiple) === true ? value : [value];
          if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !allowedFiles.has(id))) {
            throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '材料不在本次授权范围');
          }
        }
        return native.runAction(name, input);
      },
    };
  }

  async handle(request: Request, body: unknown, actor: ExecutionContext, scope: TaskScope): Promise<Response> {
    const rpc = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    const methods = new Set(['initialize', 'notifications/initialized', 'notifications/cancelled', 'ping', 'tools/list', 'tools/call']);
    const tools = new Set(['list_objects', 'describe_object', 'query_records', 'get_record', 'list_actions', 'run_action']);
    if (!rpc || typeof rpc.method !== 'string' || !methods.has(rpc.method) || rpc.method === 'tools/call' &&
        (!rpc.params || typeof rpc.params !== 'object' || !tools.has(String((rpc.params as Record<string, unknown>).name)))) {
      throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '该能力不在本次授权范围');
    }
    const mcp = service<{ handleHttpRequest(request: Request, opts: unknown): Promise<Response> }>(this.context, 'mcp');
    return mcp.handleHttpRequest(request, { bridge: await this.bridge(actor, scope), parsedBody: body,
      toolOptions: { grantedScopes: ['data:read', 'actions:execute'] } });
  }
}
