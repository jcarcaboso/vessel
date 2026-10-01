import {
  CandlestickSeries, ColorType, CrosshairMode, createChart,
  type AutoscaleInfo, type IChartApi, type IPrimitivePaneRenderer, type IPrimitivePaneView, type ISeriesApi,
  type ISeriesPrimitive, type ISeriesPrimitiveAxisView, type LogicalRange, type PrimitiveHoveredItem,
  type SeriesAttachedParameter, type Time, type UTCTimestamp,
} from 'lightweight-charts'
import type { ChartAdapter, ChartAdapterFactory, ChartCandle, PriceOverlay } from './types'

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0]

interface ChartTheme {
  background: string
  foreground: string
  muted: string
  border: string
  grid: string
  labelInk: string
  font: string
  candleUp: string
  candleDown: string
  candleDownEdge: string
}

const hitTolerance = 6

function readTheme(element: HTMLElement): ChartTheme {
  const style = getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    background: token('--background', '#0f1114'),
    foreground: token('--foreground', '#e9edf2'),
    muted: token('--muted-foreground', '#abb3c0'),
    border: token('--border', '#394350'),
    grid: token('--secondary', '#1e2229'),
    labelInk: '#151c20',
    font: style.fontFamily || 'system-ui, sans-serif',
    // Monochrome candles keep red and green free for stops and targets.
    candleUp: token('--chart-candle-up', '#e9edf2'),
    candleDown: token('--chart-candle-down', '#050607'),
    candleDownEdge: token('--chart-candle-down-edge', '#9aa3b0'),
  }
}

/** Resolves `var(--token)` colors against the chart container. */
function colorResolver(element: HTMLElement) {
  const cache = new Map<string, string>()
  return (color: string) => {
    const name = /^var\((--[\w-]+)\)$/.exec(color.trim())?.[1]
    if (!name) return color
    if (!cache.has(name)) cache.set(name, getComputedStyle(element).getPropertyValue(name).trim() || '#abb3c0')
    return cache.get(name)!
  }
}

/** Decimal places needed to show the loaded prices without rounding them away. */
export function pricePrecision(candles: readonly ChartCandle[]) {
  let precision = 0
  for (const candle of candles.slice(-200)) {
    for (const value of [candle.open, candle.high, candle.low, candle.close]) {
      const text = String(value)
      if (text.includes('e')) return 8
      precision = Math.max(precision, text.split('.')[1]?.length ?? 0)
    }
  }
  return Math.min(precision, 8)
}

/** Draws planned levels on the main pane and price axis, and reports hits for selection and dragging. */
class LevelsPrimitive implements ISeriesPrimitive<Time> {
  private overlays: readonly PriceOverlay[] = []
  private axisViews: readonly ISeriesPrimitiveAxisView[] = []
  private series: ISeriesApi<'Candlestick'> | null = null
  private requestUpdate: (() => void) | null = null
  private readonly views: readonly IPrimitivePaneView[]

  constructor(private readonly theme: ChartTheme, private readonly resolve: (color: string) => string) {
    this.views = [{ zOrder: () => 'top', renderer: () => ({ draw: target => this.draw(target) }) }]
  }

  attached({ series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.series = series as ISeriesApi<'Candlestick'>
    this.requestUpdate = requestUpdate
  }

  detached() {
    this.series = null
    this.requestUpdate = null
  }

  set(overlays: readonly PriceOverlay[]) {
    // Selected levels are drawn last so they stay on top of overlapping aggregate levels.
    this.overlays = [...overlays]
      .sort((a, b) => Number(a.emphasis === 'selected') - Number(b.emphasis === 'selected'))
      .map(overlay => ({ ...overlay, color: this.resolve(overlay.color), ...(overlay.accent ? { accent: this.resolve(overlay.accent) } : {}) }))
    this.axisViews = this.overlays.map(overlay => ({
      coordinate: () => this.y(overlay.price) ?? -1000,
      text: () => this.series?.priceFormatter().format(overlay.price) ?? String(overlay.price),
      textColor: () => this.theme.labelInk,
      backColor: () => overlay.color,
    }))
    this.requestUpdate?.()
  }

  find(id: string) {
    return this.overlays.find(overlay => overlay.id === id)
  }

  /** Nearest level within the hit tolerance, preferring the selected entry's levels. */
  levelAt(y: number) {
    let best: { overlay: PriceOverlay; distance: number } | null = null
    for (const overlay of this.overlays) {
      const levelY = this.y(overlay.price)
      if (levelY === null) continue
      const distance = Math.abs(levelY - y)
      if (distance > hitTolerance) continue
      if (!best || distance < best.distance || distance === best.distance && overlay.emphasis === 'selected') best = { overlay, distance }
    }
    return best
  }

  paneViews() { return this.views }
  priceAxisViews() { return this.axisViews }
  updateAllViews() { /* Coordinates are resolved while drawing. */ }

  autoscaleInfo(): AutoscaleInfo | null {
    if (!this.overlays.length) return null
    const prices = this.overlays.map(overlay => overlay.price)
    return { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } }
  }

  hitTest(_x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.levelAt(y)
    return hit ? {
      externalId: hit.overlay.id, zOrder: 'top', distance: hit.distance, hitTestPriority: 1,
      cursorStyle: hit.overlay.draggable ? 'ns-resize' : 'pointer',
    } : null
  }

  private y(price: number) {
    return this.series?.priceToCoordinate(price) ?? null
  }

  private draw(target: DrawTarget) {
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio: h, verticalPixelRatio: v }) => {
      context.save()
      context.font = `600 ${Math.round(10 * v)}px ${this.theme.font}`
      context.textBaseline = 'middle'
      for (const overlay of this.overlays) {
        const y = this.y(overlay.price)
        if (y === null) continue
        const selected = overlay.emphasis === 'selected'
        const lineWidth = Math.max(1, Math.round((selected ? 2 : 1) * v))
        const lineY = Math.round(y * v) + (lineWidth % 2 ? 0.5 : 0)
        context.globalAlpha = selected || overlay.kind === 'reference' ? 1 : 0.72
        context.strokeStyle = overlay.color
        context.lineWidth = lineWidth
        context.setLineDash(overlay.kind === 'entry' ? [] : overlay.kind === 'stop' ? [2 * h, 3 * h]
          : overlay.kind === 'reference' ? [10 * h, 3 * h, 2 * h, 3 * h] : [7 * h, 4 * h])
        context.beginPath()
        context.moveTo(0, lineY)
        context.lineTo(bitmapSize.width, lineY)
        context.stroke()
        context.setLineDash([])

        const padding = 5 * h
        const tagHeight = Math.round(16 * v)
        const marker = overlay.accent && overlay.accent !== overlay.color ? Math.round(4 * h) : 0
        const tagWidth = Math.ceil(context.measureText(overlay.label).width + padding * 2 + marker)
        const tagX = Math.round(8 * h)
        const tagY = Math.round(lineY - tagHeight / 2)
        context.fillStyle = overlay.color
        context.fillRect(tagX, tagY, tagWidth, tagHeight)
        if (marker) {
          context.fillStyle = overlay.accent!
          context.fillRect(tagX, tagY, marker, tagHeight)
        }
        context.fillStyle = this.theme.labelInk
        context.fillText(overlay.label, tagX + marker + padding, lineY)

        if (overlay.draggable) {
          context.globalAlpha = 1
          context.beginPath()
          context.arc(bitmapSize.width - 22 * h, lineY, 4.5 * h, 0, Math.PI * 2)
          context.fillStyle = overlay.color
          context.fill()
          context.lineWidth = Math.max(1, Math.round(2 * h))
          context.strokeStyle = this.theme.background
          context.stroke()
        }
      }
      context.restore()
    })
  }
}

export const createLightweightAdapter: ChartAdapterFactory = (container, callbacks) => {
  const theme = readTheme(container)
  const chart: IChartApi = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: theme.background }, textColor: theme.muted,
      fontFamily: theme.font, fontSize: 11, attributionLogo: true,
    },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    rightPriceScale: { borderColor: theme.border },
    timeScale: { borderColor: theme.border, timeVisible: true, secondsVisible: false },
    crosshair: { mode: CrosshairMode.Normal },
  })
  const series = chart.addSeries(CandlestickSeries, {
    upColor: theme.candleUp, downColor: theme.candleDown,
    borderUpColor: theme.candleUp, borderDownColor: theme.candleDownEdge,
    wickUpColor: theme.candleUp, wickDownColor: theme.candleDownEdge,
    borderVisible: true,
  })
  const levels = new LevelsPrimitive(theme, colorResolver(container))
  series.attachPrimitive(levels)
  let candleCount = 0

  chart.subscribeClick(event => {
    if (typeof event.hoveredObjectId === 'string' && levels.find(event.hoveredObjectId)) callbacks.onLevelSelect(event.hoveredObjectId)
  })
  const onRange = (range: LogicalRange | null) => {
    if (range && candleCount > 0 && range.from < 15) callbacks.onNeedOlder()
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)

  // Dragging is handled before the chart sees the pointer, so panning stays off while a level moves.
  let drag: { id: string; pointerId: number; price: number; moved: boolean } | null = null
  const paneY = (event: PointerEvent) => event.clientY - container.getBoundingClientRect().top
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return
    const x = event.clientX - container.getBoundingClientRect().left
    if (x > chart.timeScale().width()) return
    const hit = levels.levelAt(paneY(event))
    if (!hit?.overlay.draggable) return
    event.preventDefault()
    event.stopPropagation()
    drag = { id: hit.overlay.id, pointerId: event.pointerId, price: hit.overlay.price, moved: false }
    container.setPointerCapture?.(event.pointerId)
    chart.applyOptions({ handleScroll: false, handleScale: false })
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const price = series.coordinateToPrice(paneY(event))
    if (price === null || !Number.isFinite(price) || price <= 0) return
    drag.price = price
    drag.moved = true
    callbacks.onLevelDrag(drag.id, price, 'move')
  }
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.stopPropagation()
    const finished = drag
    drag = null
    container.releasePointerCapture?.(event.pointerId)
    chart.applyOptions({ handleScroll: true, handleScale: true })
    if (finished.moved) callbacks.onLevelDrag(finished.id, finished.price, 'end')
    else callbacks.onLevelSelect(finished.id)
  }
  container.addEventListener('pointerdown', onPointerDown, true)
  container.addEventListener('pointermove', onPointerMove, true)
  container.addEventListener('pointerup', endDrag, true)
  container.addEventListener('pointercancel', endDrag, true)

  const adapter: ChartAdapter = {
    setCandles(candles, reset) {
      candleCount = candles.length
      const precision = pricePrecision(candles)
      series.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } })
      series.setData(candles.map(candle => ({
        time: Math.floor(candle.time / 1000) as UTCTimestamp,
        open: candle.open, high: candle.high, low: candle.low, close: candle.close,
      })))
      if (reset) {
        chart.priceScale('right').applyOptions({ autoScale: true })
        chart.timeScale().scrollToRealTime()
      }
    },
    setOverlays(overlays) {
      levels.set(overlays)
    },
    destroy() {
      container.removeEventListener('pointerdown', onPointerDown, true)
      container.removeEventListener('pointermove', onPointerMove, true)
      container.removeEventListener('pointerup', endDrag, true)
      container.removeEventListener('pointercancel', endDrag, true)
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
      chart.remove()
    },
  }
  return adapter
}
