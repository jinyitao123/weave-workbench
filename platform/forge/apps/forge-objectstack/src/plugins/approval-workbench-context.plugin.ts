import type { Plugin, PluginContext } from '@objectstack/core';
import { makeExecutionContextResolver } from '@objectstack/plugin-hono-server';
import { isFileIdToken } from '@objectstack/spec/data';
import type { ApprovalActionRow, ApprovalRequestRow, IApprovalService, IHttpRequest, IHttpResponse, IHttpServer, IStorageService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';

const ROUTE = '/api/v1/approvals/requests/:requestId/workbench-context';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 11;
const MAX_FIELDS = 64;
const MAX_FIELD_VALUE = 4_000;
const FILE_FIELD_TYPES = new Set(['file']);
const TEXT_MEDIA_TYPES = new Set([
  'text/plain', 'text/plain; charset=utf-8',
  'text/markdown', 'text/markdown; charset=utf-8', 'text/x-markdown',
]);
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

class ContextFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
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
  if (result.size > MAX_FILES) {
    throw new ContextFailure(422, 'APPROVAL_CONTEXT_TOO_LARGE', 'The approval contains too many text materials.');
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
  schemaField: { type?: string; label?: string; system?: boolean; internal?: boolean } | undefined,
  payloadDisplay: JsonRecord,
): string | undefined {
  if (!schemaField || schemaField.system || schemaField.internal || FILE_FIELD_TYPES.has(schemaField.type ?? '')) return undefined;
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
  engine: IObjectQLEngine,
  storage: IStorageService,
  allowedFiles: Map<string, SnapshotFile>,
): Promise<Array<{ fileId: string; name: string; mediaType: 'text/plain; charset=utf-8'; bytes: number; sha256: string; content: string }>> {
  if (allowedFiles.size === 0) return [];
  const orderedFiles = [...allowedFiles.entries()].sort((left, right) => Number(right[1].primary === true) - Number(left[1].primary === true));
  const ids = orderedFiles.map(([id]) => id);
  const rows = await engine.find('sys_file', {
    where: { id: { $in: ids } },
    fields: ['id', 'key', 'name', 'mime_type', 'size', 'status', 'ref_object', 'ref_id', 'ref_field'],
    limit: ids.length,
  }, { context: SYSTEM_CONTEXT });
  const byId = new Map<string, FileRow>();
  for (const row of rows ?? []) {
    if (row?.id != null) byId.set(String(row.id), row as FileRow);
  }

  const files = [];
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
    if (!TEXT_MEDIA_TYPES.has(String(file.mime_type))) {
      throw new ContextFailure(415, 'APPROVAL_MATERIAL_UNSUPPORTED_TYPE', 'Only text/plain approval materials can be previewed.');
    }
    if ((file.size as number) > MAX_FILE_BYTES) {
      throw new ContextFailure(413, 'APPROVAL_MATERIAL_TOO_LARGE', 'An approval text material exceeds the 2 MiB limit.');
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
  return files;
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

async function sendError(res: IHttpResponse, status: number, code: string, message: string): Promise<void> {
  await res.status(status).json({ error: { code, message } });
}

export class ApprovalWorkbenchContextPlugin implements Plugin {
  name = 'com.inocube.forge.approval-workbench-context';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.approvals'];

  init(ctx: PluginContext): void {
    ctx.hook('kernel:ready', () => {
      const server = readService<IHttpServer>(ctx, 'http.server') ?? readService<IHttpServer>(ctx, 'http-server');
      if (!server) {
        ctx.logger.error('[approval-workbench-context] HTTP service unavailable; route was not mounted');
        return;
      }
      const resolveContext = makeExecutionContextResolver(ctx);
      server.get(ROUTE, async (req, res) => {
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
          // This is the sole authorization lookup. The service resolves the
          // authenticated participant flags; caller-supplied ids are ignored.
          const request = await approvals.getRequest(requestId, executionContext);
          if (!request) {
            await sendError(res, 404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
            return;
          }
          let viewer: 'current_approver' | 'original_submitter';
          if (request.status === 'pending' && request.viewer?.can_act === true) {
            viewer = 'current_approver';
          } else if (request.status === 'returned' && request.viewer?.is_submitter === true) {
            viewer = 'original_submitter';
          } else {
            await sendError(res, 404, 'APPROVAL_CONTEXT_NOT_FOUND', 'Approval context not found.');
            return;
          }

          const actions = request.status === 'returned' ? await approvals.listActions(request.id, executionContext) : [];
          if (request.status === 'returned' && returnedApprovalSupersededByResubmit(actions)) {
            await sendError(res, 409, 'APPROVAL_CONTEXT_STALE', 'This returned approval has already been resubmitted.');
            return;
          }
          const materialFields = fileFieldNames(engine, request.object_name);
          const allowedFiles = snapshotFiles(request.payload, materialFields);
          const files = await readSnapshotFiles(request, engine, storage, allowedFiles);
          const title = boundedText(request.record_title, 300) ?? boundedText(request.object_label, 300) ?? '审批事项';
          const step = boundedText(request.step_label, 160);
          if (!step) throw new ContextFailure(422, 'APPROVAL_CONTEXT_INVALID', 'The approval step is unavailable.');
          const objectName = boundedText(request.object_name, 160);
          const recordId = boundedText(request.record_id, 128);
          if (!objectName || !recordId || !isRecord(request.payload)) {
            throw new ContextFailure(422, 'APPROVAL_CONTEXT_INVALID', 'The approval source is unavailable.');
          }
          const sourceMaterialVersion = await sha256(new TextEncoder().encode(canonicalJson(request.payload)));
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
            fields: projectFields(request, engine),
            files,
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
    });
  }
}
