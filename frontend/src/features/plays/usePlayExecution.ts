import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceApi } from '@/api/workspace'
import type { LinkOrder, PlayExecution } from '@/api/plays'
import { failure } from './saved'

/** How often an open play view checks the venue while the tab is visible. */
export const executionCheckInterval = 60_000

const active = (execution: PlayExecution | null) =>
  !!execution?.tracked && ['planned', 'paused', 'open'].includes(execution.status)

/**
 * Venue orders and fills of a saved play. Tracked plays are checked when opened and then every minute
 * while the tab is visible, so orders link and statuses move without the owner remembering to refresh.
 */
export function usePlayExecution(api: WorkspaceApi, playId: string | null, status?: string) {
  const [execution, setExecution] = useState<PlayExecution | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current = useRef<string | null>(playId)
  useEffect(() => { current.current = playId })

  const run = useCallback(async (action: (id: string) => Promise<PlayExecution>) => {
    const id = current.current
    if (!id) return
    setBusy(true)
    try {
      const next = await action(id)
      if (current.current === id) { setExecution(next); setError(null) }
    } catch (cause) {
      if (current.current === id) setError(failure(cause))
    } finally {
      if (current.current === id) setBusy(false)
    }
  }, [])

  const check = useCallback(() => run(id => api.checkPlayExecution(id)), [api, run])
  const link = useCallback((request: LinkOrder) => run(id => api.linkOrder(id, request)), [api, run])
  const unlink = useCallback((linkId: string) => run(id => api.unlinkOrder(id, linkId)), [api, run])

  const [loadedId, setLoadedId] = useState<string | null>(null)
  if (loadedId !== playId) {
    setLoadedId(playId)
    setExecution(null)
    setError(null)
  }

  useEffect(() => {
    if (!playId) return
    const controller = new AbortController()
    api.playExecution(playId, controller.signal).then(next => {
      if (controller.signal.aborted) return
      setExecution(next)
      if (active(next)) void check()
    }).catch(cause => { if (!controller.signal.aborted) setError(failure(cause)) })
    return () => controller.abort()
    // A status change (planning, resuming) can start tracking, so it reloads too.
  }, [api, playId, status, check])

  const tracking = active(execution)
  useEffect(() => {
    if (!tracking) return
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check() }, executionCheckInterval)
    return () => clearInterval(timer)
  }, [tracking, check])

  return { execution, error, busy, check, link, unlink }
}
