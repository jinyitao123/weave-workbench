import type { IObjectQLEngine, ISharingService, RecordShare } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { HookContext } from '@objectstack/spec/data';
import { effectivePositionUsers } from './business-position-resolution.js';
import { sharingInTransaction } from './native-sharing-transaction.js';

const CONTRACT_OBJECT = 'forge_sales_contract';
const SHARE_SOURCE_ID_PREFIX = 'forge-contract-review:';
const POSITION_LABELS = [
  ['contract_delivery_reviewer', '合同交付复核岗'],
  ['contract_commercial_reviewer', '合同商务复核岗'],
] as const;

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function contractReviewShareSourceId(contractId: string): string {
  if (!contractId || contractId.includes('\0')) throw new Error('合同复核分享缺少有效合同');
  return SHARE_SOURCE_ID_PREFIX + contractId;
}

export async function resolveContractReviewers(
  engine: IObjectQLEngine,
  contract: Row,
  organizationId: string,
  submitterId: string,
  context: ExecutionContext,
): Promise<string[]> {
  if (!organizationId || contract.organization_id !== organizationId || !text(contract.id)) {
    throw new Error('VALIDATION_FAILED: 合同复核岗位必须位于合同所属组织');
  }
  const positions = [
    ...POSITION_LABELS,
    ...(contract.requires_legal_review === true ? [['contract_legal_reviewer', '非标合同法务复核岗'] as const] : []),
  ];
  const reviewers: string[] = [];
  for (const [position, label] of positions) {
    const assignments = await effectivePositionUsers(engine, organizationId, position, { context });
    if (!assignments.length) throw new Error(`VALIDATION_FAILED: 未配置${label}，请先在系统设置中为员工分配该岗位`);
    if (assignments.length > 1) throw new Error(`VALIDATION_FAILED: ${label}当前有多名员工，请先明确本次合同的复核负责人`);
    reviewers.push(assignments[0]);
  }
  if (new Set(reviewers).size !== reviewers.length || reviewers.includes(submitterId)) {
    throw new Error('VALIDATION_FAILED: 合同提交人与各复核岗位必须由不同员工承担');
  }
  return reviewers;
}

async function shareRows(engine: IObjectQLEngine, contractId: string, organizationId: string, context: ExecutionContext): Promise<RecordShare[]> {
  const rows = await engine.find('sys_record_share', {
    where: { organization_id: organizationId, object_name: CONTRACT_OBJECT, record_id: contractId, recipient_type: 'user' },
    fields: ['id', 'object_name', 'record_id', 'recipient_type', 'recipient_id', 'access_level', 'source', 'source_id', 'organization_id'],
    limit: 1001,
  }, { context });
  if (rows.length > 1000) throw new Error('合同复核分享无法完整核对');
  return rows as unknown as RecordShare[];
}

/**
 * Project only the current native Flow-position reviewers onto the parent contract.
 * The stable team source marker is owned by this connector; all other source rows
 * are left untouched. Native controlled_by_parent detail rows inherit this read.
 */
export async function synchronizeContractReviewShares(
  engine: IObjectQLEngine,
  sharing: ISharingService,
  contract: Row,
  organizationId: string,
  reviewerIds: string[],
  context: ExecutionContext,
): Promise<void> {
  const contractId = text(contract.id);
  if (context.isSystem !== true || !context.tenantId || context.tenantId !== organizationId ||
      !contractId || contract.organization_id !== organizationId) {
    throw new Error('合同复核分享缺少精确的系统事务、合同和组织范围');
  }
  if (new Set(reviewerIds).size !== reviewerIds.length || reviewerIds.some(id => !id)) {
    throw new Error('合同复核分享目标账号无效');
  }
  sharing = sharingInTransaction(engine, sharing, context);
  const sourceId = contractReviewShareSourceId(contractId);
  const existing = await shareRows(engine, contractId, organizationId, context);
  const desired = new Set(reviewerIds);

  for (const share of existing) {
    if (share.source === 'team' && share.source_id === sourceId && !desired.has(share.recipient_id)) {
      await sharing.revoke(share.id, context, { object: CONTRACT_OBJECT, recordId: contractId });
    }
  }

  for (const recipientId of desired) {
    const own = existing.find(share => share.source === 'team' && share.source_id === sourceId && share.recipient_id === recipientId);
    if (own) {
      if (own.access_level !== 'read') {
        await sharing.grant({
          object: CONTRACT_OBJECT, recordId: contractId, recipientType: 'user', recipientId,
          accessLevel: 'read', source: 'team', sourceId,
          reason: '合同原生复核岗位读取合同',
        }, context);
      }
      continue;
    }
    // Native SharingService upserts on source (not source_id). Never overwrite a
    // different team's provenance for the same recipient/record.
    const conflictingTeamGrant = existing.some(share => share.source === 'team' && share.recipient_id === recipientId);
    if (conflictingTeamGrant) continue;
    await sharing.grant({
      object: CONTRACT_OBJECT, recordId: contractId, recipientType: 'user', recipientId,
      accessLevel: 'read', source: 'team', sourceId,
      reason: '合同原生复核岗位读取合同',
    }, context);
  }
}

export async function revokeContractReviewShares(
  engine: IObjectQLEngine,
  sharing: ISharingService,
  contractId: string,
  organizationId: string,
  context: ExecutionContext,
): Promise<void> {
  if (context.isSystem !== true || !context.tenantId || context.tenantId !== organizationId || !contractId) {
    throw new Error('合同复核分享撤销缺少组织范围');
  }
  sharing = sharingInTransaction(engine, sharing, context);
  const rows = await shareRows(engine, contractId, organizationId, context);
  const sourceId = contractReviewShareSourceId(contractId);
  for (const share of rows) {
    if (share.source === 'team' && share.source_id === sourceId) {
      await sharing.revoke(share.id, context, { object: CONTRACT_OBJECT, recordId: contractId });
    }
  }
}

export async function revokeTerminalContractReviewShares(
  engine: IObjectQLEngine,
  sharing: ISharingService,
  hook: HookContext,
): Promise<void> {
  const previous = row(hook.previous);
  const input = row(hook.input);
  const patch = input.data && typeof input.data === 'object' ? row(input.data) : input;
  const current = { ...previous, ...patch, ...row(hook.result) };
  if (previous.status !== 'pending_approval' || !['active', 'rejected'].includes(text(current.status))) return;
  const contractId = text(current.id || input.id);
  const organizationId = text(current.organization_id || hook.session?.organizationId || hook.user?.organizationId);
  if (!contractId || !organizationId || current.organization_id !== organizationId) {
    throw new Error('合同复核终态分享撤销缺少合同或组织');
  }
  const context: ExecutionContext = {
    isSystem: true,
    userId: text(hook.session?.userId || hook.user?.id) || 'system',
    tenantId: organizationId,
    ...(hook.transaction !== undefined ? { transaction: hook.transaction } : {}),
  };
  await revokeContractReviewShares(engine, sharing, contractId, organizationId, context);
}
