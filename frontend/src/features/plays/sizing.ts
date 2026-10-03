import type { PlayDraft } from './draft'
import { averageEntryPrice } from './levels'

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
