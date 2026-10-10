import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CandleInterval, VenueCandle, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import type { ChartCandle } from '@/components/chart/types'

export interface CandleSource {
  api: WorkspaceApi
  accountId: string
  instrument: string
  interval: CandleInterval
}

export interface CandleState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  /** Older history could not be loaded; the already loaded candles remain visible. */
  olderError: string | null
  retrievedAt: string | null
  notice: string | null
  historyExhausted: boolean
  loadingOlder: boolean
  refreshing: boolean
}

const initial: CandleState = {
  status: 'loading', error: null, olderError: null, retrievedAt: null, notice: null,
  historyExhausted: false, loadingOlder: false, refreshing: false,
}

const message = (error: unknown) => error instanceof ApiError ? error.message : 'Candles could not be loaded.'

/** Merges by open time; later reads replace earlier values for the same candle. */
export function mergeCandles(current: readonly VenueCandle[], incoming: readonly VenueCandle[]) {
  const byTime = new Map(current.map(candle => [candle.openTime, candle]))
  for (const candle of incoming) byTime.set(candle.openTime, candle)
  return [...byTime.values()].sort((a, b) => a.openTime - b.openTime)
}

export const toChartCandle = (candle: VenueCandle): ChartCandle => ({
  time: candle.openTime, open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close),
  volume: Number(candle.volume),
})

/** Upserts one candle by open time; the common live cases (same or next candle) avoid a full merge. */
export function upsertCandle(current: readonly VenueCandle[], candle: VenueCandle) {
  const last = current.at(-1)
  if (!last || candle.openTime > last.openTime) return [...current, candle]
  if (candle.openTime === last.openTime) return [...current.slice(0, -1), candle]
  return mergeCandles(current, [candle])
}

/**
 * Loads a bounded window of venue candles, then older windows on demand. Refresh is manual or driven by
 * the live market hook, which also upserts streamed candles without resetting the view.
 */
export function useCandles(source: CandleSource) {
  const { api, accountId, instrument, interval } = source
  const key = `${accountId}|${instrument}|${interval}`
  const [state, setState] = useState<CandleState & { key: string }>({ ...initial, key })
  const [venueCandles, setVenueCandles] = useState<{ key: string; candles: VenueCandle[] }>({ key, candles: [] })
  const current = useRef({ key, candles: [] as VenueCandle[], busy: false })
  const controller = useRef<AbortController | null>(null)

  if (state.key !== key) setState({ ...initial, key })
  if (venueCandles.key !== key) setVenueCandles({ key, candles: [] })

  const commit = useCallback((candles: VenueCandle[], patch: Partial<CandleState>) => {
    current.current.candles = candles
    setVenueCandles({ key, candles })
    setState(previous => previous.key === key ? { ...previous, ...patch } : previous)
  }, [key])

  const load = useCallback((mode: 'initial' | 'refresh' | 'older') => {
    if (mode === 'older' && current.current.busy) return
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    current.current.busy = true
    const oldest = current.current.candles[0]?.openTime
    const endTime = mode === 'older' && oldest !== undefined ? oldest - 1 : undefined
    setState(previous => previous.key !== key ? previous : mode === 'older' ? { ...previous, loadingOlder: true, olderError: null } :
      mode === 'refresh' ? { ...previous, refreshing: true, loadingOlder: false, error: null } : previous)
    api.candles(accountId, { instrument, interval, ...(endTime !== undefined ? { endTime } : {}) }, abort.signal).then(series => {
      if (abort.signal.aborted || current.current.key !== key) return
      const merged = mode === 'initial' ? series.candles : mergeCandles(current.current.candles, series.candles)
      commit(merged, {
        status: 'ready', error: null, notice: series.notice, loadingOlder: false, refreshing: false,
        ...(mode === 'older' ? { historyExhausted: series.historyExhausted } : { retrievedAt: series.retrievedAt }),
        ...(mode === 'initial' ? { historyExhausted: series.historyExhausted } : {}),
      })
    }, (error: unknown) => {
      if (abort.signal.aborted || current.current.key !== key) return
      setState(previous => previous.key !== key ? previous : mode === 'older'
        ? { ...previous, loadingOlder: false, olderError: message(error) }
        : { ...previous, status: current.current.candles.length ? 'ready' : 'error', refreshing: false, error: message(error) })
    }).finally(() => {
      if (controller.current === abort) current.current.busy = false
    })
  }, [api, accountId, instrument, interval, key, commit])

  useEffect(() => {
    current.current = { key, candles: [], busy: false }
    load('initial')
    return () => controller.current?.abort()
  }, [key, load])

  /** Applies a streamed candle to the loaded series. Ignored until the first window has loaded. */
  const upsert = useCallback((candle: VenueCandle, receivedAt: string) => {
    if (current.current.key !== key || !current.current.candles.length) return
    commit(upsertCandle(current.current.candles, candle), { retrievedAt: receivedAt })
  }, [key, commit])
  const refresh = useCallback(() => load('refresh'), [load])

  const candles = useMemo(() => venueCandles.key === key ? venueCandles.candles.map(toChartCandle) : [], [venueCandles, key])
  const visible = state.key === key ? state : { ...initial, key }
  return {
    ...visible,
    candles,
    refresh,
    upsert,
    loadOlder: () => {
      if (!visible.historyExhausted && !visible.loadingOlder && !visible.olderError && candles.length) load('older')
    },
    retryOlder: () => load('older'),
  }
}
