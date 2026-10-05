import type { DraftEntry, PlayDraft } from './draft'
import { averageEntryPrice, exitsOf, levelPrice, type ExitKind } from './levels'

const positive = (value: string) => /^\d+(\.\d+)?$/.test(value.trim()) && Number(value) > 0 ? Number(value) : null

/**
 * Whole-position size at a leverage, before fees. Margin sizing fixes the margin, so leverage changes
 * the notional and quantity; quantity sizing fixes the quantity, so leverage changes the margin.
 * Notional uses the quantity-weighted planned average entry. Unknown parts are null.
 */
export interface PositionSize {
  margin: number | null
  notional: number | null
  quantity: number | null
  averageEntry: number | null
}

export function positionSize(draft: Pick<PlayDraft, 'size' | 'sizingMode' | 'entries'>, leverage: number): PositionSize {
  const size = positive(draft.size)
  const averageEntry = averageEntryPrice(draft.entries, 1)
  const lever = Math.max(1, leverage)
  if (size === null) return { margin: null, notional: null, quantity: null, averageEntry }
  if (draft.sizingMode === 'margin') {
    const notional = size * lever
    return { margin: size, notional, quantity: averageEntry === null ? null : notional / averageEntry, averageEntry }
  }
  const notional = averageEntry === null ? null : size * averageEntry
  return { margin: notional === null ? null : notional / lever, notional, quantity: size, averageEntry }
}

/** Units for the size readout: the quote asset (e.g. USDC) and the contract (e.g. ETH) when known. */
export interface SizeUnits {
  quote: string
  base: string
  /** Venue quantity precision; null rounds to five significant figures. */
  quantityDecimals: number | null
}

/** Without a venue contract the units are generic. */
export const defaultSizeUnits: SizeUnits = { quote: 'quote units', base: 'units', quantityDecimals: null }

const money = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

export function formatMoney(value: number, units: SizeUnits) {
  return `${money.format(value)} ${units.quote}`
}

export function formatQuantity(value: number, units: SizeUnits) {
  const digits = units.quantityDecimals ?? Math.min(8, Math.max(0, 4 - Math.floor(Math.log10(Math.abs(value) || 1))))
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value)} ${units.base}`
}

/** What a leverage change does to the position size, in one sentence. Null when the size is not known. */
export function sizeChange(draft: Pick<PlayDraft, 'size' | 'sizingMode' | 'entries'>, from: number, to: number, units: SizeUnits) {
  const before = positionSize(draft, from)
  const after = positionSize(draft, to)
  if (draft.sizingMode === 'margin' && before.margin !== null && before.notional !== null && after.notional !== null) {
    const quantity = before.quantity !== null && after.quantity !== null
      ? ` (${formatQuantity(before.quantity, units)} → ${formatQuantity(after.quantity, units)})` : ''
    return `Margin stays ${formatMoney(before.margin, units)}; the position goes from ${formatMoney(before.notional, units)} to ${formatMoney(after.notional, units)}${quantity}.`
  }
  if (draft.sizingMode === 'quantity' && before.quantity !== null && before.margin !== null && after.margin !== null)
    return `Quantity stays ${formatQuantity(before.quantity, units)}; margin goes from ${formatMoney(before.margin, units)} to ${formatMoney(after.margin, units)}.`
  return null
}

/**
 * The same position in the other sizing unit: margin ↔ quantity at the leverage and planned average
 * entry. Blank when the size or an entry price is missing, so nothing is invented.
 */
export function convertSize(draft: Pick<PlayDraft, 'size' | 'sizingMode' | 'entries'>, leverage: number, units: SizeUnits) {
  const sized = positionSize(draft, leverage)
  if (draft.sizingMode === 'margin') {
    if (sized.quantity === null) return ''
    const digits = units.quantityDecimals ?? 6
    return String(Number(sized.quantity.toFixed(digits)))
  }
  return sized.margin === null ? '' : String(Number(sized.margin.toFixed(2)))
}

/**
 * The play's budget: the manual amount when set, otherwise what the account has available. An empty
 * wallet is not a budget. Null when neither is known.
 */
export function playBudget(draft: Pick<PlayDraft, 'budgetOverride'>, available: string | null | undefined) {
  const usable = available != null && Number(available) > 0 ? available : null
  const value = draft.budgetOverride ?? usable
  return value === null ? null : { value, amount: Number(value), source: draft.budgetOverride !== null ? 'manual' as const : 'available' as const }
}

/** Margin above the budget, before fees. Null when it fits or either side is unknown. */
export function marginOverBudget(draft: Pick<PlayDraft, 'size' | 'sizingMode' | 'entries' | 'budgetOverride'>, leverage: number, available: string | null | undefined) {
  const budget = playBudget(draft, available)
  const { margin } = positionSize(draft, leverage)
  // Cents of rounding are not worth blocking a plan.
  if (budget === null || margin === null || margin <= budget.amount + 0.005) return null
  return { margin, budget }
}

/** The size field value that uses the whole budget, or null when it cannot be converted. Quantities round down. */
export function sizeForBudget(draft: Pick<PlayDraft, 'sizingMode' | 'entries'>, leverage: number, budget: string, units: SizeUnits) {
  if (draft.sizingMode === 'margin') return budget
  const averageEntry = averageEntryPrice(draft.entries, 1)
  if (averageEntry === null) return null
  const factor = 10 ** (units.quantityDecimals ?? 6)
  return String(Math.floor(Number(budget) * Math.max(1, leverage) / averageEntry * factor) / factor)
}

/**
 * Share-weighted distance from the entry price to its stops or targets, on their correct side.
 * Shares are normalized over the levels with a price; blank shares count equally when none is set.
 */
export function averageDistance(entry: DraftEntry, entryPrice: number, kind: ExitKind, direction: PlayDraft['direction'], leverage: number) {
  const levels = weightedLevels(entry, entryPrice, kind, direction, leverage)
  if (!levels.length) return null
  const total = levels.reduce((sum, level) => sum + level.weight, 0)
  return total > 0 ? levels.reduce((sum, level) => sum + level.distance * level.weight, 0) / total : null
}

/**
 * Stops or targets with a price, their distance from the entry and their weight in the average:
 * their share, or 1 each when no share is set. Levels without a price are left out.
 */
export function weightedLevels(entry: DraftEntry, entryPrice: number, kind: ExitKind, direction: PlayDraft['direction'], leverage: number) {
  const levels = exitsOf(entry, kind).flatMap(exit => {
    const price = levelPrice(entryPrice, exit, kind, direction, leverage)
    return price === null ? [] : [{ exit, price, distance: Math.abs(price - entryPrice), share: positive(exit.share) }]
  })
  const weighted = levels.some(level => level.share !== null)
  return levels.map(({ share, ...level }) => ({ ...level, weight: weighted ? share ?? 0 : 1 }))
}

/**
 * Planned reward per unit of risk of one entry: the share-weighted target distance over the
 * share-weighted stop distance, before fees. Null without an entry price, a stop and a target, or
 * when a level sits on the wrong side, since the plan check already flags those.
 */
export function rewardToRisk(entry: DraftEntry, direction: PlayDraft['direction'], leverage: number) {
  const entryPrice = positive(entry.price)
  if (entryPrice === null) return null
  const sign = direction === 'long' ? 1 : -1
  const wrong = (['stop', 'target'] as const).some(kind => exitsOf(entry, kind).some(exit => {
    const price = levelPrice(entryPrice, exit, kind, direction, leverage)
    return price !== null && (price - entryPrice) * sign * (kind === 'target' ? 1 : -1) <= 0
  }))
  if (wrong) return null
  const risk = averageDistance(entry, entryPrice, 'stop', direction, leverage)
  const reward = averageDistance(entry, entryPrice, 'target', direction, leverage)
  return risk === null || reward === null || risk === 0 ? null : reward / risk
}

/** "1:2.5" with at most two decimals. */
export const formatRewardToRisk = (ratio: number) => `1:${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(ratio)}`

/**
 * Estimated liquidation price of the whole plan, assuming every entry fills at its planned price
 * and the position uses isolated margin. The margin is the notional ÷ leverage, so the price is
 * where that margin plus the unrealized result falls to Hyperliquid's maintenance margin, half the
 * initial margin at the venue maximum leverage. Fees, funding, margin tiers of large positions and
 * the mark price are ignored; cross margin liquidates further away, since the account backs it.
 * Null without an average entry or venue maximum, or when there is no liquidation price (1× long).
 */
export function estimatedLiquidation(entries: PlayDraft['entries'], direction: PlayDraft['direction'], leverage: number, maxLeverage: number | null) {
  const averageEntry = averageEntryPrice(entries, 1)
  if (averageEntry === null || maxLeverage === null || maxLeverage < 1) return null
  const margin = 1 / Math.max(1, leverage)
  const maintenance = 1 / (2 * maxLeverage)
  const price = direction === 'long'
    ? averageEntry * (1 - margin) / (1 - maintenance)
    : averageEntry * (1 + margin) / (1 + maintenance)
  return price > 0 ? price : null
}
