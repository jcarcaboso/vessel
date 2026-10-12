import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { defaultIndicators } from '@/components/chart/indicators'
import { readChartPreferences, useChartPreferences } from './chartPreferences'

afterEach(() => localStorage.removeItem('vessel.chart.preferences.v1'))
describe('Stored EMA preferences', () => {
  it('preserves deliberately saved legacy EMA pairs after migration and reload', () => {
    localStorage.setItem('vessel.chart.preferences.v1', JSON.stringify({
      indicators: { emas: [{}, { period: 21, color: '#4cbb6c' }] },
    }))
    const { result } = renderHook(useChartPreferences)
    expect(result.current[0].indicators.emas[1]?.period).toBe(50)
    act(() => result.current[1]({
      indicators: { ...result.current[0].indicators, emas: result.current[0].indicators.emas.map((ema, index) =>
        index === 1 ? { ...ema, period: 21, color: '#4cbb6c', enabled: false } : ema) },
    }))
    expect(readChartPreferences().indicators.emas[1]).toMatchObject({ period: 21, color: '#4cbb6c', enabled: false })
  })
  it('persists the legacy migration marker on read before any user edit', () => {
    localStorage.setItem('vessel.chart.preferences.v1', JSON.stringify({
      indicators: { emas: [{}, { period: 21, color: '#4cbb6c' }] },
    }))
    readChartPreferences()
    const stored = JSON.parse(localStorage.getItem('vessel.chart.preferences.v1')!)
    expect(stored.schemaVersion).toBe(2)
    expect(stored.indicators.emas[1]).toMatchObject({ period: 50, color: '#ef5350' })
  })
  it('reads old untouched defaults as the new defaults, without losing unrelated preferences', () => {
    localStorage.setItem('vessel.chart.preferences.v1', JSON.stringify({
      interval: '4h', live: false, indicators: { emas: [
        { period: 9, color: '#b388ff' }, { period: 21, color: '#4cbb6c' },
        { period: 50, color: '#f2c94c' }, { period: 200, color: '#ef5350', enabled: false },
      ] },
    }))
    const settings = readChartPreferences()
    expect(settings.interval).toBe('4h')
    expect(settings.live).toBe(false)
    expect(settings.indicators.emas).toEqual(defaultIndicators.emas.map((ema, index) => ({ ...ema, enabled: index !== 3 })))
  })
})
