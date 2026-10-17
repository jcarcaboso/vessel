import { describe, expect, it } from 'vitest'
import { identityTextCases } from '@/test/identity-text-fixtures'
import { cleanDisplayName, cleanIdentityText, cleanLabel } from './profile-rules'

describe('identity text rule', () => {
  it.each(identityTextCases)('%s', (_name, input, limit, optional, expected) => {
    expect(cleanIdentityText(input, limit, optional)).toBe(expected)
  })

  it('uses 60 units for display names and 40 for labels', () => {
    expect(cleanDisplayName('a'.repeat(60))).toBe('a'.repeat(60))
    expect(cleanDisplayName('a'.repeat(61))).toBeUndefined()
    expect(cleanDisplayName('  ')).toBeUndefined()
    expect(cleanLabel('a'.repeat(40))).toBe('a'.repeat(40))
    expect(cleanLabel('a'.repeat(41))).toBeUndefined()
    expect(cleanLabel('')).toBeNull()
  })
})
