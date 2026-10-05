/**
 * The owner's risk setting, closed-play record and the limits suggestions follow (`GET /api/sizing`).
 * Numbers are invariant decimal strings; unknowns are null. Mechanical estimates, not investment advice.
 */
export type ExposureLevel = 'full' | 'half' | 'quarter'
export type PlayOutcome = 'win' | 'loss' | 'scratch'

export interface SizingSettings { riskPercent: string }
export interface SizingExposure {
  level: ExposureLevel
  /** 1, 0.5 or 0.25 of the risk setting. */
  multiplier: string
  reason: string
  lossStreak: number
  winsSinceStepDown: number
}
export interface RecordedPlay {
  playId: string
  title: string
  instrument: string | null
  closedAtUtc: string
  netResultUsd: string
  returnPercent: string | null
  riskUsd: string | null
  rMultiple: string | null
  outcome: PlayOutcome
  /** False when fees in another token were left out of the net result. */
  feesComplete: boolean
}
export interface SizingRecord {
  closedPlays: number
  decidedPlays: number
  window: number
  wins: number
  losses: number
  scratches: number
  battingAverage: string | null
  averageGainPercent: string | null
  averageLossPercent: string | null
  winLossRatio: string | null
  breakEvenRewardRisk: string | null
  averageWinR: string | null
  averageLossR: string | null
  recent: RecordedPlay[]
}
export interface SizingLimits {
  effectiveRiskPercent: string
  /** Largest stop distance from its entry, in percent of the entry price. */
  maxStopPercent: string
  minRewardRisk: string
  maxStopSource: 'default' | 'averageGain'
  minRewardRiskSource: 'default' | 'battingAverage'
}
export interface SizingDocument {
  settings: SizingSettings
  exposure: SizingExposure
  record: SizingRecord
  limits: SizingLimits
  notice: string
}

/** The risk setting the API accepts, in percent of the balance. Above the warning level the editor warns. */
export const riskPercentRange = { min: 0.1, max: 5, warnAbove: 2.5 } as const

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length <= max
const decimal = (v: unknown): v is string => text(v, 100) && /^-?\d+(\.\d+)?$/.test(v)
const nullableDecimal = (v: unknown) => v === null || decimal(v)
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const date = (v: unknown) => text(v, 64) && Number.isFinite(Date.parse(v))
const recorded = (v: unknown): v is RecordedPlay => object(v) && text(v.playId, 64) && text(v.title, 200) &&
  (v.instrument === null || text(v.instrument, 128)) && date(v.closedAtUtc) && decimal(v.netResultUsd) &&
  nullableDecimal(v.returnPercent) && nullableDecimal(v.riskUsd) && nullableDecimal(v.rMultiple) &&
  ['win', 'loss', 'scratch'].includes(v.outcome as string) && typeof v.feesComplete === 'boolean'
const record = (v: unknown): v is SizingRecord => object(v) &&
  ['closedPlays', 'decidedPlays', 'window', 'wins', 'losses', 'scratches'].every(k => count(v[k])) &&
  ['battingAverage', 'averageGainPercent', 'averageLossPercent', 'winLossRatio', 'breakEvenRewardRisk', 'averageWinR', 'averageLossR']
    .every(k => nullableDecimal(v[k])) &&
  Array.isArray(v.recent) && v.recent.length <= 100 && v.recent.every(recorded)

export const isSizingDocument = (v: unknown): v is SizingDocument => object(v) &&
  object(v.settings) && decimal(v.settings.riskPercent) &&
  object(v.exposure) && ['full', 'half', 'quarter'].includes(v.exposure.level as string) && decimal(v.exposure.multiplier) &&
  text(v.exposure.reason) && count(v.exposure.lossStreak) && count(v.exposure.winsSinceStepDown) &&
  record(v.record) &&
  object(v.limits) && ['effectiveRiskPercent', 'maxStopPercent', 'minRewardRisk'].every(k => decimal((v.limits as Record<string, unknown>)[k])) &&
  ['default', 'averageGain'].includes(v.limits.maxStopSource as string) &&
  ['default', 'battingAverage'].includes(v.limits.minRewardRiskSource as string) &&
  text(v.notice)
