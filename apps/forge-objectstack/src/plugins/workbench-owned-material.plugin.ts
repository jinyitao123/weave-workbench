import type { Plugin, PluginContext } from '@objectstack/core';
import { makeExecutionContextResolver } from '@objectstack/plugin-hono-server';
import type { IHttpRequest, IHttpResponse, IHttpServer, IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveRetainedContractMaterialForOwner } from './contract-material-holder.js';
import { currentNativeActor, TaskConnectionFailure } from './native-task-auth.js';

const ROUTE = '/api/v1/workbench/materials/:fileId';
const ORIGINAL_ROUTE = '/api/v1/workbench/materials/:fileId/original';
const MAX_TEXT_BYTES = 700_000;
const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGINAL_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

function service<T>(context: PluginContext, name: string): T | undefined {
  try { return context.getService<T>(name); } catch { return undefined; }
}

function sessionHeaders(headers: IHttpRequest['headers']): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) for (const item of value) result.append(name, item);
    else result.set(name, value);
  }
  return result;
}

function nonempty(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result && result.length <= max && !result.includes('\0') ? result : undefined;
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

function referencedFileId(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && 'id' in value) return nonempty(value.id, 128);
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (UUID.test(text)) return text;
  if (!text.startsWith('"')) return undefined;
  try {
    const decoded: unknown = JSON.parse(text);
    return typeof decoded === 'string' && UUID.test(decoded) ? decoded : undefined;
  } catch { return undefined; }
}

async function ownerCanReadBoundOriginal(
  engine: IObjectQLEngine, file: Record<string, unknown>, actor: ExecutionContext, organizationId: string,
): Promise<boolean> {
  const references = [file.ref_object, file.ref_id, file.ref_field];
  if (references.every((value) => value == null)) return true;
  const objectName = nonempty(file.ref_object, 128);
  const recordId = nonempty(file.ref_id, 128);
  const fieldName = nonempty(file.ref_field, 128);
  if (!objectName || !/^forge_[a-z][a-z0-9_]*$/.test(objectName) || !recordId || !fieldName ||
      !/^[a-z][a-z0-9_]*$/.test(fieldName)) return false;
  try {
    // Read with the employee's native ObjectStack context, never the system context.
    const record = await engine.findOne(objectName, { where: { id: recordId } }, { context: actor });
    return !!record && record.id === recordId && record.owner_id === actor.userId &&
      record.organization_id === organizationId && referencedFileId(record[fieldName]) === file.id;
  } catch { return false; }
}

async function sendError(response: IHttpResponse, status: number, code: string): Promise<void> {
  response.header('Cache-Control', 'private, no-store');
  await response.status(status).json({ error: { code } });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', input.buffer);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

/**
 * ObjectStack's native storage route does not invoke authorizeFileRead for
 * unbound scope:user uploads. The legacy route returns the authenticated
 * employee's own committed text upload as JSON; `/original` returns a
 * SHA-bound PDF/DOCX response body through the native storage service. Both
 * routes remain restricted to private files owned by the current employee.
 * Approval participants use the separate request-snapshot context.
 */

export class OwnedOriginalFailure extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

/** Shared by the employee route and the scoped task connection. */
export async function readOwnedOriginal(engine: IObjectQLEngine, storage: IStorageService, actor: ExecutionContext, fileId: string, expected: string) {
  const actorOrganizationId = actor.tenantId;
  if (!actor.userId || !actorOrganizationId) throw new OwnedOriginalFailure(401, 'UNAUTHENTICATED');
  const file = await engine.findOne('sys_file', { where: { id: fileId } }, { context: SYSTEM_CONTEXT });
  if (!file || !['committed', 'deleted'].includes(String(file.status)) || !['user', 'attachments'].includes(String(file.scope)) || file.acl !== 'private' ||
      file.owner_id !== actor.userId) {
    throw new OwnedOriginalFailure(404, 'MATERIAL_NOT_FOUND');
  }
  if (!actorOrganizationId || file.organization_id !== actorOrganizationId) {
    throw new OwnedOriginalFailure(404, 'MATERIAL_NOT_FOUND');
  }
  const retained = await resolveRetainedContractMaterialForOwner(engine, {
    fileId,
    sha256: expected,
    organizationId: actorOrganizationId,
    ownerId: actor.userId,
    context: SYSTEM_CONTEXT,
  });
  const retainedMatches = retained && retained.submitterId === actor.userId && retained.fileId === fileId &&
    retained.name === file.name && retained.mediaType === String(file.mime_type).toLowerCase() &&
    retained.bytes === Number(file.size) && retained.sha256 === expected;
  const allowedOriginal = !!retainedMatches || file.status === 'committed' &&
    await ownerCanReadBoundOriginal(engine, file, actor, actorOrganizationId);
  if (!allowedOriginal) {
    throw new OwnedOriginalFailure(404, 'MATERIAL_NOT_FOUND');
  }
  const key = nonempty(file.key, 2048), name = nonempty(file.name, 255);
  const size = Number(file.size);
  const mediaType = nonempty(file.mime_type, 160)?.toLowerCase();
  if (!key || !name || !Number.isSafeInteger(size) || size < 1) throw new OwnedOriginalFailure(422, 'MATERIAL_INVALID');
  if (size > MAX_ORIGINAL_BYTES) throw new OwnedOriginalFailure(413, 'MATERIAL_TOO_LARGE');
  if (!mediaType || !ORIGINAL_MEDIA_TYPES.has(mediaType)) throw new OwnedOriginalFailure(415, 'MATERIAL_UNSUPPORTED');

  const downloaded = await storage.download(key);
  const bytes = downloaded instanceof Uint8Array ? downloaded : new Uint8Array(downloaded);
  if (bytes.byteLength !== size || bytes.byteLength > MAX_ORIGINAL_BYTES || !hasOriginalSignature(bytes, mediaType, name)) {
    throw new OwnedOriginalFailure(422, 'MATERIAL_INVALID');
  }
  const digest = await sha256(bytes);
  if (digest !== expected) throw new OwnedOriginalFailure(409, 'MATERIAL_SHA_MISMATCH');

  return { fileId, name, mediaType, bytes, sha256: digest };
}

export class WorkbenchOwnedMaterialPlugin implements Plugin {
  name = 'com.inocube.forge.workbench-owned-material';
  version = '1.0.0';
  type = 'standard' as const;

  init(context: PluginContext): void {
    context.hook('kernel:ready', () => {
      const server = service<IHttpServer>(context, 'http.server') ?? service<IHttpServer>(context, 'http-server');
      if (!server) {
        context.logger.error('[workbench-owned-material] HTTP service unavailable; route was not mounted');
        return;
      }
    const resolveContext = makeExecutionContextResolver(context);
    server.get(ROUTE, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        const actor = await resolveContext({ req: { raw: { headers: sessionHeaders(request.headers) } } });
        if (!actor?.userId) return sendError(response, 401, 'UNAUTHENTICATED');
        const fileId = nonempty(request.params?.fileId, 128);
        if (!fileId || !UUID.test(fileId)) return sendError(response, 404, 'MATERIAL_NOT_FOUND');

        const engine = service<IObjectQLEngine>(context, 'objectql');
        const storage = service<IStorageService>(context, 'storage');
        if (!engine || !storage) return sendError(response, 503, 'MATERIAL_UNAVAILABLE');
        try {
          await currentNativeActor(context, actor.userId, actor.tenantId ?? '');
          const file = await engine.findOne('sys_file', { where: { id: fileId } }, { context: SYSTEM_CONTEXT });
          if (!file || file.status !== 'committed' || !['user', 'attachments'].includes(String(file.scope)) || file.acl !== 'private' ||
              file.owner_id !== actor.userId || file.ref_object || file.ref_id || file.ref_field) {
            return sendError(response, 404, 'MATERIAL_NOT_FOUND');
          }
          if (!actor.tenantId || file.organization_id !== actor.tenantId) {
            return sendError(response, 404, 'MATERIAL_NOT_FOUND');
          }
          const key = nonempty(file.key, 2048), name = nonempty(file.name, 255);
          const size = Number(file.size);
          const mediaType = nonempty(file.mime_type, 160)?.toLowerCase();
          if (!key || !name || !Number.isSafeInteger(size) || size < 1) return sendError(response, 422, 'MATERIAL_INVALID');
          if (size > MAX_TEXT_BYTES) return sendError(response, 413, 'MATERIAL_TOO_LARGE');
          if (!mediaType || !/^(text\/plain|text\/markdown|text\/csv|application\/json)(;\s*charset=utf-8)?$/.test(mediaType)) {
            return sendError(response, 415, 'MATERIAL_UNSUPPORTED');
          }
          const downloaded = await storage.download(key);
          const bytes = downloaded instanceof Uint8Array ? downloaded : new Uint8Array(downloaded);
          if (bytes.byteLength !== size || bytes.byteLength > MAX_TEXT_BYTES) return sendError(response, 422, 'MATERIAL_CHANGED');
          let content: string;
          try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
          catch { return sendError(response, 422, 'MATERIAL_INVALID'); }
          if (!content.trim() || content.includes('\0')) return sendError(response, 422, 'MATERIAL_INVALID');
          await response.status(200).json({
            version: '1', fileId, name, mediaType, bytes: size, sha256: await sha256(bytes), content,
          });
        } catch (error) {
          if (error instanceof TaskConnectionFailure) return sendError(response, error.status, error.code);
          context.logger.error('[workbench-owned-material] failed to read an owned text material');
          await sendError(response, 503, 'MATERIAL_UNAVAILABLE');
        }
      });

      server.get(ORIGINAL_ROUTE, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        response.header('X-Content-Type-Options', 'nosniff');
        const actor = await resolveContext({ req: { raw: { headers: sessionHeaders(request.headers) } } });
        if (!actor?.userId) return sendError(response, 401, 'UNAUTHENTICATED');
        const actorOrganizationId = actor.tenantId || actor.organizationId;
        const fileId = nonempty(request.params?.fileId, 128);
        if (!fileId || !UUID.test(fileId)) return sendError(response, 404, 'MATERIAL_NOT_FOUND');
        const expected = expectedSha256(request.headers);
        if (!expected) return sendError(response, 428, 'MATERIAL_HASH_REQUIRED');

        const engine = service<IObjectQLEngine>(context, 'objectql');
        const storage = service<IStorageService>(context, 'storage');
        if (!engine || !storage) return sendError(response, 503, 'MATERIAL_UNAVAILABLE');
        try {
          await currentNativeActor(context, actor.userId, actor.tenantId ?? '');
          const original = await readOwnedOriginal(engine, storage, actor, fileId, expected);
          const { name, mediaType, bytes, sha256: digest } = original;
          response.header('Content-Type', mediaType);
          response.header('Content-Length', String(bytes.byteLength));
          response.header('Content-Disposition', contentDisposition(name));
          response.header('ETag', `"${digest}"`);
          response.header('X-Content-SHA256', digest);
          await response.status(200).send(bytes);
          context.logger.info('[workbench-owned-material] original bytes read', {
            userId: actor.userId, organizationId: actorOrganizationId, fileId,
            mediaType, bytes: bytes.byteLength, sha256: digest,
          });
        } catch (error) {
          if (error instanceof OwnedOriginalFailure || error instanceof TaskConnectionFailure) return sendError(response, error.status, error.code);
          context.logger.error('[workbench-owned-material] failed to read an owned binary original');
          await sendError(response, 503, 'MATERIAL_UNAVAILABLE');
        }
      });
    });
  }
}
