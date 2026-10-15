import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountMonitor } from '@/api/monitor'
import type { WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/errors'

/** Admission and cooldown come from the server, including after unsuccessful attempts. */
export function useMonitorRun(api: WorkspaceApi, monitor: AccountMonitor | null, onChanged?: () => void) {
  const accountId = monitor?.accountId ?? null
  const [result, setResult] = useState<{ api: WorkspaceApi; signal: AbortSignal; source: AccountMonitor | null; monitor: AccountMonitor } | null>(null)
  const [request, setRequest] = useState<{ api: WorkspaceApi; signal: AbortSignal; accountId: string; busy: boolean; error: string | null; retryAtUtc?: string;
    unknownSource?: AccountMonitor | null } | null>(null)
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
        try { accept(await api.accountMonitor(accountId, work.controller.signal)) } catch {
          statusUnknown = true
          error = `${error ? `${error} ` : ''}Monitor status could not be refreshed.`
        }
      }
      work.busy = false
      if (!work.controller.signal.aborted) {
        setRequest({ api, signal: work.controller.signal, accountId, busy: false, error, ...(retryAtUtc ? { retryAtUtc } : {}),
          ...(statusUnknown ? { unknownSource: latest.current.monitor } : {}) })
        latest.current.onChanged?.()
      }
    }
  }, [api, accountId])
  return { monitor: shown, check, busy: currentRequest?.busy ?? false, error: currentRequest?.error ?? null,
    retryAtUtc: currentRequest?.retryAtUtc, statusUnavailable: currentRequest?.unknownSource !== undefined && currentRequest.unknownSource === monitor }
}
