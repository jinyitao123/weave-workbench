import type { EnterpriseWorkItem, EnterpriseWorkOverview } from '../types/api'

export function isPendingEnterpriseWorkItem(item: EnterpriseWorkItem): boolean {
  return item.actionable && item.status !== 'completed' && item.status !== 'cancelled'
}

/** Partial or unavailable sources cannot establish a definite pending total. */
export function enterprisePendingWorkCount(overview: EnterpriseWorkOverview | undefined, unavailable = false): number | undefined {
  if (!overview || unavailable) return undefined
  const reads = [overview.reads.weaveTasks, overview.reads.forgeApprovals, overview.reads.notifications]
  if (reads.some((read) => read.status !== 'loaded' || read.truncated)) return undefined
  return overview.tasks.length + overview.items.filter(isPendingEnterpriseWorkItem).length
}
