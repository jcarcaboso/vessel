import { decimalSign } from '@/lib/decimal'

export const tone = (value: string | null) => {
  const sign = decimalSign(value)
  return sign === 0 ? '' : sign < 0 ? 'negative' : 'positive'
}

/** Review loss and drawdown magnitudes arrive unsigned; genuine zero has no minus sign. */
export const negative = (value: string | null) => value === null ? null : decimalSign(value) === 0 ? '0' : `-${value}`
