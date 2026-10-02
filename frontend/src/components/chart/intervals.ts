import type { CandleInterval } from '@/api/workspace'

const units: Record<string, [string, string]> = { m: ['minute', ''], h: ['hour', ''], d: ['day', 'D'], w: ['week', 'W'], M: ['month', 'M'] }

/** Compact label in the style of trading terminals: 5m, 4h, D, 3D, W, M. */
export function intervalLabel(interval: CandleInterval) {
  const count = interval.slice(0, -1)
  const short = units[interval.slice(-1)]![1]
  return short ? `${count === '1' ? '' : count}${short}` : interval
}

export function intervalName(interval: CandleInterval) {
  const count = Number(interval.slice(0, -1))
  const unit = units[interval.slice(-1)]![0]
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}
