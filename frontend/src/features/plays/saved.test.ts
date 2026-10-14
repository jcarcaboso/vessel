import { describe, expect, it } from 'vitest'
import { createDraft, createEntry } from './draft'
import { savedPlayFixture } from '@/test/workspace-fixture'
import { createPlaysSession, draftFromSaved, hasDraftContent, observedPlayVersion, savedState, startNewPlay } from './saved'
import { createWorkspaceApi } from '@/api/workspace'

describe('Unsaved draft protection', () => {
  it('starts a blank editor from a clean session without retaining the saved Play', () => {
    const draft = draftFromSaved(savedPlayFixture, [])
    const next = startNewPlay({ view: 'list', draft, saved: savedState(savedPlayFixture, draft),
      observedPlay: { api: createWorkspaceApi('test'), id: savedPlayFixture.summary.id, accountId: savedPlayFixture.summary.accountId, version: 6, conflict: true } })
    expect(next.view).toBe('editor')
    expect(next.saved).toBeNull()
    expect(next.observedPlay).toBeNull()
    expect(hasDraftContent(next.draft)).toBe(false)
  })
  it('keeps the observed version apart from the baseline and scopes it to the API, Play and account', () => {
    const api = createWorkspaceApi('test')
    const draft = draftFromSaved(savedPlayFixture, [])
    const saved = savedState(savedPlayFixture, draft)
    const observedPlay = { api, id: saved.summary.id, accountId: saved.summary.accountId, version: 6, conflict: true }
    const session = { ...createPlaysSession(), draft, saved, observedPlay }
    expect(observedPlayVersion(session, api)).toBe(6)
    expect(session.saved.summary.version).toBe(savedPlayFixture.summary.version)
    expect(observedPlayVersion(session, createWorkspaceApi('new identity'))).toBe(saved.summary.version)
    expect(observedPlayVersion({ ...session, observedPlay: { ...observedPlay, id: 'other-play' } }, api)).toBe(saved.summary.version)
    expect(observedPlayVersion({ ...session, observedPlay: { ...observedPlay, accountId: 'other-account' } }, api)).toBe(saved.summary.version)
    expect(observedPlayVersion({ ...session, saved: null }, api)).toBe(0)
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
