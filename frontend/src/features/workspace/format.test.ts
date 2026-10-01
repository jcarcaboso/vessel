import { expect, it } from 'vitest'
import { amount, money, time } from './format'

it('keeps unavailable values distinct from a reported zero', () => {
  expect(money(null)).toBe('—')
  expect(money('0')).toBe('$0.00')
})
it('does not display tiny real prices or quantities as zero', () => {
  expect(money('0.000000045')).toBe('$0.000000045')
  expect(amount('0.00000000000000000001')).toBe('0.00000000000000000001')
})
it('does not silently change amounts beyond safe number precision', () => {
  expect(money('1000000000000000.05')).toBe('$1,000,000,000,000,000.05')
  expect(money('9007199254740990.99')).toBe('$9,007,199,254,740,990.99')
  expect(money('79228162514264337593543950335')).toBe('$79,228,162,514,264,337,593,543,950,335.00')
  expect(money('100000.493827156049382715604936')).toBe('$100,000.49')
  expect(amount('79228162514264337593543950335')).toBe('79,228,162,514,264,337,593,543,950,335')
  expect(amount('123456789012.123456789')).toBe('123,456,789,012.12345679')
})
it('formats negative exact totals with the same grouping', () => {
  expect(money('-79228162514264337593543950336.25')).toBe('-$79,228,162,514,264,337,593,543,950,336.25')
  expect(money('-12.5')).toBe('-$12.50')
  expect(amount('-0.000000001234')).toBe('-0.000000001234')
})
it('retains a year in historical dates', () => {
  expect(time('2024-02-15T12:00:00Z')).toContain('2024')
  expect(time(null)).toBe('Not refreshed yet')
})
