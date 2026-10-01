// Formatting only. Authoritative amounts and aggregates arrive as decimal strings.
export function money(value: string | null): string {
  if (value === null) return '—'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER || parsed !== 0 && Math.abs(parsed) < 1e-20) {
    return value.startsWith('-') ? `−$${value.slice(1)}` : `$${value}`
  }
  const digits = parsed !== 0 && Math.abs(parsed) < .01 ? Math.min(20, Math.ceil(-Math.log10(Math.abs(parsed))) + 4) : 2
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(parsed)
}
export function amount(value: string): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER && (parsed === 0 || Math.abs(parsed) >= 1e-8) ?
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(parsed) : value
}
export function time(value: string | null): string {
  return value === null ? 'Not refreshed yet' : new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
export const shortAddress = (value: string | null) => value === null ? 'Manual record' : `${value.slice(0, 6)}…${value.slice(-4)}`
export const venueName = (id: string) => ({ hyperliquid: 'Hyperliquid', lighter: 'Lighter', quantfury: 'Quantfury', manual: 'Manual' })[id as 'hyperliquid' | 'lighter' | 'quantfury' | 'manual'] ?? id
