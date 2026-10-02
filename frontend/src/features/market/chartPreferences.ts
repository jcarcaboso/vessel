import { useCallback, useState } from 'react'
import { candleIntervals, type CandleInterval } from '@/api/workspace'

/** View preferences only. No market data, tokens or draft content are stored. */
export interface ChartPreferences {
  interval: CandleInterval
  favorites: CandleInterval[]
  /** Snap drawing anchors to candle open, high, low or close. */
  magnet: boolean
}

const storageKey = 'vessel.chart.preferences.v1'
export const defaultChartPreferences: ChartPreferences = { interval: '1h', favorites: ['5m', '1h', '4h', '1d'], magnet: false }

const isInterval = (value: unknown): value is CandleInterval => candleIntervals.includes(value as CandleInterval)
const ordered = (intervals: Iterable<CandleInterval>) => candleIntervals.filter(interval => new Set(intervals).has(interval))

export function readChartPreferences(): ChartPreferences {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return defaultChartPreferences
    const { interval, favorites, magnet } = stored as Record<string, unknown>
    return {
      interval: isInterval(interval) ? interval : defaultChartPreferences.interval,
      favorites: Array.isArray(favorites) ? ordered(favorites.filter(isInterval)) : defaultChartPreferences.favorites,
      magnet: magnet === true,
    }
  } catch {
    return defaultChartPreferences
  }
}

export function useChartPreferences() {
  const [preferences, setPreferences] = useState(readChartPreferences)
  const update = useCallback((patch: Partial<ChartPreferences>) => {
    setPreferences(current => {
      const next = { ...current, ...patch, favorites: ordered(patch.favorites ?? current.favorites) }
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Preferences stay in memory. */ }
      return next
    })
  }, [])
  return [preferences, update] as const
}
