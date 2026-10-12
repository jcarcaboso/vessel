import { describe, expect, it, vi } from 'vitest'
import type { ChartCandle } from './types'
import { createSeriesWriter } from './seriesWriter'

const bars: ChartCandle[] = Array.from({ length: 3 }, (_, index) => ({ time: (index + 1) * 60_000, open: 100, high: 110, low: 90, close: 105, volume: 12 }))
const extra = { ...bars[2]!, time: 240_000 }
const cases = [
  { name: 'forming-bar update', next: [...bars.slice(0, -1), { ...bars[2]!, close: 106 }], updates: 1 },
  { name: 'append', next: [...bars, extra], updates: 1 },
  { name: 'append + forming-bar update', next: [...bars.slice(0, -1), { ...bars[2]!, volume: 13 }, extra], updates: 2 },
  { name: 'equivalent array/objects', next: bars.map(bar => ({ ...bar })), updates: 0 },
  { name: 'prepend', next: [{ ...bars[0]!, time: 0 }, ...bars], updates: null },
  { name: 'historical correction', next: [bars[0]!, { ...bars[1]!, high: 120 }, bars[2]!], updates: null },
  { name: 'trim', next: bars.slice(1), updates: null },
  { name: 'reset', next: bars, updates: null, reset: true },
  { name: 'replace final timestamp', next: [...bars.slice(0, -1), extra], updates: null },
]

function fakeSeries<T extends { time: number }>() {
  let data: T[] = []
  return {
    setData: vi.fn((next: T[]) => { data = [...next] }),
    update: vi.fn((point: T) => {
      if (point.time < data.at(-1)!.time) throw new Error('historical update')
      if (point.time === data.at(-1)?.time) data[data.length - 1] = point
      else data.push(point)
    }),
    data: () => data,
  }
}

describe('value-based series writes', () => {
  it.each(cases)('$name: candle output matches full setData', ({ next, updates, reset = false }) => {
    const series = fakeSeries<ChartCandle>()
    const convert = vi.fn((bar: ChartCandle) => ({ ...bar }))
    const write = createSeriesWriter(series, (a: ChartCandle, b) => a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume, convert)
    write(bars)
    series.setData.mockClear(); series.update.mockClear(); convert.mockClear()
    const timestampsChanged = write(next, reset)
    expect(series.data()).toEqual(next)
    expect(series.setData).toHaveBeenCalledTimes(updates === null ? 1 : 0)
    expect(series.update).toHaveBeenCalledTimes(updates ?? 0)
    expect(convert).toHaveBeenCalledTimes(updates ?? next.length)
    expect(timestampsChanged).toBe(next.length !== bars.length || next.some((point, index) => point.time !== bars[index]?.time))
  })

  it.each(cases)('$name: indicator output matches full setData (including whitespace)', ({ next, updates, reset = false }) => {
    const points = (source: ChartCandle[]) => source.map(bar => ({ time: bar.time, value: bar.time === 60_000 ? null : bar.close + bar.high + bar.volume }))
    const series = fakeSeries<{ time: number; value?: number }>()
    const write = createSeriesWriter(series, (a: { time: number; value: number | null }, b) => a.time === b.time && a.value === b.value,
      point => point.value === null ? { time: point.time } : { time: point.time, value: point.value })
    write(points(bars)); series.setData.mockClear(); series.update.mockClear()
    write(points(next), reset)
    expect(series.data()).toEqual(points(next).map(point => point.value === null ? { time: point.time } : point))
    expect(series.setData).toHaveBeenCalledTimes(updates === null ? 1 : 0)
    expect(series.update).toHaveBeenCalledTimes(updates ?? 0)
  })

  it('snapshots values instead of trusting array or point identity', () => {
    const source = bars.map(bar => ({ ...bar }))
    const series = fakeSeries<ChartCandle>()
    const write = createSeriesWriter(series, (a: ChartCandle, b) => JSON.stringify(a) === JSON.stringify(b), point => ({ ...point }))
    write(source); series.setData.mockClear()
    source[0]!.close++
    write(source)
    expect(series.setData).toHaveBeenCalledExactlyOnceWith(source)
    source[2]!.close++
    write(source)
    expect(series.update).toHaveBeenCalledExactlyOnceWith(source[2])
  })
})
