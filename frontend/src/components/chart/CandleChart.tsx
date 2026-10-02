import { useEffect, useImperativeHandle, useRef, type KeyboardEvent, type Ref } from 'react'
import type { ChartDrawing, DrawingKind } from './drawings'
import { createLazyLightweightAdapter } from './lazy'
import type { ChartAdapter, ChartAdapterFactory, ChartCallbacks, ChartCandle, PriceOverlay } from './types'
import './chart.css'

const noDrawings: readonly ChartDrawing[] = []

/** Imperative actions for the feature that owns the chart. */
export interface CandleChartControl {
  capture(caption: string): Promise<Blob | null>
}

/**
 * Reusable candle chart. Features supply candles, price overlays and drawings; the renderer stays
 * behind the adapter so it never sees plays, journals or execution data.
 */
export function CandleChart({
  candles, overlays, viewKey, label, drawings = noDrawings, selectedDrawingId = null, tool = null, magnet = false,
  onKeyDown, createAdapter = createLazyLightweightAdapter, controlRef, ...handlers
}: {
  candles: readonly ChartCandle[]
  overlays: readonly PriceOverlay[]
  /** Changing the key (instrument, interval) re-anchors the view at the latest candle. */
  viewKey: string
  label: string
  drawings?: readonly ChartDrawing[]
  selectedDrawingId?: string | null
  tool?: DrawingKind | null
  magnet?: boolean
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  createAdapter?: ChartAdapterFactory
  controlRef?: Ref<CandleChartControl>
} & { [K in keyof ChartCallbacks]?: ChartCallbacks[K] | undefined }) {
  const container = useRef<HTMLDivElement>(null)
  const adapter = useRef<ChartAdapter | null>(null)
  const shownKey = useRef<string | null>(null)
  const callbacks = useRef(handlers)
  useEffect(() => { callbacks.current = handlers })
  useImperativeHandle(controlRef, () => ({
    capture: caption => adapter.current?.capture(caption) ?? Promise.resolve(null),
  }), [])

  useEffect(() => {
    const created = createAdapter(container.current!, {
      onLevelSelect: id => callbacks.current.onLevelSelect?.(id),
      onLevelDrag: (id, price, phase) => callbacks.current.onLevelDrag?.(id, price, phase),
      onNeedOlder: () => callbacks.current.onNeedOlder?.(),
      onDrawingCreate: drawing => callbacks.current.onDrawingCreate?.(drawing),
      onDrawingChange: (drawing, phase) => callbacks.current.onDrawingChange?.(drawing, phase),
      onDrawingSelect: id => callbacks.current.onDrawingSelect?.(id),
      onLevelEdit: (id, anchor) => callbacks.current.onLevelEdit?.(id, anchor),
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
  useEffect(() => { adapter.current?.setDrawings(drawings, selectedDrawingId) }, [drawings, selectedDrawingId, createAdapter])
  useEffect(() => { adapter.current?.setDrawingTool(tool, magnet) }, [tool, magnet, createAdapter])

  // Focusable so Delete, Escape and undo shortcuts reach the feature while the pointer works on the canvas.
  return <div ref={container} className="candle-chart" role="application" aria-roledescription="chart" aria-label={label}
    tabIndex={0} onKeyDown={onKeyDown} />
}
