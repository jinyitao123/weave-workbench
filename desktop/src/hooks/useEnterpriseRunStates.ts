import { useCallback, useEffect, useRef, useState } from 'react'
import type { EnterpriseWorkRunState, EnterpriseWorkRunStates } from '@/types/api'

export interface EnterpriseRunView {
  run?: EnterpriseWorkRunState
  unavailable?: boolean
  stale?: boolean
}

export const enterpriseRunTerminal = (status: string): boolean => ['succeeded', 'failed', 'cancelled', 'abandoned'].includes(status)

/** One account/session-owned, serial read loop for all visible authorization cards. */
export function useEnterpriseRunStates(runIds: string[], accountScope: string | undefined, read?: (ids: string[]) => Promise<EnterpriseWorkRunStates>) {
  const idsKey = JSON.stringify([...new Set(runIds)].sort())
  const owner = `${accountScope ?? ''}:${idsKey}`
  const [snapshot, setSnapshot] = useState<{ owner: string; views: Record<string, EnterpriseRunView> }>({ owner: '', views: {} })
  const [revision, setRevision] = useState(0)
  const previousRef = useRef(snapshot)
  previousRef.current = snapshot
  const refresh = useCallback(() => setRevision((current) => current + 1), [])

  useEffect(() => {
    const ids: string[] = JSON.parse(idsKey)
    if (!read || !accountScope || !ids.length) return
    let disposed = false, inFlight = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const views = previousRef.current.owner === owner ? { ...previousRef.current.views } : {}
    // Revalidate even cached terminal states on mount/account/session changes.
    let first = true
    const publish = () => { if (!disposed) setSnapshot({ owner, views: { ...views } }) }
    const poll = async () => {
      if (disposed || inFlight || document.visibilityState === 'hidden') return
      const pending = ids.filter((id) => first || views[id]?.stale || !views[id]?.run || !enterpriseRunTerminal(views[id].run!.status))
      if (!pending.length) return
      first = false; inFlight = true
      try {
        const result = await read(pending)
        if (disposed) return
        const returned = new Map(result.runs.map((run) => [run.runId, run]))
        for (const id of pending) {
          const run = returned.get(id)
          views[id] = run ? { run } : { unavailable: true }
        }
      } catch {
        if (disposed) return
        for (const id of pending) views[id] = { ...views[id], stale: true }
      } finally {
        inFlight = false
        if (!disposed) {
          publish()
          if (ids.some((id) => !views[id]?.run || views[id]?.stale || !enterpriseRunTerminal(views[id].run!.status))) timer = setTimeout(() => { void poll() }, 5000)
        }
      }
    }
    const onVisibility = () => {
      if (timer) clearTimeout(timer)
      if (document.visibilityState !== 'hidden') void poll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    void poll()
    return () => { disposed = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [accountScope, idsKey, owner, read, revision])

  return { views: snapshot.owner === owner ? snapshot.views : {}, refresh }
}
