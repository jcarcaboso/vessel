import { describe, expect, it } from 'vitest'
import { computeIndicators, defaultIndicators, describeIndicators, ema, normalizeIndicators, resizePane, rsi } from './indicators'

describe('moving average', () => {
  it('starts at the simple average of the first period and then weights the latest close', () => {
    const values = ema([1, 2, 3, 4, 5], 3)
    expect(values.slice(0, 2)).toEqual([null, null])
    expect(values[2]).toBe(2)
    expect(values[3]).toBe(3)
    expect(values[4]).toBe(4)
  })
  it('leaves every point empty when there are fewer values than the period', () => {
    expect(ema([1, 2], 3)).toEqual([null, null])
  })
})

describe('relative strength', () => {
  it('uses Wilder smoothing and stays within 0–100', () => {
    // Reference values for this series from the original Wilder example (period 14).
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64]
    const values = rsi(closes, 14)
    expect(values.slice(0, 14).every(value => value === null)).toBe(true)
    expect(values[14]).toBeCloseTo(70.46, 1)
    expect(values[15]).toBeCloseTo(66.25, 1)
    expect(values[19]).toBeCloseTo(57.92, 0)
  })
  it('reads 100 when prices only rise and 50 when they never move', () => {
    expect(rsi([1, 2, 3, 4], 2)[3]).toBe(100)
    expect(rsi([5, 5, 5, 5], 2)[3]).toBe(50)
  })
})

describe('indicator settings', () => {
  it('keeps valid stored fields and defaults the rest', () => {
    const stored = normalizeIndicators({
      emas: [{ enabled: false, period: 10, color: '#ABCDEF' }, { period: 0, color: 'red' }],
      volume: { enabled: false, size: 'huge' },
      rsi: { period: 7, size: 'minimized' },
    })
    expect(stored.emas[0]).toEqual({ id: 'ema-1', enabled: false, period: 10, color: '#abcdef' })
    expect(stored.emas[1]).toEqual(defaultIndicators.emas[1])
    expect(stored.emas).toHaveLength(4)
    expect(stored.volume).toEqual({ enabled: false, size: 'normal' })
    expect(stored.rsi).toEqual({ ...defaultIndicators.rsi, period: 7, size: 'minimized' })
    expect(normalizeIndicators('nonsense')).toEqual(defaultIndicators)
  })
  it('maximizes one pane at a time', () => {
    const rsiBig = resizePane(defaultIndicators, 'rsi', 'maximized')
    const volumeBig = resizePane(rsiBig, 'volume', 'maximized')
    expect([volumeBig.volume.size, volumeBig.rsi.size]).toEqual(['maximized', 'normal'])
    expect(resizePane(rsiBig, 'volume', 'minimized').rsi.size).toBe('maximized')
  })
  it('computes only enabled indicators and names them for captures', () => {
    const candles = [1, 2, 3].map(i => ({ time: i * 1000, open: 10.5, high: 12, low: 8, close: 9 + i, volume: i }))
    const settings = { ...defaultIndicators, emas: defaultIndicators.emas.map((ema, index) => ({ ...ema, enabled: index === 0, period: 2 })), rsi: { ...defaultIndicators.rsi, enabled: false } }
    const view = computeIndicators(candles, settings)
    expect(view.lines.map(line => [line.label, line.values])).toEqual([['EMA 2', [null, 10.5, 11.5]]])
    expect(view.volume).toEqual({ size: 'normal', values: [1, 2, 3], up: [false, true, true] })
    expect(view.rsi).toBeNull()
    expect(describeIndicators(settings)).toBe('EMA 2 · Volume')
    expect(describeIndicators(defaultIndicators)).toBe('EMA 9/21/50/200 · Volume · RSI 14')
  })
})
