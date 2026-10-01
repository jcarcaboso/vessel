import { useCallback, useEffect, useRef, useState } from 'react'
import type { MarketContext, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'

/** Venue header statistics, loaded once per instrument and refreshed manually with the chart. */
export function useMarketContext(api: WorkspaceApi, accountId: string, instrument: string) {
  const key = `${accountId}|${instrument}`
  const [state, setState] = useState<{ key: string; context: MarketContext | null; error: string | null }>({ key, context: null, error: null })
  const controller = useRef<AbortController | null>(null)
  if (state.key !== key) setState({ key, context: null, error: null })

  const load = useCallback(() => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    api.marketContext(accountId, instrument, abort.signal).then(context => {
      if (!abort.signal.aborted) setState({ key, context, error: null })
    }, (error: unknown) => {
      if (!abort.signal.aborted) setState(previous => ({ key, context: previous.key === key ? previous.context : null,
        error: error instanceof ApiError ? error.message : 'Market statistics could not be loaded.' }))
    })
  }, [api, accountId, instrument, key])

  useEffect(() => {
    load()
    return () => controller.current?.abort()
  }, [load])

  return { ...(state.key === key ? state : { context: null, error: null }), refresh: load }
}

const decimals = (value: string) => value.split('.')[1]?.length ?? 0
const grouped = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const groupedPrecise = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/** Display-only statistics derived from venue strings; not valuation or performance figures. */
export function describeMarket(context: MarketContext) {
  const mark = Number(context.markPrice)
  const previous = Number(context.previousDayPrice)
  const difference = mark - previous
  const places = Math.max(decimals(context.markPrice), decimals(context.previousDayPrice))
  const sign = difference > 0 ? '+' : difference < 0 ? '−' : ''
  const percent = previous > 0 ? Math.abs(difference / previous * 100).toFixed(2) : null
  return {
    direction: difference > 0 ? 'up' as const : difference < 0 ? 'down' as const : 'flat' as const,
    change: `${sign}${Math.abs(difference).toFixed(places)}${percent === null ? '' : ` / ${sign}${percent}%`}`,
    volume: grouped.format(Number(context.dayNotionalVolume)),
    openInterest: groupedPrecise.format(Number(context.openInterest)),
    funding: `${Number(context.fundingRate) < 0 ? '−' : ''}${Math.abs(Number(context.fundingRate) * 100).toFixed(4)}%`,
  }
}
