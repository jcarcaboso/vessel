import { useEffect, useState } from 'react'
import type { WorkspaceApi } from '@/api/workspace'
import type { MonitorSummary } from '@/api/monitor'
import { ApiError } from '@/api/errors'

/** One memory-only owner stream. All refreshes read stored state, never a venue. */
export function useMonitorEvents(api: WorkspaceApi, enabled: boolean, reload: () => void, generation: number) {
  const [result, setResult] = useState<{ api: WorkspaceApi; summary: MonitorSummary } | null>(null)
  const [error, setError] = useState<{ api: WorkspaceApi; message: string } | null>(null)
  const [healthGeneration, setHealthGeneration] = useState(0)
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
    let sequence = '0'
    let ready = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let debounce: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (controller.signal.aborted || debounce !== undefined) return
      debounce = setTimeout(() => {
        debounce = undefined
        if (!controller.signal.aborted) reload()
      }, 250)
    }
    const connect = async () => {
      try {
        await api.monitorStream(sequence, controller.signal, frame => {
          if (controller.signal.aborted) return
          if (frame.type === 'status') {
            ready = true
            // Ready can precede its catch-up page. Only delivered events advance that cursor.
            if (frame.status.state === 'reset') sequence = frame.status.nextSequence
            refresh()
          } else if (BigInt(frame.event.sequence) > BigInt(sequence)) {
            sequence = frame.event.sequence
            refresh()
          }
        })
      } catch { /* Stored reads remain available while the stream reconnects. */ }
      if (!controller.signal.aborted) {
        ready = false
        retry = setTimeout(() => { void connect() }, 5_000)
      }
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
  }, [api, enabled, reload])
  return {
    summary: enabled && result?.api === api ? result.summary : null,
    error: enabled && error?.api === api ? error.message : null,
  }
}
