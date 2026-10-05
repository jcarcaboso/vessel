import type { ExposureLevel, SizingDocument } from '@/api/sizing'
import type { DraftEntry, DraftExit, PlayDraft } from './draft'
import { averageEntryPrice, levelPrice } from './levels'
import { wrongSide } from './planChecks'
import { averageDistance, estimatedLiquidation, positionSize, rewardToRisk, weightedLevels, type SizeUnits } from './sizing'

/*
 * Sizing suggestions after the owner's risk settings and record (docs/architecture/sizing-suggestions.md).
 * Each is computed live from the draft and only shown; the owner accepts it with a button. They are
 * mechanical estimates before fees and funding, not advice. Null means there is nothing to suggest:
 * an input is missing, or the plan already meets the limit.
 */

type Direction = PlayDraft['direction']

export const exposureLabels: Record<ExposureLevel, string> = { full: 'full exposure', half: '50% exposure', quarter: '25% exposure' }
type SizedDraft = Pick<PlayDraft, 'entries' | 'direction' | 'size' | 'sizingMode'>

const positive = (value: string) => /^\d+(\.\d+)?$/.test(value.trim()) && Number(value) > 0 ? Number(value) : null
/** A decimal string from the API, or null when it is not a positive finite number. */
const amount = (value: string | null | undefined) => {
  const number = value == null ? NaN : Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}
const trim = (text: string) => text.includes('.') ? text.replace(/\.?0+$/, '') : text
/** Float noise allowance when comparing against a limit, so an accepted value does not suggest itself again. */
const tolerance = 1e-9

/**
 * Rounds a price to five significant figures (the venue's perpetual price rule) in one direction,
 * so a suggestion still meets its limit after rounding.
 */
export function roundPrice(price: number, way: 'up' | 'down') {
  const decimals = Math.min(8, Math.max(0, 4 - Math.floor(Math.log10(price))))
  const factor = 10 ** decimals
  const rounded = way === 'up' ? Math.ceil(price * factor - tolerance) / factor : Math.floor(price * factor + tolerance) / factor
  return trim(rounded.toFixed(decimals))
}

const roundDecimals = (value: number, decimals: number, way: 'up' | 'down') => {
  const factor = 10 ** decimals
  return trim(((way === 'up' ? Math.ceil(value * factor - tolerance) : Math.floor(value * factor + tolerance)) / factor).toFixed(decimals))
}

/**
 * Expected loss per unit of quantity if every stop fills: the share-weighted distance from each entry
 * to its stops, weighted by the entries' quantity shares (`Σ share × Σ stopShare × |entry − stop|`).
 * Null unless every priced entry has a stop on the right side, since an entry without one has no
 * bounded risk.
 */
export function lossPerUnit(entries: readonly DraftEntry[], direction: Direction, leverage: number) {
  let total = 0
  let loss = 0
  for (const entry of entries) {
    const price = positive(entry.price)
    const share = positive(entry.share)
    if (price === null || share === null) continue
    if (entry.stops.some(stop => wrongSide(price, stop, 'stop', direction))) return null
    const distance = averageDistance(entry, price, 'stop', direction, leverage)
    if (distance === null || distance <= 0) return null
    total += share
    loss += share * distance
  }
  return total > 0 ? loss / total : null
}

export interface RiskSize {
  /** Amount at risk in the quote asset: balance × effective risk %. */
  risk: number
  effectiveRiskPercent: number
  /** Quantity that loses `risk` if the stops fill, before rounding. */
  quantity: number
  notional: number
  /** Size field value in the current unit: margin at the leverage, or quantity rounded down to the venue precision. */
  value: string
  /** Margin of `value` at the leverage. */
  margin: number
}

/** The risk-based size: balance × effective risk % ÷ loss per unit. Null without a balance, entries or stops. */
export function riskSize(draft: SizedDraft, leverage: number, balance: number | null, sizing: SizingDocument, units: SizeUnits): RiskSize | null {
  const effectiveRiskPercent = amount(sizing.limits.effectiveRiskPercent)
  const perUnit = lossPerUnit(draft.entries, draft.direction, leverage)
  const average = averageEntryPrice(draft.entries, 1)
  if (balance === null || balance <= 0 || effectiveRiskPercent === null || perUnit === null || average === null) return null
  const risk = balance * effectiveRiskPercent / 100
  const quantity = risk / perUnit
  const lever = Math.max(1, leverage)
  const value = draft.sizingMode === 'margin'
    ? roundDecimals(quantity * average / lever, 2, 'down')
    : roundDecimals(quantity, units.quantityDecimals ?? 6, 'down')
  if (!(Number(value) > 0)) return null
  const margin = draft.sizingMode === 'margin' ? Number(value) : Number(value) * average / lever
  return { risk, effectiveRiskPercent, quantity, notional: quantity * average, value, margin }
}

export interface SizeSuggestion extends RiskSize {
  /** The play's budget when the margin would not fit it; the size is then not offered. */
  overBudget: number | null
}

/**
 * The size line: the risk-based size, hidden while the entered size is within 2% of it. Above the
 * budget it reports the budget instead of offering the size, and the leverage line suggests a fix.
 */
export function suggestSize(draft: SizedDraft, leverage: number, balance: number | null, sizing: SizingDocument, units: SizeUnits, budget: number | null): SizeSuggestion | null {
  const sized = riskSize(draft, leverage, balance, sizing, units)
  if (!sized) return null
  const target = Number(sized.value)
  const entered = positive(draft.size)
  if (entered !== null && Math.abs(entered - target) <= target * 0.02) return null
  // Cents of rounding are not worth flagging, as with the over-budget check.
  return { ...sized, overBudget: budget !== null && sized.margin > budget + 0.005 ? budget : null }
}

export interface LevelSuggestion {
  /** The value to put in the level's field, in its own unit. */
  value: string
  /** The price that value stands for. */
  price: number
}

/** The value of a stop or target at `price`: the price itself, or the % return at the leverage. */
function levelValue(exit: DraftExit, entryPrice: number, price: number, leverage: number, way: 'up' | 'down', percentWay: 'up' | 'down') {
  if (exit.unit === 'price') return roundPrice(price, way)
  return roundDecimals(Math.abs(price - entryPrice) / entryPrice * 100 * Math.max(1, leverage), 2, percentWay)
}

/**
 * A stop further from its entry than the maximum stop distance (a price move in % of the entry, not
 * a return on margin): the stop at that distance. Percent stops keep their unit. Null when the stop
 * is within the limit, blank or on the wrong side.
 */
export function suggestMaxStop(entry: DraftEntry, exit: DraftExit, direction: Direction, leverage: number, maxStopPercent: number): LevelSuggestion | null {
  const entryPrice = positive(entry.price)
  if (entryPrice === null || !(maxStopPercent > 0) || wrongSide(entryPrice, exit, 'stop', direction)) return null
  const price = levelPrice(entryPrice, exit, 'stop', direction, leverage)
  if (price === null || Math.abs(price - entryPrice) / entryPrice * 100 <= maxStopPercent * (1 + tolerance)) return null
  const limit = entryPrice * (direction === 'long' ? 1 - maxStopPercent / 100 : 1 + maxStopPercent / 100)
  if (limit <= 0) return null
  // Rounded toward the entry so the accepted stop is within the limit.
  const value = levelValue(exit, entryPrice, limit, leverage, direction === 'long' ? 'up' : 'down', 'down')
  return { value, price: levelPrice(entryPrice, { ...exit, value }, 'stop', direction, leverage)! }
}

/**
 * An entry whose planned R:R is below the minimum: its farthest target moved out until the
 * share-weighted R:R reaches it. Percent targets keep their unit. Null when the R:R is unknown or
 * already enough, or when a short target would need a price at or below zero.
 */
export function suggestMinTarget(entry: DraftEntry, direction: Direction, leverage: number, minRewardRisk: number): (LevelSuggestion & { levelId: string }) | null {
  const ratio = rewardToRisk(entry, direction, leverage)
  const entryPrice = positive(entry.price)
  if (ratio === null || entryPrice === null || !(minRewardRisk > 0) || ratio >= minRewardRisk * (1 - tolerance)) return null
  const risk = averageDistance(entry, entryPrice, 'stop', direction, leverage)
  const targets = weightedLevels(entry, entryPrice, 'target', direction, leverage).filter(level => level.weight > 0)
  if (risk === null || !targets.length) return null
  const total = targets.reduce((sum, level) => sum + level.weight, 0)
  const reward = targets.reduce((sum, level) => sum + level.distance * level.weight, 0) / total
  const farthest = targets.reduce((best, level) => level.distance > best.distance ? level : best)
  const distance = farthest.distance + (minRewardRisk * risk - reward) * total / farthest.weight
  const price = direction === 'long' ? entryPrice + distance : entryPrice - distance
  if (price <= 0) return null
  // Rounded away from the entry so the accepted target reaches the minimum.
  const value = levelValue(farthest.exit, entryPrice, price, leverage, direction === 'long' ? 'up' : 'down', 'up')
  return { levelId: farthest.exit.id, value, price: levelPrice(entryPrice, { ...farthest.exit, value }, 'target', direction, leverage)! }
}

/** Highest stop price of a short, lowest of a long: the stop furthest from the entries. */
function farthestStop(entries: readonly DraftEntry[], direction: Direction, leverage: number) {
  const prices = entries.flatMap(entry => entry.stops.flatMap(stop => {
    const price = levelPrice(positive(entry.price), stop, 'stop', direction, leverage)
    return price === null ? [] : [price]
  }))
  if (!prices.length) return null
  return direction === 'long' ? Math.min(...prices) : Math.max(...prices)
}

/**
 * The lowest whole leverage that fits the position's margin in the budget and keeps the estimated
 * liquidation beyond the farthest stop, capped at the venue maximum and, while exposure is reduced,
 * at the current leverage. The position is the risk-based quantity, else the entered quantity; an
 * entered margin fixes the margin, so leverage cannot fit it. Stops are read at their current prices.
 * Null without a budget, when nothing fits or when it is the current leverage.
 */
export function suggestLeverage(draft: SizedDraft & Pick<PlayDraft, 'leverage'>, leverage: number, maxLeverage: number | null, budget: number | null,
  sizing: SizingDocument, notional: number | null, defaultMaximum = 100) {
  const position = notional ?? (draft.sizingMode === 'quantity' ? positionSize(draft, leverage).notional : null)
  if (budget === null || budget <= 0 || position === null || position <= 0) return null
  const reduced = (amount(sizing.exposure.multiplier) ?? 1) < 1
  const cap = Math.min(maxLeverage ?? defaultMaximum, reduced ? leverage : Infinity)
  const stop = farthestStop(draft.entries, draft.direction, leverage)
  const clear = (candidate: number) => {
    const liquidation = estimatedLiquidation(draft.entries, draft.direction, candidate, maxLeverage)
    return liquidation === null || stop === null || (draft.direction === 'long' ? liquidation < stop : liquidation > stop)
  }
  // Same cent allowance as the over-budget check.
  const lowest = Math.max(1, Math.ceil(position / (budget + 0.005) - tolerance))
  // Only when the current leverage is a problem: the margin does not fit, the liquidation is inside a stop,
  // or exposure is reduced (off margin while struggling). Otherwise a lower leverage is not worth a nag.
  if (!(lowest > leverage || !clear(leverage) || reduced)) return null
  // A higher leverage only brings the liquidation closer, so the lowest that fits the budget decides.
  if (lowest > cap || !clear(lowest) || lowest === leverage) return null
  return { leverage: lowest }
}
