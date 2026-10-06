/** Convert enabled type definitions to the existing text-valued order field. */
export function serviceTypeCatalogOptions(rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const row of rows) {
    if (row.category !== 'order_type' || row.status !== 'active') continue;
    const name = String(row.name ?? '').trim();
    if (!name) return { available: false, options: [], error: '服务场景配置缺少名称。' };
    if (seen.has(name)) return { available: false, options: [], error: '服务场景配置名称重复，暂无法选择。' };
    seen.add(name);
    // Enum keys obey the Spec identifier grammar; the label widget stores the
    // original business name. Code-point boundaries keep keys collision-free
    // and independent of catalog order or arbitrary configuration codes.
    const value = 'service_type_' + Array.from(name, character => character.codePointAt(0)!.toString(16)).join('_');
    options.push({ value, label: name });
  }
  return { available: true, options, error: '' };
}

export const serviceTypeCatalogHelpersSource = serviceTypeCatalogOptions.toString();
