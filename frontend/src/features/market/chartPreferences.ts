import { useSyncExternalStore } from 'react'
import { candleIntervals, type CandleInterval } from '@/api/candles'
import { isDrawingKind } from '@/components/chart/drawingTools'
import type { DrawingKind } from '@/components/chart/drawings'
import { defaultIndicators, migrateLegacyIndicators, normalizeIndicators, type IndicatorSettings } from '@/components/chart/indicators'

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
const schemaVersion = 2
function saveChartPreferences(preferences: ChartPreferences) {
  try { localStorage.setItem(storageKey, JSON.stringify({ ...preferences, schemaVersion })) } catch { /* Preferences stay in memory. */ }
}
export const defaultChartPreferences: ChartPreferences = {
  interval: '1h', favorites: ['5m', '1h', '4h', '1d'], magnet: false, live: true,
  drawingFavorites: ['trend-line', 'horizontal-line', 'fibonacci'], toolChoice: {}, indicators: defaultIndicators,
}

const isInterval = (value: unknown): value is CandleInterval => candleIntervals.includes(value as CandleInterval)
const ordered = (intervals: Iterable<CandleInterval>) => candleIntervals.filter(interval => new Set(intervals).has(interval))

const readStorage = () => {
  try { return localStorage.getItem(storageKey) } catch { return null }
}

export function readChartPreferences(): ChartPreferences {
  try {
    const stored: unknown = JSON.parse(readStorage() ?? 'null')
    if (typeof stored !== 'object' || stored === null) return defaultChartPreferences
    const { interval, favorites, magnet, live, drawingFavorites, toolChoice, indicators, schemaVersion: version } = stored as Record<string, unknown>
    const preferences: ChartPreferences = {
      interval: isInterval(interval) ? interval : defaultChartPreferences.interval,
      favorites: Array.isArray(favorites) ? ordered(favorites.filter(isInterval)) : defaultChartPreferences.favorites,
      magnet: magnet === true,
      live: typeof live === 'boolean' ? live : defaultChartPreferences.live,
      drawingFavorites: Array.isArray(drawingFavorites) ? [...new Set(drawingFavorites.filter((kind): kind is DrawingKind => typeof kind === 'string' && isDrawingKind(kind)))]
        : defaultChartPreferences.drawingFavorites,
      toolChoice: typeof toolChoice === 'object' && toolChoice !== null
        ? Object.fromEntries(Object.entries(toolChoice).filter((entry): entry is [string, DrawingKind] => typeof entry[1] === 'string' && isDrawingKind(entry[1])))
        : {},
      indicators: version === undefined ? migrateLegacyIndicators(indicators) : normalizeIndicators(indicators),
    }
    if (version === undefined) saveChartPreferences(preferences)
    return preferences
  } catch {
    return defaultChartPreferences
  }
}

let current: ChartPreferences | undefined
let storedText: string | null
const listeners = new Set<() => void>()
const snapshot = () => {
  // Re-read browser changes when the first chart mounts, without replacing active charts' shared snapshot.
  if (!current || (!listeners.size && readStorage() !== storedText)) {
    current = readChartPreferences()
    storedText = readStorage()
  }
  return current
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function update(patch: Partial<ChartPreferences>) {
  const previous = snapshot()
  current = { ...previous, ...patch, favorites: ordered(patch.favorites ?? previous.favorites) }
  saveChartPreferences(current)
  storedText = readStorage()
  for (const listener of listeners) listener()
}

export function useChartPreferences() {
  return [useSyncExternalStore(subscribe, snapshot), update] as const
}
