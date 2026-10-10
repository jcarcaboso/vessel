// Formatting is exact; Number conversions are used only for chart geometry and visual sign.
const numeric = (value: string) => value as Intl.StringNumericLiteral
export function reviewMoney(value: string | null, signed = false): string {
  if (value === null) return 'N/A'
  const digits = Number(value) !== 0 && Math.abs(Number(value)) < 1 ? 4 : 2
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits,
    minimumFractionDigits: 0, signDisplay: signed ? 'exceptZero' : 'auto' }).format(numeric(value))
}
export function reviewPercent(value: string | null, fraction = false): string {
  if (value === null) return 'N/A'
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1,
    ...(fraction ? { style: 'percent' as const } : {}) }).format(numeric(value))
  return fraction ? formatted : `${formatted}%`
}
export const reviewMultiple = (value: string | null) => value === null ? 'N/A'
  : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(numeric(value))}×`
export const reviewDate = (at: string, year = false) => new Date(at).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', ...(year ? { year: 'numeric' as const } : {}), timeZone: 'UTC',
})
export const tone = (value: string | null) => value === null || Number(value) === 0 ? '' : Number(value) > 0 ? 'positive' : 'negative'
export const negative = (value: string | null) => value === null ? null : Number(value) === 0 ? '0' : `-${value}`

/** Compare validated plain decimal strings without rounding the selected chart caption. */
export function decimalLess(a: string, b: string): boolean {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0)
  const integer = (value: string) => {
    const [whole, fraction = ''] = value.split('.')
    return BigInt(`${whole}${fraction.padEnd(scale, '0')}`)
  }
  return integer(a) < integer(b)
}
