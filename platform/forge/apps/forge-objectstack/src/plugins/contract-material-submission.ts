import { isFileIdToken } from '@objectstack/spec/data';
import type { ActionHandlerContext } from '@objectstack/spec/ui';
import type { IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import {
  verifyContractMaterialFiles,
  type ContractMaterialFileReference,
  type VerifiedContractMaterialFile,
} from './contract-material-files.js';
import { CONTRACT_SUBMISSION_OBJECT, resolveRetainedContractMaterial, retainContractMaterialFiles } from './contract-material-holder.js';

export const CONTRACT_MATERIAL_SUBMISSION_TARGET = 'forgeSubmitContractMaterialPackage';
export const CONTRACT_SUBMISSION_RECEIPT_TARGET = 'readContractSubmissionReceipt';
export const CONTRACT_REVISION_ATTACHMENT_RETIRED_TARGET = 'retiredContractRevisionAttachmentBinding';

const CONTRACT_OBJECT = 'forge_sales_contract';
const CONTRACT_LINE_OBJECT = 'forge_sales_contract_line';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

type JsonRecord = Record<string, unknown>;
type MaterialActionParams = Record<string, unknown> & {
  primary_file_id?: unknown;
  material_file_ids?: unknown;
  material_file_id?: unknown;
  material_name?: unknown;
  material_sha256?: unknown;
};
type MaterialActionContext = ActionHandlerContext<MaterialActionParams> & {
  recordLoadDenied?: boolean;
};

interface StoredPackageEntry {
  file_id: string;
  name: string;
  media_type: string;
  bytes: number;
  sha256: string;
}

interface StoredPackage {
  primary: StoredPackageEntry;
  attachments: StoredPackageEntry[];
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function fileId(value: unknown): string | undefined {
  const candidate = typeof value === 'string' ? value : asRecord(value)?.id;
  if (typeof candidate !== 'string') return undefined;
  const result = candidate.trim();
  return isFileIdToken(result) ? result : undefined;
}

function requiredText(value: unknown, max = 128): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= max && !normalized.includes('\0') ? normalized : undefined;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function packageEntry(file: VerifiedContractMaterialFile): StoredPackageEntry {
  return {
    file_id: file.fileId, name: file.name, media_type: file.mediaType,
    bytes: file.bytes, sha256: file.sha256,
  };
}

function readStoredPackage(value: unknown, primaryId: string): StoredPackage | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const entries = parsed.flatMap((item) => {
      const row = asRecord(item);
      if (!row || typeof row.file_id !== 'string' || typeof row.name !== 'string' ||
          typeof row.media_type !== 'string' || !Number.isSafeInteger(row.bytes) ||
          typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) return [];
      return [{
        file_id: row.file_id, name: row.name, media_type: row.media_type,
        bytes: Number(row.bytes), sha256: row.sha256,
      }];
    });
    const primary = entries.find((entry) => entry.file_id === primaryId);
    if (!primary || entries.length < 1 || new Set(entries.map((entry) => entry.file_id)).size !== entries.length) return undefined;
    const attachments = entries.filter((entry) => entry.file_id !== primaryId).sort((a, b) => a.file_id.localeCompare(b.file_id));
    return { primary, attachments };
  } catch {
    return undefined;
  }
}

async function materialPackageDigest(materials: StoredPackage): Promise<string> {
  return sha256(canonicalJson(materials));
}

function recordIdOf(record: JsonRecord): string | undefined {
  return requiredText(record.id);
}

function assertCaller(context: MaterialActionContext, expectedRecordId?: string): {
  actorId: string; organizationId: string; recordId: string;
} {
  const record = asRecord(context.record);
  const recordId = record && recordIdOf(record);
  const actorId = requiredText(context.user?.id);
  const sessionActorId = requiredText(context.session?.userId);
  const organizationId = requiredText(context.session?.organizationId);
  const sessionOrganizationId = requiredText(context.user?.organizationId);
  const routedRecordId = requiredText(context.params?.recordId);
  if (context.recordLoadDenied === true || !record || !recordId || !actorId || actorId !== sessionActorId ||
      !organizationId || sessionOrganizationId && sessionOrganizationId !== organizationId ||
      expectedRecordId && recordId !== expectedRecordId || routedRecordId && routedRecordId !== recordId) {
    throw new Error('FORBIDDEN: 当前员工或合同记录不可用');
  }
  if (record.responsible_id !== actorId || record.owner_id != null && record.owner_id !== actorId) {
    throw new Error('FORBIDDEN: 只有合同负责人可以提交合同材料');
  }
  if (record.organization_id !== organizationId) {
    throw new Error('FORBIDDEN: 合同不属于当前销售组织');
  }
  return { actorId, organizationId, recordId };
}

async function getLedger(
  engine: IObjectQLEngine, contractId: string, organizationId: string, context?: ExecutionContext,
): Promise<JsonRecord | undefined> {
  const row = await engine.findOne(CONTRACT_SUBMISSION_OBJECT, { where: { contract_id: contractId } }, {
    context: context ?? { ...SYSTEM_CONTEXT, tenantId: organizationId },
  });
  return asRecord(row);
}

function requestedFileIds(context: MaterialActionContext): { primaryId: string; fileIds: string[] } {
  const primaryId = fileId(context.params.primary_file_id);
  const rawIds = context.params.material_file_ids;
  if (!primaryId || !Array.isArray(rawIds) || rawIds.length < 1) {
    throw new Error('VALIDATION_FAILED: 请明确选择一份主合同文件和本次全部提交材料');
  }
  const fileIds = rawIds.map(fileId);
  if (fileIds.some((id) => !id) || new Set(fileIds).size !== fileIds.length || !fileIds.includes(primaryId)) {
    throw new Error('VALIDATION_FAILED: 主件必须包含在本次提交材料中，且材料不能重复');
  }
  return { primaryId, fileIds: fileIds as string[] };
}

function packageFromVerified(primaryId: string, verified: VerifiedContractMaterialFile[]): StoredPackage {
  const primary = verified.find((file) => file.fileId === primaryId);
  if (!primary) throw new Error('VALIDATION_FAILED: 主件不属于本次提交材料');
  return {
    primary: packageEntry(primary),
    attachments: verified.filter((file) => file.fileId !== primaryId)
      .map(packageEntry).sort((a, b) => a.file_id.localeCompare(b.file_id)),
  };
}

function assertPackageIdsMatch(requested: { primaryId: string; fileIds: string[] }, stored: StoredPackage): void {
  const expected = [stored.primary.file_id, ...stored.attachments.map((file) => file.file_id)].sort();
  const actual = [...requested.fileIds].sort();
  if (requested.primaryId !== stored.primary.file_id || expected.length !== actual.length ||
      expected.some((id, index) => id !== actual[index])) {
    throw new Error('CONFLICT: 当前合同已经绑定另一份完整材料包；需要建立新的修订轮次');
  }
}

async function verifyExistingReceipt(
  engine: IObjectQLEngine,
  storage: IStorageService,
  input: { ledger: JsonRecord; contractId: string; actorId: string; organizationId: string; requested: { primaryId: string; fileIds: string[] }; context?: ExecutionContext },
): Promise<unknown> {
  const { ledger, contractId, actorId, organizationId, requested } = input;
  const context = input.context ?? { ...SYSTEM_CONTEXT, tenantId: organizationId };
  if (ledger.organization_id !== organizationId || ledger.submitted_by !== actorId) {
    throw new Error('FORBIDDEN: 已有提交记录不属于当前员工与组织');
  }
  const stored = readStoredPackage(ledger.material_manifest, String(ledger.material_file_id ?? ''));
  const storedDigest = typeof ledger.package_sha256 === 'string' ? ledger.package_sha256 : '';
  if (!stored || !SHA256.test(storedDigest) || await materialPackageDigest(stored) !== storedDigest) {
    throw new Error('CONFLICT: 该合同存在旧版提交记录，完整材料包尚未固定；不能升级或重写历史提交');
  }
  assertPackageIdsMatch(requested, stored);
  const expected: ContractMaterialFileReference[] = [stored.primary, ...stored.attachments].map((file) => ({
    fileId: file.file_id, name: file.name, mediaType: file.media_type, bytes: file.bytes, sha256: file.sha256,
  }));
  for (const file of expected) {
    const holder = await resolveRetainedContractMaterial(engine, {
      contractId, fileId: file.fileId, sha256: String(file.sha256), organizationId,
      submitterId: actorId, context,
    });
    if (!holder || holder.holderObject !== CONTRACT_SUBMISSION_OBJECT || holder.holderId !== String(ledger.id)) {
      throw new Error('CONFLICT: 已提交材料缺少匹配的原生历史持有关系');
    }
  }
  const checked = await verifyContractMaterialFiles({
    engine, storage, actorId, contractId, organizationId, files: expected,
    retainedLedgerId: String(ledger.id), retainedHolderObject: CONTRACT_SUBMISSION_OBJECT,
    errorPrefix: 'CONTRACT_MATERIAL',
    context,
  });
  const actualPackage = packageFromVerified(stored.primary.file_id, checked);
  if (await materialPackageDigest(actualPackage) !== storedDigest) {
    throw new Error('CONFLICT: 已提交材料当前字节与冻结包摘要不一致');
  }
  return {
    id: contractId, status: 'pending_approval', material_file_id: stored.primary.file_id,
    material_file_ids: [stored.primary.file_id, ...stored.attachments.map((file) => file.file_id)],
    package_sha256: storedDigest, submitted_at: ledger.submitted_at, repeated: true,
  };
}

async function validateContractForSubmission(
  engine: IObjectQLEngine,
  contract: JsonRecord,
  organizationId: string,
  actorId: string,
  context: ExecutionContext,
): Promise<{ totalAmount: number }> {
  const contractId = recordIdOf(contract);
  if (!contractId) throw new Error('NOT_FOUND: 当前合同不存在');
  if (contract.status !== 'draft') throw new Error('CONFLICT: 仅草稿合同可以首次提交审批');
  if (contract.responsible_id !== actorId || contract.owner_id != null && contract.owner_id !== actorId ||
      contract.organization_id !== organizationId) {
    throw new Error('FORBIDDEN: 当前员工无权提交这份合同');
  }
  if (!String(contract.payment_term ?? '').trim()) throw new Error('VALIDATION_FAILED: 提交合同前必须明确付款条件');

  const contextWithOrg = { ...context, tenantId: organizationId };
  if (contract.quotation_id) {
    const quote = await engine.findOne('forge_quotation', { where: { id: contract.quotation_id } }, { context: contextWithOrg });
    if (!quote || quote.organization_id !== organizationId || quote.status !== 'accepted' ||
        !quote.customer_acceptance_evidence_attachment ||
        Number(quote.accepted_pricing_version) !== Number(quote.pricing_version || 0)) {
      throw new Error('VALIDATION_FAILED: 来源报价需有当前核价版本的客户接受凭证');
    }
  }

  const lines = await engine.find(CONTRACT_LINE_OBJECT, {
    where: { contract_id: contractId },
    fields: ['id', 'line_type', 'name', 'quantity_limit', 'sku_id', 'taxed_subtotal', 'organization_id'],
    limit: 500,
  }, { context: contextWithOrg });
  if (!lines.length) throw new Error('VALIDATION_FAILED: 合同至少需要一条物料或服务明细');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.organization_id != null && line.organization_id !== organizationId) {
      throw new Error(`VALIDATION_FAILED: 第${index + 1}条合同明细不属于当前组织`);
    }
    if (line.line_type === 'service') {
      if (!String(line.name ?? '').trim() || !(Number(line.quantity_limit) > 0) || line.sku_id) {
        throw new Error(`VALIDATION_FAILED: 第${index + 1}条服务明细必须有名称和数量，且不能关联物料规格`);
      }
    } else {
      if (line.line_type !== 'material' || !line.sku_id) {
        throw new Error(`VALIDATION_FAILED: 第${index + 1}条合同明细类型无效或缺少物料规格`);
      }
      const sku = await engine.findOne('forge_material_sku', { where: { id: line.sku_id } }, { context: contextWithOrg });
      if (!sku || sku.organization_id !== organizationId || sku.enabled === false) {
        throw new Error(`VALIDATION_FAILED: 第${index + 1}条合同明细的物料规格不存在、已停用或不属于当前组织`);
      }
      const material = await engine.findOne('forge_material', { where: { id: sku.material_id } }, { context: contextWithOrg });
      if (!material || material.organization_id !== organizationId || material.status === 'inactive') {
        throw new Error(`VALIDATION_FAILED: 第${index + 1}条合同明细的物料不存在、已停用或不属于当前组织`);
      }
      if (material.unit_id) {
        const unit = await engine.findOne('forge_unit', { where: { id: material.unit_id } }, { context: contextWithOrg });
        if (!unit || unit.organization_id !== organizationId || unit.status === 'inactive') {
          throw new Error(`VALIDATION_FAILED: 第${index + 1}条合同明细的计量单位不可用`);
        }
      }
    }
    const subtotal = Number(line.taxed_subtotal);
    if (!Number.isFinite(subtotal) || subtotal < 0) throw new Error(`VALIDATION_FAILED: 第${index + 1}条合同金额无效`);
  }

  const now = Date.now();
  const positions: Array<[string, string]> = [
    ['contract_delivery_reviewer', '合同交付复核岗'],
    ['contract_commercial_reviewer', '合同商务复核岗'],
    ...(contract.requires_legal_review ? [['contract_legal_reviewer', '非标合同法务复核岗'] as [string, string]] : []),
  ];
  const reviewerIds: string[] = [];
  for (const [position, label] of positions) {
    const assignments = await engine.find('sys_user_position', {
      where: { position }, fields: ['user_id', 'valid_from', 'valid_until', 'organization_id'], limit: 100,
    }, { context: contextWithOrg });
    const active = assignments.filter((item) => {
      const from = item.valid_from ? Date.parse(String(item.valid_from)) : Number.NEGATIVE_INFINITY;
      const until = item.valid_until ? Date.parse(String(item.valid_until)) : Number.POSITIVE_INFINITY;
      return from <= now && now < until && item.organization_id === organizationId;
    });
    if (!active.length) throw new Error(`VALIDATION_FAILED: 未配置${label}，请先在系统设置中为员工分配该岗位`);
    if (active.length > 1) throw new Error(`VALIDATION_FAILED: ${label}当前有多名员工，请先明确本次合同的复核负责人`);
    const reviewerId = requiredText(active[0].user_id);
    if (!reviewerId) throw new Error(`VALIDATION_FAILED: ${label}未关联有效员工`);
    reviewerIds.push(reviewerId);
  }
  if (new Set(reviewerIds).size !== reviewerIds.length || reviewerIds.includes(actorId)) {
    throw new Error('VALIDATION_FAILED: 合同提交人与各复核岗位必须由不同员工承担');
  }
  const totalAmount = Math.round(lines.reduce((sum, line) => sum + Number(line.taxed_subtotal), 0) * 10000) / 10000;
  return { totalAmount };
}

/**
 * Shared first-submit domain path used by the page and by MCP run_action.
 * The dispatcher already checked the action permission and loaded `record`
 * under the caller's read scope; these checks retain that boundary before any
 * captured system engine is used for the atomic ledger/holder/status write.
 */
export async function submitContractMaterialPackage(
  engine: IObjectQLEngine,
  storage: IStorageService,
  context: MaterialActionContext,
): Promise<unknown> {
  const identity = assertCaller(context);
  const requested = requestedFileIds(context);
  const tenantSystemContext: ExecutionContext = {
    ...SYSTEM_CONTEXT, userId: identity.actorId, tenantId: identity.organizationId,
  };

  try {
    return await engine.transaction(async (transactionContext) => {
      const transactionScope: ExecutionContext = {
        ...transactionContext, userId: identity.actorId, tenantId: identity.organizationId,
      };
      const current = asRecord(await engine.findOne(CONTRACT_OBJECT, { where: { id: identity.recordId } }, { context: transactionScope }));
      if (!current || current.responsible_id !== identity.actorId ||
          current.owner_id != null && current.owner_id !== identity.actorId || current.organization_id !== identity.organizationId) {
        throw new Error('FORBIDDEN: 当前员工无权提交这份合同');
      }

      const existing = await getLedger(engine, identity.recordId, identity.organizationId, transactionScope);
      if (existing) {
        return await verifyExistingReceipt(engine, storage, {
          ledger: existing, contractId: identity.recordId, actorId: identity.actorId,
          organizationId: identity.organizationId, requested, context: transactionScope,
        });
      }
      if (current.status !== 'draft' || current.submitted_material_id || current.submitted_material_sha256) {
        throw new Error('CONFLICT: 合同已离开首次提交状态，不能新建或替换提交材料包');
      }

      const verified = await verifyContractMaterialFiles({
        engine, storage, actorId: identity.actorId, contractId: identity.recordId,
        organizationId: identity.organizationId, files: requested.fileIds.map((fileId): ContractMaterialFileReference => ({ fileId })),
        errorPrefix: 'CONTRACT_MATERIAL', context: transactionScope,
      });
      const materialPackage = packageFromVerified(requested.primaryId, verified);
      const packageSha256 = await materialPackageDigest(materialPackage);
      const business = await validateContractForSubmission(engine, current, identity.organizationId, identity.actorId, transactionScope);
      const submittedAt = new Date().toISOString();
      const manifest = [materialPackage.primary, ...materialPackage.attachments];
      const submissionId = globalThis.crypto.randomUUID();
      await engine.insert(CONTRACT_SUBMISSION_OBJECT, {
        id: submissionId,
        name: `${String(current.code || current.name || '合同')} 首次提交`,
        contract_id: identity.recordId,
        material_file_id: materialPackage.primary.file_id,
        material_name: materialPackage.primary.name,
        material_sha256: materialPackage.primary.sha256,
        material_manifest: JSON.stringify(manifest),
        package_sha256: packageSha256,
        organization_id: identity.organizationId,
        submitted_by: identity.actorId,
        submitted_at: submittedAt,
      }, { context: transactionScope });
      await retainContractMaterialFiles(engine, {
        parentObject: CONTRACT_SUBMISSION_OBJECT,
        parentId: submissionId,
        submitterId: identity.actorId,
        files: [materialPackage.primary, ...materialPackage.attachments].map((file) => ({
          fileId: file.file_id, name: file.name, mediaType: file.media_type, bytes: file.bytes, sha256: file.sha256,
        })),
        context: transactionScope,
      });
      await engine.update(CONTRACT_OBJECT, {
        id: identity.recordId,
        total_amount: business.totalAmount,
        status: 'pending_approval',
        submitted_material_id: materialPackage.primary.file_id,
        submitted_material_name: materialPackage.primary.name,
        submitted_material_sha256: materialPackage.primary.sha256,
        attachment_ids: materialPackage.attachments.map((file) => file.file_id),
        submitted_attachment_manifest: JSON.stringify(materialPackage.attachments.map((file) => ({
          file_id: file.file_id, name: file.name, sha256: file.sha256,
        }))),
        submitted_attachment_revision_request_id: null,
        submitted_at: submittedAt,
      }, { context: transactionScope });
      return {
        id: identity.recordId, total_amount: business.totalAmount, status: 'pending_approval',
        material_file_id: materialPackage.primary.file_id,
        material_file_ids: manifest.map((file) => file.file_id),
        package_sha256: packageSha256, submitted_at: submittedAt, repeated: false,
      };
    }, tenantSystemContext, { require: true });
  } catch (error) {
    const existing = await getLedger(engine, identity.recordId, identity.organizationId);
    if (existing) return await verifyExistingReceipt(engine, storage, {
      ledger: existing, contractId: identity.recordId, actorId: identity.actorId,
      organizationId: identity.organizationId, requested,
    });
    throw error;
  }
}

/** Read-only compatibility path for old action names; it never creates a new submission. */
export async function readContractSubmissionReceipt(engine: IObjectQLEngine, context: MaterialActionContext): Promise<unknown> {
  const identity = assertCaller(context);
  const ledger = asRecord(await engine.findOne(CONTRACT_SUBMISSION_OBJECT, {
    where: { contract_id: identity.recordId },
  }, { context: SYSTEM_CONTEXT }));
  if (!ledger || ledger.contract_id !== identity.recordId || ledger.submitted_by !== identity.actorId ||
      ledger.organization_id != null && ledger.organization_id !== identity.organizationId) {
    throw new Error('ACTION_RETIRED: 旧提交入口不再办理新合同；请使用完整材料包提交动作');
  }
  const legacyFileId = requiredText(context.params.material_file_id, 128);
  const legacyName = requiredText(context.params.material_name, 255);
  const legacySha = requiredText(context.params.material_sha256, 64)?.toLowerCase();
  const legacyScalarMatch = !!legacyFileId && !!legacyName && !!legacySha &&
    ledger.material_file_id === legacyFileId && ledger.material_name === legacyName && ledger.material_sha256 === legacySha;
  if (ledger.organization_id == null && !legacyScalarMatch) {
    throw new Error('ACTION_RETIRED: 缺少组织范围的历史记录只允许精确读取旧版三标量回执');
  }
  if (legacyFileId && (ledger.material_file_id !== legacyFileId || ledger.material_name !== context.params.material_name ||
      String(ledger.material_sha256 ?? '').toLowerCase() !== String(context.params.material_sha256 ?? '').trim().toLowerCase())) {
    throw new Error('CONFLICT: 旧提交入口只能读取与参数完全一致的既有回执');
  }
  const stored = readStoredPackage(ledger.material_manifest, String(ledger.material_file_id ?? ''));
  if (ledger.organization_id != null && stored && SHA256.test(String(ledger.package_sha256 ?? '')) &&
      await materialPackageDigest(stored) !== ledger.package_sha256) {
    throw new Error('CONFLICT: 既有材料包回执摘要不一致');
  }
  return {
    id: identity.recordId, status: 'already_submitted', material_file_id: ledger.material_file_id,
    material_name: ledger.material_name, material_sha256: ledger.material_sha256,
    package_sha256: ledger.package_sha256 ?? null, submitted_at: ledger.submitted_at,
    repeated: true, legacy: !stored,
  };
}

export function rejectRetiredRevisionAttachmentBinding(): never {
  throw new Error('ACTION_RETIRED: 单独绑定附件已停用；请在完整修订材料包中一次提交主件和全部附件');
}
