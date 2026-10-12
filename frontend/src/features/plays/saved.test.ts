import { describe, expect, it } from 'vitest'
import { createDraft, createEntry } from './draft'
import { savedPlayFixture } from '@/test/workspace-fixture'
import { createPlaysSession, draftFromSaved, hasDraftContent, savedState, startNewPlay } from './saved'

describe('Unsaved draft protection', () => {
  it('starts a blank editor from a clean session without retaining the saved Play', () => {
    const draft = draftFromSaved(savedPlayFixture, [])
    const next = startNewPlay({ view: 'list', draft, saved: savedState(savedPlayFixture, draft) })
    expect(next.view).toBe('editor')
    expect(next.saved).toBeNull()
    expect(hasDraftContent(next.draft)).toBe(false)
  })
  it('opens the existing editor when an unsaved draft or saved Play has changes', () => {
    const session = createPlaysSession()
    session.draft.budgetOverride = '123'
    expect(startNewPlay(session)).toMatchObject({ view: 'editor', draft: session.draft })
    expect(startNewPlay(session).draft).toBe(session.draft)
    const draft = draftFromSaved(savedPlayFixture, [])
    const saved = savedState(savedPlayFixture, draft)
    draft.title = 'Unsaved saved-Play edit'
    const next = startNewPlay({ view: 'list', draft, saved })
    expect(next.draft).toBe(draft)
    expect(next.saved).toBe(saved)
  })
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
