import { useEffect, useRef, useState } from 'react'
import type { WorkspaceApi } from '@/api/workspace'
import type { MonitorSummary } from '@/api/monitor'
import { ApiError } from '@/api/errors'
import { isAfter, isUnknownCursor, readHeadCursor, unknownCursor, type EventCursor } from '@/api/event-cursor'

/** Reconnect delays grow from 2 s to 60 s, with jitter so several tabs do not retry together. */
export function reconnectDelay(attempt: number, random = Math.random()) {
  const ceiling = Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1))
  return Math.round(ceiling * (0.5 + random / 2))
}
/** A stream that stays open this long, or delivers an event, ends the backoff. A ready-then-close loop does not. */
export const stableStream = 30_000
/** The server refuses a fifth stream per owner. After repeated refusals, retry rarely and say why. */
const refusalLimit = 3
const refusedRetry = 300_000

/**
 * One memory-only owner stream. All refreshes read stored state, never a venue.
 *
 * The head cursor is read first and `cursorReady` holds the shell's stored reads until then, so an event
 * committed after those reads is streamed from that cursor rather than skipped, without a second load.
 */
export function useMonitorEvents(api: WorkspaceApi, enabled: boolean, reload: () => void, generation: number) {
  const [head, setHead] = useState<{ api: WorkspaceApi; cursor: EventCursor | null } | null>(null)
  const [result, setResult] = useState<{ api: WorkspaceApi; summary: MonitorSummary } | null>(null)
  const [error, setError] = useState<{ api: WorkspaceApi; message: string } | null>(null)
  const [notice, setNotice] = useState<{ api: WorkspaceApi; message: string } | null>(null)
  const [healthGeneration, setHealthGeneration] = useState(0)
  // A new reload callback must not reopen the stream (and reset its cursor or backoff).
  const latestReload = useRef(reload)
  useEffect(() => { latestReload.current = reload })
  const currentHead = enabled && head?.api === api ? head : null
  const headKnown = currentHead !== null
  // Null when the head read failed: the stream then learns the head itself and reloads once.
  const start = currentHead ? currentHead.cursor ?? unknownCursor : null

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    Promise.resolve().then(() => readHeadCursor(api, controller.signal)).then(cursor => {
      if (!controller.signal.aborted) setHead({ api, cursor })
    }).catch(() => { if (!controller.signal.aborted) setHead({ api, cursor: null }) })
    return () => controller.abort()
  }, [api, enabled])

  useEffect(() => {
    if (!enabled || !headKnown) return
    const controller = new AbortController()
    Promise.resolve().then(() => api.monitor(controller.signal)).then(summary => {
      if (!controller.signal.aborted) { setResult({ api, summary }); setError(null) }
    }).catch(cause => {
      if (!controller.signal.aborted) setError({ api, message: cause instanceof ApiError ? cause.message : 'Monitor status is unavailable.' })
    })
    return () => controller.abort()
  }, [api, enabled, headKnown, generation, healthGeneration])

  useEffect(() => {
    if (!enabled || start === null) return
    const controller = new AbortController()
    let cursor = start
    let ready = false
    let failures = 0
    let refusals = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    let stable: ReturnType<typeof setTimeout> | undefined
    let debounce: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (controller.signal.aborted || debounce !== undefined) return
      debounce = setTimeout(() => {
        debounce = undefined
        if (!controller.signal.aborted) latestReload.current()
      }, 250)
    }
    const connect = async () => {
      let opened = false
      let refused = false
      let retryAt = 0
      try {
        await api.monitorStream(cursor, controller.signal, frame => {
          if (controller.signal.aborted) return
          if (!opened) {
            opened = true
            if (refusals) { refusals = 0; setNotice(null) }
            stable = setTimeout(() => { failures = 0 }, stableStream)
          }
          if (frame.type === 'status') {
            ready = true
            // Without a known head, stored reads may predate this stream: take its head and reload once.
            if (isUnknownCursor(cursor)) { cursor = frame.status.nextCursor; refresh(); return }
            // Ready only confirms the cursor; its catch-up events follow. A reset means stored state must reload.
            if (frame.status.state === 'reset') { cursor = frame.status.nextCursor; refresh() }
          } else {
            failures = 0
            // Each event frame names its own resume cursor; a reconnect resumes after the last one handled.
            if (isAfter(frame.cursor, cursor)) { cursor = frame.cursor; refresh() }
          }
        })
      } catch (cause) {
        // Stored reads remain available while the stream reconnects.
        refused = cause instanceof ApiError && cause.status === 429
        const at = cause instanceof ApiError && cause.retryAtUtc ? Date.parse(cause.retryAtUtc) : 0
        retryAt = Number.isFinite(at) ? at : 0
      }
      clearTimeout(stable)
      if (controller.signal.aborted) return
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
      clearTimeout(stable)
      clearTimeout(debounce)
      clearInterval(fallback)
    }
  }, [api, enabled, start])
  return {
    /** False until the head cursor is known (or could not be read); hold stored reads until then. */
    cursorReady: !enabled || headKnown,
    summary: enabled && result?.api === api ? result.summary : null,
    error: enabled && error?.api === api ? error.message : null,
    notice: enabled && notice?.api === api ? notice.message : null,
  }
}
