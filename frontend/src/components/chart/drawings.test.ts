import { describe, expect, it, vi } from 'vitest'
import { DrawingController, buildPoints, type DrawingSpace } from './drawingController'
import { TimeIndex, fibonacciPrice, formatDuration, isChartDrawing, positionStats, priceRangeStats, snapPrice, type ChartDrawing } from './drawings'

const hour = 3_600_000
const candles = [0, 1, 2, 3].map(i => ({ time: 1_000 * hour + i * hour, open: 100 + i, high: 105 + i, low: 95 + i, close: 102 + i }))

describe('time index', () => {
  const index = new TimeIndex(candles)
  it('interpolates inside the data and extrapolates by the bar interval outside it', () => {
    expect(index.logical(candles[2]!.time)).toBe(2)
    expect(index.logical(candles[1]!.time + hour / 2)).toBe(1.5)
    expect(index.logical(candles[3]!.time + 5 * hour)).toBe(8)
    expect(index.logical(candles[0]!.time - 2 * hour)).toBe(-2)
    for (const logical of [-2, 0, 1.5, 3, 8]) expect(index.logical(index.time(logical)!)).toBeCloseTo(logical)
  })
  it('reports empty data instead of inventing positions', () => {
    const empty = new TimeIndex([])
    expect(empty.empty).toBe(true)
    expect(empty.logical(1)).toBeNull()
    expect(empty.time(1)).toBeNull()
  })
})

describe('drawing geometry', () => {
  it('snaps prices to the nearest candle value', () => {
    expect(snapPrice(candles[0]!, 104.4)).toBe(105)
    expect(snapPrice(candles[0]!, 99)).toBe(100)
  })
  it('places Fibonacci level 1 at the start and 0 at the end', () => {
    const start = { time: 0, price: 100 }
    const end = { time: 1, price: 200 }
    expect(fibonacciPrice(start, end, 1)).toBe(100)
    expect(fibonacciPrice(start, end, 0)).toBe(200)
    expect(fibonacciPrice(start, end, 0.5)).toBe(150)
  })
  it('mirrors the position stop at 1R and reports display distances', () => {
    const points = buildPoints('position', { time: 0, price: 100 }, { time: 10, price: 110 })
    expect(points).toEqual([{ time: 0, price: 100 }, { time: 10, price: 110 }, { time: 10, price: 90 }])
    expect(positionStats(points)).toEqual({ side: 'long', targetPercent: 10, stopPercent: 10, ratio: 1 })
    expect(positionStats([{ time: 0, price: 100 }, { time: 1, price: 80 }, { time: 1, price: 105 }])).toMatchObject({ side: 'short', ratio: 4 })
    expect(buildPoints('position', { time: 0, price: 10 }, { time: 1, price: 50 })[2]!.price).toBeGreaterThan(0)
  })
  it('measures price and date ranges for display', () => {
    expect(priceRangeStats({ time: 0, price: 80 }, { time: 1, price: 100 })).toEqual({ change: 20, percent: 25 })
    expect(priceRangeStats({ time: 0, price: 100 }, { time: 1, price: 80 })).toEqual({ change: -20, percent: -20 })
    expect(formatDuration(45 * 60_000)).toBe('45m')
    expect(formatDuration(-(2 * 60 + 15) * 60_000)).toBe('2h 15m')
    expect(formatDuration((3 * 24 + 4) * 3_600_000)).toBe('3d 4h')
    expect(formatDuration(2 * 24 * 3_600_000)).toBe('2d')
  })
  it('validates stored drawings by kind and anchors', () => {
    const valid: ChartDrawing = { id: 'a', schemaVersion: 1, kind: 'trend-line', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }] }
    expect(isChartDrawing(valid)).toBe(true)
    expect(isChartDrawing({ ...valid, points: [{ time: 1, price: 2 }] })).toBe(false)
    expect(isChartDrawing({ ...valid, schemaVersion: 2 })).toBe(false)
    expect(isChartDrawing({ ...valid, points: [{ time: 1, price: -2 }, { time: 3, price: 4 }] })).toBe(false)
    expect(isChartDrawing({ ...valid, kind: 'position', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }, { time: 3, price: 1 }] })).toBe(true)
    expect(isChartDrawing({ ...valid, kind: 'vertical-line', points: [{ time: 1, price: 2 }] })).toBe(true)
    expect(isChartDrawing({ ...valid, kind: 'date-range' })).toBe(true)
    expect(isChartDrawing({ ...valid, kind: 'price-range', points: [{ time: 1, price: 2 }] })).toBe(false)
  })
})

/** 1 px per minute and 1 px per price unit, inverted like a screen. */
const space: DrawingSpace = {
  x: time => time / 60_000,
  y: price => 1000 - price,
  point: (x, y, snap) => ({ time: (snap ? Math.round(x / 60) * 60 : x) * 60_000, price: 1000 - y }),
  width: () => 800,
  height: () => 600,
  formatPrice: price => price.toFixed(2),
  formatTime: time => `t${time}`,
  bars: (from, to) => (to - from) / 3_600_000,
}

function controller() {
  const callbacks = { onDrawingCreate: vi.fn(), onDrawingChange: vi.fn(), onDrawingSelect: vi.fn() }
  return { callbacks, drawings: new DrawingController(space, callbacks, vi.fn()) }
}

describe('drawing controller', () => {
  it('creates two-point drawings by dragging or by two clicks', () => {
    const { callbacks, drawings } = controller()
    drawings.setTool('trend-line')
    expect(drawings.pointerDown(100, 500)).toBe(true)
    drawings.pointerMove(150, 450)
    drawings.pointerUp(200, 400)
    expect(callbacks.onDrawingCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'trend-line', schemaVersion: 1, points: [{ time: 6_000_000, price: 500 }, { time: 12_000_000, price: 600 }],
    }))
    drawings.pointerDown(100, 500)
    drawings.pointerUp(100, 500)
    expect(drawings.busy).toBe(true)
    drawings.pointerMove(300, 300)
    drawings.pointerDown(300, 300)
    expect(callbacks.onDrawingCreate).toHaveBeenCalledTimes(2)
    expect(drawings.busy).toBe(false)
  })

  it('creates one-point drawings immediately and applies the magnet', () => {
    const { callbacks, drawings } = controller()
    drawings.magnet = true
    drawings.setTool('text')
    drawings.pointerDown(130, 500)
    expect(callbacks.onDrawingCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text', text: 'Note', points: [{ time: 120 * 60_000, price: 500 }] }))
  })

  it('selects, moves and resizes existing drawings, and leaves empty clicks to the chart', () => {
    const { callbacks, drawings } = controller()
    const line: ChartDrawing = { id: 't', schemaVersion: 1, kind: 'trend-line', points: [{ time: 6_000_000, price: 500 }, { time: 12_000_000, price: 600 }] }
    drawings.drawings = [line]
    expect(drawings.pointerDown(150, 450)).toBe(true)
    expect(callbacks.onDrawingSelect).toHaveBeenCalledWith('t')
    drawings.pointerMove(160, 440)
    drawings.pointerUp(160, 440)
    expect(callbacks.onDrawingChange).toHaveBeenLastCalledWith({ ...line, points: [{ time: 6_600_000, price: 510 }, { time: 12_600_000, price: 610 }] }, 'end')

    drawings.selectedId = 't'
    drawings.pointerDown(200, 400)
    drawings.pointerMove(250, 380)
    drawings.pointerUp(250, 380)
    expect(callbacks.onDrawingChange).toHaveBeenLastCalledWith({ ...line, points: [line.points[0], { time: 15_000_000, price: 620 }] }, 'end')

    expect(drawings.pointerDown(700, 50)).toBe(false)
    expect(callbacks.onDrawingSelect).toHaveBeenLastCalledWith(null)
  })

  it('moves a vertical line only in time and selects it near its x', () => {
    const { callbacks, drawings } = controller()
    drawings.setTool('vertical-line')
    drawings.pointerDown(300, 420)
    const created = callbacks.onDrawingCreate.mock.lastCall![0] as ChartDrawing
    expect(created).toMatchObject({ kind: 'vertical-line', points: [{ time: 18_000_000, price: 580 }] })
    drawings.setTool(null)
    drawings.drawings = [created]
    expect(drawings.drawingAt(303, 50)?.id).toBe(created.id)
    expect(drawings.drawingAt(320, 50)).toBeNull()
    drawings.pointerDown(300, 100)
    drawings.pointerMove(340, 160)
    drawings.pointerUp(340, 160)
    expect(callbacks.onDrawingChange).toHaveBeenLastCalledWith({ ...created, points: [{ time: 20_400_000, price: 580 }] }, 'end')
  })

  it('draws date and price ranges as two-point boxes with handles', () => {
    const { callbacks, drawings } = controller()
    for (const kind of ['date-range', 'price-range'] as const) {
      drawings.setTool(kind)
      drawings.pointerDown(100, 500)
      drawings.pointerMove(200, 400)
      drawings.pointerUp(200, 400)
      expect(callbacks.onDrawingCreate).toHaveBeenLastCalledWith(expect.objectContaining({
        kind, points: [{ time: 6_000_000, price: 500 }, { time: 12_000_000, price: 600 }],
      }))
    }
    const range = callbacks.onDrawingCreate.mock.lastCall![0] as ChartDrawing
    drawings.setTool(null)
    drawings.drawings = [range]
    drawings.selectedId = range.id
    expect(drawings.cursor(200, 400)).toBe('grab')
    expect(drawings.cursor(150, 450)).toBe('move')
  })

  it('keeps position target and stop on the shared end time', () => {
    const { callbacks, drawings } = controller()
    const position: ChartDrawing = { id: 'p', schemaVersion: 1, kind: 'position', points: buildPoints('position', { time: 6_000_000, price: 500 }, { time: 12_000_000, price: 550 }) }
    drawings.drawings = [position]
    drawings.selectedId = 'p'
    drawings.pointerDown(200, 550)
    drawings.pointerMove(260, 560)
    drawings.pointerUp(260, 560)
    expect(callbacks.onDrawingChange).toHaveBeenLastCalledWith({ ...position, points: [
      { time: 6_000_000, price: 500 }, { time: 15_600_000, price: 550 }, { time: 15_600_000, price: 440 },
    ] }, 'end')
  })

  it('moves horizontal lines by price only and cancels creation', () => {
    const { callbacks, drawings } = controller()
    const level: ChartDrawing = { id: 'h', schemaVersion: 1, kind: 'horizontal-line', points: [{ time: 6_000_000, price: 500 }] }
    drawings.drawings = [level]
    drawings.pointerDown(400, 500)
    drawings.pointerMove(450, 480)
    drawings.pointerUp(450, 480)
    expect(callbacks.onDrawingChange).toHaveBeenLastCalledWith({ ...level, points: [{ time: 6_000_000, price: 520 }] }, 'end')
    drawings.setTool('zone')
    drawings.pointerDown(10, 10)
    drawings.cancel()
    expect(drawings.busy).toBe(false)
    expect(callbacks.onDrawingCreate).not.toHaveBeenCalled()
  })
})

describe('drawing hit areas', () => {
  it('selects a Fibonacci only near its levels or diagonal, so drawings inside it stay reachable', () => {
    const { callbacks, drawings } = controller()
    const fib: ChartDrawing = { id: 'f', schemaVersion: 1, kind: 'fibonacci', points: [{ time: 6_000_000, price: 400 }, { time: 18_000_000, price: 600 }] }
    const line: ChartDrawing = { id: 't', schemaVersion: 1, kind: 'trend-line', points: [{ time: 9_000_000, price: 470 }, { time: 15_000_000, price: 470 }] }
    drawings.drawings = [line, fib]
    drawings.pointerDown(200, 530)
    expect(callbacks.onDrawingSelect).toHaveBeenLastCalledWith('t')
    drawings.pointerUp(200, 530)
    drawings.pointerDown(250, 500)
    expect(callbacks.onDrawingSelect).toHaveBeenLastCalledWith('f')
  })

  it('prefers the nearest stroke when a click is close to several drawings', () => {
    const { callbacks, drawings } = controller()
    const fib: ChartDrawing = { id: 'f', schemaVersion: 1, kind: 'fibonacci', points: [{ time: 6_000_000, price: 400 }, { time: 18_000_000, price: 600 }] }
    const line: ChartDrawing = { id: 't', schemaVersion: 1, kind: 'trend-line', points: [{ time: 9_000_000, price: 504 }, { time: 15_000_000, price: 504 }] }
    drawings.drawings = [line, fib]
    drawings.pointerDown(200, 496)
    expect(callbacks.onDrawingSelect).toHaveBeenLastCalledWith('t')
  })
})

describe('locked drawings', () => {
  it('select without moving or exposing handles', () => {
    const { callbacks, drawings } = controller()
    const line: ChartDrawing = { id: 't', schemaVersion: 1, kind: 'trend-line', locked: true, points: [{ time: 6_000_000, price: 500 }, { time: 12_000_000, price: 600 }] }
    drawings.drawings = [line]
    drawings.selectedId = 't'
    expect(drawings.pointerDown(200, 400)).toBe(true)
    expect(drawings.busy).toBe(false)
    drawings.pointerMove(260, 380)
    drawings.pointerUp(260, 380)
    expect(callbacks.onDrawingChange).not.toHaveBeenCalled()
    expect(drawings.cursor(150, 450)).toBe('pointer')
  })
  it('accepts optional style and lock fields in stored drawings', () => {
    const base: ChartDrawing = { id: 'a', schemaVersion: 1, kind: 'zone', points: [{ time: 1, price: 2 }, { time: 3, price: 4 }] }
    expect(isChartDrawing({ ...base, locked: true, style: { color: '#8fb8ff', line: 'dotted', width: 2 } })).toBe(true)
    expect(isChartDrawing({ ...base, style: { color: 'red' } })).toBe(false)
    expect(isChartDrawing({ ...base, style: { width: 5 } })).toBe(false)
  })
})
