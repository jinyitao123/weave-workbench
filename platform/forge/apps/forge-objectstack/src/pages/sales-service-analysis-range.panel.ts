/** Validate complete creation-date ranges before any analysis query is mounted. */
export function serviceAnalysisDateRange(from: unknown, to: unknown) {
  const start = typeof from === 'string' ? from : '';
  const end = typeof to === 'string' ? to : '';
  if (!start && !end) return { valid: true, from: '', to: '', error: '' };
  if (!start || !end) return { valid: false, from: start, to: end, error: '请完整选择开始日期和结束日期。' };
  for (const value of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { valid: false, from: start, to: end, error: '日期无效，请重新选择。' };
    const date = new Date(value + 'T00:00:00.000Z');
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return { valid: false, from: start, to: end, error: '日期无效，请重新选择。' };
  }
  if (start > end) return { valid: false, from: start, to: end, error: '开始日期不能晚于结束日期。' };
  return { valid: true, from: start, to: end, error: '' };
}

export const serviceAnalysisRangeHelpersSource = serviceAnalysisDateRange.toString();
