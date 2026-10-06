import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, remarks, required } from '../model.js';

/**
 * A project-member assignment to an existing organization position.
 * Permission capabilities remain owned by ObjectStack PermissionSets attached
 * to that native position; this object only scopes the appointment to a project.
 */
export const ProjectMemberPositionAssignment = master('forge_project_member_position_assignment', '项目成员岗位分配', 'briefcase-business', {
  name: text('岗位分配名称', true),
  assignment_key: { ...code('分配关系编号'), hidden: true, readonly: true },
  project_id: Field.masterDetail('forge_project', { label: '所属项目', deleteBehavior: 'cascade', ...required }),
  member_id: reference('forge_project_member', '项目成员', true),
  position_id: reference('sys_position', '组织岗位', true),
  position_name_snapshot: { ...text('岗位名称快照'), readonly: true },
  is_default: Field.boolean({ label: '默认项目岗位', ...required }),
  active: Field.boolean({ label: '当前有效', ...required }),
  assigned_at: Field.datetime({ label: '分配时间', ...required }),
  ended_at: { ...Field.datetime({ label: '停用时间' }), readonly: true },
  remarks: remarks(),
}, ['project_id', 'member_id', 'position_name_snapshot', 'is_default', 'active', 'assigned_at', 'ended_at'], 'controlled_by_parent');
