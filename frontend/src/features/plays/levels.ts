import type { PriceOverlay } from '@/components/chart/types'
import type { DraftEntry, DraftLevel, PlayDraft } from './draft'

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
    const base = { color: entry.color, accent: entry.color, emphasis: selected ? 'selected' as const : 'normal' as const, draggable: selected }
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
