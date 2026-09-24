import { isFileIdToken } from '@objectstack/spec/data';
import type { Plugin, PluginContext } from '@objectstack/core';
import { makeExecutionContextResolver } from '@objectstack/plugin-hono-server';
import type { IApprovalService, IHttpRequest, IHttpResponse, IHttpServer, IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ResubmitMaterialVerificationInput } from './approval-resubmit-guard.plugin.js';

const CONTRACT_OBJECT = 'forge_sales_contract';
const LEDGER_OBJECT = 'forge_sales_contract_revision_material';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const TEXT_MEDIA_TYPES = new Set(['text/plain', 'text/plain; charset=utf-8']);
const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true, positions: [], permissions: [] };
export const CONTRACT_REVISION_MATERIAL_SERVICE = 'forge.contract.revision.material';
const REVISION_ROUTE = '/api/v1/approvals/requests/:requestId/workbench-revision';
const RECEIPT_ROUTE = '/api/v1/approvals/requests/:requestId/workbench-revision/:idempotencyKey';

export interface RevisionFileReference {
  fileId: string;
  name: string;
  sha256: string;
}

export interface ContractRevisionMaterialInput {
  requestId: string;
  returnVersion: string;
  sourceMaterialVersion: string;
  idempotencyKey: string;
  primary: RevisionFileReference;
  attachments: RevisionFileReference[];
}

export interface ContractRevisionBinding {
  bindingId: string;
  returnVersion: string;
  sourceMaterialVersion: string;
  newVersionDigest: string;
  idempotencyKey: string;
  contractId: string;
  requestId: string;
  repeated: boolean;
}

export interface ContractRevisionReceipt {
  requestId: string;
  bindingId: string;
  newVersionDigest: string;
  state: 'prepared' | 'resumed' | 'resume_unknown';
  repeated: true;
}

interface VerifiedFile extends RevisionFileReference { bytes: number }
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function approvalPayloadFromRawRow(value: unknown): JsonRecord | undefined {
  const row = record(value);
  if (!row) return undefined;
  if (record(row.payload)) return record(row.payload);
  if (typeof row.payload_json !== 'string') return undefined;
  try { return record(JSON.parse(row.payload_json)); }
  catch { return undefined; }
}

function approvalRoundFromRawRow(value: unknown): number {
  const row = record(value);
  if (!row) return 1;
  const config = record(row.node_config_json) ?? (() => {
    if (typeof row.node_config_json !== 'string') return undefined;
    try { return record(JSON.parse(row.node_config_json)); }
    catch { return undefined; }
  })();
  const round = Number(config?.__round);
  return Number.isSafeInteger(round) && round > 0 ? round : 1;
}

function timestampMillis(value: unknown): number | undefined {
  if (!(typeof value === 'string' || typeof value === 'number' || value instanceof Date)) return undefined;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function nativeResubmissionRequestId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const requestId = nativeResubmissionRequestId(item);
      if (requestId) return requestId;
    }
    return undefined;
  }
  const item = record(value);
  if (!item) return undefined;
  if (item.resubmitted === true) return text(item.requestId, 128);
  for (const child of Object.values(item)) {
    const requestId = nativeResubmissionRequestId(child);
    if (requestId) return requestId;
  }
  return undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result && result.length <= max && !result.includes('\0') ? result : undefined;
}

function requestHeaders(headers: IHttpRequest['headers']): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) for (const item of value) result.append(name, item);
    else result.set(name, value);
  }
  return result;
}

async function respond(res: IHttpResponse, status: number, code: string, message: string): Promise<void> {
  await res.status(status).json({ error: { code, message } });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as JsonRecord;
  return `{${Object.keys(object).sort().filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

async function digest(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', copied.buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function approvalPayloadVersion(value: unknown): Promise<string> {
  if (!record(value)) throw new Error('REVISION_MATERIAL_INVALID: approval payload is unavailable');
  return digest(canonicalJson(value));
}

function parseFile(value: unknown): RevisionFileReference {
  const input = record(value);
  const fileId = text(input?.fileId, 128);
  const name = text(input?.name, 255);
  const sha256 = text(input?.sha256, 64)?.toLowerCase();
  if (!fileId || !isFileIdToken(fileId) || !name || !sha256 || !SHA256.test(sha256)) {
    throw new Error('REVISION_MATERIAL_INVALID: a file reference is incomplete');
  }
  return { fileId, name, sha256 };
}

export function parseContractRevisionMaterialInput(value: unknown): ContractRevisionMaterialInput {
  const input = record(value);
  const requestId = text(input?.requestId, 128);
  const returnVersion = text(input?.returnVersion, 128);
  const sourceMaterialVersion = text(input?.sourceMaterialVersion, 64)?.toLowerCase();
  const idempotencyKey = text(input?.idempotencyKey, 64);
  if (!requestId || !returnVersion || !sourceMaterialVersion || !SHA256.test(sourceMaterialVersion) ||
      !idempotencyKey || !UUID.test(idempotencyKey) || !Array.isArray(input?.attachments) || input.attachments.length > 10) {
    throw new Error('REVISION_MATERIAL_INVALID: revision identity or attachments are invalid');
  }
  const primary = parseFile(input.primary);
  const attachments = input.attachments.map(parseFile);
  const ids = [primary, ...attachments].map((file) => file.fileId);
  if (new Set(ids).size !== ids.length) throw new Error('REVISION_MATERIAL_INVALID: duplicate file reference');
  return { requestId, returnVersion, sourceMaterialVersion, idempotencyKey, primary, attachments };
}

async function verifyFiles(
  engine: IObjectQLEngine, storage: IStorageService, actorId: string, contractId: string,
  files: RevisionFileReference[],
): Promise<VerifiedFile[]> {
  const rows = await engine.find('sys_file', {
    where: { id: { $in: files.map((file) => file.fileId) } },
    fields: ['id', 'key', 'name', 'mime_type', 'size', 'status', 'owner_id', 'ref_object', 'ref_id'],
    limit: files.length,
  }, { context: SYSTEM_CONTEXT });
  const byId = new Map((rows ?? []).map((row) => [String(row.id), row]));
  const verified: VerifiedFile[] = [];
  let total = 0;
  for (const expected of files) {
    const file = byId.get(expected.fileId);
    const hasReference = file && (file.ref_object != null || file.ref_id != null);
    if (!file || file.status !== 'committed' || file.owner_id !== actorId ||
      file.name !== expected.name || !TEXT_MEDIA_TYPES.has(String(file.mime_type)) ||
      typeof file.key !== 'string' || !Number.isInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES ||
      hasReference && (file.ref_object !== CONTRACT_OBJECT || String(file.ref_id ?? '') !== contractId)) {
      throw new Error('REVISION_MATERIAL_UNAVAILABLE: a file is unavailable to this employee and contract');
    }
    const bytes = await storage.download(file.key);
    if (bytes.length !== file.size || bytes.length > MAX_FILE_BYTES || await digest(bytes) !== expected.sha256) {
      throw new Error('REVISION_MATERIAL_MISMATCH: file bytes differ from the frozen material');
    }
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('REVISION_MATERIAL_INVALID: text file is not valid UTF-8'); }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('REVISION_MATERIAL_TOO_LARGE: material bundle exceeds the limit');
    verified.push({ ...expected, bytes: bytes.length });
  }
  return verified;
}

export class ContractRevisionMaterialService {
  private readonly approvals: IApprovalService;
  private readonly engine: IObjectQLEngine;
  private readonly storage: IStorageService;

  constructor(
    approvals: IApprovalService,
    engine: IObjectQLEngine,
    storage: IStorageService,
  ) {
    this.approvals = approvals;
    this.engine = engine;
    this.storage = storage;
  }

  /** Read-only guard called immediately before the native approval service. */
  async verifyBinding(input: ResubmitMaterialVerificationInput): Promise<boolean> {
    try {
      const { request, actorId, materialBinding, idempotencyKey, context } = input;
      if (request.object_name !== CONTRACT_OBJECT || request.status !== 'returned' || request.submitter_id !== actorId ||
          !UUID.test(materialBinding.bindingId) || !UUID.test(idempotencyKey)) return false;
      const current = await this.approvals.getRequest(request.id, context);
      if (!current || current.status !== 'returned' || current.viewer?.is_submitter !== true ||
          current.submitter_id !== actorId || current.record_id !== request.record_id ||
          await approvalPayloadVersion(current.payload) !== materialBinding.sourceMaterialVersion) return false;
      const actions = await this.approvals.listActions(request.id, context);
      if ([...actions].reverse().find((action) => action.action === 'revise')?.id !== materialBinding.returnVersion) return false;

      const row = await this.engine.findOne(LEDGER_OBJECT, { where: { id: materialBinding.bindingId } }, { context: SYSTEM_CONTEXT });
      if (!row || row.approval_request_id !== request.id || row.contract_id !== request.record_id ||
          row.submitted_by !== actorId || row.return_version !== materialBinding.returnVersion ||
          row.source_material_version !== materialBinding.sourceMaterialVersion ||
          row.new_version_digest !== materialBinding.newVersionDigest || row.idempotency_key !== idempotencyKey) return false;
      const primary = parseFile({ fileId: row.primary_file_id, name: row.primary_name, sha256: row.primary_sha256 });
      const rawAttachments: unknown = JSON.parse(String(row.attachment_manifest ?? ''));
      if (!Array.isArray(rawAttachments) || rawAttachments.length > 10) return false;
      const attachments = rawAttachments.map(parseFile);
      const verified = await verifyFiles(this.engine, this.storage, actorId, request.record_id, [primary, ...attachments]);
      const [verifiedPrimary, ...verifiedAttachments] = verified;
      return await digest(canonicalJson({ primary: verifiedPrimary, attachments: verifiedAttachments })) === materialBinding.newVersionDigest;
    } catch {
      return false;
    }
  }

  /** Reconcile after a lost response without triggering another approval action. */
  async receipt(requestId: string, idempotencyKey: string, context: ExecutionContext): Promise<ContractRevisionReceipt | null> {
    const actorId = text(context.userId, 128);
    if (!actorId || !text(requestId, 128) || !UUID.test(idempotencyKey)) return null;
    const request = await this.approvals.getRequest(requestId, context);
    if (!request || request.object_name !== CONTRACT_OBJECT || request.submitter_id !== actorId ||
        request.viewer?.is_submitter !== true) return null;
    const row = await this.engine.findOne(LEDGER_OBJECT, { where: { approval_request_id: requestId } }, { context: SYSTEM_CONTEXT });
    if (!row || row.idempotency_key !== idempotencyKey || row.submitted_by !== actorId ||
        row.contract_id !== request.record_id) return null;
    const actions = await this.approvals.listActions(requestId, context);
    const hasResubmit = actions.some((action) => action.action === 'resubmit');
    if (!hasResubmit) {
      return { requestId, bindingId: String(row.id), newVersionDigest: String(row.new_version_digest), state: 'prepared', repeated: true };
    }
    if (!request.flow_run_id) {
      return { requestId, bindingId: String(row.id), newVersionDigest: String(row.new_version_digest), state: 'resume_unknown', repeated: true };
    }
    const originalRows = await this.engine.find('sys_approval_request', {
      where: { id: requestId }, fields: ['id', 'flow_node_id', 'node_config_json', 'created_at'], limit: 1,
    }, { context: SYSTEM_CONTEXT });
    const original = originalRows?.[0];
    const flowNodeId = text(original?.flow_node_id ?? request.flow_node_id, 128);
    if (!original || !flowNodeId) {
      return { requestId, bindingId: String(row.id), newVersionDigest: String(row.new_version_digest), state: 'resume_unknown', repeated: true };
    }
    const originalRound = approvalRoundFromRawRow(original);
    const originalTime = timestampMillis(original.created_at ?? request.created_at);
    const related = await this.engine.find('sys_approval_request', {
      where: { flow_run_id: request.flow_run_id, object_name: CONTRACT_OBJECT, record_id: request.record_id },
      fields: ['id', 'flow_node_id', 'node_config_json', 'created_at'], orderBy: [{ field: 'created_at', order: 'desc' }], limit: 50,
    }, { context: SYSTEM_CONTEXT });
    const resumed = related.some((candidate) => {
      if (String(candidate.id) === requestId || String(candidate.flow_node_id ?? '') !== flowNodeId) return false;
      if (approvalRoundFromRawRow(candidate) > originalRound) return true;
      const candidateTime = timestampMillis(candidate.created_at);
      return originalTime !== undefined && candidateTime !== undefined && candidateTime > originalTime;
    });
    return {
      requestId, bindingId: String(row.id), newVersionDigest: String(row.new_version_digest),
      state: resumed ? 'resumed' : 'resume_unknown', repeated: true,
    };
  }

  async prepare(rawInput: unknown, context: ExecutionContext): Promise<ContractRevisionBinding> {
    const input = parseContractRevisionMaterialInput(rawInput);
    const actorId = text(context.userId, 128);
    if (!actorId) throw new Error('FORBIDDEN: employee identity is required');
    const request = await this.approvals.getRequest(input.requestId, context);
    if (!request || request.status !== 'returned' || request.viewer?.is_submitter !== true ||
        request.submitter_id !== actorId || request.object_name !== CONTRACT_OBJECT || !request.record_id || !record(request.payload)) {
      throw new Error('REVISION_NOT_AVAILABLE: returned approval is not assigned to this employee');
    }
    const actions = await this.approvals.listActions(input.requestId, context);
    const latestReturn = [...actions].reverse().find((action) => action.action === 'revise');
    if (!latestReturn || latestReturn.id !== input.returnVersion ||
        await approvalPayloadVersion(request.payload) !== input.sourceMaterialVersion) {
      throw new Error('REVISION_STALE: approval opinion or source material has changed');
    }
    const current = await this.engine.findOne(CONTRACT_OBJECT, { where: { id: request.record_id } }, { context: SYSTEM_CONTEXT });
    if (!current || current.status !== 'pending_approval') throw new Error('REVISION_STALE: contract state has changed');
    const [primary, ...attachments] = await verifyFiles(this.engine, this.storage, actorId, request.record_id,
      [input.primary, ...input.attachments]);
    const manifest = { primary, attachments };
    const newVersionDigest = await digest(canonicalJson(manifest));
    const savedAt = new Date().toISOString();

    const fromExisting = (existing: JsonRecord): ContractRevisionBinding => {
      if (existing.approval_request_id !== input.requestId || existing.idempotency_key !== input.idempotencyKey ||
          existing.return_version !== input.returnVersion || existing.source_material_version !== input.sourceMaterialVersion ||
          existing.new_version_digest !== newVersionDigest || existing.submitted_by !== actorId) {
        throw new Error('REVISION_CONFLICT: this request key or returned approval already has another material version');
      }
      return {
        bindingId: String(existing.id), returnVersion: input.returnVersion,
        sourceMaterialVersion: input.sourceMaterialVersion, newVersionDigest,
        idempotencyKey: input.idempotencyKey, contractId: request.record_id, requestId: input.requestId,
        repeated: true,
      };
    };

    try {
      const organizationId = text(context.tenantId, 128) ?? text(request.organization_id, 128);
      return await this.engine.transaction(async (transactionContext) => {
        const scoped = { context: transactionContext };
        const approval = await this.engine.findOne('sys_approval_request', { where: { id: input.requestId } }, scoped);
        if (!approval || approval.status !== 'returned' || approval.object_name !== CONTRACT_OBJECT ||
            approval.record_id !== request.record_id || approval.submitter_id !== actorId ||
            await approvalPayloadVersion(approvalPayloadFromRawRow(approval)) !== input.sourceMaterialVersion) {
          throw new Error('REVISION_STALE: approval changed while material was prepared');
        }
        const existing = await this.engine.findOne(LEDGER_OBJECT, { where: { approval_request_id: input.requestId } }, scoped);
        if (existing) return fromExisting(existing);
        const reusedKey = await this.engine.findOne(LEDGER_OBJECT, { where: { idempotency_key: input.idempotencyKey } }, scoped);
        if (reusedKey) throw new Error('REVISION_CONFLICT: this request key was already used for another approval');
        const liveContract = await this.engine.findOne(CONTRACT_OBJECT, { where: { id: request.record_id } }, scoped);
        if (!liveContract || liveContract.status !== 'pending_approval') {
          throw new Error('REVISION_STALE: contract state changed while material was prepared');
        }
        const bindingId = globalThis.crypto.randomUUID();
        await this.engine.insert(LEDGER_OBJECT, {
          id: bindingId, name: String(current.code || current.name || '合同') + ' 修订材料',
          contract_id: request.record_id, approval_request_id: input.requestId,
          return_version: input.returnVersion, source_material_version: input.sourceMaterialVersion,
          new_version_digest: newVersionDigest, idempotency_key: input.idempotencyKey,
          primary_file_id: primary.fileId, primary_name: primary.name, primary_sha256: primary.sha256,
          attachment_manifest: JSON.stringify(attachments), submitted_by: actorId, submitted_at: savedAt,
        }, scoped);
        await this.engine.update(CONTRACT_OBJECT, {
          id: request.record_id,
          submitted_material_id: primary.fileId,
          submitted_material_name: primary.name,
          submitted_material_sha256: primary.sha256,
          attachment_ids: attachments.map((file) => file.fileId),
          submitted_attachment_manifest: JSON.stringify(attachments.map((file) => ({
            file_id: file.fileId, name: file.name, sha256: file.sha256,
          }))),
          submitted_attachment_revision_request_id: input.requestId,
          submitted_at: savedAt,
        }, scoped);
        return {
          bindingId, returnVersion: input.returnVersion, sourceMaterialVersion: input.sourceMaterialVersion,
          newVersionDigest, idempotencyKey: input.idempotencyKey,
          contractId: request.record_id, requestId: input.requestId, repeated: false,
        };
      }, { ...SYSTEM_CONTEXT, ...(organizationId ? { tenantId: organizationId } : {}) }, { require: true });
    } catch (error) {
      // A competing transaction may have committed the exact same binding
      // after our read. Query the unique approval key before reporting failure.
      const existing = await this.engine.findOne(LEDGER_OBJECT, { where: { approval_request_id: input.requestId } }, { context: SYSTEM_CONTEXT });
      if (existing) return fromExisting(existing);
      throw error;
    }
  }
}

/** Registers the domain material validator; it does not resume approvals. */
export class ContractRevisionMaterialPlugin implements Plugin {
  name = 'com.inocube.forge.contract-revision-material';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.approvals'];

  init(ctx: PluginContext): void {
    ctx.hook('kernel:ready', () => {
      const approvals = ctx.getService<IApprovalService>('approvals');
      const engine = ctx.getService<IObjectQLEngine>('objectql');
      const storage = ctx.getService<IStorageService>('storage');
      const materials = new ContractRevisionMaterialService(approvals, engine, storage);
      ctx.registerService(CONTRACT_REVISION_MATERIAL_SERVICE, materials);

      // ObjectStack 17.3 resumes the existing run snapshot at the native
      // approval_revise back-edge. Refresh the contract payload only when that
      // native continuation carries its resubmit marker and the corresponding
      // Forge material binding and audit action are already persisted. The
      // approval plugin still creates and owns the next request and round.
      const nativeApprovals = approvals as IApprovalService & {
        openNodeRequest?: (input: JsonRecord, context: ExecutionContext) => Promise<unknown>;
      };
      if (typeof nativeApprovals.openNodeRequest === 'function') {
        const openNativeRequest = nativeApprovals.openNodeRequest.bind(approvals);
        nativeApprovals.openNodeRequest = async (rawInput, context) => {
          const input = record(rawInput);
          const requestId = nativeResubmissionRequestId(input?.variables);
          const recordId = text(input?.recordId, 128);
          if (input?.object !== CONTRACT_OBJECT || !requestId || !recordId) {
            return openNativeRequest(rawInput, context);
          }
          const returned = await approvals.getRequest(requestId, context);
          if (!returned || returned.object_name !== CONTRACT_OBJECT || returned.record_id !== recordId ||
              returned.status !== 'returned') {
            return openNativeRequest(rawInput, context);
          }
          const actions = await approvals.listActions(requestId, context);
          if (![...actions].reverse().some((action) => action.action === 'resubmit')) {
            return openNativeRequest(rawInput, context);
          }
          const binding = await engine.findOne(LEDGER_OBJECT, {
            where: { approval_request_id: requestId },
          }, { context: SYSTEM_CONTEXT });
          if (!binding || binding.contract_id !== recordId || binding.submitted_by !== returned.submitter_id) {
            return openNativeRequest(rawInput, context);
          }
          const liveContract = await engine.findOne(CONTRACT_OBJECT, { where: { id: recordId } }, { context: SYSTEM_CONTEXT });
          if (!liveContract) throw new Error('REVISION_STALE: revised contract is unavailable');
          return openNativeRequest({ ...input, record: liveContract }, context);
        };
      }

      let server: IHttpServer;
      try { server = ctx.getService<IHttpServer>('http.server'); }
      catch { return; }
      const resolveContext = makeExecutionContextResolver(ctx);
      const actorContext = (req: IHttpRequest) => resolveContext({ req: { raw: { headers: requestHeaders(req.headers) } } });

      server.post(REVISION_ROUTE, async (req, res) => {
        const context = await actorContext(req);
        if (!context?.userId) return respond(res, 401, 'UNAUTHENTICATED', 'A Forge employee session is required.');
        const requestId = text(req.params?.requestId, 128);
        const body = record(req.body);
        if (!requestId || !body) return respond(res, 400, 'REVISION_MATERIAL_INVALID', 'Revision request is incomplete.');
        if (JSON.stringify(body).length > 16_384) {
          return respond(res, 413, 'REVISION_MATERIAL_TOO_LARGE', 'Revision references exceed the request limit.');
        }
        let binding: ContractRevisionBinding;
        try {
          binding = await materials.prepare({ ...body, requestId }, context);
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (message.startsWith('REVISION_CONFLICT')) return respond(res, 409, 'REVISION_CONFLICT', 'Another material version is bound to this return.');
          if (message.startsWith('REVISION_STALE')) return respond(res, 409, 'REVISION_STALE', 'The returned approval has changed.');
          if (message.startsWith('REVISION_NOT_AVAILABLE')) return respond(res, 404, 'REVISION_NOT_AVAILABLE', 'This return is not available.');
          if (message.startsWith('REVISION_MATERIAL_')) return respond(res, 422, 'REVISION_MATERIAL_INVALID', 'The material could not be verified.');
          ctx.logger.error('[contract-revision] material preparation failed');
          return respond(res, 503, 'REVISION_UNAVAILABLE', 'Revision preparation is unavailable.');
        }

        // A prior invocation may already have written the native action. A
        // repeated POST only reads its receipt; it never calls resubmit again.
        if (binding.repeated) {
          const receipt = await materials.receipt(requestId, binding.idempotencyKey, context);
          if (!receipt) return respond(res, 503, 'REVISION_RECEIPT_UNAVAILABLE', 'Revision result could not be checked.');
          await res.status(receipt.state === 'resumed' ? 200 : 202).json(receipt);
          return;
        }
        try {
          const result = await approvals.resubmit(requestId, {
            actorId: context.userId,
            idempotencyKey: binding.idempotencyKey,
            materialBinding: {
              bindingId: binding.bindingId, returnVersion: binding.returnVersion,
              sourceMaterialVersion: binding.sourceMaterialVersion, newVersionDigest: binding.newVersionDigest,
            },
          } as Parameters<IApprovalService['resubmit']>[1], context);
          const receipt = await materials.receipt(requestId, binding.idempotencyKey, context);
          if (result.resumed === true && receipt?.state === 'resumed') {
            await res.status(200).json(receipt);
          } else {
            await res.status(202).json({ ...(receipt ?? {
              requestId, bindingId: binding.bindingId, newVersionDigest: binding.newVersionDigest, repeated: true,
            }), state: 'resume_unknown' });
          }
        } catch {
          // The native service can write its audit action before resume fails.
          // Report a queryable uncertain outcome and never replay that action.
          const receipt = await materials.receipt(requestId, binding.idempotencyKey, context).catch(() => null);
          const state = receipt?.state === 'resumed' ? 'resumed' : receipt?.state === 'prepared' ? 'prepared' : 'resume_unknown';
          await res.status(state === 'resumed' ? 200 : state === 'prepared' ? 503 : 202).json({ ...(receipt ?? {
            requestId, bindingId: binding.bindingId, newVersionDigest: binding.newVersionDigest, repeated: true,
          }), state });
        }
      });

      server.get(RECEIPT_ROUTE, async (req, res) => {
        const context = await actorContext(req);
        if (!context?.userId) return respond(res, 401, 'UNAUTHENTICATED', 'A Forge employee session is required.');
        const requestId = text(req.params?.requestId, 128);
        const idempotencyKey = text(req.params?.idempotencyKey, 64);
        if (!requestId || !idempotencyKey) return respond(res, 404, 'REVISION_RECEIPT_NOT_FOUND', 'Revision receipt not found.');
        const receipt = await materials.receipt(requestId, idempotencyKey, context).catch(() => null);
        if (!receipt) return respond(res, 404, 'REVISION_RECEIPT_NOT_FOUND', 'Revision receipt not found.');
        await res.status(receipt.state === 'resumed' ? 200 : 202).json(receipt);
      });
    });
  }
}
