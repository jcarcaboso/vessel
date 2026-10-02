import type { ChartDrawing } from '@/components/chart/drawings'

export interface DraftLevel {
  id: string
  unit: 'price' | 'percent'
  value: string
}

export interface DraftTarget extends DraftLevel {
  share: string
}

export interface DraftEntry {
  id: string
  name: string
  color: string
  share: string
  price: string
  stop: DraftLevel
  targets: DraftTarget[]
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
}

const entryColors = ['#b9c9e4', '#edd49e', '#a9d6b6', '#d4b9e4', '#f2b3ac']
// ponytail: session-local IDs also work on HTTP LAN previews; use server IDs when drafts persist.
let nextId = 0
const localId = () => `draft-${++nextId}`

export function createTarget(share = ''): DraftTarget {
  return { id: localId(), unit: 'price', value: '', share }
}

export function createEntry(index: number): DraftEntry {
  return {
    id: localId(), name: `Entry ${index + 1}`, color: entryColors[index % entryColors.length]!,
    share: index === 0 ? '100' : '', price: '',
    stop: { id: localId(), unit: 'price', value: '' },
    targets: [createTarget('100')],
  }
}

export function createDraft(): PlayDraft {
  return {
    title: '', accountId: '', instrument: '', instrumentSource: 'manual', direction: 'long',
    sizingMode: 'margin', size: '', leverage: '1', budgetOverride: null,
    entries: [createEntry(0)],
    notes: { thesis: '', invalidation: '', strategy: '', evidence: '', review: '' },
    drawings: {},
  }
}
