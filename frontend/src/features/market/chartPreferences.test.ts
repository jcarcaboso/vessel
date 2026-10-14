import { createElement, StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { defaultIndicators } from '@/components/chart/indicators'

const storageKey = 'vessel.chart.preferences.v1'
const stored = () => JSON.parse(localStorage.getItem(storageKey)!)
const load = () => import('./chartPreferences')

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('Stored EMA preferences', () => {
  it('preserves deliberately saved legacy EMA pairs after migration and reload', async () => {
    localStorage.setItem(storageKey, JSON.stringify({
      indicators: { emas: [{}, { period: 21, color: '#4cbb6c' }] },
    }))
    const { useChartPreferences } = await load()
    const { result, unmount } = renderHook(useChartPreferences)
    expect(result.current[0].indicators.emas[1]?.period).toBe(50)
    act(() => result.current[1]({
      indicators: { ...result.current[0].indicators, emas: result.current[0].indicators.emas.map((ema, index) =>
        index === 1 ? { ...ema, period: 21, color: '#4cbb6c', enabled: false } : ema) },
    }))
    unmount()
    vi.resetModules()
    const reloaded = await load()
    const next = renderHook(reloaded.useChartPreferences)
    expect(next.result.current[0].indicators.emas[1]).toMatchObject({ period: 21, color: '#4cbb6c', enabled: false })
    expect(stored().schemaVersion).toBe(2)
  })

  it('persists the legacy migration marker before any user edit', async () => {
    localStorage.setItem(storageKey, JSON.stringify({
      indicators: { emas: [{}, { period: 21, color: '#4cbb6c' }] },
    }))
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const { readChartPreferences } = await load()
    readChartPreferences()
    expect(write).toHaveBeenCalledTimes(1)
    expect(stored().schemaVersion).toBe(2)
    expect(stored().indicators.emas[1]).toMatchObject({ period: 50, color: '#ef5350' })
  })

  it('migrates only untouched legacy period and colour pairs, preserving unrelated preferences', async () => {
    localStorage.setItem(storageKey, JSON.stringify({
      interval: '4h', live: false, indicators: { emas: [
        { period: 9, color: '#b388ff' }, { period: 21, color: '#4cbb6c' },
        { period: 50, color: '#f2c94c' }, { period: 200, color: '#ef5350', enabled: false },
      ] },
    }))
    const { readChartPreferences } = await load()
    const settings = readChartPreferences()
    expect(settings.interval).toBe('4h')
    expect(settings.live).toBe(false)
    expect(settings.indicators.emas).toEqual(defaultIndicators.emas.map((ema, index) => ({ ...ema, enabled: index !== 3 })))
  })

  it('keeps legacy slots with a customized period or colour', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ indicators: { emas: [
      { period: 10, color: '#b388ff' }, { period: 21, color: '#123456' },
    ] } }))
    const { readChartPreferences } = await load()
    expect(readChartPreferences().indicators.emas.slice(0, 2)).toMatchObject([
      { period: 10, color: '#b388ff' }, { period: 21, color: '#123456' },
    ])
  })
})

describe('Shared chart preferences', () => {
  it('shares one snapshot and sequential patches between multiple mounted charts', async () => {
    const { useChartPreferences } = await load()
    const first = renderHook(useChartPreferences)
    const second = renderHook(useChartPreferences)
    expect(first.result.current[0]).toBe(second.result.current[0])
    act(() => {
      first.result.current[1]({ interval: '4h' })
      second.result.current[1]({ magnet: true, favorites: ['1d', '5m', '5m'] })
    })
    expect(first.result.current[0]).toBe(second.result.current[0])
    expect(first.result.current[0]).toMatchObject({ interval: '4h', magnet: true, favorites: ['5m', '1d'] })
    expect(stored()).toMatchObject({ interval: '4h', magnet: true, favorites: ['5m', '1d'], schemaVersion: 2 })
    first.unmount()
    act(() => second.result.current[1]({ live: false }))
    const third = renderHook(useChartPreferences)
    expect(third.result.current[0]).toBe(second.result.current[0])
    expect(third.result.current[0].live).toBe(false)
  })

  it('writes once per action in StrictMode, never from a React state updater', async () => {
    const { useChartPreferences } = await load()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const view = renderHook(useChartPreferences, { wrapper: ({ children }) => createElement(StrictMode, null, children) })
    const update = view.result.current[1]
    expect(write).not.toHaveBeenCalled()
    act(() => update({ magnet: true }))
    expect(write).toHaveBeenCalledTimes(1)
    view.rerender()
    expect(view.result.current[1]).toBe(update)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it.each(['not json', 'null', '42', '"text"'])('defaults safely for malformed storage %s', async value => {
    localStorage.setItem(storageKey, value)
    const { useChartPreferences, defaultChartPreferences } = await load()
    const { result } = renderHook(useChartPreferences)
    expect(result.current[0]).toEqual(defaultChartPreferences)
  })

  it('normalizes malformed fields while preserving valid ones', async () => {
    localStorage.setItem(storageKey, JSON.stringify({
      schemaVersion: 2, interval: 'invalid', favorites: ['1d', 'bad', '5m', '5m'], magnet: 'true', live: false,
      drawingFavorites: ['trend-line', 'bad', 'trend-line'], toolChoice: { lines: 'horizontal-line', bad: 'bad' },
      indicators: { emas: [{ period: -1, color: 'red' }], rsi: { period: '14' } },
    }))
    const { useChartPreferences } = await load()
    const { result } = renderHook(useChartPreferences)
    expect(result.current[0]).toMatchObject({
      interval: '1h', favorites: ['5m', '1d'], magnet: false, live: false,
      drawingFavorites: ['trend-line'], toolChoice: { lines: 'horizontal-line' }, indicators: defaultIndicators,
    })
  })

  it('keeps shared preferences in memory if browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked') })
    const { useChartPreferences } = await load()
    const first = renderHook(useChartPreferences)
    const second = renderHook(useChartPreferences)
    act(() => first.result.current[1]({ interval: '1d', live: false }))
    expect(second.result.current[0]).toMatchObject({ interval: '1d', live: false })
  })
})
