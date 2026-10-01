import { describe, expect, it, vi } from 'vitest'
import { createDraft, createEntry, createTarget } from './draft'

describe('local play drafts', () => {
  it('starts empty and works without secure-context UUID support', () => {
    vi.stubGlobal('crypto', {})
    const draft = createDraft()
    expect(draft.title).toBe('')
    expect(draft.instrument).toBe('')
    expect(draft.accountId).toBe('')
    expect(draft.size).toBe('')
    expect(draft.budgetOverride).toBeNull()
    expect(draft.entries[0]!.price).toBe('')
    expect(draft.entries[0]!.share).toBe('100')
  })

  it('gives each draft independent entries, targets, notes and local identities', () => {
    const first = createDraft()
    const second = createDraft()
    first.entries[0]!.targets[0]!.value = '42'
    first.notes.thesis = 'Reasoning'
    expect(second.entries[0]!.targets[0]!.value).toBe('')
    expect(second.notes.thesis).toBe('')
    const ids = [
      first.entries[0]!.id, second.entries[0]!.id,
      first.entries[0]!.targets[0]!.id, second.entries[0]!.targets[0]!.id,
      createEntry(1).id, createTarget().id,
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})
