export const PROJECT_TASK_IMPORT_COLUMNS = [
  '任务标题', '详细描述', '任务类别', '负责人', '优先级', '计划开始', '计划结束', '预估工时', '所属阶段',
] as const;

export const PROJECT_TASK_IMPORT_MAPPING = {
  项目: 'project_id',
  计划: 'plan_id',
  任务标题: 'name',
  详细描述: 'description',
  任务类别: 'task_type',
  负责人: 'owner_id',
  优先级: 'priority',
  计划开始: 'planned_start_on',
  计划结束: 'planned_end_on',
  预估工时: 'estimated_hours',
  所属阶段: 'parent_id',
} as const;

export interface ProjectTaskImportOption {
  id: string;
  name?: string | null;
  code?: string | null;
  organization_id?: string | null;
  enabled?: boolean;
}

export interface ProjectTaskImportMember {
  id?: string;
  name?: string | null;
  user_id?: string | null;
  project_id?: string | null;
  active?: boolean;
  member_duty?: string | null;
}

export interface ProjectTaskImportPhase {
  id: string;
  name?: string | null;
  plan_id?: string | null;
  project_id?: string | null;
  item_type?: string | null;
}

export interface NormalizeProjectTaskImportInput {
  csv: string;
  projectId: string;
  planId: string;
  organizationId: string;
  taskTypes: ProjectTaskImportOption[];
  members: ProjectTaskImportMember[];
  phases: ProjectTaskImportPhase[];
}

export function parseProjectTaskImportCsv(text: string): string[][] {
  const cells: string[][] = [];
  let value = '', row: string[] = [], quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = false;
      } else value += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(value); value = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(value); value = ''; cells.push(row); row = []; continue; }
    value += char;
  }
  if (quoted) throw new Error('CSV引号未闭合');
  if (value.length > 0 || row.length > 0) { row.push(value); cells.push(row); }
  while (cells.length > 1 && cells[cells.length - 1].every(cell => cell.trim() === '')) cells.pop();
  return cells;
}

export function projectTaskImportRecordId(value: unknown): string {
  if (value && typeof value === 'object') return String((value as { id?: unknown }).id || '').trim();
  return String(value || '').trim();
}

export function projectTaskImportUniqueMatch<T>(rows: T[], predicate: (row: T) => boolean, label: string): T {
  const matches = rows.filter(predicate);
  if (matches.length === 0) throw new Error('找不到当前项目中唯一匹配的' + label);
  if (matches.length > 1) throw new Error(label + '名称重复，请先核对项目配置');
  return matches[0];
}

/** Resolve visible task/member/phase names to caller-visible record IDs and pin the selected project and plan. */
export function normalizeProjectTaskImportCsv(input: NormalizeProjectTaskImportInput): { csv: string; rowCount: number } {
  const projectId = String(input.projectId || '').trim();
  const planId = String(input.planId || '').trim();
  const organizationId = String(input.organizationId || '').trim();
  if (!projectId || !planId || !organizationId) throw new Error('请选择项目、执行计划并确认当前组织');
  const cells = parseProjectTaskImportCsv(String(input.csv || '').replace(/^\uFEFF/, ''));
  if (cells.length < 2) throw new Error('CSV文件没有可导入任务');
  const headers = cells[0].map(header => header.trim());
  if (headers.some(header => !header)) throw new Error('CSV表头不能为空');
  if (new Set(headers).size !== headers.length) throw new Error('CSV表头不能重复');
  const allowed = new Set<string>(PROJECT_TASK_IMPORT_COLUMNS);
  const invalid = headers.filter(header => !allowed.has(header));
  if (invalid.length) throw new Error('CSV含有不支持的列：' + invalid.join('、'));
  const required = ['任务标题', '任务类别', '负责人', '优先级', '计划开始', '计划结束', '预估工时'];
  const missing = required.filter(header => !headers.includes(header));
  if (missing.length) throw new Error('CSV缺少必填列：' + missing.join('、'));
  const indexOf = new Map(headers.map((header, index) => [header, index]));
  const typeRows = input.taskTypes.filter(row => row && row.enabled !== false && String(row.organization_id || '') === organizationId);
  const memberRows = input.members.filter(row => row && row.active === true && String(row.project_id || '') === projectId && ['manager', 'member'].includes(String(row.member_duty || '')));
  const phaseRows = input.phases.filter(row => row && row.item_type === 'phase' && String(row.plan_id || '') === planId && String(row.project_id || '') === projectId);
  const names = new Set<string>();
  const normalizedRows = cells.slice(1).map((source, rowIndex) => {
    if (source.length !== headers.length) throw new Error('第 ' + (rowIndex + 2) + ' 行的列数与表头不一致');
    const value = (header: string) => indexOf.has(header) ? String(source[indexOf.get(header)!] || '').trim() : '';
    const name = value('任务标题');
    if (!name) throw new Error('第 ' + (rowIndex + 2) + ' 行缺少任务标题');
    if (names.has(name)) throw new Error('CSV中存在同名任务：' + name);
    names.add(name);
    const taskTypeValue = value('任务类别');
    const taskType = projectTaskImportUniqueMatch(typeRows, row => projectTaskImportRecordId(row.id) === taskTypeValue || String(row.name || '').trim() === taskTypeValue || String(row.code || '').trim() === taskTypeValue, '任务类别“' + taskTypeValue + '”');
    const ownerValue = value('负责人');
    const owner = projectTaskImportUniqueMatch(memberRows, row => projectTaskImportRecordId(row.user_id) === ownerValue || projectTaskImportRecordId(row.id) === ownerValue || String(row.name || '').trim() === ownerValue, '负责人“' + ownerValue + '”');
    if (!projectTaskImportRecordId(owner.user_id)) throw new Error('负责人缺少当前项目成员账号关联');
    const priorityValue = value('优先级');
    const priority = ({ '紧急': 'urgent', '高': 'high', '中': 'medium', '低': 'low' } as Record<string, string>)[priorityValue] || priorityValue;
    if (!['urgent', 'high', 'medium', 'low'].includes(priority)) throw new Error('第 ' + (rowIndex + 2) + ' 行优先级无效');
    const start = value('计划开始'), end = value('计划结束');
    const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00.000Z')) && new Date(date + 'T00:00:00.000Z').toISOString().slice(0, 10) === date;
    if (!validDate(start) || !validDate(end) || end < start) throw new Error('第 ' + (rowIndex + 2) + ' 行计划日期无效');
    const hours = Number(value('预估工时'));
    if (!Number.isFinite(hours) || hours < 0) throw new Error('第 ' + (rowIndex + 2) + ' 行预估工时必须大于或等于零');
    const phaseValue = value('所属阶段');
    const phase = phaseValue ? projectTaskImportUniqueMatch(phaseRows, row => projectTaskImportRecordId(row.id) === phaseValue || String(row.name || '').trim() === phaseValue, '所属阶段“' + phaseValue + '”') : null;
    const output: Record<string, string> = {
      '项目': projectId,
      '计划': planId,
      '任务标题': name,
      '详细描述': value('详细描述'),
      '任务类别': projectTaskImportRecordId(taskType.id),
      '负责人': projectTaskImportRecordId(owner.user_id),
      '优先级': priority,
      '计划开始': start,
      '计划结束': end,
      '预估工时': String(hours),
      '所属阶段': phase ? projectTaskImportRecordId(phase.id) : '',
    };
    return Object.keys(PROJECT_TASK_IMPORT_MAPPING).map(header => output[header] || '');
  });
  if (!normalizedRows.length) throw new Error('CSV文件没有可导入任务');
  const resultHeaders = Object.keys(PROJECT_TASK_IMPORT_MAPPING);
  const escape = (cell: string) => '"' + String(cell ?? '').replaceAll('"', '""') + '"';
  return { csv: [resultHeaders, ...normalizedRows].map(row => row.map(escape).join(',')).join('\r\n'), rowCount: normalizedRows.length };
}
