import type { ImportedFill } from '@/api/workspace'

/** Use normalized facts, never venue wording. A close's side is opposite its position direction. */
export function fillDirection(fill: ImportedFill): 'long' | 'short' | null {
  if (fill.positionEffect === 'unknown' || fill.positionEffect === 'flip') return null
  return (fill.side === 'buy') === (fill.positionEffect === 'open') ? 'long' : 'short'
}
/** Classify a decimal string without rounding it to a JavaScript float. */
export function resultSign(value: string | null): 'positive' | 'negative' | 'neutral' {
  if (value === null || !/[1-9]/.test(value)) return 'neutral'
  return value.startsWith('-') ? 'negative' : 'positive'
}
export function duration(opened: string | null, closed: string | null): string {
  if (opened === null) return 'Unknown duration'
  if (closed === null) return 'Still open'
  const minutes = Math.floor((Date.parse(closed) - Date.parse(opened)) / 60_000)
  if (minutes < 1) return '<1m'
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), remainder = minutes % 60
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', remainder ? `${remainder}m` : ''].filter(Boolean).join(' ')
}
