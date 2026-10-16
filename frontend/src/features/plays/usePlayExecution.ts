import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkspaceApi } from '@/api/workspace'
import type { LinkOrder, PlayExecution } from '@/api/plays'
import { errorMessage } from '@/api/errors'

/** How often an open play view rereads its stored execution while the tab is visible. The read never contacts a venue. */
export const executionRefreshInterval = 60_000
/** After an accepted Check, how often and how many times the stored execution is reread until the worker finishes. */
export const checkPollInterval = 3_000
export const checkPollLimit = 40

const active = (execution: PlayExecution | null) =>
  !!execution?.tracked && ['planned', 'paused', 'open'].includes(execution.status)
const checking = (execution: PlayExecution) => execution.monitor?.manualState === 'pending' || execution.monitor?.manualState === 'running'
const replace = (next: PlayExecution) => next
const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
  const timer = setTimeout(done, ms)
  signal.addEventListener('abort', done, { once: true })
})

/** Requests belong to one API/Play/status session. Cancelling observation never rolls back a mutation. */
export function usePlayExecution(api: WorkspaceApi, playId: string | null, status?: string) {
  const session = useMemo(() => ({ api, playId, status, active: false, sequence: 0, applied: 0,
    requests: new Set<{ controller: AbortController | null }>() }), [api, playId, status])
  const [state, setState] = useState({ session, execution: null as PlayExecution | null, error: null as string | null, busy: false })

  const settled = useCallback((request: { controller: AbortController | null }) => {
    session.requests.delete(request)
    if (session.active) setState(current => current.session === session ? { ...current, busy: session.requests.size > 0 } : current)
  }, [session])

  const run = useCallback(async <T>(action: (id: string, signal?: AbortSignal) => Promise<T>, cancellable: boolean,
    apply: (next: T, current: PlayExecution | null) => PlayExecution | null) => {
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
      setState(current => ({ session, execution: apply(next, current.session === session ? current.execution : null), error: null,
        busy: session.requests.size > 0 }))
      return next
    } catch (cause) {
      if (currentRequest() && sequence >= session.applied) {
        // A newer error also supersedes older requests; they must not silently clear it.
        session.applied = sequence
        setState(current => ({ ...current, session, error: errorMessage(cause, 'The change could not be completed. Try again.') }))
      }
      return null
    } finally {
      settled(request)
    }
  }, [session, settled])

  /** A database-only read; `seen` receives the result even when a newer request already applied. */
  const read = useCallback((seen?: (next: PlayExecution) => void) =>
    run((id, signal) => api.playExecution(id, signal).then(next => { seen?.(next); return next }), true, replace), [api, run])

  // Check only asks the background worker. Busy stays on while bounded stored reads wait for it to finish.
  const check = useCallback(async () => {
    if (!session.active || !session.playId) return null
    const waiting = { controller: new AbortController() }
    const { signal } = waiting.controller
    // Registered before the request so busy does not drop between acceptance and the first read.
    session.requests.add(waiting)
    try {
      // An acceptance superseded by a newer result is still a queued run worth observing.
      const accepted = { value: false }
      await run((id, requestSignal) => api.checkPlayExecution(id, requestSignal).then(next => { accepted.value = true; return next }), true,
        (next, current) => current && { ...current, monitor: next.monitor })
      if (!accepted.value) return null
      let latest: PlayExecution | null = null
      for (let poll = 0; poll < checkPollLimit && !signal.aborted; poll++) {
        await wait(checkPollInterval, signal)
        if (signal.aborted || !session.active) break
        const seen: { next: PlayExecution | null } = { next: null }
        await read(next => { seen.next = next })
        if (!seen.next) break
        latest = seen.next
        if (!checking(latest)) break
      }
      return latest
    } finally {
      settled(waiting)
    }
  }, [api, run, read, session, settled])
  // These writes have no abort signal. A stale completion is ignored, not claimed to be undone.
  const link = useCallback((request: LinkOrder) => run(id => api.linkOrder(id, request), false, replace), [api, run])
  const unlink = useCallback((linkId: string) => run(id => api.unlinkOrder(id, linkId), false, replace), [api, run])

  // Opening a play only reads what is stored; it never requests a venue check.
  useEffect(() => {
    session.active = true
    void read()
    return () => {
      session.active = false
      for (const request of session.requests) request.controller?.abort()
      session.requests.clear()
    }
  }, [session, read])

  const execution = state.session === session ? state.execution : null
  const tracking = active(execution)
  useEffect(() => {
    if (!tracking) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && session.requests.size === 0) void read()
    }, executionRefreshInterval)
    return () => clearInterval(timer)
  }, [tracking, session, read])

  return { execution, error: state.session === session ? state.error : null, busy: state.session === session && state.busy, check, link, unlink }
}
