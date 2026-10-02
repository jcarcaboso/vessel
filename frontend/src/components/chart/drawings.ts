import type { ChartCandle } from './types'

/** Version of the persisted drawing shape. Bump and migrate when fields change. */
export const drawingSchemaVersion = 1

export type DrawingKind = 'trend-line' | 'horizontal-line' | 'zone' | 'fibonacci' | 'position' | 'text'

/** Anchors are UTC milliseconds and prices, never pixels or bar indexes, so they survive zoom and timeframe changes. */
export interface DrawingPoint {
  time: number
  price: number
}

export interface ChartDrawing {
  id: string
  schemaVersion: typeof drawingSchemaVersion
  kind: DrawingKind
  /**
   * trend-line, zone, fibonacci: [start, end]. horizontal-line, text: [anchor].
   * position: [entry, target corner, stop corner]; the corners share the box's end time.
   */
  points: DrawingPoint[]
  text?: string
}

export const pointCount: Record<DrawingKind, 1 | 2> = {
  'trend-line': 2, 'horizontal-line': 1, zone: 2, fibonacci: 2, position: 2, text: 1,
}

export const fibonacciLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const

/** Level 1 sits at the start anchor and level 0 at the end anchor, as in common charting tools. */
export const fibonacciPrice = (start: DrawingPoint, end: DrawingPoint, level: number) => end.price + (start.price - end.price) * level

/** Builds a position box from its entry and the dragged corner; the stop mirrors the target at 1R. */
export function positionPoints(entry: DrawingPoint, corner: DrawingPoint): DrawingPoint[] {
  const time = corner.time === entry.time ? entry.time + 1 : corner.time
  return [entry, { time, price: corner.price }, { time, price: entry.price - (corner.price - entry.price) }]
}

/** Display-only distances for a position drawing. Not a plan level, order or fill. */
export function positionStats(points: readonly DrawingPoint[]) {
  const [entry, target, stop] = points
  if (!entry || !target || !stop || entry.price <= 0) return null
  const reward = Math.abs(target.price - entry.price)
  const risk = Math.abs(entry.price - stop.price)
  return {
    side: target.price >= entry.price ? 'long' as const : 'short' as const,
    targetPercent: reward / entry.price * 100,
    stopPercent: risk / entry.price * 100,
    ratio: risk > 0 ? reward / risk : null,
  }
}

/**
 * Maps UTC times to fractional bar positions using the loaded candles, extrapolating with the
 * bar interval before the first and after the last candle so anchors in empty space keep their time.
 */
export class TimeIndex {
  private readonly times: number[]
  private readonly step: number

  constructor(candles: readonly ChartCandle[]) {
    this.times = candles.map(candle => candle.time)
    const last = this.times.length - 1
    this.step = last > 0 ? Math.max(1, this.times[last]! - this.times[last - 1]!) : 60_000
  }

  get empty() { return this.times.length === 0 }

  logical(time: number) {
    const times = this.times
    if (!times.length) return null
    if (time <= times[0]!) return (time - times[0]!) / this.step
    const last = times.length - 1
    if (time >= times[last]!) return last + (time - times[last]!) / this.step
    let low = 0
    let high = last
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if (times[middle]! <= time) low = middle
      else high = middle
    }
    return low + (time - times[low]!) / (times[high]! - times[low]!)
  }

  time(logical: number) {
    const times = this.times
    if (!times.length) return null
    const last = times.length - 1
    if (logical <= 0) return Math.round(times[0]! + logical * this.step)
    if (logical >= last) return Math.round(times[last]! + (logical - last) * this.step)
    const low = Math.floor(logical)
    return Math.round(times[low]! + (logical - low) * (times[low + 1]! - times[low]!))
  }

  /** Nearest loaded candle to a fractional position, for magnet snapping. */
  candleIndex(logical: number) {
    if (!this.times.length) return null
    return Math.min(this.times.length - 1, Math.max(0, Math.round(logical)))
  }
}

/** Snaps a price to the nearest open, high, low or close of a candle. */
export function snapPrice(candle: ChartCandle, price: number) {
  return [candle.open, candle.high, candle.low, candle.close]
    .reduce((best, value) => Math.abs(value - price) < Math.abs(best - price) ? value : best, candle.close)
}

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Normalizes stored drawings, dropping anything malformed instead of failing the chart. */
export function isChartDrawing(value: unknown): value is ChartDrawing {
  if (typeof value !== 'object' || value === null) return false
  const drawing = value as Partial<ChartDrawing>
  const expected = drawing.kind && drawing.kind in pointCount
    ? drawing.kind === 'position' ? 3 : pointCount[drawing.kind] : 0
  return typeof drawing.id === 'string' && drawing.schemaVersion === drawingSchemaVersion && expected > 0 &&
    Array.isArray(drawing.points) && drawing.points.length === expected &&
    drawing.points.every(point => Number.isFinite(point?.time) && Number.isFinite(point?.price) && point.price > 0) &&
    (drawing.text === undefined || typeof drawing.text === 'string' && drawing.text.length <= 500)
}
