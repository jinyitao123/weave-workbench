export type ProjectTaskGanttUnavailableReason =
  | 'invalid_row'
  | 'missing_id'
  | 'missing_title'
  | 'invalid_start_date'
  | 'invalid_end_date'
  | 'reversed_dates'
  | 'invalid_progress'
  | 'invalid_rows';

export interface ProjectTaskGanttTask {
  id: string;
  title: string;
  start: Date;
  end: Date;
  progress: number;
  data: Record<string, unknown>;
  locked: true;
}

export interface ProjectTaskGanttUnavailableRow {
  row: unknown;
  reason: ProjectTaskGanttUnavailableReason;
}

export interface ProjectTaskGanttProjection {
  tasks: ProjectTaskGanttTask[];
  unavailableRows: ProjectTaskGanttUnavailableRow[];
  startDate: Date | null;
  endDate: Date | null;
}

/** Parse a strict date-only value as a local calendar date without timezone shifting. */
export function projectTaskGanttParseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** Shift a local calendar date by whole days, preserving its date-only meaning across DST. */
export function projectTaskGanttAddCalendarDays(value: Date, days: number): Date {
  const date = new Date(value.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

/** Project already-authorized task rows into a read-only, date-based Gantt range. */
export function projectTaskGanttProjection(rows: unknown): ProjectTaskGanttProjection {
  const tasks: ProjectTaskGanttTask[] = [];
  const unavailableRows: ProjectTaskGanttUnavailableRow[] = [];
  if (!Array.isArray(rows)) {
    unavailableRows.push({ row: rows, reason: 'invalid_rows' });
    return { tasks, unavailableRows, startDate: null, endDate: null };
  }

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      unavailableRows.push({ row, reason: 'invalid_row' });
      continue;
    }
    const record = row as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) {
      unavailableRows.push({ row, reason: 'missing_id' });
      continue;
    }
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const itemKey = typeof record.item_key === 'string' ? record.item_key.trim() : '';
    const title = name || itemKey;
    if (!title) {
      unavailableRows.push({ row, reason: 'missing_title' });
      continue;
    }
    const start = projectTaskGanttParseDate(record.planned_start_on);
    if (!start) {
      unavailableRows.push({ row, reason: 'invalid_start_date' });
      continue;
    }
    const end = projectTaskGanttParseDate(record.planned_end_on);
    if (!end) {
      unavailableRows.push({ row, reason: 'invalid_end_date' });
      continue;
    }
    if (end.getTime() < start.getTime()) {
      unavailableRows.push({ row, reason: 'reversed_dates' });
      continue;
    }
    if (typeof record.progress !== 'number' || !Number.isFinite(record.progress) || record.progress < 0 || record.progress > 100) {
      unavailableRows.push({ row, reason: 'invalid_progress' });
      continue;
    }
    tasks.push({ id, title, start, end, progress: record.progress, data: record, locked: true });
  }

  if (tasks.length === 0) return { tasks, unavailableRows, startDate: null, endDate: null };
  let minStart = tasks[0].start;
  let maxEnd = tasks[0].end;
  for (const task of tasks.slice(1)) {
    if (task.start.getTime() < minStart.getTime()) minStart = task.start;
    if (task.end.getTime() > maxEnd.getTime()) maxEnd = task.end;
  }
  return {
    tasks,
    unavailableRows,
    startDate: projectTaskGanttAddCalendarDays(minStart, -3),
    endDate: projectTaskGanttAddCalendarDays(maxEnd, 7),
  };
}

export const projectTaskGanttHelpersSource = [
  projectTaskGanttParseDate,
  projectTaskGanttAddCalendarDays,
  projectTaskGanttProjection,
].map(helper => helper.toString()).join('\n');
