import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkspaceApi } from '@/api/workspace'
import type { LinkOrder, PlayExecution } from '@/api/plays'
import { errorMessage } from '@/api/errors'

/** How often an open play view checks the venue while the tab is visible. */
export const executionCheckInterval = 60_000

const active = (execution: PlayExecution | null) =>
  !!execution?.tracked && ['planned', 'paused', 'open'].includes(execution.status)

/** Requests belong to one API/Play/status session. Cancelling observation never rolls back a mutation. */
export function usePlayExecution(api: WorkspaceApi, playId: string | null, status?: string) {
  const session = useMemo(() => ({ api, playId, status, active: false, sequence: 0, applied: 0,
    requests: new Set<{ controller: AbortController | null }>() }), [api, playId, status])
  const [state, setState] = useState({ session, execution: null as PlayExecution | null, error: null as string | null, busy: false })

  const run = useCallback(async (action: (id: string, signal?: AbortSignal) => Promise<PlayExecution>, cancellable: boolean) => {
    if (!session.active || !session.playId) return null
    const sequence = ++session.sequence
    const controller = cancellable ? new AbortController() : null
    const request = { controller }
    session.requests.add(request)
    setState(current => ({ ...(current.session === session ? current : { session, execution: null, error: null }), busy: true }))
    const currentRequest = () => session.active && session.requests.has(request) && !controller?.signal.aborted
    try {
      const next = await action(session.playId, controller?.signal)
      if (!currentRequest() || sequence < session.applied) return null
      session.applied = sequence
      setState({ session, execution: next, error: null, busy: session.requests.size > 0 })
      return next
    } catch (cause) {
      if (currentRequest() && sequence >= session.applied) {
        // A newer error also supersedes older requests; they must not silently clear it.
        session.applied = sequence
        setState(current => ({ ...current, session, error: errorMessage(cause, 'The change could not be completed. Try again.') }))
      }
      return null
    } finally {
      session.requests.delete(request)
      if (session.active) setState(current => current.session === session ? { ...current, busy: session.requests.size > 0 } : current)
    }
  }, [session])

  const check = useCallback(() => run((id, signal) => api.checkPlayExecution(id, signal), true), [api, run])
  // These writes have no abort signal. A stale completion is ignored, not claimed to be undone.
  const link = useCallback((request: LinkOrder) => run(id => api.linkOrder(id, request), false), [api, run])
  const unlink = useCallback((linkId: string) => run(id => api.unlinkOrder(id, linkId), false), [api, run])

  useEffect(() => {
    session.active = true
    const initialSequence = session.sequence + 1
    void run((id, signal) => api.playExecution(id, signal), true).then(next => {
      if (session.active && session.applied === initialSequence && session.requests.size === 0 && active(next)) void check()
    })
    return () => {
      session.active = false
      for (const request of session.requests) request.controller?.abort()
      session.requests.clear()
    }
  }, [api, session, run, check])

  const execution = state.session === session ? state.execution : null
  const tracking = active(execution)
  useEffect(() => {
    if (!tracking) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && session.requests.size === 0) void check()
    }, executionCheckInterval)
    return () => clearInterval(timer)
  }, [tracking, session, check])

  return { execution, error: state.session === session ? state.error : null, busy: state.session === session && state.busy, check, link, unlink }
}
