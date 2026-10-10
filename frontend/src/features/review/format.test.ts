import { describe, expect, it } from 'vitest'
import { decimalLess, reviewMoney, reviewMultiple, reviewPercent } from './format'

describe('Exact report formatting', () => {
  it('never converts authoritative money to a floating point number', () => {
    expect(reviewMoney('9007199254740993.25')).toBe('$9,007,199,254,740,993.25')
    expect(reviewMoney('-9007199254740993.25', true)).toBe('-$9,007,199,254,740,993.25')
    expect(reviewMoney('0.123456')).toBe('$0.1235')
  })
  it('distinguishes unknown from a genuine zero', () => {
    expect(reviewMoney(null)).toBe('N/A')
    expect(reviewMoney('0', true)).toBe('$0')
    expect(reviewPercent(null)).toBe('N/A')
    expect(reviewMultiple(null)).toBe('N/A')
    expect(reviewPercent('0.5', true)).toBe('50.0%')
    expect(reviewPercent('2.25')).toBe('2.3%')
    expect(reviewMultiple('2.345')).toBe('2.35×')
  })
  it('compares caption extrema without losing fractional precision', () => {
    expect(decimalLess('-9007199254740992.51', '-9007199254740992.50')).toBe(true)
    expect(decimalLess('-0.01', '0')).toBe(true)
    expect(decimalLess('1.01', '1.1')).toBe(true)
    expect(decimalLess('1.00', '1')).toBe(false)
  })
})
