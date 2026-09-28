import type { Plugin, PluginContext } from '@objectstack/core';
import { makeExecutionContextResolver } from '@objectstack/plugin-hono-server';
import type { IHttpRequest, IHttpResponse, IHttpServer, IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

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
          const file = await engine.findOne('sys_file', { where: { id: fileId } }, { context: SYSTEM_CONTEXT });
          if (!file || file.status !== 'committed' || !['user', 'attachments'].includes(String(file.scope)) || file.acl !== 'private' ||
              file.owner_id !== actor.userId || file.ref_object || file.ref_id) {
            return sendError(response, 404, 'MATERIAL_NOT_FOUND');
          }
          if (file.organization_id && actor.organizationId && file.organization_id !== actor.organizationId) {
            return sendError(response, 404, 'MATERIAL_NOT_FOUND');
          }
          const key = nonempty(file.key, 2048), name = nonempty(file.name, 255);
          const size = Number(file.size);
          const mediaType = nonempty(file.mime_type, 160)?.toLowerCase();
          if (!key || !name || !Number.isSafeInteger(size) || size < 1) return sendError(response, 422, 'MATERIAL_INVALID');
          if (size > MAX_TEXT_BYTES) return sendError(response, 413, 'MATERIAL_TOO_LARGE');
          if (!mediaType || !/^(text\/plain|text\/markdown)(;\s*charset=utf-8)?$/.test(mediaType)) {
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
        } catch {
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
          const file = await engine.findOne('sys_file', { where: { id: fileId } }, { context: SYSTEM_CONTEXT });
          if (!file || file.status !== 'committed' || !['user', 'attachments'].includes(String(file.scope)) || file.acl !== 'private' ||
              file.owner_id !== actor.userId || file.ref_object != null || file.ref_id != null || file.ref_field != null) {
            return sendError(response, 404, 'MATERIAL_NOT_FOUND');
          }
          if (!actorOrganizationId || file.organization_id !== actorOrganizationId) {
            return sendError(response, 404, 'MATERIAL_NOT_FOUND');
          }
          const key = nonempty(file.key, 2048), name = nonempty(file.name, 255);
          const size = Number(file.size);
          const mediaType = nonempty(file.mime_type, 160)?.toLowerCase();
          if (!key || !name || !Number.isSafeInteger(size) || size < 1) return sendError(response, 422, 'MATERIAL_INVALID');
          if (size > MAX_ORIGINAL_BYTES) return sendError(response, 413, 'MATERIAL_TOO_LARGE');
          if (!mediaType || !ORIGINAL_MEDIA_TYPES.has(mediaType)) return sendError(response, 415, 'MATERIAL_UNSUPPORTED');

          const downloaded = await storage.download(key);
          const bytes = downloaded instanceof Uint8Array ? downloaded : new Uint8Array(downloaded);
          if (bytes.byteLength !== size || bytes.byteLength > MAX_ORIGINAL_BYTES || !hasOriginalSignature(bytes, mediaType, name)) {
            return sendError(response, 422, 'MATERIAL_INVALID');
          }
          const digest = await sha256(bytes);
          if (digest !== expected) return sendError(response, 409, 'MATERIAL_SHA_MISMATCH');

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
        } catch {
          context.logger.error('[workbench-owned-material] failed to read an owned binary original');
          await sendError(response, 503, 'MATERIAL_UNAVAILABLE');
        }
      });
    });
  }
}
