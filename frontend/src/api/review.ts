export const reviewPeriods = [
  { id: 'day', label: 'Last 24 hours' }, { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' }, { id: 'year', label: 'Last 365 days' },
  { id: 'all', label: 'All recorded' },
] as const
export type ReviewPeriod = typeof reviewPeriods[number]['id']
export type ReviewGroupBy = 'portfolios' | 'accounts' | 'assets'
export interface ReviewQuery { period: ReviewPeriod; portfolio: string; accountId?: string; instrument?: string; offset?: number }
export const defaultReviewQuery: ReviewQuery = { period: 'month', portfolio: 'all' }
/** Authoritative statistics are decimal strings from the API, never recomputed from a paged sample. */
export interface ReviewMetrics {
  count: number; wins: number; losses: number; scratches: number
  net: string | null; batting: string | null; averageGain: string | null; averageLoss: string | null
  payoff: string | null; profitFactor: string | null; averageWin: string | null; averageLossUsd: string | null
  expectancy: string | null; averageR: string | null; riskCount: number; reviewed: number
  drawdown: string | null; maxWins: number; maxLosses: number
}
export interface ReviewGroup { id: string; name: string; detail: string; metrics: ReviewMetrics }
export interface ReviewPoint { atUtc: string; net: string; cumulative: string; drawdown: string; count: number }
export interface ReviewPlay {
  id: string; title: string; accountId: string; accountName: string; venueId: string; instrument: string
  closedAtUtc: string; net: string; returnPercent: string; rMultiple: string | null; reviewed: boolean
  origin?: 'planned' | 'retrospective'
  executionSource?: 'imported' | 'manual'
}
export interface ReviewExclusion {
  playId: string; title: string; accountId: string; accountName: string; instrument: string; reasons: string[]
}
export interface ReviewExclusions {
  items: ReviewExclusion[]; total: number; offset: number; nextOffset: number | null; notice: string
}
export interface ReviewAccount {
  id: string; name: string; portfolioId: string | null; venueId: string
  lastSyncedAtUtc: string | null; syncStatus: string; historyNotice: string | null
}
export interface ReviewDocument {
  asOfUtc: string; fromUtc: string | null; period: ReviewPeriod; currency: 'USD'
  options: { portfolios: Array<{ id: string; name: string }>; accounts: ReviewAccount[]; instruments: string[] }
  periods: Array<{ id: ReviewPeriod; count: number; net: string | null }>
  metrics: ReviewMetrics; series: ReviewPoint[]; bucketDays: number
  groups: Record<ReviewGroupBy, ReviewGroup[]>
  coverage: {
    closedCandidates: number; incompleteFees: number; incompleteExecutions: number; openPlays: number
    unassignedFills: number; firstFillAtUtc: string | null; notice: string
  }
  plays: ReviewPlay[]; offset: number; nextOffset: number | null
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max
const guid = (v: unknown) => text(v, 36) && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
const decimal = (v: unknown): v is string => text(v, 100) && /^-?\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v))
const nullableDecimal = (v: unknown) => v === null || decimal(v)
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const date = (v: unknown) => text(v, 64) && Number.isFinite(Date.parse(v))
const nullableDate = (v: unknown) => v === null || date(v)
const period = (v: unknown) => reviewPeriods.some(p => p.id === v)
const list = (v: unknown, guard: (item: unknown) => boolean, max = 10_000): boolean => Array.isArray(v) && v.length <= max && v.every(guard)
export const isReviewMetrics = (v: unknown): v is ReviewMetrics => object(v) &&
  ['count', 'wins', 'losses', 'scratches', 'riskCount', 'reviewed', 'maxWins', 'maxLosses'].every(key => count(v[key])) &&
  ['net', 'batting', 'averageGain', 'averageLoss', 'payoff', 'profitFactor', 'averageWin', 'averageLossUsd', 'expectancy', 'averageR', 'drawdown']
    .every(key => nullableDecimal(v[key])) &&
  (v.wins as number) + (v.losses as number) + (v.scratches as number) === v.count &&
  (v.riskCount as number) <= (v.count as number) && (v.reviewed as number) <= (v.count as number) &&
  (v.batting === null || Number(v.batting) >= 0 && Number(v.batting) <= 1) &&
  (v.count === 0 ? v.net === null : decimal(v.net))
const group = (v: unknown) => object(v) && text(v.id, 128) && text(v.name) && text(v.detail, 2000) && isReviewMetrics(v.metrics)
const play = (v: unknown) => object(v) && guid(v.id) && text(v.title) && guid(v.accountId) && text(v.accountName) &&
  text(v.venueId, 64) && text(v.instrument, 128) && date(v.closedAtUtc) && decimal(v.net) &&
  decimal(v.returnPercent) && nullableDecimal(v.rMultiple) && typeof v.reviewed === 'boolean' &&
  (v.origin === undefined || v.origin === 'planned' || v.origin === 'retrospective') &&
  (v.executionSource === undefined || v.executionSource === 'imported' || v.executionSource === 'manual') &&
  (v.origin !== 'retrospective' || v.rMultiple === null)
const account = (v: unknown) => object(v) && guid(v.id) && text(v.name) && (v.portfolioId === null || guid(v.portfolioId)) &&
  text(v.venueId, 64) && nullableDate(v.lastSyncedAtUtc) && text(v.syncStatus, 32) &&
  (v.historyNotice === null || text(v.historyNotice, 1000))
export const isReviewDocument = (v: unknown): v is ReviewDocument => object(v) &&
  date(v.asOfUtc) && nullableDate(v.fromUtc) && period(v.period) && v.currency === 'USD' &&
  object(v.options) && list(v.options.portfolios, p => object(p) && guid(p.id) && text(p.name)) &&
  list(v.options.accounts, account) && list(v.options.instruments, i => text(i, 128)) &&
  list(v.periods, p => object(p) && period(p.id) && count(p.count) && nullableDecimal(p.net), 5) &&
  (v.periods as Array<{ id: string }>).length === 5 && new Set((v.periods as Array<{ id: string }>).map(p => p.id)).size === 5 &&
  isReviewMetrics(v.metrics) &&
  list(v.series, p => object(p) && date(p.atUtc) && decimal(p.net) && decimal(p.cumulative) && decimal(p.drawdown) && count(p.count), 366) &&
  count(v.bucketDays) && v.bucketDays > 0 &&
  object(v.groups) && list(v.groups.portfolios, group) && list(v.groups.accounts, group) && list(v.groups.assets, group) &&
  object(v.coverage) && ['closedCandidates', 'incompleteFees', 'incompleteExecutions', 'openPlays', 'unassignedFills'].every(key => count((v.coverage as Record<string, unknown>)[key])) &&
  nullableDate(v.coverage.firstFillAtUtc) && text(v.coverage.notice, 4000) && list(v.plays, play, 50) &&
  count(v.offset) && (v.nextOffset === null || count(v.nextOffset) && v.nextOffset > v.offset)

export function reviewPath(query: ReviewQuery): string {
  const params = new URLSearchParams({ period: query.period, portfolio: query.portfolio })
  if (query.accountId) params.set('accountId', query.accountId)
  if (query.instrument) params.set('instrument', query.instrument)
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  return `/api/review?${params}`
}

export const isReviewExclusions = (v: unknown): v is ReviewExclusions => object(v) &&
  list(v.items, item => object(item) && guid(item.playId) && text(item.title) && guid(item.accountId) &&
    text(item.accountName) && text(item.instrument, 128) && list(item.reasons, reason => text(reason, 2000) && reason.trim().length > 0) &&
    (item.reasons as string[]).length > 0, 50) &&
  count(v.total) && count(v.offset) && (v.items as unknown[]).length <= v.total &&
  (v.items as unknown[]).length === Math.min(50, Math.max(0, v.total - v.offset)) &&
  new Set((v.items as ReviewExclusion[]).map(item => item.playId)).size === (v.items as unknown[]).length &&
  (v.nextOffset === null ? v.offset + (v.items as unknown[]).length >= v.total :
    count(v.nextOffset) && v.nextOffset === v.offset + (v.items as unknown[]).length && v.nextOffset < v.total && v.nextOffset > v.offset) &&
  text(v.notice, 4000)

export function reviewExclusionsPath(query: ReviewQuery): string {
  return reviewPath(query).replace('/api/review?', '/api/review/exclusions?')
}
