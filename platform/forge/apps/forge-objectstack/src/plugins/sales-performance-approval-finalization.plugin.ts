import type { Plugin, PluginContext } from '@objectstack/core';
import { defineActionDescriptor, type FlowNodeParsed } from '@objectstack/spec/automation';
import type { AutomationContext, IObjectQLEngine } from '@objectstack/spec/contracts';
import { AutomationEngine, resolveRunDataContext, type NodeExecutor } from '@objectstack/service-automation';
import { organizationBusinessDate } from './project-business-date.plugin.js';

type Row = Record<string, unknown>;
type Repository = {
  findOne(options: Record<string, unknown>): Promise<Row | undefined>;
  find(options: Record<string, unknown>): Promise<Row[]>;
  insert(data: Row): Promise<unknown>;
  update(data: Row, options: Record<string, unknown>): Promise<number>;
};
type TransactionContext = { object(name: string): Repository };
type Engine = IObjectQLEngine & {
  createContext(options: Record<string, unknown>): TransactionContext;
  transaction<T>(callback: (context: Record<string, unknown>) => Promise<T>, context?: Record<string, unknown>, options?: { require?: boolean }): Promise<T>;
};

const flowTargets = {
  forge_sales_performance_confirmation: { flowName: 'sales_performance_confirmation_approval', nodeId: 'review' },
  forge_sales_performance_rebook: { flowName: 'sales_performance_rebook_approval', nodeId: 'review' },
} as const;
const text = (value: unknown): string => value == null ? '' : String(value).trim();
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const idOf = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  return text(row(value).id || row(value).value);
};
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const versionWhere = (record: Row): Record<string, unknown> => {
  const updatedAt = Date.parse(text(record.updated_at));
  if (!Number.isFinite(updatedAt)) throw new Error('业绩记录读取版本无效');
  return { updated_at: { $gte: new Date(updatedAt).toISOString(), $lt: new Date(updatedAt + 1).toISOString() } };
};
const insertedId = (value: unknown): string => text(typeof value === 'string' ? value : row(value).id || row(row(value).record).id);

async function all(tx: TransactionContext, objectName: string, where: Row): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; offset < 20000; offset += 200) {
    const batch = await tx.object(objectName).find({ where, limit: 200, offset, orderBy: [{ field: 'id', order: 'asc' }] });
    rows.push(...batch);
    if (batch.length < 200) return rows;
  }
  throw new Error('业绩审批来源过多，已停止最终化');
}

async function terminalApproval(
  tx: TransactionContext,
  args: { objectName: keyof typeof flowTargets; flowName: string; nodeId: string; flowRunId: string; recordId: string; organizationId: string; decision: 'approved' | 'rejected' },
): Promise<{ request: Row; reviewerId: string; comment: string }> {
  const requests = await tx.object('sys_approval_request').find({ where: {
    organization_id: args.organizationId, object_name: args.objectName, record_id: args.recordId,
    process_name: 'flow:' + args.flowName, flow_run_id: args.flowRunId, flow_node_id: args.nodeId,
  }, orderBy: [{ field: 'created_at', order: 'desc' }, { field: 'id', order: 'desc' }], limit: 100 });
  if (!requests.length) throw new Error('找不到当前业绩记录对应的原生审批流程轮次');
  const round = (value: unknown) => { try { return Number(JSON.parse(text(value)).__round || 1); } catch { return 1; } };
  const request = [...requests].sort((a, b) => round(b.node_config_json) - round(a.node_config_json)
    || text(b.created_at).localeCompare(text(a.created_at)) || text(b.id).localeCompare(text(a.id)))[0];
  if (text(request.organization_id) !== args.organizationId || text(request.object_name) !== args.objectName
    || text(request.record_id) !== args.recordId || text(request.process_name) !== 'flow:' + args.flowName
    || text(request.flow_run_id) !== args.flowRunId || text(request.flow_node_id) !== args.nodeId
    || text(request.status) !== args.decision) throw new Error('找不到当前业绩记录对应的终态原生审批');
  const expectedAction = args.decision === 'approved' ? 'approve' : 'reject';
  const actions = await tx.object('sys_approval_action').find({ where: {
    organization_id: args.organizationId, request_id: text(request.id), step_name: args.nodeId, action: expectedAction,
  }, orderBy: [{ field: 'created_at', order: 'desc' }], limit: 30 });
  const decision = row(actions[0]), reviewerId = text(decision.actor_id);
  if (!reviewerId || text(decision.organization_id) !== args.organizationId || text(decision.request_id) !== text(request.id)
    || text(decision.step_name) !== args.nodeId || text(decision.action) !== expectedAction || decision.via_override === true) {
    throw new Error('原生审批缺少可核验的当前审批人记录');
  }
  return { request, reviewerId, comment: text(decision.comment) };
}

function activeWindow(from: unknown, until: unknown, now: number): boolean {
  const start = from == null || from === '' ? Number.NEGATIVE_INFINITY : Date.parse(text(from));
  const end = until == null || until === '' ? Number.POSITIVE_INFINITY : Date.parse(text(until));
  return !Number.isNaN(start) && !Number.isNaN(end) && start <= now && now < end;
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : []; } catch { return []; }
}

async function verifyFinanceReviewer(tx: TransactionContext, userId: string, organizationId: string): Promise<{ user: Row; systemPermissions: string[] }> {
  const users = tx.object('sys_user'), memberships = tx.object('sys_member');
  const user = await users.findOne({ where: { id: userId } });
  const member = await memberships.findOne({ where: { user_id: userId, organization_id: organizationId } });
  const banned = user && (user.banned === true || user.banned === 1 || user.banned === 'true');
  const expiry = Date.parse(text(user && user.ban_expires));
  if (!user || !member || banned && (!Number.isFinite(expiry) || expiry > Date.now())) throw new Error('原生审批人已不是本组织有效账号');
  const positions = (await tx.object('sys_position').find({ where: { name: 'finance_reviewer' }, limit: 100 })).filter(position =>
    position.active !== false && position.active !== 0 && position.active !== 'false'
    && (!text(position.organization_id) || text(position.organization_id) === organizationId));
  const positionIds = new Set(positions.map(position => idOf(position.id)));
  const assignments = await tx.object('sys_user_position').find({ where: { user_id: userId, organization_id: organizationId, position: 'finance_reviewer' }, limit: 1000 });
  const currentAssignments = assignments.filter(assignment => activeWindow(assignment.valid_from, assignment.valid_until, Date.now()));
  const validPositionIds = new Set(currentAssignments.flatMap(assignment => {
    const id = text(assignment.position_id);
    return id && positionIds.has(id) ? [id] : positionIds.size === 1 && assignment.position === 'finance_reviewer' ? [...positionIds] : [];
  }));
  if (!validPositionIds.size) throw new Error('原生审批人已不具备当前财务复核任职');
  const bindings = await tx.object('sys_position_permission_set').find({ where: { position_id: { $in: [...validPositionIds] } }, limit: 1000 });
  const permissionSetIds = [...new Set(bindings.map(binding => idOf(binding.permission_set_id)).filter(Boolean))];
  const permissionSets = permissionSetIds.length ? await tx.object('sys_permission_set').find({ where: { id: { $in: permissionSetIds }, active: true }, limit: 1000 }) : [];
  const systemPermissions = [...new Set(permissionSets.flatMap(set => jsonArray(set.system_permissions)))];
  if (!systemPermissions.includes('forge_sales_gross_profit_read')) throw new Error('当前财务复核岗位没有毛利来源读取权限，业绩确认不能最终化');
  return { user, systemPermissions };
}

async function grossProfitSnapshot(engine: Engine, tx: TransactionContext, reviewerId: string, organizationId: string, orderId: string, systemPermissions: string[]): Promise<Row> {
  const txApi = tx as unknown as Record<string, unknown>;
  const businessDate = await organizationBusinessDate(engine, { isSystem: true, userId: reviewerId, tenantId: organizationId, organizationId } as Record<string, unknown>);
  const result = await engine.executeAction('forge_revenue_recognition', 'sales_gross_profit_report_query', {
    params: { order_id: orderId, business_date: businessDate, period: 'year', dimension: 'order', page: 1, page_size: 100, export_all: false },
    user: { id: reviewerId, organizationId, systemPermissions },
    session: { userId: reviewerId, organizationId, timezone: 'Asia/Shanghai' },
    api: txApi,
  });
  const resultRow = row(result);
  if (resultRow.result && typeof resultRow.result === 'object') return row(resultRow.result);
  return resultRow;
}

async function postRebook(tx: TransactionContext, args: { request: Row; sourceEntry: Row; reviewerId: string; organizationId: string; comment: string }): Promise<Row> {
  const request = args.request, sourceEntry = args.sourceEntry, amount = number(request.amount), requestId = text(request.id);
  if (!requestId || !amount || amount <= 0) throw new Error('Rebook申请金额无效');
  const sourceEntries = tx.object('forge_sales_performance_entry'), rebooks = tx.object('forge_sales_performance_rebook');
  const sourceId = text(sourceEntry.id), ownerId = text(request.target_person_id), sourcePersonId = text(request.source_person_id);
  const sourceKey = 'rebook:' + requestId + ':out', targetKey = 'rebook:' + requestId + ':in';
  const existingOut = await sourceEntries.findOne({ where: { organization_id: args.organizationId, entry_key: sourceKey } });
  const existingIn = await sourceEntries.findOne({ where: { organization_id: args.organizationId, entry_key: targetKey } });
  if (existingOut && existingIn) {
    if (text(request.status) !== 'approved') {
      const changed = await rebooks.update({ status: 'approved', approval_status: 'approved', reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString(), review_comment: args.comment || null, posted_at: new Date().toISOString() }, {
        multi: true, where: { id: requestId, organization_id: args.organizationId, status: { $in: ['pending_approval', 'approved_waiting_source'] }, approval_status: 'approved' },
      });
      if (changed !== 1) throw new Error('Rebook申请状态已变化，不能完成转记');
    }
    return { id: requestId, status: 'approved', replayed: true, debit_entry_id: existingOut.id, credit_entry_id: existingIn.id };
  }
  if (existingOut || existingIn) throw new Error('Rebook双边流水状态不一致，停止重复记账');
  if (!['confirmed', 'rebooked'].includes(text(sourceEntry.status)) || text(sourceEntry.entry_type) !== 'original_confirm') throw new Error('原业绩尚未确认，Rebook暂不进入业绩银行');
  if (idOf(sourceEntry.sales_person_id) !== sourcePersonId || idOf(sourceEntry.business_unit_id) !== idOf(request.business_unit_id)) throw new Error('Rebook转出人或原生业务单元快照不匹配');
  const total = number(sourceEntry.performance_amount), posted = number(sourceEntry.rebooked_amount) || 0, reserved = number(sourceEntry.rebook_reserved_amount) || 0;
  if (total === null || posted + amount > total + 0.0001 || reserved + 0.0001 < amount) throw new Error('Rebook金额未被当前业绩记录预留');
  const [sourceUser, sourceMember, sourceAppointments, target, membership] = await Promise.all([
    tx.object('sys_user').findOne({ where: { id: sourcePersonId } }),
    tx.object('sys_member').findOne({ where: { user_id: sourcePersonId, organization_id: args.organizationId } }),
    tx.object('sys_business_unit_member').find({ where: { business_unit_id: idOf(request.business_unit_id), user_id: sourcePersonId }, limit: 1000 }),
    tx.object('sys_user').findOne({ where: { id: ownerId } }),
    tx.object('sys_member').findOne({ where: { user_id: ownerId, organization_id: args.organizationId } }),
  ]);
  const sourceBanned = sourceUser && (sourceUser.banned === true || sourceUser.banned === 1 || sourceUser.banned === 'true'), sourceBanExpiry = Date.parse(text(sourceUser && sourceUser.ban_expires));
  if (!sourceUser || !sourceMember || sourceBanned && (!Number.isFinite(sourceBanExpiry) || sourceBanExpiry > Date.now())
    || !sourceAppointments.some(appointment => activeWindow(appointment.effective_from, appointment.effective_to, Date.now()))) {
    throw new Error('Rebook转出员工已不属于当前组织原生业务单元');
  }
  const targetBanned = target && (target.banned === true || target.banned === 1 || target.banned === 'true'), targetBanExpiry = Date.parse(text(target && target.ban_expires));
  if (!target || !membership || targetBanned && (!Number.isFinite(targetBanExpiry) || targetBanExpiry > Date.now())) throw new Error('Rebook转入员工已不是本组织有效成员');
  const unit = await tx.object('sys_business_unit').findOne({ where: { id: idOf(request.business_unit_id), organization_id: args.organizationId, active: true } });
  const memberships = await tx.object('sys_business_unit_member').find({ where: { business_unit_id: idOf(request.business_unit_id), user_id: ownerId }, limit: 1000 });
  if (!unit || !activeWindow(unit.effective_from, unit.effective_to, Date.now())
    || !memberships.some(member => activeWindow(member.effective_from, member.effective_to, Date.now()))) throw new Error('Rebook转入员工已不在原生业务单元任职');
  const revision = number(sourceEntry.revision);
  if (revision === null || Math.round(revision) !== revision) throw new Error('原业绩版本无效');
  const changedSource = await sourceEntries.update({ rebooked_amount: round2(posted + amount), rebook_reserved_amount: round2(reserved - amount), status: posted + amount + 0.0001 >= total ? 'rebooked' : 'confirmed', revision: revision + 1 }, {
    multi: true, where: { id: sourceId, organization_id: args.organizationId, status: { $in: ['confirmed', 'rebooked'] }, revision },
  });
  if (changedSource !== 1) throw new Error('原业绩已变化，Rebook转记未完成');
  const ownerName = text(target.name || target.display_name || target.username);
  const shared = {
    entry_type: '', amount_direction: '', source_entry_id: sourceId, rebook_id: requestId,
    order_id: sourceEntry.order_id, order_code_snapshot: sourceEntry.order_code_snapshot, customer_id: sourceEntry.customer_id,
    customer_name_snapshot: sourceEntry.customer_name_snapshot, source_recognition_amount: sourceEntry.source_recognition_amount,
    recognition_on: sourceEntry.recognition_on || null, order_amount: sourceEntry.order_amount, performance_amount: amount,
    performance_ratio: request.ratio, gross_profit: null, gross_profit_rate: null, tax_basis: sourceEntry.tax_basis,
    cost_complete: false, business_unit_id: request.business_unit_id, team_name_snapshot: sourceEntry.team_name_snapshot,
    status: 'confirmed', confirmed_by: args.reviewerId, confirmed_at: new Date().toISOString(), reviewed_by: args.reviewerId,
    reviewed_at: new Date().toISOString(), responsible_id: args.reviewerId, organization_id: args.organizationId,
  };
  const out = await sourceEntries.insert({ ...shared, name: text(sourceEntry.order_code_snapshot) + ' 业绩分出', entry_key: sourceKey, entry_type: 'rebook_out', amount_direction: 'decrease', sales_person_id: sourcePersonId, sales_person_name_snapshot: text(sourceEntry.sales_person_name_snapshot), revision: 0 });
  const incoming = await sourceEntries.insert({ ...shared, name: text(sourceEntry.order_code_snapshot) + ' 业绩分入', entry_key: targetKey, entry_type: 'rebook_in', amount_direction: 'increase', sales_person_id: ownerId, sales_person_name_snapshot: ownerName, revision: 0 });
  const outId = insertedId(out), inId = insertedId(incoming); if (!outId || !inId) throw new Error('Rebook转入或转出流水未返回记录标识');
  const changedRequest = await rebooks.update({ status: 'approved', approval_status: 'approved', reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString(), review_comment: args.comment || null, posted_at: new Date().toISOString() }, {
    multi: true, where: { id: requestId, organization_id: args.organizationId, status: { $in: ['pending_approval', 'approved_waiting_source'] }, approval_status: 'approved' },
  });
  if (changedRequest !== 1) throw new Error('Rebook申请状态已变化，转记已取消');
  return { id: requestId, status: 'approved', replayed: false, debit_entry_id: outId, credit_entry_id: inId, amount };
}

async function releaseRebookReservation(tx: TransactionContext, request: Row, organizationId: string): Promise<void> {
  const entries = tx.object('forge_sales_performance_entry'), entry = await entries.findOne({ where: { id: idOf(request.source_entry_id), organization_id: organizationId } });
  if (!entry) throw new Error('Rebook来源业绩不存在，不能释放预留');
  const amount = number(request.amount), reserved = number(entry.rebook_reserved_amount) || 0, revision = number(entry.revision);
  if (amount === null || reserved + 0.0001 < amount || revision === null) throw new Error('Rebook预留金额与来源业绩不一致');
  const changed = await entries.update({ rebook_reserved_amount: round2(reserved - amount), revision: revision + 1 }, { multi: true, where: { id: entry.id, organization_id: organizationId, revision } });
  if (changed !== 1) throw new Error('Rebook预留已变化，不能释放');
}

async function finalizeConfirmation(tx: TransactionContext, args: { id: string; organizationId: string; decision: 'approved' | 'rejected'; reviewerId: string; comment: string; engine: Engine; systemPermissions: string[] }): Promise<Row> {
  const confirmations = tx.object('forge_sales_performance_confirmation'), entries = tx.object('forge_sales_performance_entry');
  const confirmation = await confirmations.findOne({ where: { id: args.id, organization_id: args.organizationId } });
  if (!confirmation || text(confirmation.organization_id) !== args.organizationId) throw new Error('业绩确认单不存在或不属于当前组织');
  const expected = args.decision === 'approved' ? 'confirmed' : 'rejected';
  if (text(confirmation.status) === expected && text(confirmation.approval_status) === args.decision) {
    const entry = await entries.findOne({ where: { id: idOf(confirmation.entry_id), organization_id: args.organizationId } });
    if (args.decision === 'rejected' && entry && text(entry.status) === 'pending') return { object: 'forge_sales_performance_confirmation', id: args.id, status: expected, replayed: true };
    if (args.decision === 'approved' && entry && ['confirmed', 'rebooked'].includes(text(entry.status))) return { object: 'forge_sales_performance_confirmation', id: args.id, status: expected, replayed: true, entry_id: entry.id };
    throw new Error('业绩确认终态与业绩流水不一致');
  }
  if (text(confirmation.status) !== 'pending_approval' || text(confirmation.approval_status) !== args.decision) throw new Error('业绩确认单没有对应的原生审批结果');
  const order = await tx.object('forge_sales_order').findOne({ where: { id: idOf(confirmation.order_id), organization_id: args.organizationId, status: 'completed' } });
  if (!order || idOf(order.id) !== idOf(confirmation.order_id)) throw new Error('收入来源订单已变化或不属于当前组织');
  const entry = await entries.findOne({ where: { id: idOf(confirmation.entry_id), organization_id: args.organizationId, order_id: idOf(order.id) } });
  if (!entry || text(entry.entry_type) !== 'original_confirm') throw new Error('待确认原始业绩流水不存在');
  if (args.decision === 'rejected') {
    const changed = await confirmations.update({ status: 'rejected', reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString(), review_comment: args.comment || null }, {
      multi: true, where: { id: args.id, organization_id: args.organizationId, status: 'pending_approval', approval_status: 'rejected', ...versionWhere(confirmation) },
    });
    if (changed !== 1) throw new Error('业绩确认单已变化，驳回未写入');
    return { object: 'forge_sales_performance_confirmation', id: args.id, status: 'rejected', replayed: false };
  }
  const preview = await grossProfitSnapshot(args.engine, tx, args.reviewerId, args.organizationId, text(order.id), args.systemPermissions);
  const metrics = row(preview.metrics), income = number(metrics.sales_revenue), cost = number(metrics.sales_cost), gross = number(metrics.gross_profit);
  if (preview.single_order_scope !== true || text(preview.financial_source_signature) !== text(confirmation.cost_signature)
    || Number(metrics.revenue_unmatched_count || 0) > 0 || Number(metrics.cost_unmatched_count || 0) > 0
    || income === null || cost === null || gross === null || Math.abs(income - Number(confirmation.performance_amount)) > 0.01
    || Math.abs(cost - Number(confirmation.cost_amount)) > 0.01 || Math.abs(gross - Number(confirmation.gross_profit)) > 0.01) {
    throw new Error('原收入税基或批准成本来源已变化，不能按旧快照确认');
  }
  const ownerId = idOf(confirmation.sales_person_id), [owner, ownerMember, unit] = await Promise.all([
    tx.object('sys_user').findOne({ where: { id: ownerId } }),
    tx.object('sys_member').findOne({ where: { user_id: ownerId, organization_id: args.organizationId } }),
    tx.object('sys_business_unit').findOne({ where: { id: idOf(confirmation.business_unit_id), organization_id: args.organizationId, active: true } }),
  ]);
  const ownerBanned = owner && (owner.banned === true || owner.banned === 1 || owner.banned === 'true'), ownerBanExpiry = Date.parse(text(owner && owner.ban_expires));
  if (!owner || !ownerMember || !unit || !activeWindow(unit.effective_from, unit.effective_to, Date.now())
    || ownerBanned && (!Number.isFinite(ownerBanExpiry) || ownerBanExpiry > Date.now())) throw new Error('业绩负责人已不属于本组织有效原生业务单元');
  const ownerAssignments = await tx.object('sys_business_unit_member').find({ where: { business_unit_id: idOf(unit.id), user_id: ownerId }, limit: 500 });
  if (!ownerAssignments.some(assignment => activeWindow(assignment.effective_from, assignment.effective_to, Date.now()))) throw new Error('业绩负责人已不在原生业务单元任职');
  const sourceAmount = await all(tx, 'forge_revenue_recognition', { organization_id: args.organizationId, order_id: idOf(order.id), status: 'approved' });
  if (!sourceAmount.length || sourceAmount.some(row => idOf(row.responsible_id) !== ownerId)
    || Math.abs(sourceAmount.reduce((sum, row) => sum + Number(row.net_amount || 0), 0) - Number(confirmation.source_recognized_amount)) > 0.01) throw new Error('批准收入确认负责人或金额来源已变化');
  const revision = number(entry.revision); if (revision === null || Math.round(revision) !== revision || !['pending', 'rejected'].includes(text(entry.status))) throw new Error('原始业绩状态或版本已变化');
  const changedEntry = await entries.update({ status: 'confirmed', gross_profit: gross, gross_profit_rate: number(metrics.gross_margin_rate), cost_complete: true, tax_basis: 'source_lines_reconciled', confirmed_by: args.reviewerId, confirmed_at: new Date().toISOString(), reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString(), review_comment: args.comment || null, revision: revision + 1 }, {
    multi: true, where: { id: entry.id, organization_id: args.organizationId, status: text(entry.status), revision },
  });
  if (changedEntry !== 1) throw new Error('原始业绩流水已变化，确认未写入');
  const changedConfirmation = await confirmations.update({ status: 'confirmed', reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString(), review_comment: args.comment || null }, {
    multi: true, where: { id: args.id, organization_id: args.organizationId, status: 'pending_approval', approval_status: 'approved', ...versionWhere(confirmation) },
  });
  if (changedConfirmation !== 1) throw new Error('业绩确认单已变化，原始业绩确认已取消');
  const waiting = await tx.object('forge_sales_performance_rebook').find({ where: { source_entry_id: text(entry.id), organization_id: args.organizationId, status: 'approved_waiting_source' }, limit: 1000 });
  const postResults: Row[] = [];
  for (const request of waiting) {
    const currentEntry = await entries.findOne({ where: { id: text(entry.id), organization_id: args.organizationId } });
    if (!currentEntry) throw new Error('Rebook来源业绩在确认时丢失');
    postResults.push(await postRebook(tx, { request, sourceEntry: currentEntry, reviewerId: args.reviewerId, organizationId: args.organizationId, comment: text(request.review_comment) }));
  }
  return { object: 'forge_sales_performance_confirmation', id: args.id, status: 'confirmed', replayed: false, entry_id: entry.id, gross_profit: gross, posted_rebooks: postResults.length };
}

async function finalizeRebook(tx: TransactionContext, args: { id: string; organizationId: string; decision: 'approved' | 'rejected'; reviewerId: string; comment: string }): Promise<Row> {
  const rebooks = tx.object('forge_sales_performance_rebook'), entries = tx.object('forge_sales_performance_entry');
  const request = await rebooks.findOne({ where: { id: args.id, organization_id: args.organizationId } });
  if (!request || text(request.organization_id) !== args.organizationId) throw new Error('Rebook申请不存在或不属于当前组织');
  if (args.decision === 'approved' && text(request.status) === 'approved') {
    const debit = await entries.findOne({ where: { organization_id: args.organizationId, entry_key: 'rebook:' + args.id + ':out' } });
    const credit = await entries.findOne({ where: { organization_id: args.organizationId, entry_key: 'rebook:' + args.id + ':in' } });
    if (debit && credit) return { object: 'forge_sales_performance_rebook', id: args.id, status: 'approved', replayed: true };
    throw new Error('Rebook终态与双边业绩流水不一致');
  }
  if (text(request.status) !== 'pending_approval' || text(request.approval_status) !== args.decision) throw new Error('Rebook申请没有对应的原生审批结果');
  const sourceEntry = await entries.findOne({ where: { id: idOf(request.source_entry_id), organization_id: args.organizationId } });
  if (!sourceEntry || idOf(sourceEntry.sales_person_id) !== idOf(request.source_person_id) || idOf(sourceEntry.business_unit_id) !== idOf(request.business_unit_id)) throw new Error('Rebook来源人员、业务单元或业绩记录已变化');
  const expected = args.decision === 'approved' ? 'approved_waiting_source' : 'rejected';
  if (args.decision === 'rejected') await releaseRebookReservation(tx, request, args.organizationId);
  const changed = await rebooks.update({ status: expected, reviewed_by: args.reviewerId, reviewed_at: new Date().toISOString(), review_comment: args.comment || null }, {
    multi: true, where: { id: args.id, organization_id: args.organizationId, status: 'pending_approval', approval_status: args.decision, ...versionWhere(request) },
  });
  if (changed !== 1) throw new Error('Rebook申请已变化，审核结果未写入');
  if (args.decision === 'rejected') return { object: 'forge_sales_performance_rebook', id: args.id, status: expected, replayed: false };
  if (['confirmed', 'rebooked'].includes(text(sourceEntry.status))) return postRebook(tx, { request: { ...request, status: 'approved_waiting_source', approval_status: 'approved' }, sourceEntry, reviewerId: args.reviewerId, organizationId: args.organizationId, comment: args.comment });
  if (text(sourceEntry.status) !== 'pending') throw new Error('原业绩当前状态不能接收 Rebook');
  return { object: 'forge_sales_performance_rebook', id: args.id, status: 'approved_waiting_source', replayed: false };
}

export function createSalesPerformanceApprovalFinalizationNode(engine: Engine, logger?: PluginContext['logger']): NodeExecutor {
  return {
    type: 'forge_sales_performance_finalize',
    descriptor: defineActionDescriptor({
      type: 'forge_sales_performance_finalize', version: '1.0.0', name: 'Finalize sales performance approval',
      description: 'Rechecks the native Finance approval and atomically writes the confirmed performance or Rebook ledger.',
      icon: 'badge-check', category: 'data', paradigms: ['flow'], source: 'plugin',
      configSchema: { type: 'object', additionalProperties: false, properties: {
        objectName: { type: 'string', enum: ['forge_sales_performance_confirmation', 'forge_sales_performance_rebook'] },
        approvalNodeId: { type: 'string', enum: ['review'] }, decision: { type: 'string', enum: ['approved', 'rejected'] },
      }, required: ['objectName', 'approvalNodeId', 'decision'] },
    }),
    async execute(node: FlowNodeParsed, variables: Map<string, unknown>, automation: AutomationContext) {
      const config = row(node.config), objectName = text(config.objectName) as keyof typeof flowTargets, target = flowTargets[objectName], decision = text(config.decision) as 'approved' | 'rejected';
      if (!target || text(config.approvalNodeId) !== target.nodeId || !['approved', 'rejected'].includes(decision)) return { success: false, error: 'Sales performance finalizer has an unsupported object, approval node, or decision.' };
      if (automation.runAs !== 'system' || automation.recordLoadDenied === true) return { success: false, error: 'Sales performance finalizer requires a resolved system Flow record.' };
      const flowName = text(automation.flowName || variables.get('$flowName')), flowRunId = text(automation.flowRunId || variables.get('$runId'));
      const recordId = text(automation.record?.id || row(variables.get('$record')).id), organizationId = text(automation.tenantId || automation.record?.organization_id);
      if (flowName !== target.flowName || !flowRunId || !recordId || !organizationId) return { success: false, error: 'Sales performance finalizer is missing its flow, run, record, or organization context.' };
      const dataContext = resolveRunDataContext(automation); if (!dataContext) return { success: false, error: 'Sales performance finalizer has no scoped data context.' };
      try {
        const output = await engine.transaction(async transactionContext => {
          const tx = engine.createContext(transactionContext as Record<string, unknown>);
          const native = await terminalApproval(tx, { objectName, flowName, nodeId: target.nodeId, flowRunId, recordId, organizationId, decision });
          const reviewer = await verifyFinanceReviewer(tx, native.reviewerId, organizationId);
          if (objectName === 'forge_sales_performance_confirmation') {
            return finalizeConfirmation(tx, { id: recordId, organizationId, decision, reviewerId: native.reviewerId, comment: native.comment, engine, systemPermissions: reviewer.systemPermissions });
          }
          return finalizeRebook(tx, { id: recordId, organizationId, decision, reviewerId: native.reviewerId, comment: native.comment });
        }, { ...dataContext, tenantId: organizationId, organizationId }, { require: true });
        return { success: true, output, metrics: { acted: output.replayed === true ? 0 : 1 } };
      } catch (error) {
        logger?.error?.(`[sales-performance-approval-finalization] ${objectName}/${recordId} ${decision} failed: ${String((error as Error)?.message || error)}`);
        return { success: false, error: `Sales performance ${objectName} finalization failed; no sales performance ledger was committed.` };
      }
    },
  };
}

/** Parent registration belongs beside the official Automation and Approvals plugins. */
export class SalesPerformanceApprovalFinalizationPlugin implements Plugin {
  name = 'com.inoforge.forge.sales-performance-approval-finalization';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service-automation', 'com.objectstack.service.approvals'];
  requiresServices = ['automation', 'objectql'];

  init(ctx: PluginContext): void {
    const automation = ctx.getService<AutomationEngine>('automation'), engine = ctx.getService<Engine>('objectql');
    automation.registerNodeExecutor(createSalesPerformanceApprovalFinalizationNode(engine, ctx.logger));
  }
}
