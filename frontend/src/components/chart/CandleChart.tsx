import { useEffect, useRef } from 'react'
import { createLazyLightweightAdapter } from './lazy'
import type { ChartAdapter, ChartAdapterFactory, ChartCallbacks, ChartCandle, PriceOverlay } from './types'
import './chart.css'

/**
 * Reusable candle chart. Features supply candles and price overlays; the renderer stays behind
 * the adapter so it never sees plays, journals or execution data.
 */
export function CandleChart({ candles, overlays, viewKey, label, onLevelSelect, onLevelDrag, onNeedOlder, createAdapter = createLazyLightweightAdapter }: {
  candles: readonly ChartCandle[]
  overlays: readonly PriceOverlay[]
  /** Changing the key (instrument, interval) re-anchors the view at the latest candle. */
  viewKey: string
  label: string
  createAdapter?: ChartAdapterFactory
} & Partial<ChartCallbacks>) {
  const container = useRef<HTMLDivElement>(null)
  const adapter = useRef<ChartAdapter | null>(null)
  const shownKey = useRef<string | null>(null)
  const callbacks = useRef<{ [K in keyof ChartCallbacks]?: ChartCallbacks[K] | undefined }>({})
  useEffect(() => { callbacks.current = { onLevelSelect, onLevelDrag, onNeedOlder } })

  useEffect(() => {
    const created = createAdapter(container.current!, {
      onLevelSelect: id => callbacks.current.onLevelSelect?.(id),
      onLevelDrag: (id, price, phase) => callbacks.current.onLevelDrag?.(id, price, phase),
      onNeedOlder: () => callbacks.current.onNeedOlder?.(),
    })
    adapter.current = created
    shownKey.current = null
    return () => {
      created.destroy()
      adapter.current = null
    }
  }, [createAdapter])

  useEffect(() => {
    const reset = shownKey.current !== viewKey
    adapter.current?.setCandles(candles, reset)
    if (candles.length) shownKey.current = viewKey
  }, [candles, viewKey, createAdapter])

  useEffect(() => { adapter.current?.setOverlays(overlays) }, [overlays, createAdapter])

  return <div ref={container} className="candle-chart" role="img" aria-label={label} />
}
