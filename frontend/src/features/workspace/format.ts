// Formatting only. Authoritative amounts and aggregates arrive as decimal strings.
// Intl formats the original decimal string exactly; Number only estimates magnitude
// so tiny prices keep a few significant digits instead of rounding to zero.
const fractionDigits = (value: string, standard: number) => {
  const magnitude = Math.abs(Number(value))
  return magnitude !== 0 && magnitude < 10 ** -standard ? Math.min(100, Math.ceil(-Math.log10(magnitude)) + 4) : standard
}
const decimalString = (value: string) => value as Intl.StringNumericLiteral
export function money(value: string | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: fractionDigits(value, 2) }).format(decimalString(value))
}
export function amount(value: string): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: fractionDigits(value, 8) }).format(decimalString(value))
}
export function time(value: string | null): string {
  return value === null ? 'Not refreshed yet' : new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
export const shortAddress = (value: string | null) => value === null ? 'Manual record' : `${value.slice(0, 6)}…${value.slice(-4)}`
export const venueName = (id: string) => ({ hyperliquid: 'Hyperliquid', lighter: 'Lighter', quantfury: 'Quantfury', manual: 'Manual' })[id as 'hyperliquid' | 'lighter' | 'quantfury' | 'manual'] ?? id
