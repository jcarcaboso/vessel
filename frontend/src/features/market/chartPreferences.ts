import { useCallback, useState } from 'react'
import { candleIntervals, type CandleInterval } from '@/api/workspace'
import { isDrawingKind } from '@/components/chart/drawingTools'
import type { DrawingKind } from '@/components/chart/drawings'
import { defaultIndicators, normalizeIndicators, type IndicatorSettings } from '@/components/chart/indicators'

/** View preferences only. No market data, tokens or draft content are stored. */
export interface ChartPreferences {
  interval: CandleInterval
  favorites: CandleInterval[]
  /** Snap drawing anchors to candle open, high, low or close. */
  magnet: boolean
  /** Stream live candles and statistics while the chart is visible. */
  live: boolean
  /** Drawing tools pinned to the chart toolbar. */
  drawingFavorites: DrawingKind[]
  /** Last tool used in each drawing tool group, shown on the group's button. */
  toolChoice: Record<string, DrawingKind>
  /** Moving averages, volume and RSI: which are shown, their periods, colors and pane sizes. */
  indicators: IndicatorSettings
}

const storageKey = 'vessel.chart.preferences.v1'
export const defaultChartPreferences: ChartPreferences = {
  interval: '1h', favorites: ['5m', '1h', '4h', '1d'], magnet: false, live: true,
  drawingFavorites: ['trend-line', 'horizontal-line', 'fibonacci'], toolChoice: {}, indicators: defaultIndicators,
}

const isInterval = (value: unknown): value is CandleInterval => candleIntervals.includes(value as CandleInterval)
const ordered = (intervals: Iterable<CandleInterval>) => candleIntervals.filter(interval => new Set(intervals).has(interval))

export function readChartPreferences(): ChartPreferences {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return defaultChartPreferences
    const { interval, favorites, magnet, live, drawingFavorites, toolChoice, indicators } = stored as Record<string, unknown>
    return {
      interval: isInterval(interval) ? interval : defaultChartPreferences.interval,
      favorites: Array.isArray(favorites) ? ordered(favorites.filter(isInterval)) : defaultChartPreferences.favorites,
      magnet: magnet === true,
      live: typeof live === 'boolean' ? live : defaultChartPreferences.live,
      drawingFavorites: Array.isArray(drawingFavorites) ? [...new Set(drawingFavorites.filter((kind): kind is DrawingKind => typeof kind === 'string' && isDrawingKind(kind)))]
        : defaultChartPreferences.drawingFavorites,
      toolChoice: typeof toolChoice === 'object' && toolChoice !== null
        ? Object.fromEntries(Object.entries(toolChoice).filter((entry): entry is [string, DrawingKind] => typeof entry[1] === 'string' && isDrawingKind(entry[1])))
        : {},
      indicators: normalizeIndicators(indicators),
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
