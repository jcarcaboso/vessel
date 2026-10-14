import { isCount, isNullOr, isPlainDecimal, isRecord, isText, isTimestamp } from './guards'

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

const recorded = (v: unknown): v is RecordedPlay => isRecord(v) && isText(v.playId, 64) && isText(v.title, 200) &&
  isNullOr(v.instrument, x => isText(x, 128)) && isTimestamp(v.closedAtUtc, 64) && isPlainDecimal(v.netResultUsd) &&
  isNullOr(v.returnPercent, isPlainDecimal) && isNullOr(v.riskUsd, isPlainDecimal) && isNullOr(v.rMultiple, isPlainDecimal) &&
  ['win', 'loss', 'scratch'].includes(v.outcome as string) && typeof v.feesComplete === 'boolean'
const record = (v: unknown): v is SizingRecord => isRecord(v) &&
  ['closedPlays', 'decidedPlays', 'window', 'wins', 'losses', 'scratches'].every(k => isCount(v[k])) &&
  ['battingAverage', 'averageGainPercent', 'averageLossPercent', 'winLossRatio', 'breakEvenRewardRisk', 'averageWinR', 'averageLossR']
    .every(k => isNullOr(v[k], isPlainDecimal)) &&
  Array.isArray(v.recent) && v.recent.length <= 100 && v.recent.every(recorded)

export const isSizingDocument = (v: unknown): v is SizingDocument => isRecord(v) &&
  isRecord(v.settings) && isPlainDecimal(v.settings.riskPercent) &&
  isRecord(v.exposure) && ['full', 'half', 'quarter'].includes(v.exposure.level as string) && isPlainDecimal(v.exposure.multiplier) &&
  isText(v.exposure.reason, 2000) && isCount(v.exposure.lossStreak) && isCount(v.exposure.winsSinceStepDown) &&
  record(v.record) &&
  isRecord(v.limits) && ['effectiveRiskPercent', 'maxStopPercent', 'minRewardRisk'].every(k => isPlainDecimal((v.limits as Record<string, unknown>)[k])) &&
  ['default', 'averageGain'].includes(v.limits.maxStopSource as string) &&
  ['default', 'battingAverage'].includes(v.limits.minRewardRiskSource as string) &&
  isText(v.notice, 2000)
