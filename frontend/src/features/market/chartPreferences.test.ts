import { afterEach, describe, expect, it } from 'vitest'
import { defaultIndicators } from '@/components/chart/indicators'
import { readChartPreferences } from './chartPreferences'

afterEach(() => localStorage.removeItem('vessel.chart.preferences.v1'))
describe('Stored EMA preferences', () => {
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
