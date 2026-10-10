import { describe, expect, it } from 'vitest'
import { createDraft, createEntry } from './draft'
import { hasDraftContent } from './saved'

describe('Unsaved draft protection', () => {
  it('ignores generated IDs in a new blank draft', () => {
    expect(hasDraftContent(createDraft())).toBe(false)
    expect(hasDraftContent(createDraft())).toBe(false)
  })
  it.each([
    { leverage: '2' }, { direction: 'short' as const }, { sizingMode: 'quantity' as const },
    { budgetOverride: '100' }, { entries: [createEntry(0), createEntry(1)] },
    { entries: [{ ...createEntry(0), name: 'Renamed' }] },
    { entries: [{ ...createEntry(0), stops: [] }] },
  ])('protects plan-only edits %#', change => {
    expect(hasDraftContent({ ...createDraft(), ...change })).toBe(true)
  })
})
