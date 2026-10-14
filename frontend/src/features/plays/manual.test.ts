import { describe, expect, it } from 'vitest'
import { emptyManualDraft, manualRequest } from './manual'

const draft = { ...emptyManualDraft(), entryId: 'entry-1', side: 'buy' as const, quantity: '1', price: '100', source: 'Statement' }

describe('manual UTC time input', () => {
  it.each([
    ['2026-10-13T10:00', '2026-10-13T10:00:00Z'],
    ['2026-10-13T10:00:00', '2026-10-13T10:00:00Z'],
    ['2026-10-13T10:00:00.123456', '2026-10-13T10:00:00.123456Z'],
    ['2026-10-13T10:00:00.123456Z', '2026-10-13T10:00:00.123456Z'],
    ['2026-10-13T10:00:00.123456+00:00', '2026-10-13T10:00:00.123456+00:00'],
  ])('accepts %s without losing precision', (time, expected) => {
    const result = manualRequest({ ...draft, occurredAtUtc: time }, 2, 'long', ['entry-1'])
    expect(result).toHaveProperty('input.occurredAtUtc', expected)
  })
  it.each(['', 'not a time', '2026-02-30T10:00:00Z', '2026-10-13T10:00:00+01:00', '2999-01-01T10:00:00Z'])(
    'rejects invalid or future UTC input %s', time => {
      const result = manualRequest({ ...draft, occurredAtUtc: time }, 2, 'long', ['entry-1'])
      expect(result).toHaveProperty('error')
      expect(result).not.toHaveProperty('input')
    },
  )
})
