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
  expect(money('79228162514264337593543950335')).toBe('$79228162514264337593543950335')
  expect(amount('79228162514264337593543950335')).toBe('79228162514264337593543950335')
})
it('retains a year in historical dates', () => {
  expect(time('2024-02-15T12:00:00Z')).toContain('2024')
  expect(time(null)).toBe('Not refreshed yet')
})
