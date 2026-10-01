import type { ChartAdapter, ChartAdapterFactory, ChartCandle, PriceOverlay } from './types'

/** Loads the canvas renderer on first use and replays the latest inputs once it is ready. */
export const createLazyLightweightAdapter: ChartAdapterFactory = (container, callbacks) => {
  let adapter: ChartAdapter | null = null
  let destroyed = false
  let candles: readonly ChartCandle[] | null = null
  let overlays: readonly PriceOverlay[] | null = null
  void import('./lightweight').then(({ createLightweightAdapter }) => {
    if (destroyed) return
    adapter = createLightweightAdapter(container, callbacks)
    if (candles) adapter.setCandles(candles, true)
    if (overlays) adapter.setOverlays(overlays)
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
    destroy() {
      destroyed = true
      adapter?.destroy()
    },
  }
}
