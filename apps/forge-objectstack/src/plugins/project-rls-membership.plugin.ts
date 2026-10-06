import { isGrantActive, isRowActive, type Plugin, type PluginContext } from '@objectstack/core';
import type { IObjectQLEngine, IRlsMembershipResolver, RlsMembershipContext } from '@objectstack/spec/contracts';
import { RLS_MEMBERSHIP_RESOLVER_SERVICE } from '@objectstack/spec/contracts';
import type { ExecutionContext as KernelExecutionContext } from '@objectstack/spec/kernel';
import type { PermissionSet as NativePermissionSet } from '@objectstack/spec/security';
import { PermissionEvaluator, RLSCompiler, RLS_DENY_FILTER, permissionSetBodyFromRow } from '@objectstack/plugin-security';

const MEMBER_OBJECT = 'forge_project_member';
const POSITION_ASSIGNMENT_OBJECT = 'forge_project_member_position_assignment';
const SALES_CONTRACT_OBJECT = 'forge_sales_contract';
const SALES_CONTRACT_LINE_OBJECT = 'forge_sales_contract_line';
const CONTRACT_REVIEW_SHARE_SOURCE = 'team';
const CONTRACT_REVIEW_SHARE_SOURCE_ID_PREFIX = 'forge-contract-review:';
const PAGE_SIZE = 200;

const PROJECT_POSITION_DIRECT_OBJECTS = [
  'forge_project_plan', 'forge_project_work_item', 'forge_project_daily_report', 'forge_project_timesheet',
  'forge_project_expense', 'forge_project_cost_entry', 'forge_bom', 'forge_bom_shortage_analysis',
  'forge_purchase_order', 'forge_delivery_package', 'forge_commissioning_record', 'forge_customer_acceptance',
  'forge_project_attachment', 'forge_project_log', 'forge_project_sales_link', 'forge_project_settlement', MEMBER_OBJECT, POSITION_ASSIGNMENT_OBJECT,
] as const;

/** These child records have no project_id column; resolve only through declared native lookup fields. */
const PROJECT_POSITION_PARENT_FIELDS: Record<string, Array<{ object: string; field: string }>> = {
  forge_bom_node: [{ object: 'forge_bom', field: 'bom_id' }],
  forge_bom_shortage_line: [{ object: 'forge_bom_shortage_analysis', field: 'analysis_id' }, { object: 'forge_bom', field: 'bom_id' }],
  forge_purchase_order_line: [{ object: 'forge_purchase_order', field: 'order_id' }],
  forge_accounts_payable: [{ object: 'forge_purchase_order', field: 'order_id' }],
  forge_payment_task: [{ object: 'forge_purchase_order', field: 'order_id' }, { object: 'forge_accounts_payable', field: 'payable_id' }],
  forge_commissioning_check: [{ object: 'forge_commissioning_record', field: 'commissioning_id' }],
  forge_delivery_package_item: [{ object: 'forge_delivery_package', field: 'package_id' }],
  forge_customer_acceptance_item: [{ object: 'forge_customer_acceptance', field: 'acceptance_id' }],
  forge_acceptance_rectification: [{ object: 'forge_customer_acceptance', field: 'acceptance_id' }, { object: 'forge_customer_acceptance_item', field: 'acceptance_item_id' }],
  forge_sales_contract: [{ object: 'forge_project_sales_link', field: 'contract_id' }],
  forge_sales_order: [{ object: 'forge_project_sales_link', field: 'order_id' }, { object: 'forge_sales_contract', field: 'contract_id' }],
  forge_sales_contract_line: [{ object: 'forge_sales_contract', field: 'contract_id' }],
  forge_sales_order_line: [{ object: 'forge_sales_order', field: 'order_id' }],
};
export const PROJECT_POSITION_SCOPED_OBJECTS = [
  ...PROJECT_POSITION_DIRECT_OBJECTS,
  ...Object.keys(PROJECT_POSITION_PARENT_FIELDS),
] as const;
const POSITION_SCOPE_PAGE_SIZE = 200;
const POSITION_SCOPE_MAX_ROWS = 5000;

export const projectPositionReadScopeKey = (objectName: string) => 'project_position_read_' + objectName + '_ids';
export const projectPositionCreateScopeKey = (objectName: string) => 'project_position_create_' + objectName + '_ids';
export const projectPositionEditScopeKey = (objectName: string) => 'project_position_edit_' + objectName + '_ids';
export const projectPositionDeleteScopeKey = (objectName: string) => 'project_position_delete_' + objectName + '_ids';
export const PROJECT_POSITION_RLS_POLICY_PREFIX = 'project_position_scope_';
export const CONTRACT_REVIEW_RLS_KEY = 'native_contract_review_read_ids';

const projectPositionRlsKeys = PROJECT_POSITION_SCOPED_OBJECTS.flatMap(objectName => [
  projectPositionReadScopeKey(objectName), projectPositionCreateScopeKey(objectName),
  projectPositionEditScopeKey(objectName), projectPositionDeleteScopeKey(objectName),
]).concat(CONTRACT_REVIEW_RLS_KEY);

export const PROJECT_RLS_MEMBERSHIP_KEY = 'active_project_ids';
export const PROJECT_MANAGER_RLS_KEY = 'managed_project_ids';

type Row = Record<string, unknown>;
type EngineProvider = () => IObjectQLEngine;

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function organizationIds(context: RlsMembershipContext): string[] {
  if (Array.isArray(context.accessible_org_ids)) {
    return [...new Set(context.accessible_org_ids.map(text).filter(Boolean))];
  }
  const tenantId = text(context.tenantId);
  return tenantId ? [tenantId] : [];
}

function emptyProjectPositionScopes(): Record<string, string[]> {
  return Object.fromEntries(projectPositionRlsKeys.map(key => [key, []]));
}

const positionPermissionEvaluator = new PermissionEvaluator();
const positionRlsCompiler = new RLSCompiler();

function schemaFieldEntries(engine: IObjectQLEngine, objectName: string): Array<[string, Row]> {
  const schema = engine.getSchema?.(objectName) as Row | undefined;
  const fields = schema?.fields;
  if (Array.isArray(fields)) return (fields as unknown[])
    .filter((field): field is Row => Boolean(field) && typeof field === 'object')
    .map((field): [string, Row] => [text(field.name), field])
    .filter(([name]) => Boolean(name));
  if (fields && typeof fields === 'object') return Object.entries(fields as Row).map(([name, field]): [string, Row] => [name, field as Row]);
  return [];
}

function permissionSetHasReadableBusinessField(engine: IObjectQLEngine, objectName: string, permissionSet: Row): boolean {
  const fieldEntries = schemaFieldEntries(engine, objectName);
  if (!fieldEntries.length) return false;
  const nativePermissionSet = permissionSet as unknown as NativePermissionSet;
  const fieldPermissions = positionPermissionEvaluator.getFieldPermissions(objectName, [nativePermissionSet]);
  const metadataOnly = new Set(['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'deleted_at', 'organization_id']);
  return fieldEntries.some(([name, definition]) =>
    !metadataOnly.has(name) && definition.hidden !== true && fieldPermissions[name]?.readable !== false,
  );
}

function permissionSetRlsFilter(
  engine: IObjectQLEngine,
  objectName: string,
  permissionSet: Row,
  operation: string,
  context: KernelExecutionContext,
): Row | null {
  const fieldEntries = schemaFieldEntries(engine, objectName);
  if (!fieldEntries.length) throw new Error('项目岗位授权无法读取目标对象字段定义: ' + objectName);
  const declared = new Set(fieldEntries.map(([name]) => name));
  const policyList = Array.isArray(permissionSet.rowLevelSecurity) ? permissionSet.rowLevelSecurity : [];
  const nativePolicies = policyList.filter((policy: Row) =>
    !text(policy?.name).startsWith(PROJECT_POSITION_RLS_POLICY_PREFIX),
  );
  const applicable = positionRlsCompiler.getApplicablePolicies(objectName, operation, nativePolicies, context.positions || []);
  if (!applicable.length) return null;
  const filter = positionRlsCompiler.compileFilter(applicable, context, 'using', { declared });
  if (filter === RLS_DENY_FILTER) return RLS_DENY_FILTER;
  return filter as Row | null;
}

async function findAllScopedRows(
  engine: IObjectQLEngine,
  objectName: string,
  where: Row,
  fields: string[],
  context: KernelExecutionContext,
  rowFilter?: Row | null,
): Promise<Row[]> {
  const rows: Row[] = [];
  const queryWhere = rowFilter ? { $and: [where, rowFilter] } : where;
  let offset = 0;
  while (true) {
    const page = await engine.find(objectName, {
      where: queryWhere, fields, orderBy: [{ field: 'id', order: 'asc' }], limit: POSITION_SCOPE_PAGE_SIZE, offset,
    }, { context });
    if (!Array.isArray(page)) throw new Error('项目岗位范围对象查询未返回记录列表: ' + objectName);
    rows.push(...page as Row[]);
    if (rows.length > POSITION_SCOPE_MAX_ROWS) throw new Error('项目岗位范围记录超过安全上限: ' + objectName);
    if (page.length < POSITION_SCOPE_PAGE_SIZE) break;
    offset += page.length;
  }
  return rows;
}

async function projectScopedRecordIds(
  engine: IObjectQLEngine,
  objectName: string,
  organizationId: string,
  projectIds: string[],
  context: KernelExecutionContext,
  cache: Map<string, Promise<string[]>>,
  rowFilter?: Row | null,
): Promise<string[]> {
  const ids = [...new Set(projectIds.map(text).filter(Boolean))].sort();
  if (!ids.length) return [];
  const cacheKey = objectName + ':' + JSON.stringify(ids) + ':' + JSON.stringify(rowFilter ?? null);
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    const recordIds = new Set<string>();
    if ((PROJECT_POSITION_DIRECT_OBJECTS as readonly string[]).includes(objectName)) {
      for (let index = 0; index < ids.length; index += 100) {
        const projectBatch = ids.slice(index, index + 100);
        const rows = await findAllScopedRows(engine, objectName,
          { project_id: { $in: projectBatch }, organization_id: organizationId },
          ['id', 'project_id', 'organization_id'], context, rowFilter);
        for (const row of rows) {
          if (text(row.organization_id) === organizationId && projectBatch.includes(text(row.project_id)) && text(row.id)) recordIds.add(text(row.id));
        }
      }
    } else {
      const relations = PROJECT_POSITION_PARENT_FIELDS[objectName];
      if (!relations?.length) throw new Error('项目岗位范围对象没有声明项目关系: ' + objectName);
      const parentIdsByField = new Map<string, Set<string>>();
      const candidateRows = new Map<string, Row>();
      const relationFields = [...new Set(relations.map(relation => relation.field))];
      for (const relation of relations) {
        const parentIds = await projectScopedRecordIds(engine, relation.object, organizationId, ids, context, cache);
        const parentIdSet = new Set(parentIds);
        parentIdsByField.set(relation.field, parentIdSet);
        if (!parentIds.length) continue;
        for (let index = 0; index < parentIds.length; index += 100) {
          const parentBatch = parentIds.slice(index, index + 100);
          const rows = await findAllScopedRows(engine, objectName,
            { [relation.field]: { $in: parentBatch }, organization_id: organizationId },
            ['id', ...relationFields, 'organization_id'], context, rowFilter);
          for (const row of rows) {
            if (text(row.organization_id) === organizationId && parentBatch.includes(text(row[relation.field])) && text(row.id)) candidateRows.set(text(row.id), row);
          }
        }
      }
      for (const [id, row] of candidateRows) {
        const relationsMatch = relations.every(relation => {
          const linkedId = text(row[relation.field]);
          return !linkedId || (parentIdsByField.get(relation.field)?.has(linkedId) === true);
        });
        if (relationsMatch) recordIds.add(id);
      }
    }
    if (recordIds.size > POSITION_SCOPE_MAX_ROWS) throw new Error('项目岗位范围记录超过安全上限: ' + objectName);
    return [...recordIds];
  })();
  cache.set(cacheKey, pending);
  return pending;
}

/**
 * Project the precise native contract-review grants into the project read
 * scope. This only feeds the existing read-ID policies; Native Sharing remains
 * the independent authorization layer and no write/delete IDs are changed.
 */
async function contractReviewSharedReadIds(
  engine: IObjectQLEngine,
  userId: string,
  organizationId: string,
  context: KernelExecutionContext,
): Promise<{ contractIds: string[]; lineIds: string[] }> {
  const shares = await findAllScopedRows(engine, 'sys_record_share', {
    organization_id: organizationId,
    object_name: SALES_CONTRACT_OBJECT,
    recipient_type: 'user',
    recipient_id: userId,
    access_level: 'read',
    source: CONTRACT_REVIEW_SHARE_SOURCE,
  }, ['id', 'organization_id', 'object_name', 'record_id', 'recipient_type', 'recipient_id', 'access_level', 'source', 'source_id'], context);
  const candidates = [...new Set(shares.flatMap(share => {
    const recordId = text(share.record_id);
    return text(share.organization_id) === organizationId
      && text(share.object_name) === SALES_CONTRACT_OBJECT
      && text(share.recipient_type) === 'user'
      && text(share.recipient_id) === userId
      && text(share.access_level) === 'read'
      && text(share.source) === CONTRACT_REVIEW_SHARE_SOURCE
      && text(share.source_id) === CONTRACT_REVIEW_SHARE_SOURCE_ID_PREFIX + recordId
      && recordId
      ? [recordId]
      : [];
  }))];
  if (!candidates.length) return { contractIds: [], lineIds: [] };

  const contracts = await findAllScopedRows(engine, SALES_CONTRACT_OBJECT, {
    id: { $in: candidates }, organization_id: organizationId,
  }, ['id', 'organization_id'], context);
  const contractIds = [...new Set(contracts.flatMap(contract => {
    const id = text(contract.id);
    return text(contract.organization_id) === organizationId && candidates.includes(id) ? [id] : [];
  }))];
  if (!contractIds.length) return { contractIds: [], lineIds: [] };

  const contractIdSet = new Set(contractIds);
  const lines = await findAllScopedRows(engine, SALES_CONTRACT_LINE_OBJECT, {
    contract_id: { $in: contractIds }, organization_id: organizationId,
  }, ['id', 'contract_id', 'organization_id'], context);
  const lineIds = [...new Set(lines.flatMap(line => {
    const id = text(line.id);
    return text(line.organization_id) === organizationId && contractIdSet.has(text(line.contract_id)) && id ? [id] : [];
  }))];
  return { contractIds, lineIds };
}

async function resolveProjectPositionScopes(
  engine: IObjectQLEngine,
  userId: string,
  organizationId: string,
  activeMembers: Row[],
  requestContext: RlsMembershipContext,
  rlsMembership: Record<string, string[]>,
): Promise<Record<string, string[]>> {
  const empty = emptyProjectPositionScopes();
  const context = { isSystem: true, userId, tenantId: organizationId } as KernelExecutionContext;
  const contractReviewIds = await contractReviewSharedReadIds(engine, userId, organizationId, context);
  empty[CONTRACT_REVIEW_RLS_KEY] = contractReviewIds.contractIds;
  empty[projectPositionReadScopeKey(SALES_CONTRACT_OBJECT)] = contractReviewIds.contractIds;
  empty[projectPositionReadScopeKey(SALES_CONTRACT_LINE_OBJECT)] = contractReviewIds.lineIds;
  if (!activeMembers.length) return empty;
  const memberById = new Map(activeMembers.map(member => [text(member.id), member]));
  const memberIds = [...memberById.keys()].filter(Boolean);
  const rlsContext = {
    userId,
    tenantId: organizationId,
    positions: requestContext.positions || [],
    permissions: requestContext.permissions || [],
    accessible_org_ids: requestContext.accessible_org_ids || [organizationId],
    rlsMembership: { ...rlsMembership, [CONTRACT_REVIEW_RLS_KEY]: contractReviewIds.contractIds },
  } as unknown as KernelExecutionContext;
  const [assignments, userPositions] = await Promise.all([
    engine.find(POSITION_ASSIGNMENT_OBJECT, {
      where: { member_id: { $in: memberIds }, organization_id: organizationId, active: true },
      fields: ['id', 'member_id', 'project_id', 'position_id', 'organization_id', 'active'],
      orderBy: [{ field: 'id', order: 'asc' }], limit: 5000,
    }, { context }),
    engine.find('sys_user_position', {
      where: { user_id: userId, organization_id: organizationId },
      fields: ['user_id', 'position', 'organization_id', 'valid_from', 'valid_until'],
      orderBy: [{ field: 'id', order: 'asc' }], limit: 1000,
    }, { context }),
  ]);
  if (!Array.isArray(assignments) || !Array.isArray(userPositions)) throw new Error('项目岗位或原生组织任职查询未返回记录列表');
  const now = Date.now();
  const validPositionNames = new Set(userPositions.filter(row =>
    text(row.user_id) === userId
    && text(row.organization_id) === organizationId
    && text(row.position)
    && isGrantActive(row, now),
  ).map(row => text(row.position)));
  if (!validPositionNames.size) return empty;
  const positionRows = await engine.find('sys_position', {
    where: { name: { $in: [...validPositionNames] }, active: true },
    fields: ['id', 'name', 'active'], orderBy: [{ field: 'id', order: 'asc' }], limit: 1000,
  }, { context });
  if (!Array.isArray(positionRows)) throw new Error('原生组织岗位查询未返回记录列表');
  const positionById = new Map(positionRows.filter(row => isRowActive(row)).map(row => [text(row.id), row]));
  const positions = [...new Set(assignments.filter(assignment => {
    const member = memberById.get(text(assignment.member_id));
    const position = positionById.get(text(assignment.position_id));
    return assignment.active === true
      && text(assignment.organization_id) === organizationId
      && member != null
      && text(assignment.project_id) === text(member.project_id)
      && position != null
      && validPositionNames.has(text(position.name));
  }).map(assignment => text(assignment.position_id)).filter(Boolean))];
  if (!positions.length) return empty;
  const bindings = await engine.find('sys_position_permission_set', {
    where: { position_id: { $in: positions } },
    fields: ['position_id', 'permission_set_id'],
    orderBy: [{ field: 'id', order: 'asc' }], limit: 5000,
  }, { context });
  if (!Array.isArray(bindings)) throw new Error('岗位PermissionSet绑定查询未返回记录列表');
  const permissionSetIds = [...new Set(bindings.map(binding => text(binding.permission_set_id)).filter(Boolean))];
  if (!permissionSetIds.length) return empty;
  const permissionSets = await engine.find('sys_permission_set', {
      where: { id: { $in: permissionSetIds }, active: true },
    fields: ['id', 'name', 'label', 'description', 'active', 'object_permissions', 'field_permissions', 'system_permissions', 'row_level_security', 'tab_permissions', 'admin_scope'],
    orderBy: [{ field: 'id', order: 'asc' }], limit: 2000,
  }, { context });
  if (!Array.isArray(permissionSets)) throw new Error('原生PermissionSet查询未返回记录列表');
  const permissionSetById = new Map(permissionSets.filter(set => set.active !== false).map(set => [text(set.id), permissionSetBodyFromRow(set) as Row]));
  const positionPermissions = new Map<string, Row[]>();
  for (const binding of bindings) {
    const positionId = text(binding.position_id), set = permissionSetById.get(text(binding.permission_set_id));
    if (!positionId || !set) continue;
    const current = positionPermissions.get(positionId) || [];
    current.push(set);
    positionPermissions.set(positionId, current);
  }
  const projectsByPosition = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const member = memberById.get(text(assignment.member_id));
    const position = positionById.get(text(assignment.position_id));
    if (assignment.active !== true || text(assignment.organization_id) !== organizationId || !member
      || text(assignment.project_id) !== text(member.project_id) || !position
      || !validPositionNames.has(text(position.name))) continue;
    const projectId = text(assignment.project_id), positionId = text(assignment.position_id);
    if (!projectId) continue;
    const projects = projectsByPosition.get(positionId) || new Set<string>();
    projects.add(projectId);
    projectsByPosition.set(positionId, projects);
  }
  const cache = new Map<string, Promise<string[]>>();
  for (const [positionId, positionSets] of positionPermissions) {
    const projects = [...(projectsByPosition.get(positionId) || [])];
    if (!projects.length) continue;
    for (const set of positionSets) {
      for (const objectName of PROJECT_POSITION_SCOPED_OBJECTS) {
        if (!permissionSetHasReadableBusinessField(engine, objectName, set)) continue;
        const nativePermissionSet = set as unknown as NativePermissionSet;
        if (positionPermissionEvaluator.checkObjectPermission('find', objectName, [nativePermissionSet], { isPrivate: true })) {
          const filter = permissionSetRlsFilter(engine, objectName, set, 'find', rlsContext);
          const key = projectPositionReadScopeKey(objectName);
          const rowIds = await projectScopedRecordIds(engine, objectName, organizationId, projects, context, cache, filter);
          empty[key] = [...new Set([...(empty[key] || []), ...rowIds])];
        }
        if (positionPermissionEvaluator.checkObjectPermission('update', objectName, [nativePermissionSet], { isPrivate: true })) {
          const filter = permissionSetRlsFilter(engine, objectName, set, 'update', rlsContext);
          const key = projectPositionEditScopeKey(objectName);
          const rowIds = await projectScopedRecordIds(engine, objectName, organizationId, projects, context, cache, filter);
          empty[key] = [...new Set([...(empty[key] || []), ...rowIds])];
        }
        if (positionPermissionEvaluator.checkObjectPermission('delete', objectName, [nativePermissionSet], { isPrivate: true })) {
          const filter = permissionSetRlsFilter(engine, objectName, set, 'delete', rlsContext);
          const key = projectPositionDeleteScopeKey(objectName);
          const rowIds = await projectScopedRecordIds(engine, objectName, organizationId, projects, context, cache, filter);
          empty[key] = [...new Set([...(empty[key] || []), ...rowIds])];
        }
      }
    }
  }
  return empty;
}

/** Resolves only active membership rows in organizations admitted by the core tenancy context. */
export function createProjectMembershipRlsResolver(getEngine: EngineProvider): IRlsMembershipResolver {
  return {
    keys: [PROJECT_RLS_MEMBERSHIP_KEY, PROJECT_MANAGER_RLS_KEY, ...projectPositionRlsKeys],
    async resolve(context) {
      const userId = text(context.userId);
      const scopedOrganizationIds = organizationIds(context);
      if (!userId || !scopedOrganizationIds.length) {
        return { [PROJECT_RLS_MEMBERSHIP_KEY]: [], [PROJECT_MANAGER_RLS_KEY]: [], ...emptyProjectPositionScopes() };
      }

      const engine = getEngine();
      const projectIds = new Set<string>();
      const activeMemberRows: Row[] = [];
      for (const organizationId of scopedOrganizationIds) {
        const executionContext = {
          isSystem: true,
          userId,
          tenantId: organizationId,
        } as KernelExecutionContext;
        let offset = 0;
        while (true) {
          const page = await engine.find(MEMBER_OBJECT, {
            where: { user_id: userId, active: true, organization_id: organizationId },
            fields: ['id', 'user_id', 'project_id', 'active', 'organization_id'],
            orderBy: [{ field: 'id', order: 'asc' }],
            limit: PAGE_SIZE,
            offset,
          }, { context: executionContext });

          if (!Array.isArray(page)) throw new Error('项目成员查询未返回记录列表');
          for (const candidate of page as Row[]) {
            const rowUserId = text(candidate.user_id);
            const projectId = text(candidate.project_id);
            if (candidate.active === true
              && rowUserId === userId
              && text(candidate.organization_id) === organizationId
              && projectId) {
              projectIds.add(projectId);
              activeMemberRows.push(candidate);
            }
          }

          if (page.length < PAGE_SIZE) break;
          offset += page.length;
        }
      }

  const result: Record<string, string[]> = {
    [PROJECT_RLS_MEMBERSHIP_KEY]: [...projectIds],
    ...emptyProjectPositionScopes(),
  };
  const managedIds = new Set<string>();
  const hasManagerCapability = context.permissions?.includes('forge_project_manager') === true;
  let managerScopeResolved = !hasManagerCapability;
  if (hasManagerCapability) {
    try {
      for (const organizationId of scopedOrganizationIds) {
        let offset = 0;
        while (true) {
          const page = await engine.find('forge_project', {
            where: { manager_id: userId, organization_id: organizationId },
            fields: ['id', 'manager_id', 'organization_id'],
            orderBy: [{ field: 'id', order: 'asc' }],
            limit: PAGE_SIZE,
            offset,
          }, { context: { isSystem: true, userId, tenantId: organizationId } as KernelExecutionContext });
          if (!Array.isArray(page)) throw new Error('项目经理范围查询未返回记录列表');
          for (const candidate of page as Row[]) {
            if (text(candidate.manager_id) === userId && text(candidate.organization_id) === organizationId && text(candidate.id)) {
              managedIds.add(text(candidate.id));
            }
          }
          if (page.length < PAGE_SIZE) break;
          offset += page.length;
        }
      }
      result[PROJECT_MANAGER_RLS_KEY] = [...managedIds];
      managerScopeResolved = true;
    } catch {
      // Leave the manager key unresolved and suppress all position scopes whose
      // native PermissionSet RLS may depend on it.
    }
  }

  const rlsMembership: Record<string, string[]> = {
    [PROJECT_RLS_MEMBERSHIP_KEY]: [...projectIds],
    ...(managerScopeResolved && hasManagerCapability ? { [PROJECT_MANAGER_RLS_KEY]: [...managedIds] } : {}),
  };
  if (managerScopeResolved) {
    try {
      const positionScopes = emptyProjectPositionScopes();
      for (const organizationId of scopedOrganizationIds) {
        const members = activeMemberRows.filter(member => text(member.organization_id) === organizationId);
        const organizationScopes = await resolveProjectPositionScopes(engine, userId, organizationId, members, context, rlsMembership);
        for (const key of projectPositionRlsKeys) {
          positionScopes[key] = [...new Set([...(positionScopes[key] || []), ...(organizationScopes[key] || [])])];
        }
      }
      Object.assign(result, positionScopes);
    } catch {
      // Incomplete PermissionSet/RLS reads deny all position-derived rows;
      // the independent active member and manager scopes remain unchanged.
      Object.assign(result, emptyProjectPositionScopes());
    }
  }
  return result;
    },
  };
}

/** Registers the platform resolver before SecurityPlugin.start() probes the service. */
export class ProjectRlsMembershipPlugin implements Plugin {
  name = 'com.inoforge.forge.project-rls-membership';
  version = '1.0.0';
  type = 'standard' as const;
  providesServices = [RLS_MEMBERSHIP_RESOLVER_SERVICE];

  init(ctx: PluginContext): void {
    ctx.registerService(RLS_MEMBERSHIP_RESOLVER_SERVICE, createProjectMembershipRlsResolver(
      () => ctx.getService<IObjectQLEngine>('objectql'),
    ));
  }
}
