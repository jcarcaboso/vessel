import type { ChartDrawing, DrawingKind } from './drawings'
import type { ChartAdapter, ChartAdapterFactory, ChartCandle, PriceOverlay } from './types'

/** Loads the canvas renderer on first use and replays the latest inputs once it is ready. */
export const createLazyLightweightAdapter: ChartAdapterFactory = (container, callbacks) => {
  let adapter: ChartAdapter | null = null
  let destroyed = false
  let candles: readonly ChartCandle[] | null = null
  let overlays: readonly PriceOverlay[] | null = null
  let drawings: [readonly ChartDrawing[], string | null] | null = null
  let tool: [DrawingKind | null, boolean] | null = null
  void import('./lightweight').then(({ createLightweightAdapter }) => {
    if (destroyed) return
    adapter = createLightweightAdapter(container, callbacks)
    if (candles) adapter.setCandles(candles, true)
    if (overlays) adapter.setOverlays(overlays)
    if (drawings) adapter.setDrawings(...drawings)
    if (tool) adapter.setDrawingTool(...tool)
  })
  return {
    setCandles(next, reset) {
      if (adapter) adapter.setCandles(next, reset)
      else candles = next
    },
    setOverlays(next) {
      if (adapter) adapter.setOverlays(next)
      else overlays = next
    },
    setDrawings(next, selectedId) {
      if (adapter) adapter.setDrawings(next, selectedId)
      else drawings = [next, selectedId]
    },
    setDrawingTool(next, magnet) {
      if (adapter) adapter.setDrawingTool(next, magnet)
      else tool = [next, magnet]
    },
    destroy() {
      destroyed = true
      adapter?.destroy()
    },
  }
}
