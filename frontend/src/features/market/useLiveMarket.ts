import { useEffect, useRef, useState } from 'react'
import type { CandleInterval, MarketContext, VenueCandle, WorkspaceApi } from '@/api/workspace'

export type LiveMarketState = 'off' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'stale'

/** Delays before reopening the stream after it ends or fails, by consecutive unstable attempt. */
export const reconnectDelays = [1_000, 2_000, 5_000, 10_000, 30_000] as const
/** Consecutive streams that end without delivering any event before REST polling takes over. */
export const failuresBeforePolling = 3
export const pollInterval = 15_000
export const pollingStreamRetry = 60_000
/** A stream that stayed open this long resets the backoff, so a scheduled server close reconnects quickly. */
export const stableStream = 60_000

export interface LiveMarketOptions {
  api: WorkspaceApi
  accountId: string
  instrument: string
  interval: CandleInterval
  /** The owner's Live preference. */
  enabled: boolean
  /** The first candle window has loaded; streaming starts only after it. */
  ready: boolean
  onCandle: (candle: VenueCandle, receivedAt: string) => void
  onContext: (context: MarketContext) => void
  refreshCandles: () => void
  refreshContext: () => void
}

interface Session { key: string; state: LiveMarketState; lastEventAt: string | null }

/**
 * Keeps a loaded chart current from the market stream: upserts candles, replaces statistics, reconnects with
 * backoff, falls back to REST polling, and pauses while the tab is hidden. Prices are observations, not fills.
 */
export function useLiveMarket(options: LiveMarketOptions) {
  const { api, accountId, instrument, interval, enabled, ready } = options
  const handlers = useRef(options)
  useEffect(() => { handlers.current = options })
  const key = `${accountId}|${instrument}|${interval}`
  const active = enabled && ready
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!active) return
    let disposed = false
    let controller: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let failures = 0
    let unstable = 0
    let polling = false
    let gapFill = false

    const publish = (state: LiveMarketState, eventAt?: string) => {
      if (disposed) return
      setSession(previous => {
        const lastEventAt = eventAt ?? (previous?.key === key ? previous.lastEventAt : null)
        return previous?.key === key && previous.state === state && previous.lastEventAt === lastEventAt ? previous : { key, state, lastEventAt }
      })
    }
    const hidden = () => document.visibilityState === 'hidden'
    const refreshAll = () => { handlers.current.refreshCandles(); handlers.current.refreshContext() }
    const clearRetry = () => { clearTimeout(retryTimer); retryTimer = undefined }
    const clearPoll = () => { clearInterval(pollTimer); pollTimer = undefined }

    const connect = () => {
      clearRetry()
      if (disposed || hidden()) return
      const abort = new AbortController()
      controller = abort
      const openedAt = Date.now()
      let received = false
      api.marketStream(accountId, { instrument, interval }, abort.signal, event => {
        if (disposed || abort.signal.aborted) return
        if (!received) {
          received = true
          failures = 0
          if (polling) { polling = false; clearPoll() }
          if (gapFill) { gapFill = false; handlers.current.refreshCandles() }
        }
        const now = new Date().toISOString()
        if (event.type === 'candle') { handlers.current.onCandle(event.candle, now); publish('live', now) }
        else if (event.type === 'context') { handlers.current.onContext(event.context); publish('live', now) }
        else publish(event.status.state)
      }).then(() => ended(abort, received, openedAt), () => ended(abort, received, openedAt))
    }

    const ended = (abort: AbortController, received: boolean, openedAt: number) => {
      if (disposed || abort.signal.aborted || controller !== abort) return
      controller = null
      gapFill = true
      failures = received ? 0 : failures + 1
      unstable = received && Date.now() - openedAt >= stableStream ? 1 : unstable + 1
      if (failures >= failuresBeforePolling) {
        if (!polling) {
          polling = true
          refreshAll()
          pollTimer = setInterval(refreshAll, pollInterval)
        }
        publish('polling')
        retryTimer = setTimeout(connect, pollingStreamRetry)
      } else {
        publish(polling ? 'polling' : 'reconnecting')
        retryTimer = setTimeout(connect, reconnectDelays[Math.min(unstable, reconnectDelays.length) - 1]!)
      }
    }

    const onVisibility = () => {
      if (hidden()) {
        clearRetry()
        clearPoll()
        const open = controller
        controller = null
        open?.abort()
        gapFill = true
      } else if (!controller && retryTimer === undefined) {
        gapFill = false
        refreshAll()
        if (polling) pollTimer = setInterval(refreshAll, pollInterval)
        connect()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    connect()
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      clearRetry()
      clearPoll()
      controller?.abort()
      setSession(null)
    }
  }, [active, api, accountId, instrument, interval, key])

  const current = enabled && session?.key === key ? session : null
  return {
    state: (enabled ? current?.state ?? 'connecting' : 'off') as LiveMarketState,
    lastEventAt: current?.lastEventAt ?? null,
  }
}
