import { useEffect, useRef, useState } from 'react'
import type { WorkspaceApi } from '@/api/workspace'
import type { MonitorSummary } from '@/api/monitor'
import { ApiError } from '@/api/errors'

/**
 * A cursor beyond any retained sequence. The server answers it with a `reset` status naming the current
 * head, so a new subscription starts there instead of replaying the whole retained history.
 */
export const headCursor = '9223372036854775807'
/** Reconnect delays grow from 2 s to 60 s, with jitter so several tabs do not retry together. */
export function reconnectDelay(attempt: number, random = Math.random()) {
  const ceiling = Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1))
  return Math.round(ceiling * (0.5 + random / 2))
}
/** The server refuses a fifth stream per owner. After repeated refusals, retry rarely and say why. */
const refusalLimit = 3
const refusedRetry = 300_000

/** One memory-only owner stream. All refreshes read stored state, never a venue. */
export function useMonitorEvents(api: WorkspaceApi, enabled: boolean, reload: () => void, generation: number) {
  const [result, setResult] = useState<{ api: WorkspaceApi; summary: MonitorSummary } | null>(null)
  const [error, setError] = useState<{ api: WorkspaceApi; message: string } | null>(null)
  const [notice, setNotice] = useState<{ api: WorkspaceApi; message: string } | null>(null)
  const [healthGeneration, setHealthGeneration] = useState(0)
  // A new reload callback must not reopen the stream (and reset its cursor or refusal count).
  const latestReload = useRef(reload)
  useEffect(() => { latestReload.current = reload })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    Promise.resolve().then(() => api.monitor(controller.signal)).then(summary => {
      if (!controller.signal.aborted) { setResult({ api, summary }); setError(null) }
    }).catch(cause => {
      if (!controller.signal.aborted) setError({ api, message: cause instanceof ApiError ? cause.message : 'Monitor status is unavailable.' })
    })
    return () => controller.abort()
  }, [api, enabled, generation, healthGeneration])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let sequence = headCursor
    // The shell's own initial load is current, so the first head status does not reload it again.
    let initial = true
    let ready = false
    let failures = 0
    let refusals = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    let debounce: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (controller.signal.aborted || debounce !== undefined) return
      debounce = setTimeout(() => {
        debounce = undefined
        if (!controller.signal.aborted) latestReload.current()
      }, 250)
    }
    const connect = async () => {
      let refused = false
      let retryAt = 0
      try {
        await api.monitorStream(sequence, controller.signal, frame => {
          if (controller.signal.aborted) return
          failures = 0
          if (refusals) { refusals = 0; setNotice(null) }
          if (frame.type === 'status') {
            ready = true
            const head = sequence === headCursor
            // Ready can precede its catch-up page. Only delivered events advance that cursor.
            if (head || frame.status.state === 'reset') sequence = frame.status.nextSequence
            if (head && initial) { initial = false; return }
            refresh()
          } else if (sequence !== headCursor && BigInt(frame.event.sequence) > BigInt(sequence)) {
            sequence = frame.event.sequence
            refresh()
          }
        })
      } catch (cause) {
        // Stored reads remain available while the stream reconnects.
        refused = cause instanceof ApiError && cause.status === 429
        const at = cause instanceof ApiError && cause.retryAtUtc ? Date.parse(cause.retryAtUtc) : 0
        retryAt = Number.isFinite(at) ? at : 0
      }
      if (controller.signal.aborted) return
      // Events may have been committed while no stream was open, so a later head status reloads.
      initial = false
      ready = false
      failures++
      refusals = refused ? refusals + 1 : 0
      if (refusals >= refusalLimit) {
        setNotice({ api, message: 'Live monitor updates are paused because too many Vessel tabs or windows are open. Close the others; stored data still reloads every minute.' })
      }
      const delay = refusals >= refusalLimit ? refusedRetry : Math.max(reconnectDelay(failures), retryAt - Date.now())
      retry = setTimeout(() => { void connect() }, Math.min(delay, refusedRetry))
    }
    void connect()
    const fallback = setInterval(() => {
      if (ready) setHealthGeneration(value => value + 1)
      else refresh()
    }, 60_000)
    return () => {
      controller.abort()
      clearTimeout(retry)
      clearTimeout(debounce)
      clearInterval(fallback)
    }
  }, [api, enabled])
  return {
    summary: enabled && result?.api === api ? result.summary : null,
    error: enabled && error?.api === api ? error.message : null,
    notice: enabled && notice?.api === api ? notice.message : null,
  }
}
