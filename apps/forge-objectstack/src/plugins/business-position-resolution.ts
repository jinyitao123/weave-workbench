import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SYSTEM_READ, TaskConnectionFailure } from './native-task-auth.js';

/** Native positions and memberships remain the only staff directory. */
export async function effectivePositionUsers(engine: IObjectQLEngine, organizationId: string, positionName: string,
  options: { exclude?: string; context?: ExecutionContext; now?: number } = {}): Promise<string[]> {
  const context = options.context ?? { ...SYSTEM_READ, tenantId: organizationId }, now = options.now ?? Date.now();
  const positions = await engine.find('sys_position', { where: { organization_id: organizationId, name: positionName },
    fields: ['id', 'name', 'active', 'organization_id'], limit: 101 }, { context });
  if (positions.length > 100) throw new TaskConnectionFailure(503, 'BUSINESS_POSITION_INCOMPLETE', '岗位配置无法完整核对');
  const keys = positions.filter(p => p.active !== false && p.organization_id === organizationId)
    .map(p => String(p.name));
  if (!keys.length) return [];
  const assignments = await engine.find('sys_user_position', { where: { organization_id: organizationId, position: { $in: keys } },
    fields: ['user_id', 'organization_id', 'position', 'valid_from', 'valid_until'], limit: 101 }, { context });
  if (assignments.length > 100) throw new TaskConnectionFailure(503, 'BUSINESS_POSITION_INCOMPLETE', '岗位任职无法完整核对');
  const candidates = [...new Set(assignments.filter(a => {
    const from = a.valid_from ? Date.parse(String(a.valid_from)) : Number.NEGATIVE_INFINITY;
    const until = a.valid_until ? Date.parse(String(a.valid_until)) : Number.POSITIVE_INFINITY;
    return a.organization_id === organizationId && keys.includes(String(a.position)) && from <= now && now < until
      && typeof a.user_id === 'string' && a.user_id !== options.exclude;
  }).map(a => String(a.user_id)))];
  if (!candidates.length) return [];
  const [members, users] = await Promise.all([
    engine.find('sys_member', { where: { organization_id: organizationId, user_id: { $in: candidates } }, fields: ['user_id', 'organization_id'], limit: 101 }, { context }),
    engine.find('sys_user', { where: { id: { $in: candidates } }, fields: ['id', 'banned', 'ban_expires'], limit: 101 }, { context }),
  ]);
  if (members.length > 100 || users.length > 100) throw new TaskConnectionFailure(503, 'BUSINESS_POSITION_INCOMPLETE', '当前员工资格无法完整核对');
  return candidates.filter(id => members.some(m => m.user_id === id && m.organization_id === organizationId)
    && users.some(u => u.id === id && !(u.banned === true && (!u.ban_expires || !Number.isFinite(Date.parse(String(u.ban_expires))) || Date.parse(String(u.ban_expires)) > now)))).sort();
}

export async function requireUniquePositionUser(engine: IObjectQLEngine, organizationId: string, position: string,
  options: { exclude?: string; preferred?: string; context?: ExecutionContext } = {}): Promise<string> {
  const candidates = await effectivePositionUsers(engine, organizationId, position, options);
  if (options.preferred && candidates.includes(options.preferred)) return options.preferred;
  if (candidates.length !== 1) throw new TaskConnectionFailure(422, 'BUSINESS_ASSIGNEE_REQUIRED',
    candidates.length ? '该岗位有多名有效员工，请先明确本单负责人' : '该岗位当前没有有效任职员工，请先完成分配');
  return candidates[0];
}
