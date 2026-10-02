import type { PriceOverlay } from '@/components/chart/types'
import { createTarget, type DraftEntry, type DraftLevel, type PlayDraft } from './draft'

export type ChartView = 'aggregate' | 'selected'
type LevelRef = { entryId: string; kind: 'entry' } | { entryId: string; kind: 'stop' } | { entryId: string; kind: 'target'; targetId: string }

const separator = '|'
const overlayId = (ref: LevelRef) => ref.kind === 'target'
  ? [ref.entryId, ref.kind, ref.targetId].join(separator) : [ref.entryId, ref.kind].join(separator)

export function parseOverlayId(id: string): LevelRef | null {
  const [entryId, kind, targetId] = id.split(separator)
  if (!entryId) return null
  if (kind === 'entry' || kind === 'stop') return { entryId, kind }
  if (kind === 'target' && targetId) return { entryId, kind, targetId }
  return null
}

const unsigned = (value: string) => /^\d+(\.\d+)?$/.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null
const positive = (value: string) => {
  const number = unsigned(value)
  return number !== null && number > 0 ? number : null
}

/**
 * Plotting position of a stop or target. Percentages are unsigned distances from the entry, so
 * the side follows the direction. This is display placement, not a profit or risk calculation.
 */
export function levelPrice(entryPrice: number | null, level: DraftLevel, kind: 'stop' | 'target', direction: PlayDraft['direction']) {
  if (level.unit === 'price') return positive(level.value)
  const distance = unsigned(level.value)
  if (entryPrice === null || distance === null) return null
  const above = (kind === 'target') === (direction === 'long')
  const price = entryPrice * (1 + (above ? distance : -distance) / 100)
  return price > 0 ? price : null
}

// Stops and targets share risk colors across entries; the tag accent identifies the entry.
const stopColor = 'var(--negative)'
const targetColor = 'var(--positive)'

export const averageOverlayId = 'aggregate:average-entry'

/**
 * Quantity-weighted planned entry price over entries that have both a price and a positive
 * quantity share. Shares are normalized over those entries. Null unless `minimum` entries contribute
 * (two for the chart line, where a single entry's own line already shows its price).
 */
export function averageEntryPrice(entries: readonly DraftEntry[], minimum = 2) {
  const weighted = entries.flatMap(entry => {
    const price = positive(entry.price)
    const share = positive(entry.share)
    return price !== null && share !== null ? [{ price, share }] : []
  })
  if (weighted.length < Math.max(1, minimum)) return null
  const total = weighted.reduce((sum, item) => sum + item.share, 0)
  return weighted.reduce((sum, item) => sum + item.price * item.share, 0) / total
}

export function planOverlays(entries: readonly DraftEntry[], selectedId: string, view: ChartView, direction: PlayDraft['direction']): PriceOverlay[] {
  const overlays: PriceOverlay[] = []
  entries.forEach((entry, index) => {
    const selected = entry.id === selectedId
    if (view === 'selected' && !selected) return
    // Every planned level can be dragged; dragging another entry's level selects that entry.
    const base = { color: entry.color, accent: entry.color, emphasis: selected ? 'selected' as const : 'normal' as const, draggable: true }
    const tag = `E${index + 1}`
    const entryPrice = positive(entry.price)
    if (entryPrice !== null) overlays.push({ ...base, id: overlayId({ entryId: entry.id, kind: 'entry' }), label: tag, price: entryPrice, kind: 'entry' })
    const stop = levelPrice(entryPrice, entry.stop, 'stop', direction)
    if (stop !== null) overlays.push({ ...base, id: overlayId({ entryId: entry.id, kind: 'stop' }), label: `${tag} SL`, price: stop, kind: 'stop', color: stopColor })
    entry.targets.forEach((target, targetIndex) => {
      const price = levelPrice(entryPrice, target, 'target', direction)
      if (price !== null) overlays.push({
        ...base, id: overlayId({ entryId: entry.id, kind: 'target', targetId: target.id }),
        label: `${tag} TP${targetIndex + 1}`, price, kind: 'target', color: targetColor,
      })
    })
  })
  const average = view === 'aggregate' ? averageEntryPrice(entries) : null
  if (average !== null) overlays.push({
    id: averageOverlayId, label: 'AVG', price: average, color: 'var(--foreground)', kind: 'reference', emphasis: 'normal', draggable: false,
  })
  return overlays
}

const trim = (text: string) => text.includes('.') ? text.replace(/\.?0+$/, '') : text

/** Five significant figures (Hyperliquid's perpetual price rule), at most eight decimals, no exponent. */
export function formatDraggedPrice(price: number) {
  const decimals = Math.min(8, Math.max(0, 4 - Math.floor(Math.log10(price))))
  return trim(price.toFixed(decimals))
}

const formatPercent = (percent: number) => trim(percent.toFixed(2))

/** Writes a dragged price back in the level's own unit. Percent levels cannot cross the entry. */
export function applyLevelDrag(entries: readonly DraftEntry[], id: string, price: number, direction: PlayDraft['direction']): DraftEntry[] {
  const ref = parseOverlayId(id)
  if (!ref || !Number.isFinite(price) || price <= 0) return [...entries]
  return entries.map(entry => {
    if (entry.id !== ref.entryId) return entry
    if (ref.kind === 'entry') return { ...entry, price: formatDraggedPrice(price) }
    const entryPrice = positive(entry.price)
    const move = <T extends DraftLevel>(level: T, kind: 'stop' | 'target'): T => {
      if (level.unit === 'price') return { ...level, value: formatDraggedPrice(price) }
      if (entryPrice === null) return level
      const above = (kind === 'target') === (direction === 'long')
      const distance = (above ? price - entryPrice : entryPrice - price) / entryPrice * 100
      return { ...level, value: formatPercent(Math.max(0, distance)) }
    }
    if (ref.kind === 'stop') return { ...entry, stop: move(entry.stop, 'stop') }
    return { ...entry, targets: entry.targets.map(target => target.id === ref.targetId ? move(target, 'target') : target) }
  })
}

/** Default distance for levels added from the chart, as a fraction of the entry price. */
const addedLevelDistance = 0.02

/** Plotted price of one level, or null when it is blank or invalid. */
export function overlayPrice(entry: DraftEntry, id: string, direction: PlayDraft['direction']) {
  const ref = parseOverlayId(id)
  if (!ref || ref.entryId !== entry.id) return null
  const entryPrice = positive(entry.price)
  if (ref.kind === 'entry') return entryPrice
  if (ref.kind === 'stop') return levelPrice(entryPrice, entry.stop, 'stop', direction)
  const target = entry.targets.find(current => current.id === ref.targetId)
  return target ? levelPrice(entryPrice, target, 'target', direction) : null
}

/** Adds a price target beyond the entry in the trade's direction, or null without an entry price. */
export function addChartTarget(entry: DraftEntry, direction: PlayDraft['direction']): DraftEntry | null {
  const entryPrice = positive(entry.price)
  if (entryPrice === null) return null
  const price = entryPrice * (1 + (direction === 'long' ? 1 : -1) * addedLevelDistance * (entry.targets.length + 1))
  return { ...entry, targets: [...entry.targets, { ...createTarget(), value: formatDraggedPrice(price) }] }
}

/** Sets a price stop on the risk side of the entry when the entry has none plotted. */
export function addChartStop(entry: DraftEntry, direction: PlayDraft['direction']): DraftEntry | null {
  const entryPrice = positive(entry.price)
  if (entryPrice === null) return null
  const price = entryPrice * (1 - (direction === 'long' ? 1 : -1) * addedLevelDistance)
  return { ...entry, stop: { ...entry.stop, unit: 'price', value: formatDraggedPrice(price) } }
}

export function removeTarget(entry: DraftEntry, targetId: string): DraftEntry {
  return { ...entry, targets: entry.targets.filter(target => target.id !== targetId) }
}

export function setTargetShare(entry: DraftEntry, targetId: string, share: string): DraftEntry {
  return { ...entry, targets: entry.targets.map(target => target.id === targetId ? { ...target, share } : target) }
}

const scalarFields = ['name', 'price', 'share'] as const
const levelFields = ['unit', 'value'] as const
const targetFields = ['unit', 'value', 'share'] as const

/** Copies only the sub-fields that changed between `from` and `to` onto `current`. */
function patchFields<T extends object, K extends keyof T>(current: T, from: T, to: T, fields: readonly K[]): T {
  let next = current
  for (const field of fields) if (from[field] !== to[field]) next = { ...next, [field]: to[field] }
  return next
}

/**
 * Applies one recorded edit (`from` → `to`) to the current entry, touching only what the edit
 * changed: scalar fields, stop sub-fields, and targets by ID (changed sub-fields, additions and
 * removals). Later edits to other fields or other targets, e.g. in the side editor, are preserved.
 */
export function applyEntryEdit(current: DraftEntry, from: DraftEntry, to: DraftEntry): DraftEntry {
  let next = patchFields(current, from, to, scalarFields)
  const stop = patchFields(current.stop, from.stop, to.stop, levelFields)
  if (stop !== current.stop) next = { ...next, stop }

  const before = new Map(from.targets.map(target => [target.id, target]))
  const after = new Map(to.targets.map(target => [target.id, target]))
  let targets = current.targets
    .filter(target => !(before.has(target.id) && !after.has(target.id)))
    .map(target => {
      const was = before.get(target.id)
      const now = after.get(target.id)
      return was && now ? patchFields(target, was, now, targetFields) : target
    })
  to.targets.forEach((target, index) => {
    if (before.has(target.id) || targets.some(existing => existing.id === target.id)) return
    targets = [...targets.slice(0, index), target, ...targets.slice(index)]
  })
  const unchanged = targets.length === current.targets.length && targets.every((target, index) => target === current.targets[index])
  return unchanged ? next : { ...next, targets }
}
