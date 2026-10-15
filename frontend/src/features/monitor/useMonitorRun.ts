import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountMonitor } from '@/api/monitor'
import type { WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/errors'

/** Stored-status reads while a run is pending or running, in case its completion event is missed. */
export const runPollInterval = 3_000
const runPollLimit = 40

// A newer attempt or a change of run state means the shown status is fresher than the failed request.
const progress = (monitor: AccountMonitor | null) => monitor ? `${monitor.manualState}|${monitor.lastAttemptAtUtc ?? ''}` : null

/** Admission and cooldown come from the server, including after unsuccessful attempts. */
export function useMonitorRun(api: WorkspaceApi, monitor: AccountMonitor | null, onChanged?: () => void) {
  const accountId = monitor?.accountId ?? null
  const [result, setResult] = useState<{ api: WorkspaceApi; signal: AbortSignal; source: AccountMonitor | null; monitor: AccountMonitor } | null>(null)
  const [request, setRequest] = useState<{ api: WorkspaceApi; signal: AbortSignal; accountId: string; busy: boolean; error: string | null; retryAtUtc?: string;
    unknownSource?: AccountMonitor | null; progress?: string | null } | null>(null)
  const session = useRef<{ api: WorkspaceApi; accountId: string | null; controller: AbortController; busy: boolean } | null>(null)
  const latest = useRef({ monitor, onChanged })
  useEffect(() => { latest.current = { monitor, onChanged } })
  useEffect(() => {
    const work = { api, accountId, controller: new AbortController(), busy: false }
    session.current = work
    return () => work.controller.abort()
  }, [api, accountId])
  const shown = result?.api === api && !result.signal.aborted && result.source === monitor ? result.monitor : monitor
  const currentRequest = request?.api === api && !request.signal.aborted && request.accountId === accountId ? request : null
  const check = useCallback(async () => {
    const work = session.current
    if (!work || work.api !== api || !accountId || work.accountId !== accountId || work.busy || work.controller.signal.aborted) return
    work.busy = true
    setRequest({ api, signal: work.controller.signal, accountId, busy: true, error: null })
    let error: string | null = null
    let retryAtUtc: string | undefined
    let statusUnknown = false
    let read: AccountMonitor | null = null
    const accept = (next: AccountMonitor) => {
      if (!work.controller.signal.aborted) setResult({ api, signal: work.controller.signal, source: latest.current.monitor, monitor: next })
    }
    try {
      const accepted = await api.runAccountMonitor(accountId, work.controller.signal)
      accept(accepted.monitor)
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : 'The monitor run was not confirmed. Read its status before retrying.'
      retryAtUtc = cause instanceof ApiError ? cause.retryAtUtc : undefined
    } finally {
      if (!work.controller.signal.aborted) {
        try { read = await api.accountMonitor(accountId, work.controller.signal); accept(read) } catch {
          statusUnknown = true
          error = `${error ? `${error} ` : ''}Monitor status could not be refreshed.`
        }
      }
      work.busy = false
      if (!work.controller.signal.aborted) {
        setRequest({ api, signal: work.controller.signal, accountId, busy: false, error, ...(retryAtUtc ? { retryAtUtc } : {}),
          ...(statusUnknown ? { unknownSource: latest.current.monitor } : {}), progress: progress(read) })
        latest.current.onChanged?.()
      }
    }
  }, [api, accountId])

  // The completion event normally ends pending/running. A bounded stored read covers a missed event.
  const active = !!shown && shown.manualState !== 'idle'
  useEffect(() => {
    const work = session.current
    if (!active || !accountId || !work || work.api !== api || work.accountId !== accountId) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, work.controller.signal])
    let polls = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = () => {
      timer = setTimeout(() => {
        polls++
        api.accountMonitor(accountId, signal).then(next => {
          if (signal.aborted) return
          setResult({ api, signal: work.controller.signal, source: latest.current.monitor, monitor: next })
          setRequest(current => current && current.api === api && current.accountId === accountId && !current.busy && current.error && !current.retryAtUtc
            ? { ...current, error: null } : current)
          if (next.manualState === 'idle') latest.current.onChanged?.()
          else if (polls < runPollLimit) poll()
        }).catch(() => { if (!signal.aborted && polls < runPollLimit) poll() })
      }, runPollInterval)
    }
    poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [api, accountId, active])

  // A 429 explains a cooldown; once that ends the message no longer applies.
  const retryAt = Date.parse(currentRequest?.retryAtUtc ?? '') || 0
  useEffect(() => {
    if (!retryAt) return
    const timer = setTimeout(() => setRequest(current => current && Date.parse(current.retryAtUtc ?? '') === retryAt
      ? { ...current, error: null } : current), Math.max(0, retryAt - Date.now()))
    return () => clearTimeout(timer)
  }, [retryAt])
  const stale = currentRequest?.progress != null && currentRequest.progress !== progress(shown)
  return { monitor: shown, check, busy: currentRequest?.busy ?? false, error: stale ? null : currentRequest?.error ?? null,
    retryAtUtc: currentRequest?.retryAtUtc, statusUnavailable: currentRequest?.unknownSource !== undefined && currentRequest.unknownSource === monitor }
}
