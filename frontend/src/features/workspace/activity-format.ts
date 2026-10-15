import type { ImportedFill } from '@/api/fills'
import { decimalSign } from '@/lib/decimal'
import type { ActivityOperation } from '@/api/activity'

/** A fill's own trade side from the normalized side, never venue wording: a buy is Long, a sell is Short. */
export function sideDirection(fill: ImportedFill): 'long' | 'short' {
  return fill.side === 'buy' ? 'long' : 'short'
}
/** Classify a decimal string without rounding it to a JavaScript float. */
export function resultSign(value: string | null): 'positive' | 'negative' | 'neutral' {
  const sign = decimalSign(value)
  return sign === 0 ? 'neutral' : sign < 0 ? 'negative' : 'positive'
}
export function duration(opened: string | null, closed: string | null): string {
  if (opened === null) return 'Unknown duration'
  if (closed === null) return 'Still open'
  const minutes = Math.floor((Date.parse(closed) - Date.parse(opened)) / 60_000)
  if (minutes < 1) return '<1m'
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), remainder = minutes % 60
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', remainder ? `${remainder}m` : ''].filter(Boolean).join(' ')
}

/** Display-only, direction-adjusted price return. Never infer leverage or account/margin return. */
export function operationPriceReturn(op: ActivityOperation): string | null {
  if (op.status === 'incomplete' || op.direction === null || op.averageEntryPrice === null || op.averageExitPrice === null) return null
  const scale = Math.max(op.averageEntryPrice.split('.')[1]?.length ?? 0, op.averageExitPrice.split('.')[1]?.length ?? 0)
  const units = (value: string) => {
    const [whole, fraction = ''] = value.split('.')
    return BigInt(whole + fraction.padEnd(scale, '0'))
  }
  const entry = units(op.averageEntryPrice), exit = units(op.averageExitPrice)
  if (entry <= 0n) return null
  const change = (exit - entry) * (op.direction === 'short' ? -1n : 1n)
  const hundredths = ((change < 0n ? -change : change) * 10_000n + entry / 2n) / entry
  return `${hundredths === 0n ? '' : change < 0n ? '-' : '+'}${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}%`
}

export function operationStatus(op: ActivityOperation): { label: string; tone: string } {
  if (op.status === 'incomplete') return { label: 'Incomplete', tone: 'incomplete' }
  if (op.status === 'closed') return { label: 'Closed', tone: 'closed' }
  return resultSign(op.totalExitedQuantity) === 'positive' && resultSign(op.openQuantity) === 'positive'
    ? { label: 'Partially closed', tone: 'partial' } : { label: 'Open', tone: 'open' }
}

export function operationDates(op: ActivityOperation): string {
  const end = op.closedAtUtc ?? (op.status === 'incomplete' ? op.lastOccurredAtUtc : null)
  const year = op.openedAtUtc?.slice(0, 4) !== end?.slice(0, 4) && end !== null
  const date = (value: string, timeOnly = false) => new Date(value).toLocaleString('en-GB', {
    ...(!timeOnly ? { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } as const : {}) } as const : {}),
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
  })
  const opened = op.openedAtUtc === null ? 'Opened unknown' : date(op.openedAtUtc)
  if (end === null) return opened
  const sameDay = op.openedAtUtc?.slice(0, 10) === end.slice(0, 10)
  return `${opened} → ${op.closedAtUtc === null ? 'last fill ' : ''}${date(end, sameDay)}`
}
