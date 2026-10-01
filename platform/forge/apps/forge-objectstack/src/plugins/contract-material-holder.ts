import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

export const CONTRACT_SUBMISSION_OBJECT = 'forge_sales_contract_submission';
export const CONTRACT_REVISION_MATERIAL_OBJECT = 'forge_sales_contract_revision_material';
export const CONTRACT_OBJECT = 'forge_sales_contract';

export const CONTRACT_MATERIAL_HOLDER_OBJECTS = new Set([
  CONTRACT_SUBMISSION_OBJECT,
  CONTRACT_REVISION_MATERIAL_OBJECT,
]);

const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true, positions: [], permissions: [] };
const SHA256 = /^[0-9a-f]{64}$/;

export interface ContractMaterialFile {
  fileId: string;
  name: string;
  mediaType: string;
  bytes: number;
  sha256: string;
}

export interface RetainedContractMaterial {
  contractId: string;
  fileId: string;
  name: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  submitterId: string;
  holderObject: string;
  holderId: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fileIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isRecord(value) && typeof value.id === 'string' && value.id.trim()) return value.id.trim();
  return undefined;
}

function digestOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const digest = value.trim().toLowerCase();
  return SHA256.test(digest) ? digest : undefined;
}

function parseManifest(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function firstSubmissionFiles(row: JsonRecord): ContractMaterialFile[] {
  const manifest = parseManifest(row.material_manifest);
  if (!manifest.length || !digestOf(row.package_sha256)) return [];
  return manifest.flatMap((item) => {
    const fileId = fileIdOf(item.file_id);
    const name = typeof item.name === 'string' ? item.name : undefined;
    const mediaType = typeof item.media_type === 'string' ? item.media_type : undefined;
    const bytes = Number(item.bytes);
    const sha256 = digestOf(item.sha256);
    if (!fileId || !name || !mediaType || !Number.isSafeInteger(bytes) || bytes < 1 || !sha256) return [];
    return [{ fileId, name, mediaType, bytes, sha256 }];
  });
}

function revisionFiles(row: JsonRecord): ContractMaterialFile[] {
  const primaryId = fileIdOf(row.primary_file_id);
  const primaryName = typeof row.primary_name === 'string' ? row.primary_name : undefined;
  const primaryMediaType = typeof row.primary_media_type === 'string' ? row.primary_media_type : undefined;
  const primaryBytes = Number(row.primary_bytes);
  const primarySha = digestOf(row.primary_sha256);
  const result: ContractMaterialFile[] = [];
  if (primaryId && primaryName && primaryMediaType && Number.isSafeInteger(primaryBytes) && primaryBytes > 0 && primarySha) {
    result.push({ fileId: primaryId, name: primaryName, mediaType: primaryMediaType, bytes: primaryBytes, sha256: primarySha });
  }
  for (const item of parseManifest(row.attachment_manifest)) {
    const fileId = fileIdOf(item.fileId ?? item.file_id);
    const name = typeof item.name === 'string' ? item.name : undefined;
    const mediaType = typeof item.mediaType === 'string' ? item.mediaType : typeof item.media_type === 'string' ? item.media_type : undefined;
    const bytes = Number(item.bytes);
    const sha256 = digestOf(item.sha256);
    if (!fileId || !name || !mediaType || !Number.isSafeInteger(bytes) || bytes < 1 || !sha256) continue;
    result.push({ fileId, name, mediaType, bytes, sha256 });
  }
  return result;
}

/**
 * Link each frozen file to its immutable submission/revision ledger row using
 * ObjectStack's native attachment relation. This is the storage holder the
 * native reaper already understands; it does not create a second file store.
 * Call only after the unique ledger row is inserted in the same transaction.
 * The ledger uniqueness constraint serializes concurrent submissions before
 * this read-then-insert, so one version creates at most one link per file.
 */
export async function retainContractMaterialFiles(
  engine: IObjectQLEngine,
  input: {
    parentObject: string;
    parentId: string;
    submitterId: string;
    files: ContractMaterialFile[];
    context?: ExecutionContext;
  },
): Promise<void> {
  const { parentObject, parentId, submitterId, files } = input;
  const context = input.context ?? SYSTEM_CONTEXT;
  if (!CONTRACT_MATERIAL_HOLDER_OBJECTS.has(parentObject) || !parentId || !submitterId) {
    throw new Error('合同材料持有关系目标无效');
  }
  const seen = new Set<string>();
  for (const file of files) {
    if (!file.fileId || !file.name || !file.mediaType || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !SHA256.test(file.sha256)) {
      throw new Error('合同材料持有关系清单无效');
    }
    if (seen.has(file.fileId)) throw new Error('合同材料不能重复');
    seen.add(file.fileId);
    const existing = await engine.findOne('sys_attachment', {
      where: { parent_object: parentObject, parent_id: parentId, file_id: file.fileId },
    }, { context });
    if (existing) {
      if (existing.file_name !== file.name || existing.mime_type !== file.mediaType || Number(existing.size) !== file.bytes ||
          existing.uploaded_by !== submitterId) {
        throw new Error('合同材料历史持有关系与冻结清单不一致');
      }
      continue;
    }
    await engine.insert('sys_attachment', {
      id: globalThis.crypto.randomUUID(),
      parent_object: parentObject,
      parent_id: parentId,
      file_id: file.fileId,
      file_name: file.name,
      mime_type: file.mediaType,
      size: file.bytes,
      uploaded_by: submitterId,
      description: '合同提交版本材料',
    }, { context });
  }
}

/**
 * Resolve a file only when both the immutable version ledger and its native
 * sys_attachment holder name the same file and SHA-256. The live contract is
 * deliberately not consulted, so replaced versions remain independently
 * addressable while their holder exists.
 */
export async function resolveRetainedContractMaterial(
  engine: IObjectQLEngine,
  input: {
    contractId: string;
    fileId: string;
    sha256: string;
    organizationId: string;
    submitterId?: string;
    context?: ExecutionContext;
  },
): Promise<RetainedContractMaterial | undefined> {
  const { contractId, fileId, organizationId, submitterId } = input;
  const expectedSha = digestOf(input.sha256);
  const context = input.context ?? SYSTEM_CONTEXT;
  if (!contractId || !fileId || !organizationId || !expectedSha) return undefined;

  const versions: Array<{ object: string; row: JsonRecord; files: ContractMaterialFile[] }> = [];
  const firstSubmission = await engine.findOne(CONTRACT_SUBMISSION_OBJECT, {
    where: { contract_id: contractId },
  }, { context });
  if (firstSubmission && firstSubmission.organization_id === organizationId &&
      (!submitterId || firstSubmission.submitted_by === submitterId)) {
    versions.push({ object: CONTRACT_SUBMISSION_OBJECT, row: firstSubmission, files: firstSubmissionFiles(firstSubmission) });
  }

  const revisions = await engine.find(CONTRACT_REVISION_MATERIAL_OBJECT, {
    where: { contract_id: contractId },
  }, { context });
  for (const revision of revisions ?? []) {
    if (revision.organization_id !== organizationId || submitterId && revision.submitted_by !== submitterId) continue;
    versions.push({ object: CONTRACT_REVISION_MATERIAL_OBJECT, row: revision, files: revisionFiles(revision) });
  }

  for (const version of versions) {
    const entry = version.files.find((file) => file.fileId === fileId && file.sha256 === expectedSha);
    if (!entry) continue;
    const link = await engine.findOne('sys_attachment', {
      where: { parent_object: version.object, parent_id: String(version.row.id), file_id: fileId },
    }, { context });
    if (!link || link.file_name !== entry.name || link.mime_type !== entry.mediaType || Number(link.size) !== entry.bytes) continue;
    return {
      contractId,
      fileId,
      name: entry.name,
      mediaType: entry.mediaType,
      bytes: entry.bytes,
      sha256: entry.sha256,
      submitterId: String(version.row.submitted_by),
      holderObject: version.object,
      holderId: String(version.row.id),
    };
  }
  return undefined;
}

/** Owner-only lookup used by the existing Workbench original-material route. */
export async function resolveRetainedContractMaterialForOwner(
  engine: IObjectQLEngine,
  input: { fileId: string; sha256: string; organizationId: string; ownerId: string; context?: ExecutionContext },
): Promise<RetainedContractMaterial | undefined> {
  const context = input.context ?? SYSTEM_CONTEXT;
  const links = await engine.find('sys_attachment', { where: { file_id: input.fileId } }, { context });
  for (const link of links ?? []) {
    if (!CONTRACT_MATERIAL_HOLDER_OBJECTS.has(String(link.parent_object ?? ''))) continue;
    const ledger = link.parent_object === CONTRACT_SUBMISSION_OBJECT
      ? await engine.findOne(CONTRACT_SUBMISSION_OBJECT, { where: { id: link.parent_id } }, { context })
      : await engine.findOne(CONTRACT_REVISION_MATERIAL_OBJECT, { where: { id: link.parent_id } }, { context });
    const contractId = fileIdOf(ledger?.contract_id);
    if (!contractId) continue;
    const retained = await resolveRetainedContractMaterial(engine, {
      contractId,
      fileId: input.fileId,
      sha256: input.sha256,
      organizationId: input.organizationId,
      submitterId: input.ownerId,
      context,
    });
    if (retained && retained.holderObject === link.parent_object && retained.holderId === String(link.parent_id)) return retained;
  }
  return undefined;
}
