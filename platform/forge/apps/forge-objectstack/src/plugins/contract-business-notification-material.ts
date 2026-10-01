import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import {
  CONTRACT_OBJECT,
  CONTRACT_REVISION_MATERIAL_OBJECT,
  CONTRACT_SUBMISSION_OBJECT,
  resolveRetainedContractMaterial,
} from './contract-material-holder.js';

const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true, positions: [], permissions: [] };
const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const ORIGINAL_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

type JsonRecord = Record<string, unknown>;

export interface BusinessNotificationOriginalFile {
  sourceKind: 'owner';
  fileId: string;
  name: string;
  mediaType: string;
  bytes: number;
  sha256: string;
}

export interface ContractBusinessNotificationMaterials {
  materialStatus: 'available' | 'none' | 'unavailable';
  originalFiles: BusinessNotificationOriginalFile[];
}

interface MaterialEntry {
  fileId: string;
  name: string;
  mediaType: string;
  bytes: number;
  sha256: string;
}

function object(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function text(value: unknown, max = 255): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= max && !normalized.includes('\0') ? normalized : undefined;
}

function fileId(value: unknown): string | undefined {
  if (typeof value === 'string') return text(value, 128);
  return text(object(value)?.id, 128);
}

function sha256(value: unknown): string | undefined {
  const digest = text(value, 64)?.toLowerCase();
  return digest && SHA256.test(digest) ? digest : undefined;
}

function jsonArray(value: unknown): JsonRecord[] | undefined {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return undefined; }
  }
  if (!Array.isArray(parsed)) return undefined;
  const result = parsed.map(object);
  return result.every((item): item is JsonRecord => !!item) ? result : undefined;
}

function entry(value: unknown, revision: boolean): MaterialEntry | undefined {
  const raw = object(value);
  if (!raw) return undefined;
  const id = fileId(revision ? raw.fileId ?? raw.file_id : raw.file_id);
  const name = text(raw.name);
  const mediaType = text(revision ? raw.mediaType ?? raw.media_type : raw.media_type, 160)?.toLowerCase();
  const bytes = Number(raw.bytes);
  const digest = sha256(raw.sha256);
  if (!id || !name || !mediaType || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_ORIGINAL_BYTES ||
      !digest || !ORIGINAL_MEDIA_TYPES.has(mediaType)) return undefined;
  return { fileId: id, name, mediaType, bytes, sha256: digest };
}

function snapshotEntry(value: unknown): MaterialEntry | undefined {
  const raw = object(value);
  if (!raw) return undefined;
  const id = fileId(raw.file_id ?? raw.fileId);
  const name = text(raw.name);
  const digest = sha256(raw.sha256);
  if (!id || !name || !digest) return undefined;
  return { fileId: id, name, mediaType: '', bytes: 0, sha256: digest };
}

function sameEntry(left: MaterialEntry, right: MaterialEntry): boolean {
  return left.fileId === right.fileId && left.name === right.name && left.sha256 === right.sha256;
}

function sameSet(left: MaterialEntry[], right: MaterialEntry[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort((x, y) => x.fileId.localeCompare(y.fileId));
  const b = [...right].sort((x, y) => x.fileId.localeCompare(y.fileId));
  return a.every((item, index) => sameEntry(item, b[index]));
}

function currentSnapshot(contract: JsonRecord): { files?: MaterialEntry[]; hasMaterial: boolean } {
  const primaryId = fileId(contract.submitted_material_id);
  const primaryName = text(contract.submitted_material_name);
  const primarySha = sha256(contract.submitted_material_sha256);
  const rawAttachments = jsonArray(contract.submitted_attachment_manifest);
  const hasMaterial = Boolean(primaryId || primaryName || primarySha ||
    contract.submitted_attachment_manifest != null && contract.submitted_attachment_manifest !== '');
  if (!primaryId || !primaryName || !primarySha || !rawAttachments) return { hasMaterial };
  const attachments = rawAttachments.map(snapshotEntry);
  if (attachments.some((item) => !item)) return { hasMaterial: true };
  const files = [{
    fileId: primaryId, name: primaryName, mediaType: '', bytes: 0, sha256: primarySha,
  }, ...attachments as MaterialEntry[]];
  if (new Set(files.map((item) => item.fileId)).size !== files.length) return { hasMaterial: true };
  return { files, hasMaterial: true };
}

function initialPackage(ledger: JsonRecord): MaterialEntry[] | undefined {
  const manifest = jsonArray(ledger.material_manifest);
  if (!manifest?.length) return undefined;
  const files = manifest.map((item) => entry(item, false));
  if (files.some((item) => !item)) return undefined;
  const primaryId = fileId(ledger.material_file_id);
  const primary = files.find((item) => item!.fileId === primaryId);
  const expectedName = text(ledger.material_name);
  const expectedSha = sha256(ledger.material_sha256);
  if (!primary || primary!.name !== expectedName || primary!.sha256 !== expectedSha) return undefined;
  return [primary!, ...files.filter((item) => item !== primary) as MaterialEntry[]];
}

function revisionPackage(ledger: JsonRecord): MaterialEntry[] | undefined {
  const primary = entry({
    fileId: ledger.primary_file_id,
    name: ledger.primary_name,
    mediaType: ledger.primary_media_type,
    bytes: ledger.primary_bytes,
    sha256: ledger.primary_sha256,
  }, true);
  const manifest = jsonArray(ledger.attachment_manifest);
  if (!primary || !manifest) return undefined;
  const attachments = manifest.map((item) => entry(item, true));
  if (attachments.some((item) => !item)) return undefined;
  const files = [primary, ...attachments as MaterialEntry[]];
  if (new Set(files.map((item) => item.fileId)).size !== files.length) return undefined;
  return files;
}

function snapshotMatchesLedger(snapshot: MaterialEntry[], ledger: MaterialEntry[]): boolean {
  if (snapshot.length !== ledger.length) return false;
  const primary = snapshot[0];
  const ledgerPrimary = ledger[0];
  if (!sameEntry(primary, ledgerPrimary)) return false;
  return sameSet(snapshot.slice(1), ledger.slice(1));
}

/**
 * Project only the currently submitted contract package. The employee's
 * native record read happens before this function; this function then binds
 * the current record snapshot to its immutable ledger and native file holders.
 */
export async function projectCurrentContractBusinessNotificationMaterials(
  engine: IObjectQLEngine,
  input: {
    contract: JsonRecord;
    actor: ExecutionContext;
    organizationId: string;
  },
): Promise<ContractBusinessNotificationMaterials> {
  const unavailable = (): ContractBusinessNotificationMaterials => ({ materialStatus: 'unavailable', originalFiles: [] });
  const none = (): ContractBusinessNotificationMaterials => ({ materialStatus: 'none', originalFiles: [] });
  const { contract, actor, organizationId } = input;
  const contractId = text(contract.id, 128);
  const actorId = text(actor.userId, 128);
  if (!contractId || !actorId || !organizationId || contract.organization_id !== organizationId ||
      contract.owner_id !== actorId) return unavailable();

  const snapshot = currentSnapshot(contract);
  if (!snapshot.hasMaterial && contract.status === 'draft') return none();
  if (!snapshot.files) return unavailable();

  try {
    const requestId = text(contract.submitted_attachment_revision_request_id, 128);
    let ledger: JsonRecord | null;
    let files: MaterialEntry[] | undefined;
    if (requestId) {
      ledger = await engine.findOne(CONTRACT_REVISION_MATERIAL_OBJECT, {
        where: { contract_id: contractId, approval_request_id: requestId },
      }, { context: SYSTEM_CONTEXT }) as JsonRecord | null;
      if (!ledger || ledger.contract_id !== contractId || ledger.approval_request_id !== requestId ||
          ledger.organization_id !== organizationId || ledger.submitted_by !== actorId) return unavailable();
      files = revisionPackage(ledger);
    } else {
      ledger = await engine.findOne(CONTRACT_SUBMISSION_OBJECT, {
        where: { contract_id: contractId },
      }, { context: SYSTEM_CONTEXT }) as JsonRecord | null;
      if (!ledger || ledger.contract_id !== contractId || ledger.organization_id !== organizationId ||
          ledger.submitted_by !== actorId) return unavailable();
      files = initialPackage(ledger);
    }
    if (!files || !snapshotMatchesLedger(snapshot.files, files)) return unavailable();

    const projected: BusinessNotificationOriginalFile[] = [];
    for (const file of files) {
      const retained = await resolveRetainedContractMaterial(engine, {
        contractId, fileId: file.fileId, sha256: file.sha256,
        organizationId, submitterId: actorId, context: SYSTEM_CONTEXT,
      });
      if (!retained || retained.contractId !== contractId || retained.fileId !== file.fileId ||
          retained.submitterId !== actorId || retained.name !== file.name || retained.mediaType !== file.mediaType ||
          retained.bytes !== file.bytes || retained.sha256 !== file.sha256) return unavailable();

      const stored = await engine.findOne('sys_file', {
        where: { id: file.fileId },
        fields: ['id', 'name', 'mime_type', 'size', 'status', 'scope', 'acl', 'owner_id', 'organization_id'],
      }, { context: SYSTEM_CONTEXT });
      if (!stored || stored.id !== file.fileId || stored.owner_id !== actorId ||
          stored.organization_id !== organizationId || stored.acl !== 'private' || stored.scope !== 'attachments' ||
          !['committed', 'deleted'].includes(String(stored.status)) || stored.name !== file.name ||
          String(stored.mime_type).toLowerCase() !== file.mediaType || Number(stored.size) !== file.bytes) return unavailable();

      projected.push({ sourceKind: 'owner', ...file });
    }
    return { materialStatus: 'available', originalFiles: projected };
  } catch {
    return unavailable();
  }
}

export { CONTRACT_OBJECT };
