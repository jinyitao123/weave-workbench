/** ObjectStack 17.3 approval listing uses limit/offset and optional total. */
export async function readApprovalPages(read: (path: string) => Promise<unknown>): Promise<{ data: unknown[] }> {
  const limit = 50
  const found = new Map<string, unknown>()
  let offset = 0
  let total: number | undefined
  for (;;) {
    const response = await read(`/api/v1/approvals/requests?limit=${limit}${offset ? `&offset=${offset}` : ''}`)
    const envelope = object(response)
    const values = Array.isArray(response) ? response : Array.isArray(envelope?.data) ? envelope.data : envelope?.requests
    if (!Array.isArray(values) || values.length > limit) throw new Error('审批事项分页格式无效，请刷新后重试')
    if (envelope?.total !== undefined) {
      if (!Number.isSafeInteger(envelope.total) || (envelope.total as number) < 0) throw new Error('审批事项总量格式无效，请刷新后重试')
      if (total !== undefined && total !== envelope.total) throw new Error('审批事项列表在读取期间已变化，请刷新后重试')
      total = envelope.total as number
    }
    const previousCount = found.size
    for (const value of values) {
      const id = object(value)?.id
      if (typeof id !== 'string' || !id.trim()) throw new Error('审批事项分页缺少有效事项，请刷新后重试')
      const previous = found.get(id)
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error('审批事项在读取期间已变化，请刷新后重试')
      found.set(id, value)
    }
    if (total !== undefined && found.size >= total) {
      if (found.size !== total) throw new Error('审批事项总量与列表不一致，请刷新后重试')
      return { data: [...found.values()] }
    }
    if (values.length < limit) {
      if (total !== undefined) throw new Error('审批事项分页未能完整读取，请刷新后重试')
      return { data: [...found.values()] }
    }
    if (found.size === previousCount) throw new Error('审批事项分页没有继续前进，请刷新后重试')
    offset += values.length
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
