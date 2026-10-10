import type { WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import type { PlanEntry, PlayFields, PlayPlan, PlaySummary, SavedEvidence, SavedPlay } from '@/api/plays'
import { isChartDrawing, type ChartDrawing } from '@/components/chart/drawings'
import { createDraft, createEvidenceId, type DraftEvidence, type PlayDraft } from './draft'

export const failure = (cause: unknown) => cause instanceof ApiError ? cause.message : 'The change could not be completed. Try again.'

/** What was last saved, to tell unsaved edits and plan changes (which need a reason) apart. */
export interface SavedState {
  summary: PlaySummary
  fieldsKey: string
  planKey: string
  /** Server evidence IDs present at the last save; a missing one was removed locally. */
  evidenceIds: string[]
}

/** Kept by the shell, so navigating away and back keeps the open play and its unsaved edits. */
export interface PlaysSession {
  view: 'list' | 'editor'
  draft: PlayDraft
  saved: SavedState | null
}
export const createPlaysSession = (): PlaysSession => ({ view: 'list', draft: createDraft(), saved: null })

export function hasDraftContent(draft: PlayDraft) {
  return !!(draft.title.trim() || draft.accountId || draft.instrument || draft.evidence.length || draft.notes.review.trim() ||
    Object.values(draft.drawings).some(items => items.length) || planContent(draft) !== blankPlanContent)
}

export function planFromDraft(draft: PlayDraft): PlayPlan {
  return {
    direction: draft.direction, sizingMode: draft.sizingMode, size: draft.size, leverage: draft.leverage,
    budgetOverride: draft.budgetOverride,
    entries: draft.entries.map(({ id, name, color, share, price, stops, targets }) => ({
      id, name, color, share, price, stops: stops.map(stop => ({ ...stop })), targets: targets.map(target => ({ ...target })),
    })),
    notes: { thesis: draft.notes.thesis, invalidation: draft.notes.invalidation, strategy: draft.notes.strategy, evidence: draft.notes.evidence },
  }
}

// Generated IDs are not edits; every plan value and its entry/exit structure is.
const planContent = (draft: PlayDraft) => JSON.stringify(planFromDraft(draft), (key, value: unknown) => key === 'id' ? undefined : value)
const blankPlanContent = planContent(createDraft())

export function fieldsFromDraft(draft: PlayDraft): PlayFields {
  return {
    accountId: draft.accountId, instrument: draft.instrument || null, instrumentSource: draft.instrumentSource,
    title: draft.title, plan: planFromDraft(draft), drawings: draft.drawings, review: draft.notes.review,
  }
}

const planKey = (plan: PlayPlan) => JSON.stringify(plan)
const fieldsKey = (draft: PlayDraft) => JSON.stringify(fieldsFromDraft(draft))

export function savedState(play: SavedPlay, draft: PlayDraft): SavedState {
  return {
    summary: play.summary, fieldsKey: fieldsKey(draft), planKey: planKey(planFromDraft(draft)),
    evidenceIds: draft.evidence.flatMap(item => item.serverId ? [item.serverId] : []),
  }
}

export const planChanged = (draft: PlayDraft, saved: SavedState) => planKey(planFromDraft(draft)) !== saved.planKey

function evidenceChanged(draft: PlayDraft, saved: SavedState) {
  const present = new Set(draft.evidence.map(item => item.serverId))
  return saved.evidenceIds.some(id => !present.has(id)) || draft.evidence.some(item => !item.serverId || !item.savedState ||
    item.savedState.note !== item.note || JSON.stringify(item.savedState.markup) !== JSON.stringify(item.markup))
}

export function isDirty(draft: PlayDraft, saved: SavedState | null) {
  if (!saved) return true
  return fieldsKey(draft) !== saved.fieldsKey || evidenceChanged(draft, saved)
}

/** Builds the editable draft of a saved Play. Drawings the chart does not recognize are dropped. */
export function draftFromSaved(play: SavedPlay, evidence: DraftEvidence[]): PlayDraft {
  const drawings: Record<string, ChartDrawing[]> = {}
  for (const [key, items] of Object.entries(play.drawings)) drawings[key] = items.filter(isChartDrawing)
  return {
    title: play.summary.title, accountId: play.summary.accountId, instrument: play.summary.instrument ?? '',
    instrumentSource: play.summary.instrumentSource, direction: play.plan.direction, sizingMode: play.plan.sizingMode,
    size: play.plan.size, leverage: play.plan.leverage, budgetOverride: play.plan.budgetOverride,
    entries: play.plan.entries.map((entry: PlanEntry) => ({ ...entry, stops: entry.stops.map(stop => ({ ...stop })), targets: entry.targets.map(target => ({ ...target })) })),
    notes: { ...play.plan.notes, review: play.review },
    drawings, evidence,
  }
}

const extension = (type: string) => type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'

export function draftEvidenceFromSaved(item: SavedEvidence, image: Blob): DraftEvidence {
  return {
    id: createEvidenceId(), serverId: item.id, savedState: { note: item.note, markup: item.markup },
    source: item.source, image, name: `vessel-${item.source}-${item.createdAtUtc.slice(0, 10)}-${item.id.slice(0, 8)}.${extension(item.contentType)}`,
    context: '', note: item.note, markup: item.markup, addedAt: item.createdAtUtc,
  }
}

/** Loads a saved Play with its evidence images. */
export async function loadSavedPlay(api: WorkspaceApi, id: string, signal?: AbortSignal) {
  const [play, items] = await Promise.all([api.play(id, signal), api.evidence(id, signal)])
  const evidence = await Promise.all(items.map(async item => draftEvidenceFromSaved(item, await api.evidenceImage(item.id, signal))))
  const draft = draftFromSaved(play, evidence)
  return { draft, saved: savedState(play, draft) }
}

/**
 * Brings server evidence in line with the draft: removes deleted images, uploads new ones and saves
 * changed notes and marks. Stops at the first failure; what succeeded is reflected in the result.
 */
export async function syncEvidence(api: WorkspaceApi, playId: string, evidence: DraftEvidence[], savedIds: string[]) {
  const present = new Set(evidence.map(item => item.serverId))
  const result: DraftEvidence[] = []
  let error: unknown = null
  const pendingDeletes: string[] = []
  for (const id of savedIds.filter(id => !present.has(id))) {
    if (error) { pendingDeletes.push(id); continue }
    try { await api.deleteEvidence(id) } catch (failure) { error = failure; pendingDeletes.push(id) }
  }
  for (const item of evidence) {
    if (error) { result.push(item); continue }
    try {
      if (!item.serverId) {
        const saved = await api.uploadEvidence(playId, item.image, { source: item.source, note: item.note, markup: item.markup, name: item.name })
        result.push({ ...item, serverId: saved.id, savedState: { note: saved.note, markup: saved.markup } })
        continue
      }
      let state = item.savedState ?? { note: '', markup: null }
      if (state.note !== item.note) state = { ...state, note: (await api.updateEvidenceNote(item.serverId, item.note)).note }
      if (JSON.stringify(state.markup) !== JSON.stringify(item.markup)) state = { ...state, markup: (await api.updateEvidenceMarkup(item.serverId, item.markup)).markup }
      result.push({ ...item, savedState: state })
    } catch (failure) {
      error = failure
      result.push(item)
    }
  }
  // Deletions that failed stay in the saved list, so the next save retries them.
  return { evidence: result, error, pendingDeletes }
}

const levelText = (level: { unit: string; value: string }) => level.value === '' ? 'blank' : level.unit === 'percent' ? `${level.value}%` : level.value

/** Readable differences between two plan revisions, for the history view. */
export function describePlanChanges(before: PlayPlan, after: PlayPlan): string[] {
  const changes: string[] = []
  const field = (label: string, a: string | null, b: string | null) => {
    if (a !== b) changes.push(`${label}: ${a || 'blank'} → ${b || 'blank'}`)
  }
  field('Direction', before.direction, after.direction)
  field('Sizing', `${before.size} ${before.sizingMode}`.trim(), `${after.size} ${after.sizingMode}`.trim())
  field('Leverage', `${before.leverage}×`, `${after.leverage}×`)
  field('Budget', before.budgetOverride, after.budgetOverride)
  const previous = new Map(before.entries.map(entry => [entry.id, entry]))
  for (const entry of after.entries) {
    const old = previous.get(entry.id)
    if (!old) { changes.push(`${entry.name} added at ${entry.price || 'no price'}`); continue }
    previous.delete(entry.id)
    field(`${entry.name} price`, old.price, entry.price)
    field(`${entry.name} share`, old.share && `${old.share}%`, entry.share && `${entry.share}%`)
    for (const kind of ['stop', 'target'] as const) {
      const list = (plan: PlanEntry) => kind === 'stop' ? plan.stops : plan.targets
      const exits = new Map(list(old).map(exit => [exit.id, exit]))
      list(entry).forEach((exit, index) => {
        const was = exits.get(exit.id)
        const name = kind === 'target' || list(entry).length > 1 ? `${entry.name} ${kind} ${index + 1}` : `${entry.name} ${kind}`
        if (!was) { changes.push(`${name} added at ${levelText(exit)}`); return }
        exits.delete(exit.id)
        if (levelText(was) !== levelText(exit)) changes.push(`${name}: ${levelText(was)} → ${levelText(exit)}`)
        if (was.share !== exit.share) changes.push(`${name} share: ${was.share || 'blank'}% → ${exit.share || 'blank'}%`)
      })
      for (const removed of exits.values()) changes.push(`${entry.name} ${kind} at ${levelText(removed)} removed`)
    }
  }
  for (const removed of previous.values()) changes.push(`${removed.name} removed`)
  for (const [key, label] of [['thesis', 'Thesis'], ['invalidation', 'Invalidation'], ['strategy', 'Strategy'], ['evidence', 'Evidence notes']] as const) {
    if (before.notes[key] !== after.notes[key]) changes.push(`${label} edited`)
  }
  return changes
}
