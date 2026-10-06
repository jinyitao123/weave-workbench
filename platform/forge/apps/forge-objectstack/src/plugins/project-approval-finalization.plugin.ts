import type { Plugin, PluginContext } from '@objectstack/core';
import { defineActionDescriptor, type FlowNodeParsed } from '@objectstack/spec/automation';
import type { AutomationContext, IObjectQLEngine } from '@objectstack/spec/contracts';
import { AutomationEngine, resolveRunDataContext, type NodeExecutor } from '@objectstack/service-automation';

type Row = Record<string, unknown>;
type ProjectRepository = {
  findOne(options: Record<string, unknown>): Promise<Row | undefined>;
  find(options: Record<string, unknown>): Promise<Row[]>;
  insert(data: Row): Promise<unknown>;
  update(data: Row, options: Record<string, unknown>): Promise<number>;
};
type ProjectTransactionContext = { object(name: string): ProjectRepository };
type ProjectFinalizationEngine = IObjectQLEngine & {
  createContext(options: Record<string, unknown>): ProjectTransactionContext;
};

const targets = {
  forge_project_expense: { flowName: 'project_expense_approval', nodeId: 'expense_review' },
  forge_project_timesheet: { flowName: 'project_timesheet_approval', nodeId: 'timesheet_review' },
} as const;

function row(value: unknown): Row {
  return value && typeof value === 'object' ? value as Row : {};
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function versionWhere(record: Row): Record<string, unknown> {
  const updatedAt = text(record.updated_at);
  const time = Date.parse(updatedAt);
  if (!Number.isFinite(time)) throw new Error('业务记录读取版本无效');
  return { updated_at: { $gte: new Date(time).toISOString(), $lt: new Date(time + 1).toISOString() } };
}

function insertedId(value: unknown): string {
  if (typeof value === 'string') return value;
  const result = row(value);
  return text(result.id || row(result.record).id);
}

async function terminalApproval(
  tx: ProjectTransactionContext,
  args: { objectName: keyof typeof targets; flowName: string; nodeId: string; flowRunId: string; recordId: string; organizationId: string; decision: 'approved' | 'rejected' },
): Promise<{ request: Row; reviewerId: string; comment: string }> {
  const requests = await tx.object('sys_approval_request').find({
    where: {
      organization_id: args.organizationId,
      object_name: args.objectName,
      record_id: args.recordId,
      process_name: 'flow:' + args.flowName,
      flow_run_id: args.flowRunId,
      flow_node_id: args.nodeId,
    },
    orderBy: [{ field: 'created_at', order: 'desc' }, { field: 'id', order: 'desc' }],
    limit: 50,
  });
  if (!Array.isArray(requests) || requests.length === 0) throw new Error('找不到当前记录的原生审批流程轮次');
  const latestRequest = requests.map(row).sort((a, b) => {
    const round = (value: unknown) => {
      try { return Number(JSON.parse(text(value)).__round || 1); } catch { return 1; }
    };
    return round(b.node_config_json) - round(a.node_config_json)
      || text(b.created_at).localeCompare(text(a.created_at))
      || text(b.id).localeCompare(text(a.id));
  })[0];
  const request = latestRequest;
  if (text(request.organization_id) !== args.organizationId || text(request.object_name) !== args.objectName
    || text(request.record_id) !== args.recordId || text(request.process_name) !== 'flow:' + args.flowName
    || text(request.flow_run_id) !== args.flowRunId || text(request.flow_node_id) !== args.nodeId
    || text(request.status) !== args.decision) {
    throw new Error('找不到当前记录对应的终态原生审批');
  }

  const expectedAction = args.decision === 'approved' ? 'approve' : 'reject';
  const actions = await tx.object('sys_approval_action').find({
    where: { organization_id: args.organizationId, request_id: text(request.id), step_name: args.nodeId, action: expectedAction },
    orderBy: [{ field: 'created_at', order: 'desc' }],
    limit: 20,
  });
  const decision = Array.isArray(actions) ? row(actions[0]) : {};
  const reviewerId = text(decision.actor_id);
  if (!reviewerId || text(decision.organization_id) !== args.organizationId || text(decision.request_id) !== text(request.id)
    || text(decision.step_name) !== args.nodeId || text(decision.action) !== expectedAction || decision.via_override === true) {
    throw new Error('原生审批缺少可核验的当前审批人记录');
  }
  return { request, reviewerId, comment: text(decision.comment) };
}

async function finalizeTimesheet(
  tx: ProjectTransactionContext,
  args: { id: string; organizationId: string; decision: 'approved' | 'rejected'; reviewerId: string; comment: string; autoApproved?: boolean; flowName: string; flowRunId: string; approvalNodeId: string },
): Promise<Row> {
  const timesheets = tx.object('forge_project_timesheet');
  const projects = tx.object('forge_project');
  const members = tx.object('forge_project_member');
  const costs = tx.object('forge_project_cost_entry');
  const sheet = await timesheets.findOne({ where: { id: args.id, organization_id: args.organizationId } });
  if (!sheet || text(sheet.organization_id) !== args.organizationId) throw new Error('项目工时不存在或不属于当前组织');
  const projectId = text(sheet.project_id);
  const project = await projects.findOne({ where: { id: projectId, organization_id: args.organizationId } });
  if (!project || text(project.organization_id) !== args.organizationId) throw new Error('关联项目不存在或不属于当前组织');
  const managerSnapshot = text(sheet.approval_manager_snapshot || sheet.approval_manager_id);
  if (text(project.manager_id) !== args.reviewerId || managerSnapshot !== args.reviewerId) throw new Error('提交时项目负责人已变化，工时不能归集');
  if (args.autoApproved === true && text(sheet.approval_manager_id)) throw new Error('自动审批快照仍包含人工审批人');
  if (args.autoApproved !== true && text(sheet.approval_manager_id) !== args.reviewerId) throw new Error('原生审批人已不是本项目当前负责人，工时不能归集');
  if (text(sheet.responsible_id) !== text(sheet.worker_id)) throw new Error('工时负责人不是本单填报人');
  const member = await members.findOne({ where: { project_id: projectId, organization_id: args.organizationId, user_id: sheet.worker_id, active: true } });
  if (!member || member.active !== true) throw new Error('工时人员已不属于当前项目有效团队');
  const managerMember = await members.findOne({ where: { project_id: projectId, organization_id: args.organizationId, user_id: args.reviewerId, member_duty: 'manager', active: true } });
  if (!managerMember || managerMember.active !== true || text(managerMember.member_duty) !== 'manager') throw new Error('原生审批人已不是当前项目有效负责人');

  const expectedStatus = args.decision === 'approved' ? 'approved' : 'rejected';
  const currentStatus = text(sheet.status);
  const currentApproval = text(sheet.approval_status);
  const existingCosts = await costs.find({ where: { organization_id: args.organizationId, source_id: args.id, source_type: 'timesheet' } });
  const activeCosts = existingCosts.filter(cost => text(cost.status) !== 'reversed');
  if (currentStatus === expectedStatus && currentApproval === args.decision) {
    if (args.decision === 'rejected' && activeCosts.length === 0) {
      return { object: 'forge_project_timesheet', id: args.id, status: expectedStatus, replayed: true };
    }
    if (args.decision === 'approved' && activeCosts.length === 1) {
      const cost = activeCosts[0];
      return { object: 'forge_project_timesheet', id: args.id, status: expectedStatus, replayed: true, cost_entry_id: cost.id, cost_amount: cost.allocated_amount };
    }
    throw new Error('工时审批终态与成本归集结果不一致');
  }
  if (currentStatus !== 'pending_review' || (args.autoApproved !== true && currentApproval !== args.decision) || (args.autoApproved === true && currentApproval)) throw new Error('工时记录没有对应的原生审批结果');
  if (args.autoApproved === true) {
    const threshold = Number(sheet.auto_approval_threshold_snapshot), hours = Number(sheet.hours);
    if (sheet.auto_approval_eligible_snapshot !== true || !Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(hours) || hours > threshold + 0.0001 || !(Number(sheet.auto_approval_settings_revision_snapshot) >= 1)) {
      throw new Error('官方自动审批结果与提交时阈值快照不匹配');
    }
  }
  if (activeCosts.length) throw new Error('待审核工时已存在有效人工成本');

  const amount = Number(sheet.cost_amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('工时成本金额无效');
  if (args.decision === 'rejected') {
    const changed = await timesheets.update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewer_id: args.reviewerId, review_comment: args.comment || null,
      approval_source_snapshot: 'native_approval', approval_flow_name_snapshot: args.flowName, approval_flow_run_id_snapshot: args.flowRunId, approval_flow_node_id_snapshot: args.approvalNodeId }, {
      multi: true,
      where: { id: args.id, organization_id: args.organizationId, project_id: projectId, status: 'pending_review', approval_status: 'rejected', ...versionWhere(sheet) },
    });
    if (changed !== 1) throw new Error('项目工时已被修改，驳回未写入');
    return { object: 'forge_project_timesheet', id: args.id, status: 'rejected', replayed: false };
  }

  if (['settled', 'terminated', 'archived'].includes(text(project.status))) throw new Error('项目已结算或关闭，不能再增加人工成本');
  const hours = Number(sheet.hours), rate = Number(sheet.hourly_rate);
  if (!(hours >= 0.25 && hours <= 24) || !Number.isFinite(rate) || rate < 0) throw new Error('本单工时或费率无效');
  const expectedAmount = Math.round((hours * rate + Number.EPSILON) * 100) / 100;
  if (Math.abs(expectedAmount - amount) > 0.01) throw new Error('工时成本与本单冻结费率不一致');
  const approvalSource = args.autoApproved === true ? 'native_approval_auto_approve' : 'native_approval';
  const created = await costs.insert({
    name: text(project.code) + ' 人工成本 ' + text(sheet.code), code: 'COST-' + text(sheet.code),
    project_id: projectId, customer_id: project.customer_id, source_type: 'timesheet', cost_type: 'labor', source_id: args.id,
    occurred_on: sheet.work_on, source_hours_snapshot: hours, source_hourly_rate_snapshot: rate,
    fee_source_snapshot: text(sheet.fee_source_snapshot) || null, fee_role_revision_snapshot: sheet.fee_role_revision_snapshot ?? null,
    fee_settings_revision_snapshot: sheet.fee_settings_revision_snapshot ?? null,
    approval_source_snapshot: approvalSource, approval_flow_name_snapshot: args.flowName, approval_flow_run_id_snapshot: args.flowRunId,
    approval_flow_node_id_snapshot: args.approvalNodeId, auto_approval_threshold_snapshot: args.autoApproved === true ? Number(sheet.auto_approval_threshold_snapshot) : null,
    total_amount: amount, allocated_amount: amount, remaining_amount: 0, status: 'allocated',
    responsible_id: args.autoApproved===true?text(sheet.worker_id):args.reviewerId, remarks: args.autoApproved===true?'由Native Approval Flow官方自动审批分支归集':'由原生审批通过的项目工时自动归集', organization_id: args.organizationId,
  });
  const costId = insertedId(created);
  if (!costId) throw new Error('人工成本记录创建后未返回ID');
  const changedSheet = await timesheets.update({ status: 'approved', approval_status: 'approved', reviewed_at: new Date().toISOString(), reviewer_id: args.autoApproved===true?null:args.reviewerId,
    review_comment: args.autoApproved===true?'按提交时配置的工时阈值通过Native Approval Flow自动审批':args.comment||null,
    approval_source_snapshot: approvalSource, approval_flow_name_snapshot: args.flowName, approval_flow_run_id_snapshot: args.flowRunId, approval_flow_node_id_snapshot: args.approvalNodeId }, {
    multi: true,
    where: { id: args.id, organization_id: args.organizationId, project_id: projectId, status: 'pending_review', ...(args.autoApproved===true?{approval_status:null}:{approval_status:'approved'}), ...versionWhere(sheet) },
  });
  if (changedSheet !== 1) throw new Error('项目工时已被修改，成本归集已取消');
  const projectVersion = versionWhere(project);
  const nextCost = Math.round((Number(project.total_cost || 0) + amount + Number.EPSILON) * 100) / 100;
  const changedProject = await projects.update({ total_cost: nextCost }, { multi: true, where: { id: projectId, organization_id: args.organizationId, ...projectVersion } });
  if (changedProject !== 1) throw new Error('项目成本已变化，工时成本归集已取消');
  return { object: 'forge_project_timesheet', id: args.id, status: 'approved', replayed: false, cost_entry_id: costId, cost_amount: amount, project_total_cost: nextCost };
}

async function finalizeExpense(
  tx: ProjectTransactionContext,
  args: { id: string; organizationId: string; decision: 'approved' | 'rejected'; reviewerId: string; comment: string; flowName: string; flowRunId: string; approvalNodeId: string },
): Promise<Row> {
  const expenses = tx.object('forge_project_expense');
  const projects = tx.object('forge_project');
  const members = tx.object('forge_project_member');
  const linesRepo = tx.object('forge_project_expense_line');
  const costs = tx.object('forge_project_cost_entry');
  const expense = await expenses.findOne({ where: { id: args.id, organization_id: args.organizationId } });
  if (!expense || text(expense.organization_id) !== args.organizationId) throw new Error('项目费用不存在或不属于当前组织');
  const project = await projects.findOne({ where: { id: expense.project_id, organization_id: args.organizationId } });
  if (!project || text(project.organization_id) !== args.organizationId || text(project.manager_id) !== args.reviewerId
    || text(expense.responsible_id) !== args.reviewerId) throw new Error('仅当前项目负责人可以完成本项目费用审批');
  const managerMember = await members.findOne({ where: { project_id: project.id, organization_id: args.organizationId, user_id: args.reviewerId, member_duty: 'manager', active: true } });
  if (!managerMember || managerMember.active !== true || text(managerMember.member_duty) !== 'manager') throw new Error('原生审批人已不是当前项目有效负责人');
  const expectedStatus = args.decision === 'approved' ? 'approved' : 'rejected';
  const currentStatus = text(expense.status), currentApproval = text(expense.approval_status);
  const lines = await linesRepo.find({ where: { expense_id: args.id, organization_id: args.organizationId }, orderBy: [{ field: 'line_key', order: 'asc' }] });
  const lineIds = new Set(lines.map(line => text(line.id)));
  const allProjectExpenseCosts = await costs.find({ where: { organization_id: args.organizationId, source_type: 'expense' } });
  const expenseCosts = allProjectExpenseCosts.filter(cost => lineIds.has(text(cost.source_id)));
  const activeCosts = expenseCosts.filter(cost => text(cost.status) !== 'reversed');
  if (currentStatus === expectedStatus && currentApproval === args.decision) {
    if (args.decision === 'rejected' && activeCosts.length === 0) return { object: 'forge_project_expense', id: args.id, status: expectedStatus, replayed: true };
    if (args.decision === 'approved' && lines.length > 0 && activeCosts.length === lines.length) {
      return { object: 'forge_project_expense', id: args.id, status: expectedStatus, replayed: true, cost_entry_ids: activeCosts.map(cost => cost.id), total_amount: expense.total_amount };
    }
    throw new Error('项目费用审批终态与成本归集结果不一致');
  }
  if (currentStatus !== 'pending_review' || currentApproval !== args.decision) throw new Error('项目费用没有对应的原生审批结果');
  if (!lines.length) throw new Error('费用明细不能为空');
  if (activeCosts.length) throw new Error('待审核费用已存在有效成本');
  if (args.decision === 'rejected') {
    const changed = await expenses.update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewer_id: args.reviewerId, review_comment: args.comment || null }, {
      multi: true,
      where: { id: args.id, organization_id: args.organizationId, status: 'pending_review', approval_status: 'rejected', responsible_id: args.reviewerId, ...versionWhere(expense) },
    });
    if (changed !== 1) throw new Error('项目费用已被修改，驳回未写入');
    return { object: 'forge_project_expense', id: args.id, status: 'rejected', replayed: false };
  }

  if (['settled', 'terminated', 'archived'].includes(text(project.status))) throw new Error('项目已结算或关闭，不能增加费用成本');
  const rounded = (value: number) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
  const total = rounded(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0));
  const costIds: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !text(line.cost_type) || !text(line.occurred_on)) throw new Error('费用明细金额、类别或日期无效');
    const existing = await costs.find({ where: { organization_id: args.organizationId, source_id: line.id, source_type: 'expense' } });
    if (existing.some(cost => text(cost.status) !== 'reversed')) throw new Error('费用明细已存在有效成本：' + text(line.name));
    const created = await costs.insert({
      name: text(project.code) + ' ' + text(line.name),
      code: 'COST-' + text(expense.code) + '-' + String(index + 1).padStart(3, '0'),
      project_id: project.id, customer_id: project.customer_id, source_type: 'expense', cost_type: line.cost_type,
      source_id: line.id, occurred_on: line.occurred_on, total_amount: rounded(amount), allocated_amount: rounded(amount),
      remaining_amount: 0, status: 'allocated', approval_source_snapshot: 'native_approval', approval_flow_name_snapshot: args.flowName,
      approval_flow_run_id_snapshot: args.flowRunId, approval_flow_node_id_snapshot: args.approvalNodeId, responsible_id: args.reviewerId,
      remarks: '由原生审批通过的项目费用 ' + text(expense.code) + ' 自动归集', organization_id: args.organizationId,
    });
    const costId = insertedId(created);
    if (!costId) throw new Error('项目成本记录创建后未返回ID');
    costIds.push(costId);
  }
  const changedExpense = await expenses.update({
    total_amount: total, line_count: lines.length, status: 'approved', reviewed_at: new Date().toISOString(),
    reviewer_id: args.reviewerId, review_comment: args.comment || null, cost_entry_count: costIds.length,
  }, {
    multi: true,
    where: { id: args.id, organization_id: args.organizationId, status: 'pending_review', approval_status: 'approved', responsible_id: args.reviewerId, ...versionWhere(expense) },
  });
  if (changedExpense !== 1) throw new Error('项目费用已被修改，归集已取消');
  const projectVersion = versionWhere(project);
  const nextCost = rounded(Number(project.total_cost || 0) + total);
  const changedProject = await projects.update({ total_cost: nextCost }, { multi: true, where: { id: project.id, organization_id: args.organizationId, ...projectVersion } });
  if (changedProject !== 1) throw new Error('项目成本已变化，费用成本归集已取消');
  return { object: 'forge_project_expense', id: args.id, status: 'approved', replayed: false, cost_entry_ids: costIds, total_amount: total, project_total_cost: nextCost };
}

/** A narrowly configured Flow node: only native terminal approval may post project costs. */
export function createProjectApprovalFinalizationNode(engine: ProjectFinalizationEngine, logger?: PluginContext['logger']): NodeExecutor {
  return {
    type: 'forge_project_approval_finalize',
    descriptor: defineActionDescriptor({
      type: 'forge_project_approval_finalize',
      version: '1.0.0',
      name: 'Finalize project approval',
      description: 'Post project expense or labor cost only after its matching ObjectStack Approval decision.',
      icon: 'badge-check',
      category: 'data',
      paradigms: ['flow'],
      source: 'plugin',
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          objectName: { type: 'string', enum: ['forge_project_expense', 'forge_project_timesheet'] },
          approvalNodeId: { type: 'string' },
          decision: { type: 'string', enum: ['approved', 'rejected'] },
        },
        required: ['objectName', 'approvalNodeId', 'decision'],
      },
    }),
    async execute(node: FlowNodeParsed, variables: Map<string, unknown>, automation: AutomationContext) {
      const config = row(node.config);
      const objectName = text(config.objectName) as keyof typeof targets;
      const target = targets[objectName];
      const decision = text(config.decision) as 'approved' | 'rejected';
      if (!target || !['approved', 'rejected'].includes(decision) || text(config.approvalNodeId) !== target.nodeId) {
        return { success: false, error: `Project finalizer '${node.id}' has an unsupported object, approval node, or decision.` };
      }
      if (automation.runAs !== 'system' || automation.recordLoadDenied === true) {
        return { success: false, error: `Project finalizer '${node.id}' requires a resolved system Flow record.` };
      }

      const flowName = text(automation.flowName || variables.get('$flowName'));
      const flowRunId = text(automation.flowRunId || variables.get('$runId'));
      const recordId = text(automation.record?.id || row(variables.get('$record')).id);
      const organizationId = text(automation.tenantId || automation.record?.organization_id);
      if (flowName !== target.flowName || !flowRunId || !recordId || !organizationId) {
        return { success: false, error: `Project finalizer '${node.id}' is missing its flow, run, record, or organization context.` };
      }
      const dataContext = resolveRunDataContext(automation);
      if (!dataContext) return { success: false, error: `Project finalizer '${node.id}' has no scoped data context.` };
      const autoApprovalOutput = objectName === 'forge_project_timesheet' && decision === 'approved'
        && variables.get(target.nodeId + '.autoApproved') === true
        && text(variables.get(target.nodeId + '.decision')) === 'approve';

      try {
        const output = await engine.transaction(async transactionContext => {
          const tx = engine.createContext(transactionContext as Record<string, unknown>);
          const currentRecord = await tx.object(objectName).findOne({ where: { id: recordId, organization_id: organizationId } });
          if (!currentRecord || text(currentRecord.organization_id) !== organizationId) {
            throw new Error('业务记录不存在或不属于原生审批组织');
          }
          let native: { reviewerId: string; comment: string };
          if (autoApprovalOutput) {
            const threshold = Number(currentRecord.auto_approval_threshold_snapshot), hours = Number(currentRecord.hours);
            if (currentRecord.status !== 'pending_review' || currentRecord.approval_status || currentRecord.auto_approval_eligible_snapshot !== true
              || text(currentRecord.approval_manager_id) || !text(currentRecord.approval_manager_snapshot)
              || !Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(hours) || hours > threshold + 0.0001
              || !(Number(currentRecord.auto_approval_settings_revision_snapshot) >= 1)) {
              throw new Error('官方自动审批输出与提交时阈值快照不匹配');
            }
            const requests = await tx.object('sys_approval_request').find({ where: {
              object_name: objectName, record_id: recordId, organization_id: organizationId,
              process_name: 'flow:' + flowName, flow_run_id: flowRunId, flow_node_id: target.nodeId,
            }, limit: 2 });
            if (!Array.isArray(requests) || requests.length) throw new Error('自动审批路径不应创建Native Approval request');
            native = { reviewerId: text(currentRecord.approval_manager_snapshot), comment: '' };
          } else {
            native = await terminalApproval(tx, { objectName, flowName, nodeId: target.nodeId, flowRunId, recordId, organizationId, decision });
            if (text(currentRecord.approval_status) !== decision) {
              throw new Error('业务记录状态与原生审批结果不匹配');
            }
          }
          const project = await tx.object('forge_project').findOne({ where: { id: currentRecord.project_id, organization_id: organizationId } });
          if (!project || text(project.organization_id) !== organizationId || text(project.manager_id) !== native.reviewerId) {
            throw new Error('原生审批人已不是当前项目负责人');
          }
          return objectName === 'forge_project_timesheet'
            ? finalizeTimesheet(tx, { id: recordId, organizationId, decision, reviewerId: native.reviewerId, comment: native.comment, autoApproved: autoApprovalOutput, flowName, flowRunId, approvalNodeId: target.nodeId })
            : finalizeExpense(tx, { id: recordId, organizationId, decision, reviewerId: native.reviewerId, comment: native.comment, flowName, flowRunId, approvalNodeId: target.nodeId });
        }, { ...dataContext, tenantId: organizationId, organizationId }, { require: true });
        return { success: true, output, metrics: { acted: output.replayed === true ? 0 : 1 } };
      } catch (error) {
        logger?.error?.(`[project-approval-finalization] ${objectName}/${recordId} ${decision} failed: ${String((error as Error)?.message || error)}`);
        return { success: false, error: `Project ${objectName} finalization failed; no project cost was committed.` };
      }
    },
  };
}

export class ProjectApprovalFinalizationPlugin implements Plugin {
  name = 'com.inoforge.forge.project-approval-finalization';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service-automation', 'com.objectstack.service.approvals'];
  requiresServices = ['automation', 'objectql'];

  init(ctx: PluginContext): void {
    const automation = ctx.getService<AutomationEngine>('automation');
    const engine = ctx.getService<ProjectFinalizationEngine>('objectql');
    automation.registerNodeExecutor(createProjectApprovalFinalizationNode(engine, ctx.logger));
  }
}
