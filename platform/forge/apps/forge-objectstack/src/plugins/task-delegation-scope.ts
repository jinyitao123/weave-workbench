import type { PluginContext } from '@objectstack/core';
import type { IApprovalService, IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { readApprovalOriginal } from './approval-workbench-context.plugin.js';
import { readOwnedOriginal } from './workbench-owned-material.plugin.js';
import { SYSTEM_READ, TaskConnectionFailure, digest, nonempty, service } from './native-task-auth.js';

export interface TaskResource {
  type: 'forge-file'; id: string; name: string; bytes: number; sha256: string;
  sourceKind?: 'owner' | 'approval'; requestId?: string; materialId?: string; mediaType?: string;
}
export interface TaskScope {
  input_revision_id: string; registration_id: string; task_sha256: string;
  workflow_id: string; workflow_version: number; allowed_actions: string[];
  resources: TaskResource[]; business_record?: { object_name: string; record_id: string };
}
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ACTION = /^forge:action:forge_[a-z0-9_]+\.[A-Za-z_][A-Za-z0-9_]*$/;

export function parseTaskScope(value: unknown): TaskScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskConnectionFailure(400, 'FORGE_TASK_SCOPE_INVALID', '任务授权范围无效');
  const scope = value as TaskScope;
  const keys = new Set(['input_revision_id', 'registration_id', 'task_sha256', 'workflow_id', 'workflow_version', 'allowed_actions', 'resources', 'business_record']);
  if (Object.keys(scope).some((key) => !keys.has(key)) || !UUID.test(scope.input_revision_id) ||
      !nonempty(scope.registration_id, 256) || !SHA.test(scope.task_sha256) || !nonempty(scope.workflow_id) ||
      !Number.isSafeInteger(scope.workflow_version) || scope.workflow_version < 1 || !Array.isArray(scope.allowed_actions) ||
      scope.allowed_actions.length > 32 || scope.allowed_actions.some((action) => typeof action !== 'string' || !ACTION.test(action)) ||
      new Set(scope.allowed_actions).size !== scope.allowed_actions.length || !Array.isArray(scope.resources) || scope.resources.length > 10) {
    throw new TaskConnectionFailure(400, 'FORGE_TASK_SCOPE_INVALID', '任务授权范围无效');
  }
  let total = 0;
  const files = new Set<string>();
  for (const item of scope.resources) {
    const keys = new Set(['type', 'id', 'name', 'bytes', 'sha256', 'sourceKind', 'requestId', 'materialId', 'mediaType']);
    if (!item || typeof item !== 'object' || Object.keys(item).some((key) => !keys.has(key)) || item.type !== 'forge-file' ||
        !nonempty(item.id) || !nonempty(item.name, 255) || !SHA.test(item.sha256) || !Number.isSafeInteger(item.bytes) ||
        item.bytes < 1 || item.bytes > 2 * 1024 * 1024 || files.has(item.id) ||
        item.sourceKind !== undefined && !['owner', 'approval'].includes(item.sourceKind) ||
        item.sourceKind === 'approval' && !nonempty(item.requestId) || item.sourceKind !== 'approval' && item.requestId !== undefined) {
      throw new TaskConnectionFailure(400, 'FORGE_TASK_SCOPE_INVALID', '任务材料授权无效');
    }
    total += item.bytes; files.add(item.id);
  }
  if (total > 8 * 1024 * 1024) throw new TaskConnectionFailure(400, 'FORGE_TASK_SCOPE_INVALID', '任务材料超限');
  if (scope.business_record && (!/^forge_[a-z0-9_]+$/.test(scope.business_record.object_name) ||
      !nonempty(scope.business_record.record_id) || Object.keys(scope.business_record).some((key) => !['object_name', 'record_id'].includes(key)))) {
    throw new TaskConnectionFailure(400, 'FORGE_TASK_SCOPE_INVALID', '任务记录授权无效');
  }
  return scope;
}

export async function readTaskResource(context: PluginContext, actor: ExecutionContext, resource: TaskResource) {
  const engine = service<IObjectQLEngine>(context, 'objectql'), storage = service<IStorageService>(context, 'storage');
  let original: { fileId: string; name: string; mediaType: string; bytes: Uint8Array; sha256: string };
  if (resource.sourceKind === 'approval') {
    original = await readApprovalOriginal(service<IApprovalService>(context, 'approvals'), engine, storage, actor,
      resource.requestId!, resource.id, resource.sha256);
  } else if (resource.sourceKind === 'owner') {
    original = await readOwnedOriginal(engine, storage, actor, resource.id, resource.sha256);
  } else {
    // The original text-only door is restricted to the same native unbound,
    // private upload predicate. Binary/retained originals use the shared readers.
    const file = await engine.findOne('sys_file', { where: { id: resource.id } }, { context: SYSTEM_READ });
    if (!file || file.status !== 'committed' || !['user', 'attachments'].includes(String(file.scope)) || file.acl !== 'private' ||
        file.owner_id !== actor.userId || file.organization_id !== actor.tenantId || file.ref_object || file.ref_id || file.ref_field ||
        Number(file.size) !== resource.bytes || Number(file.size) > 2 * 1024 * 1024 ||
        !nonempty(file.key, 2048) || !nonempty(file.name, 255) || !/^(text\/plain|text\/markdown|text\/csv|application\/json)(;\s*charset=utf-8)?$/.test(String(file.mime_type))) {
      throw new TaskConnectionFailure(404, 'FORGE_TASK_MATERIAL_NOT_FOUND', '当前材料不可读取');
    }
    const bytes = new Uint8Array(await storage.download(String(file.key)));
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new TaskConnectionFailure(422, 'FORGE_TASK_MATERIAL_INVALID', '当前材料不是有效的 UTF-8 文本'); }
    if (!content.trim() || content.includes('\0')) throw new TaskConnectionFailure(422, 'FORGE_TASK_MATERIAL_INVALID', '当前材料无效');
    original = { fileId: resource.id, name: String(file.name), mediaType: String(file.mime_type), bytes, sha256: await digest(bytes) };
  }
  if (original.bytes.byteLength !== resource.bytes || original.name !== resource.name || original.sha256 !== resource.sha256 ||
      resource.mediaType && original.mediaType !== resource.mediaType) {
    throw new TaskConnectionFailure(409, 'FORGE_TASK_MATERIAL_CHANGED', '当前材料与授权版本不一致');
  }
  return original;
}

export function actionKey(action: Record<string, unknown>): string {
  return `forge:action:${String(action.objectName)}.${String(action.name)}`;
}

export function allowedObjectNames(scope: TaskScope): Set<string> {
  return new Set([...(scope.business_record ? [scope.business_record.object_name] : []),
    ...scope.allowed_actions.map((action) => action.slice('forge:action:'.length).split('.')[0])]);
}
