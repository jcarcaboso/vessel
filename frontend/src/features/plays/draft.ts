import type { ChartDrawing } from '@/components/chart/drawings'
import type { ImageMarkup } from './markup'

/**
 * A stop or target. A percent value is the return on margin at the play's leverage, so the price
 * moves value ÷ leverage percent from the entry. Share is the part of the entry it closes.
 */
export interface DraftExit {
  id: string
  unit: 'price' | 'percent'
  value: string
  share: string
}

export interface DraftEntry {
  id: string
  name: string
  color: string
  share: string
  price: string
  stops: DraftExit[]
  targets: DraftExit[]
}

export interface PlayDraft {
  title: string
  accountId: string
  instrument: string
  instrumentSource: 'venue' | 'manual'
  direction: 'long' | 'short'
  sizingMode: 'margin' | 'quantity'
  size: string
  leverage: string
  budgetOverride: string | null
  entries: DraftEntry[]
  notes: Record<'thesis' | 'invalidation' | 'strategy' | 'evidence' | 'review', string>
  /** Chart drawings per venue instrument key (`venueId:contractId`), kept when the instrument changes. */
  drawings: Record<string, ChartDrawing[]>
  /** Chart captures and uploaded images. They stay in the browser until the Play is saved. */
  evidence: DraftEvidence[]
}

export interface DraftEvidence {
  id: string
  /** Server evidence ID once the image is stored with a saved Play. */
  serverId?: string
  /** Note and marks as last saved, to detect edits that still need saving. */
  savedState?: { note: string; markup: ImageMarkup | null }
  source: 'capture' | 'upload'
  image: Blob
  /** Upload file name, or a generated name for captures; used when downloading. */
  name: string
  /** What a capture shows, e.g. "BTC · Hyperliquid · 1 hour"; empty for uploads. */
  context: string
  note: string
  /** Marks drawn over the image; the original `image` is never changed. */
  markup: ImageMarkup | null
  addedAt: string
}

const entryColors = ['#b9c9e4', '#edd49e', '#a9d6b6', '#d4b9e4', '#f2b3ac']
// Saved plans keep these IDs, so they must not repeat across page loads. randomUUID needs a secure
// context, which HTTP LAN previews lack, so time and randomness stand in for it.
let nextId = 0
const localId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${(++nextId).toString(36)}`

export const createEvidenceId = localId

export function createExit(share = ''): DraftExit {
  return { id: localId(), unit: 'price', value: '', share }
}

export function createEntry(index: number): DraftEntry {
  return {
    id: localId(), name: `Entry ${index + 1}`, color: entryColors[index % entryColors.length]!,
    share: index === 0 ? '100' : '', price: '',
    stops: [createExit('100')],
    targets: [createExit('100')],
  }
}

/** A blank entry after the existing ones, named after the first free "Entry n". */
export function createNextEntry(entries: readonly DraftEntry[]): DraftEntry {
  let index = entries.length
  while (entries.some(entry => entry.name === `Entry ${index + 1}`)) index += 1
  return createEntry(index)
}

export function createDraft(): PlayDraft {
  return {
    title: '', accountId: '', instrument: '', instrumentSource: 'manual', direction: 'long',
    sizingMode: 'margin', size: '', leverage: '1', budgetOverride: null,
    entries: [createEntry(0)],
    notes: { thesis: '', invalidation: '', strategy: '', evidence: '', review: '' },
    drawings: {},
    evidence: [],
  }
}
