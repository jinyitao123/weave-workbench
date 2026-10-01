import type { IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { resolveRetainedContractMaterial } from './contract-material-holder.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const QUERY_CHUNK_SIZE = 100;
const OFFICE_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const TEXT_MEDIA_TYPES = new Set(['text/plain', 'text/plain; charset=utf-8']);
const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true, positions: [], permissions: [] };
type JsonRecord = Record<string, unknown>;

export interface ContractMaterialFileReference {
  fileId: string;
  name?: string;
  sha256?: string;
  mediaType?: string;
  bytes?: number;
}

export interface VerifiedContractMaterialFile {
  fileId: string;
  name: string;
  sha256: string;
  mediaType: string;
  bytes: number;
}

export interface VerifyContractMaterialFilesOptions {
  engine: IObjectQLEngine;
  storage: IStorageService;
  actorId: string;
  contractId: string;
  organizationId?: string;
  files: ContractMaterialFileReference[];
  /** Revision callers preserve legacy text input semantics; initial submission derives all metadata from sys_file. */
  requireExpectedOfficeMetadata?: boolean;
  requireOrganization?: boolean;
  /** Required for any soft-deleted file; it must name the exact immutable holder row. */
  retainedLedgerId?: string;
  retainedHolderObject?: string;
  errorPrefix?: string;
  context?: ExecutionContext;
}

function fail(prefix: string, code: string, message: string): never {
  throw new Error(`${prefix}_${code}: ${message}`);
}

function normalizeMediaType(raw: unknown, prefix: string): string {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (OFFICE_MEDIA_TYPES.has(value)) return value;
  if (TEXT_MEDIA_TYPES.has(value)) return 'text/plain; charset=utf-8';
  fail(prefix, 'UNSUPPORTED_TYPE', 'material MIME type is not supported');
}

function fileHasOriginalSignature(bytes: Uint8Array, mediaType: string, name: string): boolean {
  const lowerName = name.toLowerCase();
  if (mediaType === 'application/pdf') {
    return lowerName.endsWith('.pdf') && bytes.byteLength >= 5 &&
      String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
  }
  if (mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return lowerName.endsWith('.docx') && bytes.byteLength >= 4 &&
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }
  return false;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The shared server-side validator for first submission and returned revisions.
 * Names, MIME, lengths, and digests are read from ObjectStack/storage; caller
 * supplied values can only narrow the match and can never establish trust.
 */
export async function verifyContractMaterialFiles(options: VerifyContractMaterialFilesOptions): Promise<VerifiedContractMaterialFile[]> {
  const {
    engine, storage, actorId, contractId, organizationId, files,
    requireExpectedOfficeMetadata = false, requireOrganization = true, retainedLedgerId, retainedHolderObject,
    errorPrefix = 'CONTRACT_MATERIAL', context = SYSTEM_CONTEXT,
  } = options;
  if (!actorId || !contractId || requireOrganization && !organizationId || files.length < 1) {
    fail(errorPrefix, 'INVALID', 'material package identity or count is invalid');
  }
  const ids = files.map((file) => file.fileId);
  if (ids.some((id) => !id || id.length > 128) || new Set(ids).size !== ids.length) {
    fail(errorPrefix, 'INVALID', 'material package contains an invalid or duplicate file reference');
  }
  const byId = new Map<string, JsonRecord>();
  for (let offset = 0; offset < ids.length; offset += QUERY_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + QUERY_CHUNK_SIZE);
    const rows = await engine.find('sys_file', {
      where: { id: { $in: chunk } },
      fields: ['id', 'key', 'name', 'mime_type', 'size', 'status', 'scope', 'acl', 'owner_id', 'organization_id', 'ref_object', 'ref_id'],
      limit: chunk.length,
    }, { context });
    for (const row of rows ?? []) byId.set(String(row.id), row as JsonRecord);
  }
  const verified: VerifiedContractMaterialFile[] = [];
  let total = 0;

  for (const expected of files) {
    const file = byId.get(expected.fileId);
    const referencePresent = file && (file.ref_object != null || file.ref_id != null);
    const statusOkay = file && (file.status === 'committed' || file.status === 'deleted' && !!retainedLedgerId);
    if (!file || !statusOkay || file.owner_id !== actorId ||
        organizationId && file.organization_id !== organizationId ||
        typeof file.key !== 'string' || typeof file.name !== 'string' || !file.name.trim() ||
        !Number.isSafeInteger(file.size) || Number(file.size) < 1 || Number(file.size) > MAX_FILE_BYTES ||
        referencePresent && (file.ref_object !== 'forge_sales_contract' || String(file.ref_id ?? '') !== contractId)) {
      fail(errorPrefix, 'UNAVAILABLE', 'a material is unavailable to this employee, organization, or contract');
    }
    if (expected.name !== undefined && expected.name !== file.name) {
      fail(errorPrefix, 'MISMATCH', 'declared file name differs from stored file metadata');
    }
    const mediaType = normalizeMediaType(file.mime_type, errorPrefix);
    if (expected.mediaType !== undefined && normalizeMediaType(expected.mediaType, errorPrefix) !== mediaType) {
      fail(errorPrefix, 'MISMATCH', 'declared MIME type differs from stored file metadata');
    }
    if (expected.bytes !== undefined && expected.bytes !== file.size) {
      fail(errorPrefix, 'MISMATCH', 'declared byte count differs from stored file metadata');
    }
    if (requireExpectedOfficeMetadata && OFFICE_MEDIA_TYPES.has(mediaType) &&
        (expected.mediaType === undefined || expected.bytes === undefined)) {
      fail(errorPrefix, 'INVALID', 'Office originals require explicit MIME and byte metadata');
    }
    if (OFFICE_MEDIA_TYPES.has(mediaType) &&
        (!organizationId || file.organization_id !== organizationId || file.scope !== 'attachments' || file.acl !== 'private')) {
      fail(errorPrefix, 'UNAVAILABLE', 'an Office original must be a private attachment');
    }
    if (file.status === 'deleted') {
      if (!retainedLedgerId || !retainedHolderObject || !expected.sha256 || !organizationId) {
        fail(errorPrefix, 'UNAVAILABLE', 'a deleted file requires a matching immutable material holder');
      }
      const retained = await resolveRetainedContractMaterial(engine, {
        contractId, fileId: expected.fileId, sha256: expected.sha256,
        organizationId, submitterId: actorId, context,
      });
      if (!retained || retained.holderObject !== retainedHolderObject || retained.holderId !== retainedLedgerId || retained.name !== file.name ||
          retained.mediaType !== mediaType || retained.bytes !== file.size) {
        fail(errorPrefix, 'UNAVAILABLE', 'deleted file is not retained by this exact material version');
      }
    }

    const bytes = await storage.download(file.key);
    if (bytes.byteLength !== file.size || bytes.byteLength > MAX_FILE_BYTES) {
      fail(errorPrefix, 'MISMATCH', 'stored bytes differ from file metadata');
    }
    const actualSha256 = await sha256(bytes);
    if (expected.sha256 !== undefined && expected.sha256.toLowerCase() !== actualSha256) {
      fail(errorPrefix, 'MISMATCH', 'stored bytes differ from the frozen material digest');
    }
    if (OFFICE_MEDIA_TYPES.has(mediaType)) {
      if (!fileHasOriginalSignature(bytes, mediaType, file.name)) {
        fail(errorPrefix, 'INVALID', 'Office original signature or file extension is invalid');
      }
    } else {
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { fail(errorPrefix, 'INVALID', 'text material is not valid UTF-8'); }
    }
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) fail(errorPrefix, 'TOO_LARGE', 'material package exceeds the size limit');
    verified.push({ fileId: expected.fileId, name: file.name, mediaType, bytes: bytes.byteLength, sha256: actualSha256 });
  }
  return verified;
}

export const CONTRACT_MATERIAL_LIMITS = { maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES } as const;
