import { ORDER_APPROVAL_MCP_APPROVE_TARGET, ORDER_APPROVAL_MCP_REJECT_TARGET, ORDER_APPROVAL_MCP_RECALL_TARGET,
  QUOTATION_APPROVAL_MCP_APPROVE_TARGET, QUOTATION_APPROVAL_MCP_REJECT_TARGET } from '../actions/approval-workbench.action.js';
import type { Plugin, PluginContext } from '@objectstack/core';
import { makeExecutionContextResolver } from '@objectstack/plugin-hono-server';
import { isFileIdToken } from '@objectstack/spec/data';
import type { ApprovalActionRow, ApprovalRequestRow, IApprovalService, IHttpRequest, IHttpResponse, IHttpServer, IStorageService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ActionHandlerContext } from '@objectstack/spec/ui';
import {
  CONTRACT_APPROVAL_MCP_APPROVE_TARGET,
  CONTRACT_APPROVAL_MCP_SEND_BACK_TARGET,
} from '../actions/approval-workbench.action.js';
import { CONTRACT_OBJECT, resolveRetainedContractMaterial } from './contract-material-holder.js';
import { approvalPayloadVersion } from './contract-revision-material.js';
import { applySalesOrderApproval } from './sales-order-domain.js';
import { matchesOrderApprovalSnapshot } from './sales-order-readiness.js';

const ROUTE = '/api/v1/approvals/requests/:requestId/workbench-context';
const ORIGINAL_ROUTE = '/api/v1/approvals/requests/:requestId/workbench-context/files/:fileId/original';
const HISTORY_ORIGINAL_ROUTE = '/api/v1/approvals/requests/:requestId/workbench-history/files/:fileId/original';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FIELDS = 64;
const MAX_FIELD_VALUE = 4_000;
const FILE_FIELD_TYPES = new Set(['file']);
const TEXT_MEDIA_TYPES = new Set([
  'text/plain', 'text/plain; charset=utf-8',
  'text/markdown', 'text/markdown; charset=utf-8', 'text/x-markdown',
]);
const ORIGINAL_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const HISTORICAL_DECISION_ACTIONS = new Set(['approve', 'reject']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

type JsonRecord = Record<string, unknown>;

interface FileRow {
  id?: unknown;
  key?: unknown;
  name?: unknown;
  mime_type?: unknown;
  size?: unknown;
  status?: unknown;
  scope?: unknown;
  acl?: unknown;
  owner_id?: unknown;
  organization_id?: unknown;
  ref_object?: unknown;
  ref_id?: unknown;
  ref_field?: unknown;
}

interface SnapshotFile {
  fields: Set<string>;
  sha256?: string;
  name?: string;
  primary?: boolean;
}

interface ContextField {
  label?: string;
  value: string;
}

interface OriginalFileReference {
  sourceKind: 'approval';
  requestId: string;
  fileId: string;
  name: string;
  mediaType: string;
  bytes: number;
  sha256: string;
}

const QUOTATION_OBJECT = 'forge_quotation';
const EMPLOYEE_APPROVAL_OBJECTS = new Set([CONTRACT_OBJECT, 'forge_sales_order', QUOTATION_OBJECT]);
type ApprovalMcpDecision = 'approve' | 'revise' | 'reject' | 'recall';
type ApprovalMcpParams = Record<string, unknown> & {
  approvalRequestId?: unknown;
  itemVersion?: unknown;
  sourceMaterialVersion?: unknown;
  comment?: unknown;
  recordId?: unknown;
  objectName?: unknown;
};
type ApprovalMcpHandlerContext = ActionHandlerContext<ApprovalMcpParams> & { recordLoadDenied?: boolean };

class ContextFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class ApprovalActionFailure extends ContextFailure {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.message = `${code}: ${message}`;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.includes('\0') || text.length > maxLength) return undefined;
  return text;
}

function headersForSession(headers: IHttpRequest['headers']): Headers {
  const webHeaders = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) webHeaders.append(name, item);
    } else {
      webHeaders.set(name, value);
    }
  }
  return webHeaders;
}

function headerValue(headers: IHttpRequest['headers'], name: string): string | undefined {
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const value = Array.isArray(match) ? match[0] : match;
  return typeof value === 'string' ? value.trim() : undefined;
}

function expectedSha256(headers: IHttpRequest['headers']): string | undefined {
  const value = headerValue(headers, 'if-match');
  return value?.match(/^"([0-9a-f]{64})"$/i)?.[1]?.toLowerCase();
}

function hasOriginalSignature(bytes: Uint8Array, mediaType: string, name: string): boolean {
  if (mediaType === 'application/pdf') {
    return name.toLowerCase().endsWith('.pdf') && bytes.byteLength >= 5 &&
      String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
  }
  if (mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return name.toLowerCase().endsWith('.docx') && bytes.byteLength >= 4 &&
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }
  return false;
}

function contentDisposition(name: string): string {
  const fallback = name.replace(/[\u0000-\u001f\u007f"\\]/g, '_').replace(/[^\x20-\x7e]/g, '_').slice(0, 120) || 'original';
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function readService<T>(ctx: PluginContext, name: string): T | undefined {
  try {
    return ctx.getService<T>(name);
  } catch {
    return undefined;
  }
}

function fileFieldNames(engine: IObjectQLEngine, objectName: string): Set<string> {
  const fields = engine.getObject(objectName)?.fields;
  if (!fields || typeof fields !== 'object') return new Set();
  return new Set(Object.entries(fields).filter(([, field]) => FILE_FIELD_TYPES.has(field.type)).map(([name]) => name));
}

function fileIdsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(fileIdsFromValue);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.flatMap(fileIdsFromValue);
      } catch {
        // A malformed legacy value is not interpreted as a file identifier.
      }
    }
    return isFileIdToken(trimmed) ? [trimmed] : [];
  }
  if (isRecord(value) && typeof value.id === 'string' && isFileIdToken(value.id)) return [value.id];
  return [];
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter((key) => (value as JsonRecord)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonRecord)[key])}`).join(',')}}`;
}

function selectOptionLabel(value: unknown, options: unknown): string | undefined {
  if (!Array.isArray(options)) return undefined;
  const option = options.find((candidate) => isRecord(candidate) && candidate.value === value &&
    typeof candidate.label === 'string' && candidate.label.trim());
  return isRecord(option) && typeof option.label === 'string' ? option.label.trim() : undefined;
}

function snapshotFiles(payload: unknown, fields: Set<string>): Map<string, SnapshotFile> {
  const result = new Map<string, Set<string>>();
  if (!isRecord(payload)) return new Map();
  for (const field of fields) {
    for (const id of fileIdsFromValue(payload[field])) {
      const names = result.get(id) ?? new Set<string>();
      names.add(field);
      result.set(id, names);
    }
  }
  const digests = new Map<string, { sha256: string; name?: string }>();
  const primaryIds = fileIdsFromValue(payload.submitted_material_id);
  const primarySha = typeof payload.submitted_material_sha256 === 'string' ? payload.submitted_material_sha256.toLowerCase() : '';
  if (/^[0-9a-f]{64}$/.test(primarySha)) {
    for (const id of primaryIds) digests.set(id, {
      sha256: primarySha,
      ...(typeof payload.submitted_material_name === 'string' ? { name: payload.submitted_material_name } : {}),
    });
  }

  const rawManifest = payload.submitted_attachment_manifest;
  if (typeof rawManifest === 'string' && rawManifest.trim()) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(rawManifest);
    } catch {
      throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'The frozen attachment manifest is invalid.');
    }
    if (!Array.isArray(manifest)) {
      throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'The frozen attachment manifest is invalid.');
    }
    for (const entry of manifest) {
      if (!isRecord(entry) || typeof entry.file_id !== 'string' || typeof entry.sha256 !== 'string') continue;
      const sha = entry.sha256.toLowerCase();
      if (!isFileIdToken(entry.file_id) || !/^[0-9a-f]{64}$/.test(sha)) {
        throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'The frozen attachment manifest is invalid.');
      }
      const existing = digests.get(entry.file_id);
      if (existing && existing.sha256 !== sha) {
        throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'The frozen attachment manifest conflicts with the submitted material.');
      }
      digests.set(entry.file_id, { sha256: sha, ...(typeof entry.name === 'string' ? { name: entry.name } : {}) });
    }
  }

  const snapshot = new Map<string, SnapshotFile>();
  const canDeriveLegacyAttachmentDigest = primaryIds.length > 0 && /^[0-9a-f]{64}$/.test(primarySha);
  for (const [id, names] of result) {
    const digest = digests.get(id);
    if (!digest) {
      // Native contract approval payloads freeze attachment_ids, but earlier
      // submissions did not persist the companion manifest. The committed
      // ObjectStack file ID is immutable; derive its digest from those bytes
      // only when the same frozen payload also carries a verified primary file.
      if (canDeriveLegacyAttachmentDigest && names.has('attachment_ids')) {
        snapshot.set(id, { fields: names });
        continue;
      }
      throw new ContextFailure(422, 'APPROVAL_MATERIAL_HASH_UNAVAILABLE', 'An approval material has no frozen SHA-256 value.');
    }
    snapshot.set(id, { fields: names, ...digest, primary: primaryIds.includes(id) });
  }
  return snapshot;
}

function humanFieldValue(
  name: string,
  value: unknown,
  schemaField: { type?: string; label?: string; system?: boolean; internal?: boolean; hidden?: boolean; options?: unknown } | undefined,
  payloadDisplay: JsonRecord,
): string | undefined {
  if (!schemaField || schemaField.hidden || schemaField.system || schemaField.internal || FILE_FIELD_TYPES.has(schemaField.type ?? '')) return undefined;
  if (schemaField.type === 'select') {
    const optionLabel = selectOptionLabel(value, schemaField.options);
    if (optionLabel) return optionLabel;
    if (typeof value === 'string' && value.trim()) return `未知（原值：${value.trim()}）`;
    if (typeof value === 'number' && Number.isFinite(value)) return `未知（原值：${String(value)}）`;
    return undefined;
  }
  const display = payloadDisplay[name];
  if (typeof display === 'string' && display.trim()) return display.trim();
  if (/(^id$|_id$|_sha256$|_manifest$|_request_id$)/i.test(name)) return undefined;
  if (schemaField.type === 'lookup' || schemaField.type === 'user' || schemaField.type === 'record') return undefined;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || UUID.test(text) || isFileIdToken(text) && text.startsWith('file_')) return undefined;
    return text;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number')) {
    return value.map(String).join('、');
  }
  return undefined;
}

function projectFields(request: ApprovalRequestRow, engine: IObjectQLEngine): ContextField[] {
  if (!isRecord(request.payload)) return [];
  const object = engine.getObject(request.object_name);
  const schemaFields = object?.fields ?? {};
  const display = isRecord(request.payload_display) ? request.payload_display : {};
  const labels = isRecord(request.payload_labels) ? request.payload_labels : {};
  const result: ContextField[] = [];
  for (const [name, value] of Object.entries(request.payload)) {
    const definition = schemaFields[name];
    const projected = humanFieldValue(name, value, definition, display);
    if (projected === undefined) continue;
    const label = boundedText(labels[name], 160) ?? boundedText(definition?.label, 160);
    if (!label) continue;
    if (projected.length > MAX_FIELD_VALUE) {
      throw new ContextFailure(422, 'APPROVAL_CONTEXT_TOO_LARGE', 'An approval field exceeds the text limit.');
    }
    result.push({ label, value: projected });
  }
  if (result.length > MAX_FIELDS) {
    throw new ContextFailure(422, 'APPROVAL_CONTEXT_TOO_LARGE', 'The approval contains too many fields.');
  }
  return result;
}

async function readSnapshotFiles(
  request: ApprovalRequestRow,
  requestId: string,
  engine: IObjectQLEngine,
  storage: IStorageService,
  allowedFiles: Map<string, SnapshotFile>,
): Promise<{
  files: Array<{ fileId: string; name: string; mediaType: 'text/plain; charset=utf-8'; bytes: number; sha256: string; content: string }>;
  originalFiles: OriginalFileReference[];
}> {
  if (allowedFiles.size === 0) return { files: [], originalFiles: [] };
  const orderedFiles = [...allowedFiles.entries()].sort((left, right) => Number(right[1].primary === true) - Number(left[1].primary === true));
  const ids = orderedFiles.map(([id]) => id);
  const rows = await engine.find('sys_file', {
    where: { id: { $in: ids } },
    fields: ['id', 'key', 'name', 'mime_type', 'size', 'status', 'scope', 'acl', 'owner_id', 'organization_id', 'ref_object', 'ref_id', 'ref_field'],
    limit: ids.length,
  }, { context: SYSTEM_CONTEXT });
  const byId = new Map<string, FileRow>();
  for (const row of rows ?? []) {
    if (row?.id != null) byId.set(String(row.id), row as FileRow);
  }

  let totalBytes = 0;
  for (const [id] of orderedFiles) {
    const file = byId.get(id);
    if (!file || !Number.isInteger(file.size) || (file.size as number) < 0) continue;
    if ((file.size as number) > MAX_FILE_BYTES) {
      throw new ContextFailure(413, 'APPROVAL_MATERIAL_TOO_LARGE', 'An approval material exceeds the 2 MiB limit.');
    }
    totalBytes += file.size as number;
  }
  if (totalBytes > MAX_TOTAL_FILE_BYTES) {
    throw new ContextFailure(413, 'APPROVAL_CONTEXT_TOO_LARGE', 'Approval materials exceed the 8 MiB total limit.');
  }

  const files = [];
  const originalFiles: OriginalFileReference[] = [];
  const seenContent = new Set<string>();
  for (const [id, snapshotFile] of orderedFiles) {
    const file = byId.get(id);
    const fieldMatches = file && typeof file.ref_field === 'string' && snapshotFile.fields.has(file.ref_field);
    const hasOwner = file && (file.ref_object != null || file.ref_id != null || file.ref_field != null);
    const ownerMatches = file && (!hasOwner || file.ref_object === request.object_name &&
      String(file.ref_id ?? '') === request.record_id && fieldMatches);
    if (!file || !['committed', 'deleted'].includes(String(file.status)) || !ownerMatches || typeof file.key !== 'string' ||
        typeof file.name !== 'string' || !file.name.trim() ||
        !Number.isInteger(file.size) || (file.size as number) < 0) {
      throw new ContextFailure(422, 'APPROVAL_MATERIAL_UNAVAILABLE', 'An approval text material is unavailable.');
    }
    const mediaType = String(file.mime_type);
    const isBinaryOriginal = ORIGINAL_MEDIA_TYPES.has(mediaType);
    if (!isBinaryOriginal && !TEXT_MEDIA_TYPES.has(mediaType)) {
      throw new ContextFailure(415, 'APPROVAL_MATERIAL_UNSUPPORTED_TYPE', 'Only supported text, PDF, and DOCX approval materials can be read.');
    }
    if (isBinaryOriginal && (!snapshotFile.sha256 || !request.submitter_id || file.owner_id !== request.submitter_id ||
        !['user', 'attachments'].includes(String(file.scope)) || file.acl !== 'private' ||
        !request.organization_id || !file.organization_id || file.organization_id !== request.organization_id)) {
      throw new ContextFailure(422, 'APPROVAL_MATERIAL_UNAVAILABLE', 'The binary approval material is not bound to its original submitter and organization.');
    }
    if ((file.size as number) > MAX_FILE_BYTES) {
      throw new ContextFailure(413, 'APPROVAL_MATERIAL_TOO_LARGE', 'An approval text material exceeds the 2 MiB limit.');
    }
    if (isBinaryOriginal) {
      const filenameMatchesMime = mediaType === 'application/pdf'
        ? file.name.toLowerCase().endsWith('.pdf')
        : file.name.toLowerCase().endsWith('.docx');
      if ((file.size as number) < 1 || !filenameMatchesMime) {
        throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'A binary approval material has invalid metadata.');
      }
      if (snapshotFile.name && snapshotFile.name !== file.name) {
        throw new ContextFailure(422, 'APPROVAL_MATERIAL_HASH_MISMATCH', 'A binary approval material name does not match its frozen snapshot.');
      }
      originalFiles.push({
        sourceKind: 'approval',
        requestId,
        fileId: id,
        name: file.name.trim().slice(0, 255),
        mediaType,
        bytes: file.size as number,
        sha256: snapshotFile.sha256 as string,
      });
      continue;
    }
    const bytes = await storage.download(file.key);
    if (bytes.length > MAX_FILE_BYTES || bytes.length !== file.size) {
      throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'An approval text material failed size validation.');
    }
    const digest = await sha256(bytes);
    if (snapshotFile.sha256 && digest !== snapshotFile.sha256 || snapshotFile.name && snapshotFile.name !== file.name) {
      throw new ContextFailure(422, 'APPROVAL_MATERIAL_HASH_MISMATCH', 'An approval text material does not match its frozen SHA-256 value.');
    }
    const contentIdentity = `${file.name.trim()}\0${digest}`;
    if (seenContent.has(contentIdentity)) continue;
    seenContent.add(contentIdentity);
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'An approval text material is not valid UTF-8.');
    }
    files.push({
      fileId: id,
      name: file.name.trim().slice(0, 255),
      mediaType: 'text/plain; charset=utf-8' as const,
      bytes: bytes.length,
      sha256: digest,
      content,
    });
  }
  return { files, originalFiles };
}

function latestReturn(actions: ApprovalActionRow[]): { returnVersion: string; returnReason: string } | undefined {
  for (const action of [...actions].reverse()) {
    if (action.action !== 'revise') continue;
    const returnVersion = boundedText(action.id, 128);
    if (!returnVersion) return undefined;
    return { returnVersion, returnReason: boundedText(action.comment, 4_000) ?? '' };
  }
  return undefined;
}

function returnedApprovalSupersededByResubmit(actions: ApprovalActionRow[]): boolean {
  let latestReturnIndex = -1;
  let latestResubmitIndex = -1;
  actions.forEach((action, index) => {
    if (action.action === 'revise') latestReturnIndex = index;
    if (action.action === 'resubmit') latestResubmitIndex = index;
  });
  return latestResubmitIndex > latestReturnIndex;
}

function historicalApprovalParticipant(
  request: ApprovalRequestRow,
  actions: ApprovalActionRow[],
  actorId: string,
): boolean {
  if (request.submitter_id === actorId) return true;
  // Approve/reject support privileged override, so only rows with an explicit
  // non-override marker prove a real approver. Native sendBack (revise) has no
  // override path and checks the actor against the pending slate before writing.
  // An unacted approver or a legacy decision without an override marker is not
  // inferred from current roles or positions.
  return actions.some((action) => action.actor_id === actorId && (
    action.action === 'revise' || HISTORICAL_DECISION_ACTIONS.has(action.action) && action.via_override === false
  ));
}

function nativeApprovalActionContext(actionContext: ApprovalMcpHandlerContext): ExecutionContext {
  const userId = boundedText(actionContext.user?.id, 128);
  const sessionUserId = boundedText(actionContext.session?.userId, 128);
  if (!userId || sessionUserId !== userId) {
    throw new ApprovalActionFailure(401, 'UNAUTHENTICATED', 'A current authenticated employee session is required.');
  }
  const sessionOrganizationId = boundedText(actionContext.session?.organizationId, 128);
  const userOrganizationId = boundedText(actionContext.user?.organizationId, 128);
  if (sessionOrganizationId && userOrganizationId && sessionOrganizationId !== userOrganizationId) {
    throw new ApprovalActionFailure(401, 'UNAUTHENTICATED', 'The authenticated employee organization is inconsistent.');
  }
  const organizationId = sessionOrganizationId ?? userOrganizationId;
  const positions = Array.isArray(actionContext.session?.positions)
    ? actionContext.session.positions.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    userId,
    ...(organizationId ? { tenantId: organizationId } : {}),
    positions,
    permissions: [],
    systemPermissions: [],
    isSystem: false,
  };
}

async function approvalItemVersion(request: ApprovalRequestRow, actions: ApprovalActionRow[]): Promise<string> {
  const state = {
    id: request.id,
    status: request.status,
    process: request.process_name,
    objectName: request.object_name,
    recordId: request.record_id,
    organizationId: request.organization_id ?? null,
    flowRunId: request.flow_run_id ?? null,
    flowNodeId: request.flow_node_id ?? null,
    currentStep: request.current_step ?? null,
    currentStepIndex: request.current_step_index ?? null,
    round: request.round ?? 1,
    pendingApprovers: [...(request.pending_approvers ?? [])].map(String).sort(),
    actions: [...actions].sort((left, right) =>
      String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')) || left.id.localeCompare(right.id),
    ).map((action) => ({
      id: action.id,
      action: action.action,
      actorId: action.actor_id ?? null,
      comment: action.comment ?? null,
      createdAt: action.created_at ?? null,
      stepName: action.step_name ?? null,
      stepIndex: action.step_index ?? null,
    })),
  };
  return `v1-${await sha256(new TextEncoder().encode(canonicalJson(state)))}`;
}

function observedNativeAction(
  request: ApprovalRequestRow,
  actions: ApprovalActionRow[],
  actorId: string,
  decision: ApprovalMcpDecision,
  comment: string,
  itemVersion: string,
  sourceMaterialVersion: string,
): JsonRecord | undefined {
  const nativeAction = decision;
  const matching = actions.filter((action) => action.actor_id === actorId &&
    action.action === nativeAction && action.comment === comment);
  if (!matching.length) return undefined;
  return {
    status: 'history_observed',
    decision: 'unknown',
    requestId: request.id,
    recordId: request.record_id,
    itemVersion,
    sourceMaterialVersion,
    observedStatus: request.status,
    history: matching.map((action) => ({
      action: action.action,
      actorId: action.actor_id,
      comment: action.comment ?? '',
      ...(action.created_at ? { createdAt: action.created_at } : {}),
    })),
  };
}

async function withApprovalRequestLock<T>(
  engine: IObjectQLEngine,
  context: ExecutionContext,
  requestId: string,
  operation: () => Promise<T>,
  preserveOrderDecision?: () => Promise<boolean>,
): Promise<T> {
  if (typeof engine.transaction !== 'function' || typeof engine.execute !== 'function') {
    throw new ApprovalActionFailure(503, 'APPROVAL_ACTION_UNAVAILABLE', 'The approval action lock is unavailable.');
  }
  const result = await engine.transaction(async (trxContext: { transaction?: unknown }, info: { owned?: boolean }) => {
    if (info?.owned !== true || trxContext?.transaction == null) {
      throw new ApprovalActionFailure(503, 'APPROVAL_ACTION_UNAVAILABLE', 'A PostgreSQL transaction is required for this approval action.');
    }
    await engine.execute?.('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', {
      args: [requestId],
      object: 'sys_approval_request',
      transaction: trxContext.transaction,
    });
    try { return { value: await operation() }; }
    catch (error) {
      // Domain effects have their own savepoint. Commit the durable native
      // decision under this lock before reporting its unconfirmed business result.
      if (preserveOrderDecision && error instanceof ApprovalActionFailure && error.code === 'APPROVAL_ACTION_IN_DOUBT' && await preserveOrderDecision()) return { error };
      throw error;
    }
  }, context, { require: true });
  if ('error' in result) throw result.error;
  return result.value;
}

async function executeNativeApprovalAction(
  engine: IObjectQLEngine,
  approvals: IApprovalService,
  actionContext: ApprovalMcpHandlerContext,
  decision: ApprovalMcpDecision,
): Promise<JsonRecord> {
  const params = actionContext.params;
  if (Object.hasOwn(params, 'actorId')) {
    throw new ApprovalActionFailure(400, 'APPROVAL_ACTION_INVALID', 'The acting employee comes from the authenticated session.');
  }
  const allowedParams = new Set(['approvalRequestId', 'itemVersion', 'sourceMaterialVersion', 'comment', 'recordId', 'objectName']);
  if (Object.keys(params).some((key) => !allowedParams.has(key))) {
    throw new ApprovalActionFailure(400, 'APPROVAL_ACTION_INVALID', 'The approval action contains unsupported parameters.');
  }
  const requestId = boundedText(params.approvalRequestId, 128);
  const suppliedItemVersion = boundedText(params.itemVersion, 128);
  const suppliedMaterialVersion = boundedText(params.sourceMaterialVersion, 128)?.toLowerCase();
  const comment = boundedText(params.comment, 4_000);
  const objectName = boundedText(params.objectName, 160);
  const parameterRecordId = boundedText(params.recordId, 128);
  const loadedRecordId = boundedText(actionContext.record?.id, 128);
  if (parameterRecordId && loadedRecordId && parameterRecordId !== loadedRecordId) {
    throw new ApprovalActionFailure(404, 'APPROVAL_ACTION_BINDING_MISMATCH', 'The approval action is not bound to this contract record.');
  }
  const recordId = parameterRecordId ?? loadedRecordId;
  if (!requestId || !suppliedItemVersion || !suppliedMaterialVersion || !/^[0-9a-f]{64}$/.test(suppliedMaterialVersion) || !comment) {
    throw new ApprovalActionFailure(400, 'APPROVAL_ACTION_INVALID', 'The approval request, versions, and a non-empty comment are required.');
  }
  if (!objectName || !EMPLOYEE_APPROVAL_OBJECTS.has(objectName) || !recordId) {
    throw new ApprovalActionFailure(404, 'APPROVAL_ACTION_BINDING_MISMATCH', 'The approval action is not bound to this contract record.');
  }
  if (objectName === QUOTATION_OBJECT && decision !== 'approve' && decision !== 'reject') {
    throw new ApprovalActionFailure(400, 'APPROVAL_ACTION_INVALID', '销售报价审批仅支持同意或驳回。');
  }
  const context = nativeApprovalActionContext(actionContext);
  const actorId = context.userId!;
  return withApprovalRequestLock(engine, context, requestId, async () => {
    const request = await approvals.getRequest(requestId, context);
    if (!request || request.id !== requestId) {
      throw new ApprovalActionFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
    }
    if (request.object_name !== objectName || request.record_id !== recordId ||
      (request.organization_id && request.organization_id !== context.tenantId)) {
      throw new ApprovalActionFailure(404, 'APPROVAL_ACTION_BINDING_MISMATCH', 'The approval action is not bound to this contract record.');
    }
    if (objectName === QUOTATION_OBJECT && request.submitter_id === actorId) {
      throw new ApprovalActionFailure(403, 'APPROVAL_ACTION_FORBIDDEN', '报价发起人不能审批自己的报价。');
    }
    const recallingOwnOrder = request.object_name === 'forge_sales_order' &&
      request.submitter_id === actorId && request.viewer?.is_submitter === true;
    if (decision === 'recall' && (!recallingOwnOrder || !context.tenantId || !request.organization_id || request.organization_id !== context.tenantId)) {
      throw new ApprovalActionFailure(403, 'APPROVAL_ACTION_FORBIDDEN', '只有订单审批的本人发起人可以撤回。');
    }
    const actions = await approvals.listActions(request.id, context);
    const sourceMaterialVersion = await approvalPayloadVersion(request.payload);
    if (sourceMaterialVersion !== suppliedMaterialVersion) {
      throw new ApprovalActionFailure(409, 'APPROVAL_ACTION_STALE', 'The approval materials changed after this action was offered.');
    }
    const observed = observedNativeAction(request, actions, actorId, decision, comment, suppliedItemVersion, suppliedMaterialVersion);
    if (observed) {
      if (objectName === 'forge_sales_order' && ['approved', 'rejected', 'recalled'].includes(String(request.status))) {
        // The native action may have committed before its business cleanup or
        // reply failed. Reconcile the durable result, never decide a second time.
        try { await applySalesOrderApproval(engine, recordId, context.tenantId!); }
        catch { throw new ApprovalActionFailure(503, 'APPROVAL_ACTION_IN_DOUBT', '原生决定已保存，订单结果待核对，请从订单事项继续核对原结果。'); }
      }
      return observed;
    }
    if (request.status !== 'pending' || (decision !== 'recall' && request.viewer?.can_act !== true)) {
      throw new ApprovalActionFailure(409, 'APPROVAL_ACTION_FORBIDDEN', 'This employee can no longer act on the current approval request.');
    }
    const currentItemVersion = await approvalItemVersion(request, actions);
    if (currentItemVersion !== suppliedItemVersion) {
      throw new ApprovalActionFailure(409, 'APPROVAL_ACTION_STALE', 'The approval item changed after this action was offered.');
    }
    if (actions.some((action) => action.actor_id === actorId && ['approve', 'revise', 'reject', 'recall'].includes(action.action))) {
      throw new ApprovalActionFailure(409, 'APPROVAL_ACTION_CONFLICT', 'This employee has already recorded an approval decision for this request.');
    }
    try {
      if (request.object_name === 'forge_sales_order' && decision === 'revise' || request.object_name === CONTRACT_OBJECT && decision === 'reject') throw new ApprovalActionFailure(400, 'APPROVAL_ACTION_INVALID', '当前流程不支持该办理动作');
      if (decision === 'recall') {
        const result = await approvals.recall(requestId, { actorId, comment }, context);
        await applySalesOrderApproval(engine, recordId, context.tenantId!);
        return {
          decision: 'recall', status: result.request.status, requestId, recordId,
          itemVersion: suppliedItemVersion, sourceMaterialVersion,
          resumed: result.resumed === true, autoRejected: false, alreadyApplied: false,
          businessStatus: 'cancelled',
        };
      }
      if (decision === 'approve' || decision === 'reject') {
        const result = await approvals.decide(requestId, { actorId, decision, comment }, context);
        let businessStatus: string | undefined;
        if (objectName === 'forge_sales_order') {
          const order = await engine.findOne('forge_sales_order', { where: { id: recordId, organization_id: context.tenantId } }, { context: { ...context, isSystem: true } });
          const expected = result.request.status === 'approved' ? 'active' : result.request.status === 'rejected' ? 'cancelled' : undefined;
          if (!expected || order?.status !== expected || order.approval_outcome !== result.request.status) throw new ApprovalActionFailure(503, 'APPROVAL_ACTION_IN_DOUBT', '原生决定已保存，订单结果待核对，请从订单事项继续核对原结果。');
          businessStatus = expected;
        }
        return {
          decision: result.decision,
          status: result.request.status,
          requestId,
          recordId,
          itemVersion: suppliedItemVersion,
          sourceMaterialVersion,
          resumed: result.resumed === true,
          autoRejected: false,
          alreadyApplied: false,
          ...(businessStatus ? { businessStatus } : {}),
        };
      }
      const result = await approvals.sendBack(requestId, { actorId, comment }, context);
      const autoRejected = result.autoRejected === true;
      return {
        decision: autoRejected ? 'reject' : 'revise',
        status: result.request.status,
        requestId,
        recordId,
        itemVersion: suppliedItemVersion,
        sourceMaterialVersion,
        resumed: result.resumed === true,
        autoRejected,
        alreadyApplied: false,
      };
    } catch (error) {
      if (error instanceof ApprovalActionFailure) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/^FORBIDDEN:/.test(message)) {
        throw new ApprovalActionFailure(403, 'APPROVAL_ACTION_FORBIDDEN', 'The authenticated employee is not an allowed current approver.');
      }
      if (/^(INVALID_STATE|REQUEST_NOT_FOUND):/.test(message)) {
        throw new ApprovalActionFailure(409, 'APPROVAL_ACTION_STALE', 'The native approval request changed before this action could be applied.');
      }
      if (/^VALIDATION_FAILED:/.test(message)) {
        throw new ApprovalActionFailure(400, 'APPROVAL_ACTION_INVALID', 'The native approval service rejected this action input.');
      }
      throw new ApprovalActionFailure(503, 'APPROVAL_ACTION_IN_DOUBT', 'The approval result could not be confirmed. Read the native request and action history before continuing.');
    }
  }, objectName === 'forge_sales_order' ? async () => {
    // Do not commit an incomplete native write or a preflight lost-run refusal.
    const durable = await approvals.getRequest(requestId, context);
    const expectedStatus = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'recalled';
    if (!durable || durable.object_name !== objectName || durable.record_id !== recordId || durable.organization_id !== context.tenantId
      || durable.status !== expectedStatus
      || await approvalPayloadVersion(durable.payload) !== suppliedMaterialVersion) return false;
    const order = await engine.findOne('forge_sales_order', { where: { id: recordId, organization_id: context.tenantId } }, { context: { ...context, isSystem: true } });
    if (!order || !matchesOrderApprovalSnapshot({ submitter_id: durable.submitter_id, payload: durable.payload }, order)) return false;
    const recorded = await approvals.listActions(requestId, context);
    return recorded.filter(action => action.actor_id === actorId && action.action === decision && action.comment === comment).length === 1;
  } : undefined);
}

function currentApprovalActions(
  request: ApprovalRequestRow,
  viewer: 'current_approver' | 'original_submitter',
  itemVersion: string,
  sourceMaterialVersion: string,
  actorId: string,
): JsonRecord[] {
  if (!EMPLOYEE_APPROVAL_OBJECTS.has(request.object_name) || request.status !== 'pending' || !request.record_id) return [];
  if (request.object_name === QUOTATION_OBJECT && request.submitter_id === actorId) return [];
  const execution = (actionName: string) => ({
    tool: 'run_action',
    actionName,
    objectName: request.object_name,
    recordId: request.record_id,
    params: { approvalRequestId: request.id, itemVersion, sourceMaterialVersion },
  });
  const inputs = [{ name: 'comment', type: 'string', label: '办理意见', required: true }];
  if (viewer === 'original_submitter') {
    if (request.object_name !== 'forge_sales_order' || request.viewer?.is_submitter !== true) return [];
    return [{
      semantic: 'recall', label: '撤回订单审批',
      description: '撤回本人发起的待审批订单，取消订单并释放预收绑定，保留审批记录与财务台账。',
      execution: execution('order_approval_mcp_recall'),
      inputs: [{ name: 'comment', type: 'string', label: '撤回原因', required: true }],
    }];
  }
  if (request.viewer?.can_act !== true) return [];
  const approveActionName = request.object_name === CONTRACT_OBJECT
    ? 'contract_approval_mcp_approve'
    : request.object_name === QUOTATION_OBJECT
      ? 'quotation_approval_mcp_approve'
      : 'order_approval_mcp_approve';
  const rejectActionName = request.object_name === CONTRACT_OBJECT
    ? 'contract_approval_mcp_send_back'
    : request.object_name === QUOTATION_OBJECT
      ? 'quotation_approval_mcp_reject'
      : 'order_approval_mcp_reject';
  const secondarySemantic = request.object_name === CONTRACT_OBJECT ? 'revise' : 'reject';
  const secondaryLabel = request.object_name === CONTRACT_OBJECT ? '退回修改审批事项'
    : request.object_name === QUOTATION_OBJECT ? '驳回报价审批' : '拒绝订单复核';
  const secondaryDescription = request.object_name === CONTRACT_OBJECT
    ? '将当前员工的退回意见记录到原生审批动作，并沿原生修订分支继续。'
    : request.object_name === QUOTATION_OBJECT
      ? '记录驳回意见并由既有原生报价审批流程更新报价状态；本流程不支持退回修改。'
      : '记录拒绝意见并由原生审批取消本订单，保留正式处理依据。';
  return [
    {
      semantic: 'approve',
      label: request.object_name === QUOTATION_OBJECT ? '同意报价审批' : '同意审批事项',
      description: '将当前员工的意见记录到原生审批动作，并由原生审批服务决定是否推进流程。',
      execution: execution(approveActionName),
      inputs,
    },
    {
      semantic: secondarySemantic,
      label: secondaryLabel,
      description: secondaryDescription,
      execution: execution(rejectActionName),
      inputs,
    },
  ];
}

async function authorizedApprovalRequest(
  approvals: IApprovalService,
  requestId: string,
  executionContext: ExecutionContext,
): Promise<{
  request: ApprovalRequestRow;
  viewer: 'current_approver' | 'original_submitter';
  actions: ApprovalActionRow[];
}> {
  const request = await approvals.getRequest(requestId, executionContext);
  if (!request) throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
  if (request.id !== requestId) throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
  let viewer: 'current_approver' | 'original_submitter';
  if (request.status === 'pending' && request.object_name === 'forge_sales_order' &&
    request.viewer?.is_submitter === true && request.submitter_id === executionContext.userId) {
    viewer = 'original_submitter';
  } else if (request.status === 'pending' && request.viewer?.can_act === true) {
    viewer = 'current_approver';
  } else if (request.status === 'returned' && request.viewer?.is_submitter === true) {
    viewer = 'original_submitter';
  } else {
    throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
  }
  const actions = await approvals.listActions(request.id, executionContext);
  if (request.status === 'returned' && returnedApprovalSupersededByResubmit(actions)) {
    throw new ContextFailure(409, 'APPROVAL_CONTEXT_STALE', 'This returned approval has already been resubmitted.');
  }
  return { request, viewer, actions };
}

async function sendError(res: IHttpResponse, status: number, code: string, message: string): Promise<void> {
  res.header('Cache-Control', 'private, no-store');
  await res.status(status).json({ error: { code, message } });
}


/** The same native participant/snapshot checks serve both read doors. */
export async function readApprovalOriginal(approvals: IApprovalService, engine: IObjectQLEngine, storage: IStorageService, actor: ExecutionContext, requestId: string, fileId: string, expected: string) {
  const { request } = await authorizedApprovalRequest(approvals, requestId, actor);
  const actorOrganizationId = actor.tenantId;
  if (!request.organization_id || !actorOrganizationId || request.organization_id !== actorOrganizationId) {
    throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
  }
  const allowedFiles = snapshotFiles(request.payload, fileFieldNames(engine, request.object_name));
  const snapshotFile = allowedFiles.get(fileId);
  if (!snapshotFile) throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
  if (!snapshotFile.sha256) {
    throw new ContextFailure(422, 'APPROVAL_MATERIAL_HASH_UNAVAILABLE', 'The approval material has no frozen SHA-256 value.');
  }
  if (snapshotFile.sha256 !== expected) {
    throw new ContextFailure(409, 'APPROVAL_MATERIAL_HASH_MISMATCH', 'The requested SHA-256 does not match this approval snapshot.');
  }

  const rows = await engine.find('sys_file', {
    where: { id: fileId },
    fields: ['id', 'key', 'name', 'mime_type', 'size', 'status', 'scope', 'acl', 'owner_id', 'organization_id', 'ref_object', 'ref_id', 'ref_field'],
    limit: 1,
  }, { context: SYSTEM_CONTEXT });
  const file = rows?.[0] as FileRow | undefined;
  const fieldMatches = file && typeof file.ref_field === 'string' && snapshotFile.fields.has(file.ref_field);
  const hasOwner = file && (file.ref_object != null || file.ref_id != null || file.ref_field != null);
  const recordMatches = file && (!hasOwner || file.ref_object === request.object_name &&
    String(file.ref_id ?? '') === request.record_id && fieldMatches);
  const organizationMatches = file && file.organization_id === request.organization_id;
  if (!file || !request.submitter_id || file.owner_id !== request.submitter_id ||
      !['user', 'attachments'].includes(String(file.scope)) || file.acl !== 'private' || !recordMatches || !organizationMatches ||
      !['committed', 'deleted'].includes(String(file.status))) {
    throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
  }

  if (file.status === 'deleted') {
    const retained = await resolveRetainedContractMaterial(engine, {
      contractId: request.record_id,
      fileId,
      sha256: snapshotFile.sha256,
      organizationId: request.organization_id,
      submitterId: request.submitter_id,
      context: SYSTEM_CONTEXT,
    });
    if (!retained || retained.submitterId !== request.submitter_id || retained.contractId !== request.record_id ||
        retained.name !== file.name || retained.mediaType !== String(file.mime_type).toLowerCase() ||
        retained.bytes !== Number(file.size) || snapshotFile.name && snapshotFile.name !== retained.name) {
      throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
    }
  }

  const key = boundedText(file.key, 2048);
  const name = boundedText(file.name, 255);
  const size = Number(file.size);
  const mediaType = typeof file.mime_type === 'string' ? file.mime_type.toLowerCase() : '';
  if (!key || !name || !Number.isSafeInteger(size) || size < 1) {
    throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'The approval material metadata is invalid.');
  }
  if (size > MAX_FILE_BYTES) {
    throw new ContextFailure(413, 'APPROVAL_MATERIAL_TOO_LARGE', 'The original approval material exceeds the 2 MiB limit.');
  }
  if (!ORIGINAL_MEDIA_TYPES.has(mediaType)) {
    throw new ContextFailure(415, 'APPROVAL_MATERIAL_UNSUPPORTED_TYPE', 'Only PDF and DOCX approval originals can be downloaded.');
  }
  if (snapshotFile.name && snapshotFile.name !== name) {
    throw new ContextFailure(409, 'APPROVAL_MATERIAL_HASH_MISMATCH', 'The approval material name does not match its frozen snapshot.');
  }

  const bytes = await storage.download(key);
  if (bytes.length !== size || bytes.length > MAX_FILE_BYTES || !hasOriginalSignature(bytes, mediaType, name)) {
    throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'The original approval material failed MIME or size validation.');
  }
  const digest = await sha256(bytes);
  if (digest !== snapshotFile.sha256 || digest !== expected) {
    throw new ContextFailure(409, 'APPROVAL_MATERIAL_HASH_MISMATCH', 'The original approval material does not match its frozen SHA-256.');
  }

  return { fileId, name, mediaType, bytes, sha256: digest };
}

export class ApprovalWorkbenchContextPlugin implements Plugin {
  name = 'com.inocube.forge.approval-workbench-context';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.approvals'];

  init(ctx: PluginContext): void {
    ctx.hook('kernel:ready', () => {
      const actionEngine = readService<IObjectQLEngine>(ctx, 'objectql');
      const actionApprovals = readService<IApprovalService>(ctx, 'approvals');
      if (actionEngine && actionApprovals && typeof actionEngine.registerAction === 'function') {
        actionEngine.registerAction('forge_sales_order', ORDER_APPROVAL_MCP_APPROVE_TARGET,
          (actionContext: ApprovalMcpHandlerContext) => executeNativeApprovalAction(actionEngine, actionApprovals, actionContext, 'approve'), 'forge.approval-workbench');
        actionEngine.registerAction('forge_sales_order', ORDER_APPROVAL_MCP_REJECT_TARGET,
          (actionContext: ApprovalMcpHandlerContext) => executeNativeApprovalAction(actionEngine, actionApprovals, actionContext, 'reject'), 'forge.approval-workbench');
        actionEngine.registerAction('forge_sales_order', ORDER_APPROVAL_MCP_RECALL_TARGET,
          (actionContext: ApprovalMcpHandlerContext) => executeNativeApprovalAction(actionEngine, actionApprovals, actionContext, 'recall'), 'forge.approval-workbench');
        actionEngine.registerAction(CONTRACT_OBJECT, CONTRACT_APPROVAL_MCP_APPROVE_TARGET,
          (actionContext: ApprovalMcpHandlerContext) => executeNativeApprovalAction(actionEngine, actionApprovals, actionContext, 'approve'),
          'forge.approval-workbench');
        actionEngine.registerAction(CONTRACT_OBJECT, CONTRACT_APPROVAL_MCP_SEND_BACK_TARGET,
          (actionContext: ApprovalMcpHandlerContext) => executeNativeApprovalAction(actionEngine, actionApprovals, actionContext, 'revise'),
          'forge.approval-workbench');
        actionEngine.registerAction(QUOTATION_OBJECT, QUOTATION_APPROVAL_MCP_APPROVE_TARGET,
          (actionContext: ApprovalMcpHandlerContext) => executeNativeApprovalAction(actionEngine, actionApprovals, actionContext, 'approve'),
          'forge.approval-workbench');
        actionEngine.registerAction(QUOTATION_OBJECT, QUOTATION_APPROVAL_MCP_REJECT_TARGET,
          (actionContext: ApprovalMcpHandlerContext) => executeNativeApprovalAction(actionEngine, actionApprovals, actionContext, 'reject'),
          'forge.approval-workbench');
      } else if (!actionEngine || !actionApprovals) {
        ctx.logger.error('[approval-workbench-context] ObjectQL or native approvals service unavailable; MCP actions were not registered');
      }
      const server = readService<IHttpServer>(ctx, 'http.server') ?? readService<IHttpServer>(ctx, 'http-server');
      if (!server) {
        ctx.logger.error('[approval-workbench-context] HTTP service unavailable; route was not mounted');
        return;
      }
      const resolveContext = makeExecutionContextResolver(ctx);
      server.get(ROUTE, async (req, res) => {
        res.header('Cache-Control', 'private, no-store');
        const executionContext = await resolveContext({ req: { raw: { headers: headersForSession(req.headers) } } });
        if (!executionContext?.userId) {
          await sendError(res, 401, 'UNAUTHENTICATED', 'A valid Forge session is required.');
          return;
        }
        const requestId = boundedText(req.params?.requestId, 128);
        if (!requestId) {
          await sendError(res, 404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          return;
        }

        const approvals = readService<IApprovalService>(ctx, 'approvals');
        const engine = readService<IObjectQLEngine>(ctx, 'objectql');
        const storage = readService<IStorageService>(ctx, 'storage');
        if (!approvals || !engine || !storage) {
          await sendError(res, 503, 'APPROVAL_CONTEXT_UNAVAILABLE', 'Approval context is unavailable.');
          return;
        }

        try {
          // The native service resolves the authenticated participant flags;
          // caller-supplied identities never widen the snapshot.
          const { request, viewer, actions } = await authorizedApprovalRequest(approvals, requestId, executionContext);
          const actorOrganizationId = executionContext.tenantId;
          if (request.organization_id && request.organization_id !== actorOrganizationId) {
            throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          }
          const materialFields = fileFieldNames(engine, request.object_name);
          const allowedFiles = snapshotFiles(request.payload, materialFields);
          const snapshotMaterials = await readSnapshotFiles(request, requestId, engine, storage, allowedFiles);
          const title = boundedText(request.record_title, 300) ?? boundedText(request.object_label, 300) ?? '审批事项';
          const step = boundedText(request.step_label, 160);
          if (!step) throw new ContextFailure(422, 'APPROVAL_CONTEXT_INVALID', 'The approval step is unavailable.');
          const objectName = boundedText(request.object_name, 160);
          const recordId = boundedText(request.record_id, 128);
          if (!objectName || !recordId || !isRecord(request.payload)) {
            throw new ContextFailure(422, 'APPROVAL_CONTEXT_INVALID', 'The approval source is unavailable.');
          }
          const sourceMaterialVersion = await sha256(new TextEncoder().encode(canonicalJson(request.payload)));
          const itemVersion = await approvalItemVersion(request, actions);
          const latest = request.status === 'returned' ? latestReturn(actions) : undefined;
          if (request.status === 'returned' && !latest) {
            throw new ContextFailure(422, 'APPROVAL_CONTEXT_INVALID', 'The return decision is unavailable.');
          }
          const response = {
            version: '1',
            requestId,
            status: request.status,
            viewer,
            title,
            step,
            businessObject: {
              objectName, recordId,
              ...(boundedText(request.record_title, 300) ? { recordName: boundedText(request.record_title, 300) } : {}),
            },
            sourceMaterialVersion,
            ...(latest ?? {}),
            availableActions: currentApprovalActions(request, viewer, itemVersion, sourceMaterialVersion, executionContext.userId!),
            fields: projectFields(request, engine),
            files: snapshotMaterials.files,
            originalFiles: snapshotMaterials.originalFiles,
          };
          await res.status(200).json(response);
        } catch (error) {
          if (error instanceof ContextFailure) {
            await sendError(res, error.status, error.code, error.message);
            return;
          }
          ctx.logger.error('[approval-workbench-context] failed to build a scoped approval context');
          await sendError(res, 503, 'APPROVAL_CONTEXT_UNAVAILABLE', 'Approval context is unavailable.');
        }
      });

      server.get(ORIGINAL_ROUTE, async (req, res) => {
        res.header('Cache-Control', 'private, no-store');
        res.header('X-Content-Type-Options', 'nosniff');
        const executionContext = await resolveContext({ req: { raw: { headers: headersForSession(req.headers) } } });
        if (!executionContext?.userId) {
          await sendError(res, 401, 'UNAUTHENTICATED', 'A valid Forge session is required.');
          return;
        }
        const requestId = boundedText(req.params?.requestId, 128);
        const fileId = boundedText(req.params?.fileId, 128);
        if (!requestId || !fileId || !isFileIdToken(fileId)) {
          await sendError(res, 404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          return;
        }
        const expected = expectedSha256(req.headers);
        if (!expected) {
          await sendError(res, 428, 'APPROVAL_MATERIAL_HASH_REQUIRED', 'The frozen material SHA-256 is required.');
          return;
        }

        const approvals = readService<IApprovalService>(ctx, 'approvals');
        const engine = readService<IObjectQLEngine>(ctx, 'objectql');
        const storage = readService<IStorageService>(ctx, 'storage');
        if (!approvals || !engine || !storage) {
          await sendError(res, 503, 'APPROVAL_CONTEXT_UNAVAILABLE', 'Approval context is unavailable.');
          return;
        }

        try {
          const actorOrganizationId = executionContext.tenantId;
          const original = await readApprovalOriginal(approvals, engine, storage, executionContext, requestId, fileId, expected);
          const { name, mediaType, bytes, sha256: digest } = original;
          res.header('Content-Type', mediaType);
          res.header('Content-Length', String(bytes.length));
          res.header('Content-Disposition', contentDisposition(name));
          res.header('ETag', `"${digest}"`);
          res.header('X-Content-SHA256', digest);
          await res.status(200).send(bytes);
          ctx.logger.info('[approval-workbench-context] original bytes read', {
            userId: executionContext.userId, organizationId: actorOrganizationId,
            requestId, fileId, mediaType, bytes: bytes.length, sha256: digest,
          });
        } catch (error) {
          if (error instanceof ContextFailure) {
            await sendError(res, error.status, error.code, error.message);
            return;
          }
          ctx.logger.error('[approval-workbench-context] failed to read a scoped binary original');
          await sendError(res, 503, 'APPROVAL_CONTEXT_UNAVAILABLE', 'Approval context is unavailable.');
        }
      });

      server.get(HISTORY_ORIGINAL_ROUTE, async (req, res) => {
        res.header('Cache-Control', 'private, no-store');
        res.header('X-Content-Type-Options', 'nosniff');
        const executionContext = await resolveContext({ req: { raw: { headers: headersForSession(req.headers) } } });
        if (!executionContext?.userId) {
          await sendError(res, 401, 'UNAUTHENTICATED', 'A valid Forge session is required.');
          return;
        }
        const requestId = boundedText(req.params?.requestId, 128);
        const fileId = boundedText(req.params?.fileId, 128);
        if (!requestId || !fileId || !isFileIdToken(fileId)) {
          await sendError(res, 404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          return;
        }
        const expected = expectedSha256(req.headers);
        if (!expected) {
          await sendError(res, 428, 'APPROVAL_MATERIAL_HASH_REQUIRED', 'The frozen material SHA-256 is required.');
          return;
        }

        const approvals = readService<IApprovalService>(ctx, 'approvals');
        const engine = readService<IObjectQLEngine>(ctx, 'objectql');
        const storage = readService<IStorageService>(ctx, 'storage');
        if (!approvals || !engine || !storage) {
          await sendError(res, 503, 'APPROVAL_CONTEXT_UNAVAILABLE', 'Approval context is unavailable.');
          return;
        }

        try {
          // This path is for completed or superseded round snapshots. It deliberately
          // does not reuse authorizedApprovalRequest(), whose 409 protects current
          // workbench continuation after a returned request is resubmitted.
          const request = await approvals.getRequest(requestId, executionContext);
          if (!request || request.id !== requestId || request.object_name !== CONTRACT_OBJECT) {
            throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          }
          const actorOrganizationId = executionContext.tenantId;
          if (!actorOrganizationId || !request.organization_id || request.organization_id !== actorOrganizationId) {
            throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          }
          const actions = await approvals.listActions(requestId, executionContext);
          if (!historicalApprovalParticipant(request, actions, executionContext.userId)) {
            throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          }
          if (!request.record_id || !request.submitter_id || !isRecord(request.payload)) {
            throw new ContextFailure(422, 'APPROVAL_CONTEXT_INVALID', 'The approval source is unavailable.');
          }

          const allowedFiles = snapshotFiles(request.payload, fileFieldNames(engine, request.object_name));
          const snapshotFile = allowedFiles.get(fileId);
          if (!snapshotFile) throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          if (!snapshotFile.sha256) {
            throw new ContextFailure(422, 'APPROVAL_MATERIAL_HASH_UNAVAILABLE', 'The approval material has no frozen SHA-256 value.');
          }
          if (snapshotFile.sha256 !== expected) {
            throw new ContextFailure(409, 'APPROVAL_MATERIAL_HASH_MISMATCH', 'The requested SHA-256 does not match this approval snapshot.');
          }

          // The frozen round snapshot and immutable ledger+sys_attachment holder
          // must independently agree. Never consult the live contract fields here:
          // they point at the newest version and cannot identify an old round.
          const retained = await resolveRetainedContractMaterial(engine, {
            contractId: request.record_id,
            fileId,
            sha256: snapshotFile.sha256,
            organizationId: request.organization_id,
            submitterId: request.submitter_id,
            context: SYSTEM_CONTEXT,
          });
          if (!retained || retained.submitterId !== request.submitter_id || retained.contractId !== request.record_id) {
            throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          }
          if (snapshotFile.name && snapshotFile.name !== retained.name) {
            throw new ContextFailure(409, 'APPROVAL_MATERIAL_HASH_MISMATCH', 'The retained material name does not match this approval snapshot.');
          }

          const file = await engine.findOne('sys_file', { where: { id: fileId } }, { context: SYSTEM_CONTEXT }) as FileRow | null;
          if (!file || file.owner_id !== request.submitter_id || file.organization_id !== request.organization_id ||
              !['user', 'attachments'].includes(String(file.scope)) || file.acl !== 'private' ||
              !['committed', 'deleted'].includes(String(file.status))) {
            throw new ContextFailure(404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
          }

          const key = boundedText(file.key, 2048);
          const name = boundedText(file.name, 255);
          const size = Number(file.size);
          const mediaType = typeof file.mime_type === 'string' ? file.mime_type.toLowerCase() : '';
          if (!key || !name || !Number.isSafeInteger(size) || size < 1 ||
              name !== retained.name || mediaType !== retained.mediaType || size !== retained.bytes) {
            throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'The retained approval material metadata is invalid.');
          }
          if (size > MAX_FILE_BYTES) {
            throw new ContextFailure(413, 'APPROVAL_MATERIAL_TOO_LARGE', 'The original approval material exceeds the 2 MiB limit.');
          }
          if (!ORIGINAL_MEDIA_TYPES.has(mediaType)) {
            throw new ContextFailure(415, 'APPROVAL_MATERIAL_UNSUPPORTED_TYPE', 'Only PDF and DOCX approval originals can be downloaded.');
          }

          const bytes = await storage.download(key);
          if (bytes.length !== size || bytes.length > MAX_FILE_BYTES || !hasOriginalSignature(bytes, mediaType, name)) {
            throw new ContextFailure(422, 'APPROVAL_MATERIAL_INVALID', 'The original approval material failed MIME or size validation.');
          }
          const digest = await sha256(bytes);
          if (digest !== snapshotFile.sha256 || digest !== expected || digest !== retained.sha256) {
            throw new ContextFailure(409, 'APPROVAL_MATERIAL_HASH_MISMATCH', 'The original approval material does not match its frozen SHA-256.');
          }

          res.header('Content-Type', mediaType);
          res.header('Content-Length', String(bytes.length));
          res.header('Content-Disposition', contentDisposition(name));
          res.header('ETag', `"${digest}"`);
          res.header('X-Content-SHA256', digest);
          await res.status(200).send(bytes);
          ctx.logger.info('[approval-workbench-context] historical original bytes read', {
            userId: executionContext.userId, organizationId: actorOrganizationId,
            requestId, fileId, mediaType, bytes: bytes.length, sha256: digest,
          });
        } catch (error) {
          if (error instanceof ContextFailure) {
            await sendError(res, error.status, error.code, error.message);
            return;
          }
          ctx.logger.error('[approval-workbench-context] failed to read a retained historical original');
          await sendError(res, 503, 'APPROVAL_CONTEXT_UNAVAILABLE', 'Approval context is unavailable.');
        }
      });
    });
  }
}
