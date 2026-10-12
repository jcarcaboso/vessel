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
  it('uses the owner-selected default periods and colors', () => {
    expect(defaultIndicators.emas.map(({ period, color }) => [period, color])).toEqual([
      [9, '#b388ff'], [50, '#ef5350'], [100, '#f2c94c'], [200, '#4cbb6c'],
    ])
  })
  it('migrates each untouched old slot, preserving custom slots and visibility', () => {
    const migrated = normalizeIndicators({ emas: [
      { period: 9, color: '#b388ff', enabled: false },
      { period: 21, color: '#4cbb6c', enabled: false },
      { period: 50, color: '#f2c94c' },
      { period: 200, color: '#ef5350' },
    ], volume: { enabled: false, size: 'minimized' }, rsi: { period: 7, color: '#123456' } })
    expect(migrated.emas).toEqual(defaultIndicators.emas.map((ema, index) => ({ ...ema, enabled: index > 1 })))
    expect(migrated.volume).toEqual({ enabled: false, size: 'minimized' })
    expect(migrated.rsi).toMatchObject({ period: 7, color: '#123456' })
    expect(normalizeIndicators(migrated)).toEqual(migrated)
    const customized = normalizeIndicators({ emas: [
      { period: 12, color: '#b388ff' }, { period: 21, color: '#123456' },
      { period: 55, color: '#f2c94c' }, { period: 200, color: '#abcdef' },
    ] })
    expect(customized.emas.map(({ period, color }) => [period, color])).toEqual([
      [12, '#b388ff'], [21, '#123456'], [55, '#f2c94c'], [200, '#abcdef'],
    ])
  })
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
  it('keeps only one stored pane maximized', () => {
    const stored = normalizeIndicators({ volume: { size: 'maximized' }, rsi: { size: 'maximized' } })
    expect([stored.volume.size, stored.rsi.size]).toEqual(['maximized', 'normal'])
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
    expect(describeIndicators(defaultIndicators)).toBe('EMA 9/50/100/200 · Volume · RSI 14')
  })
})

describe('indicator caption', () => {
  it('says which panes are minimized and therefore not plotted', () => {
    expect(describeIndicators({ ...defaultIndicators, rsi: { ...defaultIndicators.rsi, size: 'minimized' } })).toBe('EMA 9/50/100/200 · Volume · RSI 14 minimized, not plotted')
    expect(describeIndicators(defaultIndicators, { volume: 'minimized' })).toBe('EMA 9/50/100/200 · Volume minimized, not plotted · RSI 14')
  })
})
