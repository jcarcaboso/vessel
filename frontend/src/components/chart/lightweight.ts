import {
  CandlestickSeries, ColorType, CrosshairMode, createChart,
  type AutoscaleInfo, type IChartApi, type IPrimitivePaneRenderer, type IPrimitivePaneView, type ISeriesApi,
  type ISeriesPrimitive, type ISeriesPrimitiveAxisView, type Logical, type LogicalRange, type PrimitiveHoveredItem,
  type SeriesAttachedParameter, type Time, type UTCTimestamp,
} from 'lightweight-charts'
import { DrawingController, type DrawingSpace, type DrawingTheme } from './drawingController'
import { TimeIndex, snapPrice } from './drawings'
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
  drawing: string
  positive: string
  negative: string
  card: string
}

const hitTolerance = 6
/** Levels within ±50% of the latest close widen the price scale; farther ones stay off-scale. */
const autoscaleReach = 0.5
/** Media-pixel area that Lightweight Charts uses for its attribution logo. */
const logoZone = { width: 60, height: 46 }

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
    drawing: token('--chart-drawing', '#8fb8ff'),
    positive: token('--positive', '#a9d6b6'),
    negative: token('--negative', '#f2b3ac'),
    card: token('--card', '#171a1f'),
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
  /** Last drawn label tags in pane pixels, for click-to-edit. */
  private tags: { id: string; left: number; right: number; top: number; bottom: number }[] = []

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

  /** Level whose tag contains the point, if any. */
  tagAt(x: number, y: number) {
    const tag = [...this.tags].reverse().find(item => x >= item.left && x <= item.right && y >= item.top && y <= item.bottom)
    return tag ? { overlay: this.find(tag.id)!, x: tag.right, y: (tag.top + tag.bottom) / 2 } : null
  }

  paneViews() { return this.views }
  priceAxisViews() { return this.axisViews }
  updateAllViews() { /* Coordinates are resolved while drawing. */ }

  /** Latest close; levels far from it are left out of autoscaling so a mismatched plan cannot flatten the candles. */
  reference: number | null = null

  autoscaleInfo(): AutoscaleInfo | null {
    const reference = this.reference
    const prices = this.overlays.map(overlay => overlay.price)
      .filter(price => reference === null || Math.abs(price / reference - 1) <= autoscaleReach)
    if (!prices.length) return null
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
      const tags: typeof this.tags = []
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
        const tagY = Math.round(lineY - tagHeight / 2)
        // Keep tags clear of the required TradingView attribution in the bottom-left corner.
        const inLogoZone = tagY + tagHeight > bitmapSize.height - logoZone.height * v
        const tagX = Math.round((inLogoZone ? logoZone.width : 8) * h)
        context.fillStyle = overlay.color
        context.fillRect(tagX, tagY, tagWidth, tagHeight)
        if (marker) {
          context.fillStyle = overlay.accent!
          context.fillRect(tagX, tagY, marker, tagHeight)
        }
        context.fillStyle = this.theme.labelInk
        context.fillText(overlay.label, tagX + marker + padding, lineY)
        if (overlay.kind !== 'reference') tags.push({ id: overlay.id, left: tagX / h, right: (tagX + tagWidth) / h, top: tagY / v, bottom: (tagY + tagHeight) / v })

        // Handles mark the selected entry; other entries' levels still drag from the line.
        if (overlay.draggable && selected) {
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
      this.tags = tags
      context.restore()
    })
  }
}

/** Paints user drawings on the chart canvas (so captures include them) and reports hover cursors. */
class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  controller: DrawingController | null = null
  requestUpdate: () => void = () => {}
  private readonly views: readonly IPrimitivePaneView[]

  constructor(private readonly theme: DrawingTheme) {
    this.views = [{ renderer: () => ({ draw: target => target.useMediaCoordinateSpace(({ context }) => this.controller?.render(context, this.theme)) }) }]
  }

  attached({ requestUpdate }: SeriesAttachedParameter<Time>) { this.requestUpdate = requestUpdate }
  detached() { this.requestUpdate = () => {} }
  paneViews() { return this.views }
  updateAllViews() { /* Coordinates are resolved while drawing. */ }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const cursor = this.controller?.cursor(x, y)
    return cursor ? { externalId: 'drawing', zOrder: 'normal', cursorStyle: cursor, hitTestPriority: 2 } : null
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
  let loaded: readonly ChartCandle[] = []
  let index = new TimeIndex([])

  const space: DrawingSpace = {
    x: time => {
      const logical = index.logical(time)
      return logical === null ? null : chart.timeScale().logicalToCoordinate(logical as Logical)
    },
    y: price => series.priceToCoordinate(price),
    point: (x, y, snap) => {
      const logical = chart.timeScale().coordinateToLogical(x)
      const price = series.coordinateToPrice(y)
      if (logical === null || price === null || !Number.isFinite(price) || price <= 0) return null
      const candle = snap ? loaded[index.candleIndex(logical) ?? -1] : undefined
      if (candle) return { time: candle.time, price: snapPrice(candle, price) }
      const time = index.time(logical)
      return time === null ? null : { time, price }
    },
    width: () => chart.timeScale().width(),
    formatPrice: price => series.priceFormatter().format(price),
  }
  const drawingsLayer = new DrawingsPrimitive({
    line: theme.drawing, text: theme.foreground, muted: theme.muted, background: theme.card,
    positive: theme.positive, negative: theme.negative, font: theme.font,
  })
  series.attachPrimitive(drawingsLayer)
  const drawings = new DrawingController(space, {
    onDrawingCreate: drawing => callbacks.onDrawingCreate(drawing),
    onDrawingChange: (drawing, phase) => callbacks.onDrawingChange(drawing, phase),
    onDrawingSelect: id => callbacks.onDrawingSelect(id),
  }, () => drawingsLayer.requestUpdate())
  drawingsLayer.controller = drawings

  chart.subscribeClick(event => {
    if (typeof event.hoveredObjectId === 'string' && levels.find(event.hoveredObjectId)) callbacks.onLevelSelect(event.hoveredObjectId)
  })
  const onRange = (range: LogicalRange | null) => {
    if (range && candleCount > 0 && range.from < 15) callbacks.onNeedOlder()
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)

  // Drawings and level drags are handled before the chart sees the pointer, so panning stays off while they move.
  let drag: { id: string; pointerId: number; price: number; moved: boolean } | null = null
  let drawingPointer: number | null = null
  const pane = (event: PointerEvent) => {
    const rect = container.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const lockChart = (locked: boolean) => chart.applyOptions({ handleScroll: !locked, handleScale: !locked })
  const consume = (event: PointerEvent) => { event.preventDefault(); event.stopPropagation() }
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return
    const { x, y } = pane(event)
    if (x > chart.timeScale().width()) return
    container.focus({ preventScroll: true })
    if (!index.empty && drawings.pointerDown(x, y)) {
      consume(event)
      drawingPointer = event.pointerId
      container.setPointerCapture?.(event.pointerId)
      lockChart(true)
      return
    }
    const tag = levels.tagAt(x, y)
    if (tag) {
      consume(event)
      callbacks.onLevelEdit(tag.overlay.id, { x: tag.x, y: tag.y })
      return
    }
    const hit = levels.levelAt(y)
    if (!hit?.overlay.draggable) return
    consume(event)
    drag = { id: hit.overlay.id, pointerId: event.pointerId, price: hit.overlay.price, moved: false }
    container.setPointerCapture?.(event.pointerId)
    lockChart(true)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (drawings.busy) {
      const { x, y } = pane(event)
      if (drawings.pointerMove(x, y)) consume(event)
      return
    }
    if (!drag || event.pointerId !== drag.pointerId) return
    consume(event)
    const price = series.coordinateToPrice(pane(event).y)
    if (price === null || !Number.isFinite(price) || price <= 0) return
    drag.price = price
    drag.moved = true
    callbacks.onLevelDrag(drag.id, price, 'move')
  }
  const endDrag = (event: PointerEvent) => {
    if (drawingPointer === event.pointerId) {
      event.stopPropagation()
      drawingPointer = null
      container.releasePointerCapture?.(event.pointerId)
      const { x, y } = pane(event)
      if (event.type === 'pointercancel') drawings.cancel()
      else drawings.pointerUp(x, y)
      // A two-click creation keeps panning off until the second click.
      lockChart(drawings.busy)
      return
    }
    if (!drag || event.pointerId !== drag.pointerId) return
    event.stopPropagation()
    const finished = drag
    drag = null
    container.releasePointerCapture?.(event.pointerId)
    lockChart(false)
    if (finished.moved) callbacks.onLevelDrag(finished.id, finished.price, 'end')
    else callbacks.onLevelSelect(finished.id)
  }
  const onDoubleClick = (event: MouseEvent) => {
    const rect = container.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (x > chart.timeScale().width() || drawings.tool || drawings.drawingAt(x, y)) return
    const hit = levels.levelAt(y)
    if (!hit || hit.overlay.kind === 'reference') return
    event.preventDefault()
    callbacks.onLevelEdit(hit.overlay.id, { x, y: series.priceToCoordinate(hit.overlay.price) ?? y })
  }
  container.addEventListener('dblclick', onDoubleClick)
  container.addEventListener('pointerdown', onPointerDown, true)
  container.addEventListener('pointermove', onPointerMove, true)
  container.addEventListener('pointerup', endDrag, true)
  container.addEventListener('pointercancel', endDrag, true)

  const adapter: ChartAdapter = {
    setCandles(candles, reset) {
      candleCount = candles.length
      loaded = candles
      index = new TimeIndex(candles)
      levels.reference = candles.at(-1)?.close ?? null
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
    setDrawings(next, selectedId) {
      drawings.drawings = next
      drawings.selectedId = selectedId
      drawingsLayer.requestUpdate()
    },
    setDrawingTool(tool, magnet) {
      drawings.magnet = magnet
      if (tool !== drawings.tool) {
        drawings.setTool(tool)
        lockChart(false)
      }
    },
    capture(caption) {
      // Levels and drawings are series primitives, so they are on the screenshot canvas.
      const shot = chart.takeScreenshot(true, false)
      const ratio = shot.width / Math.max(1, container.clientWidth)
      const footer = Math.round(26 * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = shot.width
      canvas.height = shot.height + footer
      const context = canvas.getContext('2d')
      if (!context) return Promise.resolve(null)
      context.drawImage(shot, 0, 0)
      context.fillStyle = theme.card
      context.fillRect(0, shot.height, canvas.width, footer)
      context.fillStyle = theme.border
      context.fillRect(0, shot.height, canvas.width, Math.max(1, Math.round(ratio)))
      context.font = `500 ${Math.round(11 * ratio)}px ${theme.font}`
      context.fillStyle = theme.muted
      context.textBaseline = 'middle'
      context.fillText(caption, Math.round(10 * ratio), shot.height + footer / 2)
      return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    },
    destroy() {
      container.removeEventListener('dblclick', onDoubleClick)
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
