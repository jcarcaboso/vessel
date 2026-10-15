import { describe, expect, it } from 'vitest'
import { defaultPortfolioIcon, isPortfolioIconKey, portfolioIconKeys } from '@/api/portfolio-icons'
import { portfolioIconKey, portfolioIcons } from './portfolio-icons'

describe('portfolio icon keys', () => {
  it('lists distinct short keys with a drawn icon for each, in picker order', () => {
    expect(new Set(portfolioIconKeys).size).toBe(portfolioIconKeys.length)
    expect(portfolioIconKeys.every(key => /^[a-z]+(-[a-z]+)*$/.test(key) && key.length <= 40)).toBe(true)
    expect(Object.keys(portfolioIcons)).toEqual([...portfolioIconKeys])
    expect(portfolioIconKeys[0]).toBe(defaultPortfolioIcon)
  })
  it.each([7, null, undefined, '', 'Folder', 'toString', '__proto__', 'x'.repeat(41)])('rejects unknown key %j', key => {
    expect(isPortfolioIconKey(key)).toBe(false)
  })
  it('shows unknown stored keys as the default icon', () => {
    expect(isPortfolioIconKey('rocket')).toBe(true)
    expect(portfolioIconKey('rocket')).toBe('rocket')
    expect(portfolioIconKey('unknown')).toBe(defaultPortfolioIcon)
    expect(portfolioIconKey(undefined)).toBe(defaultPortfolioIcon)
  })
})
