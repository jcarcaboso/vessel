import { isFilledText, isPositiveCount, isRecord as object, isText as text, isTimestamp } from './guards'

export interface MonitorDiscrepancy {
  id: string
  accountId: string
  playId: string | null
  contractId: string
  kind: string
  severity: 'info' | 'warning' | 'critical'
  state: 'open' | 'resolved' | 'dismissed'
  openedAtUtc: string
  confirmedAtUtc: string | null
  resolvedAtUtc: string | null
  dismissedAtUtc: string | null
  note: string | null
  details: Record<string, unknown>
}

export interface AccountMonitor {
  accountId: string
  state: 'live' | 'stale' | 'degraded' | 'credential-error' | 'idle'
  lastAttemptAtUtc: string | null
  lastSuccessAtUtc: string | null
  nextRunAtUtc: string | null
  manualState: 'idle' | 'pending' | 'running'
  /** Who started pending or running work: an owner Check, an owner account refresh or the scheduler. Null when idle. */
  runTrigger: 'owner' | 'refresh' | 'scheduled' | null
  nextManualAllowedAtUtc: string | null
  error: string | null
  workerOnline: boolean
  discrepancies: MonitorDiscrepancy[]
}

export interface MonitorSummary {
  workerOnline: boolean
  heartbeatAtUtc: string | null
  accounts: AccountMonitor[]
}

export interface MonitorRunAccepted { requestId: string; monitor: AccountMonitor }
export interface MonitorEvent {
  id: string
  type: string
  version: number
  ownerId: string
  sequence: string
  runId: string
  dedupKey: string
  severity: MonitorDiscrepancy['severity']
  occurredAt: string
  detectedAt: string
  timeliness: 'timely' | 'late'
  relevance: 'current' | 'superseded'
  expiresAt: string | null
  subject: { accountId?: string; venueId?: string; contractId?: string; playId?: string; entryId?: string; levelId?: string; discrepancyId?: string }
  source: { trigger: string; orderIds?: string[]; fillIds?: string[] }
  data: Record<string, unknown>
}
export interface MonitorEventPage { events: MonitorEvent[]; nextSequence: string; resetRequired: boolean }
export type MonitorStreamEvent = { type: 'event'; event: MonitorEvent } |
  { type: 'status'; status: { state: 'ready' | 'reset'; nextSequence: string } }

const id = (v: unknown): v is string => isFilledText(v, 128)
// Monitor timestamps are bounded UTC strings with up to seven fractional digits.
const date = (v: unknown): v is string => isTimestamp(v, 64) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(v)
const nullableDate = (v: unknown) => v === null || date(v)
const severity = (v: unknown) => ['info', 'warning', 'critical'].includes(v as string)
export const isSequence = (v: unknown): v is string => text(v, 40) && /^(0|[1-9]\d*)$/.test(v)

export const isMonitorDiscrepancy = (v: unknown): v is MonitorDiscrepancy => object(v) &&
  id(v.id) && id(v.accountId) && (v.playId === null || id(v.playId)) && id(v.contractId) && id(v.kind) &&
  severity(v.severity) && ['open', 'resolved', 'dismissed'].includes(v.state as string) &&
  date(v.openedAtUtc) && nullableDate(v.confirmedAtUtc) && nullableDate(v.resolvedAtUtc) && nullableDate(v.dismissedAtUtc) &&
  (v.note === null || text(v.note, 2000)) && object(v.details)

export const isAccountMonitor = (v: unknown): v is AccountMonitor => object(v) && id(v.accountId) &&
  ['live', 'stale', 'degraded', 'credential-error', 'idle'].includes(v.state as string) &&
  nullableDate(v.lastAttemptAtUtc) && nullableDate(v.lastSuccessAtUtc) && nullableDate(v.nextRunAtUtc) &&
  ['idle', 'pending', 'running'].includes(v.manualState as string) &&
  (v.manualState === 'idle' ? v.runTrigger === null : ['owner', 'refresh', 'scheduled'].includes(v.runTrigger as string)) &&
  nullableDate(v.nextManualAllowedAtUtc) &&
  (v.error === null || text(v.error, 2000)) && typeof v.workerOnline === 'boolean' &&
  Array.isArray(v.discrepancies) && v.discrepancies.every(d => isMonitorDiscrepancy(d) && d.accountId === v.accountId)

export const isMonitorSummary = (v: unknown): v is MonitorSummary => object(v) && typeof v.workerOnline === 'boolean' &&
  nullableDate(v.heartbeatAtUtc) && Array.isArray(v.accounts) && v.accounts.length <= 200 && v.accounts.every(isAccountMonitor) &&
  new Set(v.accounts.map(a => a.accountId)).size === v.accounts.length

export const isMonitorRunAccepted = (v: unknown): v is MonitorRunAccepted => object(v) && id(v.requestId) && isAccountMonitor(v.monitor)
export const isMonitorEvent = (v: unknown): v is MonitorEvent => object(v) &&
  ['id', 'type', 'ownerId', 'runId'].every(key => id(v[key])) && text(v.dedupKey, 1024) && v.dedupKey.length > 0 &&
  isPositiveCount(v.version) &&
  isSequence(v.sequence) && severity(v.severity) && date(v.occurredAt) && date(v.detectedAt) && nullableDate(v.expiresAt) &&
  ['timely', 'late'].includes(v.timeliness as string) && ['current', 'superseded'].includes(v.relevance as string) &&
  object(v.subject) && Object.values(v.subject).every(value => id(value)) &&
  object(v.source) && id(v.source.trigger) && ['orderIds', 'fillIds'].every(key => v.source && object(v.source) &&
    (v.source[key] === undefined || Array.isArray(v.source[key]) && v.source[key].every(id))) && object(v.data)

export function monitorFrame(event: string, data: string): MonitorStreamEvent | null {
  let body: unknown
  try { body = JSON.parse(data) } catch { return null }
  if (event === 'event' && isMonitorEvent(body)) return { type: 'event', event: body }
  if (event === 'status' && object(body) && (body.state === 'ready' || body.state === 'reset') && isSequence(body.nextSequence)) {
    return { type: 'status', status: { state: body.state, nextSequence: body.nextSequence } }
  }
  return null
}

export const isMonitorEventPage = (v: unknown): v is MonitorEventPage => object(v) && Array.isArray(v.events) && v.events.length <= 200 &&
  v.events.every(isMonitorEvent) && isSequence(v.nextSequence) && typeof v.resetRequired === 'boolean'
