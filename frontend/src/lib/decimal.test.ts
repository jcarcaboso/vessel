import { describe, expect, it } from 'vitest'
import { decimalLess, decimalSign } from './decimal'

describe('exact plain decimals', () => {
  it.each([null, '0', '-0', '00.000', '-000.000'])('keeps %j neutral', value => {
    expect(decimalSign(value)).toBe(0)
  })
  it.each(['9007199254740993.25', '0.0000000000000000000000000001', `0.${'0'.repeat(324)}1`])('keeps the exact sign of %s', value => {
    expect(decimalSign(value)).toBe(1)
    expect(decimalSign(`-${value}`)).toBe(-1)
  })
  it.each([
    ['-9007199254740992.51', '-9007199254740992.50', true],
    ['9007199254740992.50', '9007199254740992.51', true],
    ['-0.01', '0', true],
    ['1.01', '1.1', true],
    ['1.00', '1', false],
    ['-0.00', '0', false],
    ['-000.0001', '-0.001', false],
    [`0.${'0'.repeat(324)}1`, '0', false],
  ])('compares %s with %s without rounding', (a, b, expected) => {
    expect(decimalLess(a, b)).toBe(expected)
  })
})
