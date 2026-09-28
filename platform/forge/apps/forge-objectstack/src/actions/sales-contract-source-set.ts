export function hasExactQuotationLineSet(
  quotationLines: Array<{ id?: unknown }>,
  contractLines: Array<{ quotation_line_id?: unknown }>,
): boolean {
  if (!Array.isArray(quotationLines) || !Array.isArray(contractLines) || quotationLines.length !== contractLines.length) return false;
  const expectedIds = quotationLines.map(line => String(line?.id || '').trim());
  const actualIds = contractLines.map(line => String(line?.quotation_line_id || '').trim());
  if (expectedIds.some(id => !id) || actualIds.some(id => !id)) return false;
  const expectedSet = new Set(expectedIds);
  const actualSet = new Set(actualIds);
  return expectedSet.size === expectedIds.length
    && actualSet.size === actualIds.length
    && expectedSet.size === actualSet.size
    && [...expectedSet].every(id => actualSet.has(id));
}
