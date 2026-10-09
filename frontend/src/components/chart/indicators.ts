import type { ChartCandle } from './types'

/**
 * Chart indicators: four exponential moving averages on the price pane, and volume and RSI in their own
 * panes. Values are computed from the loaded display candles for plotting only; they are not signals.
 */

export interface EmaSetting {
  id: string
  enabled: boolean
  period: number
  /** `#rrggbb`. */
  color: string
}

/** Normal shares the height with the price pane; minimized keeps only the pane's bar. */
export type PaneSize = 'normal' | 'minimized' | 'maximized'
export type IndicatorPaneId = 'volume' | 'rsi'

export interface PaneSetting {
  enabled: boolean
  size: PaneSize
}

export interface IndicatorSettings {
  emas: EmaSetting[]
  volume: PaneSetting
  rsi: PaneSetting & { period: number; color: string }
}

export const emaPeriodLimits = { min: 1, max: 500 } as const
export const rsiPeriodLimits = { min: 2, max: 100 } as const
/** Overbought and oversold guides on the RSI pane. */
export const rsiGuides = [70, 30] as const

/** Purple for the fastest average, then traffic-light colors from fast to slow. */
export const defaultIndicators: IndicatorSettings = {
  emas: [
    { id: 'ema-1', enabled: true, period: 9, color: '#b388ff' },
    { id: 'ema-2', enabled: true, period: 21, color: '#4cbb6c' },
    { id: 'ema-3', enabled: true, period: 50, color: '#f2c94c' },
    { id: 'ema-4', enabled: true, period: 200, color: '#ef5350' },
  ],
  volume: { enabled: true, size: 'normal' },
  rsi: { enabled: true, size: 'normal', period: 14, color: '#7fb2f0' },
}

/** Swatches offered for indicator colors; any `#rrggbb` can still be chosen. */
export const indicatorColors = ['#b388ff', '#4cbb6c', '#f2c94c', '#ef5350', '#7fb2f0', '#4dd0e1', '#ff9f43', '#f48fb1', '#e9edf2', '#9aa3b0'] as const

const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
const isSize = (value: unknown): value is PaneSize => value === 'normal' || value === 'minimized' || value === 'maximized'
const period = (value: unknown, limits: { min: number; max: number }, fallback: number) =>
  Number.isInteger(value) && (value as number) >= limits.min && (value as number) <= limits.max ? value as number : fallback
const record = (value: unknown) => typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}

/** Reads stored settings, keeping each valid field and defaulting the rest. */
export function normalizeIndicators(value: unknown): IndicatorSettings {
  const stored = record(value)
  const emas = Array.isArray(stored.emas) ? stored.emas : []
  const pane = (raw: unknown, fallback: PaneSetting): PaneSetting => {
    const { enabled, size } = record(raw)
    return { enabled: typeof enabled === 'boolean' ? enabled : fallback.enabled, size: isSize(size) ? size : fallback.size }
  }
  const rsi = record(stored.rsi)
  const volume = pane(stored.volume, defaultIndicators.volume)
  const rsiPane = pane(rsi, defaultIndicators.rsi)
  // Only one pane is maximized at a time; Volume keeps it if both were stored maximized.
  if (volume.size === 'maximized' && rsiPane.size === 'maximized') rsiPane.size = 'normal'
  return {
    emas: defaultIndicators.emas.map((fallback, index) => {
      const { enabled, period: length, color } = record(emas[index])
      return {
        id: fallback.id,
        enabled: typeof enabled === 'boolean' ? enabled : fallback.enabled,
        period: period(length, emaPeriodLimits, fallback.period),
        color: isColor(color) ? color.toLowerCase() : fallback.color,
      }
    }),
    volume,
    rsi: {
      ...rsiPane,
      period: period(rsi.period, rsiPeriodLimits, defaultIndicators.rsi.period),
      color: isColor(rsi.color) ? rsi.color.toLowerCase() : defaultIndicators.rsi.color,
    },
  }
}

/** Sets a pane's size; only one pane is maximized at a time. */
export function resizePane(settings: IndicatorSettings, id: IndicatorPaneId, size: PaneSize): IndicatorSettings {
  const other: IndicatorPaneId = id === 'rsi' ? 'volume' : 'rsi'
  return {
    ...settings,
    [id]: { ...settings[id], size },
    ...(size === 'maximized' && settings[other].size === 'maximized' ? { [other]: { ...settings[other], size: 'normal' } } : {}),
  }
}

/**
 * Exponential moving average seeded with the simple average of the first `period` values. Earlier
 * points are null rather than a partial average.
 */
export function ema(values: readonly number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null)
  if (period < 1 || values.length < period) return result
  const k = 2 / (period + 1)
  let average = 0
  for (let index = 0; index < period; index++) average += values[index]! / period
  result[period - 1] = average
  for (let index = period; index < values.length; index++) {
    average = values[index]! * k + average * (1 - k)
    result[index] = average
  }
  return result
}

/** Relative strength index with Wilder's smoothing; the first `period` points are null. */
export function rsi(values: readonly number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null)
  if (period < 1 || values.length <= period) return result
  let gain = 0
  let loss = 0
  for (let index = 1; index <= period; index++) {
    const change = values[index]! - values[index - 1]!
    if (change > 0) gain += change
    else loss -= change
  }
  gain /= period
  loss /= period
  const value = () => loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss)
  result[period] = value()
  for (let index = period + 1; index < values.length; index++) {
    const change = values[index]! - values[index - 1]!
    gain = (gain * (period - 1) + Math.max(change, 0)) / period
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period
    result[index] = value()
  }
  return result
}

export interface IndicatorLine {
  id: string
  label: string
  color: string
  values: (number | null)[]
}

/** Renderer input: values aligned with `times` (the candles' open times). */
export interface IndicatorView {
  times: number[]
  /** Enabled moving averages on the price pane. */
  lines: IndicatorLine[]
  volume: { size: PaneSize; values: number[]; up: boolean[] } | null
  rsi: (IndicatorLine & { size: PaneSize; guides: readonly number[] }) | null
}

export const emaLabel = (setting: Pick<EmaSetting, 'period'>) => `EMA ${setting.period}`
export const rsiLabel = (setting: Pick<IndicatorSettings['rsi'], 'period'>) => `RSI ${setting.period}`

export function computeIndicators(candles: readonly ChartCandle[], settings: IndicatorSettings): IndicatorView {
  const closes = candles.map(candle => candle.close)
  return {
    times: candles.map(candle => candle.time),
    lines: settings.emas.filter(setting => setting.enabled)
      .map(setting => ({ id: setting.id, label: emaLabel(setting), color: setting.color, values: ema(closes, setting.period) })),
    volume: settings.volume.enabled ? {
      size: settings.volume.size,
      values: candles.map(candle => candle.volume),
      up: candles.map(candle => candle.close >= candle.open),
    } : null,
    rsi: settings.rsi.enabled ? {
      id: 'rsi', label: rsiLabel(settings.rsi), color: settings.rsi.color, size: settings.rsi.size, guides: rsiGuides,
      values: rsi(closes, settings.rsi.period),
    } : null,
  }
}

/**
 * Short description of the indicators, e.g. for a capture caption. `shown` gives each pane's size on
 * screen when it differs from the chosen one (a short chart minimizes panes).
 */
export function describeIndicators(settings: IndicatorSettings, shown: Partial<Record<IndicatorPaneId, PaneSize>> = {}) {
  const emas = settings.emas.filter(setting => setting.enabled).map(setting => setting.period)
  const pane = (id: IndicatorPaneId, label: string) => !settings[id].enabled ? ''
    : (shown[id] ?? settings[id].size) === 'minimized' ? `${label} minimized, not plotted` : label
  return [
    emas.length ? `EMA ${emas.join('/')}` : '',
    pane('volume', 'Volume'),
    pane('rsi', rsiLabel(settings.rsi)),
  ].filter(Boolean).join(' · ')
}

/** Position of an indicator pane in chart-container pixels, for its control bar. */
export interface PaneLayout {
  id: IndicatorPaneId
  top: number
  height: number
  /** Left edge and width of the plotting area, between the price scales. */
  left: number
  width: number
  /** What is shown, which can differ from the chosen size when the chart is too short. */
  effectiveSize: PaneSize
  /** Minimized only because the chart is too short to plot it. */
  compacted: boolean
}
