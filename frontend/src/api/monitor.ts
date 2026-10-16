import { isGuid, isNullOr, isRecord, isText, isTimestamp } from './guards'

/** Server-recorded account monitor state. Reading it never contacts a venue. Times are ISO UTC or null. */
export interface AccountMonitor {
  accountId: string
  state: 'live' | 'stale' | 'degraded' | 'credential-error' | 'idle'
  lastAttemptAtUtc: string | null
  lastSuccessAtUtc: string | null
  nextRunAtUtc: string | null
  /** Whether an on-demand check is waiting for or held by the background worker. */
  manualState: 'idle' | 'pending' | 'running'
  nextManualAllowedAtUtc: string | null
  /** Safe server-authored text, never a venue payload. */
  error: string | null
  workerOnline: boolean
  discrepancies: MonitorDiscrepancy[]
}
/** An accepted on-demand check: the worker runs it later; completion shows in the stored monitor state. */
export interface MonitorRunAccepted { requestId: string; monitor: AccountMonitor }
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
/** A linked order of an ended Play, watched until the venue settles it. Unverifiable never claims the order is gone. */
export interface MonitorWatch {
  linkId: string
  playId: string
  orderId: string
  role: 'entry' | 'stop' | 'target' | 'exit'
  state: 'watching' | 'resolved' | 'unverifiable'
  startedAtUtc: string
  endedAtUtc: string | null
}

const timeLength = 64
const time = (v: unknown) => isTimestamp(v, timeLength)
export const isMonitorDiscrepancy = (v: unknown): v is MonitorDiscrepancy => isRecord(v) && isGuid(v.id) && isGuid(v.accountId) &&
  isNullOr(v.playId, isGuid) && isText(v.contractId, 128) && isText(v.kind, 64) &&
  ['info', 'warning', 'critical'].includes(v.severity as string) && ['open', 'resolved', 'dismissed'].includes(v.state as string) &&
  time(v.openedAtUtc) && isNullOr(v.confirmedAtUtc, time) && isNullOr(v.resolvedAtUtc, time) && isNullOr(v.dismissedAtUtc, time) &&
  isNullOr(v.note, x => isText(x, 4000)) && isRecord(v.details)
export const isAccountMonitor = (v: unknown): v is AccountMonitor => isRecord(v) && isGuid(v.accountId) &&
  ['live', 'stale', 'degraded', 'credential-error', 'idle'].includes(v.state as string) &&
  isNullOr(v.lastAttemptAtUtc, time) && isNullOr(v.lastSuccessAtUtc, time) && isNullOr(v.nextRunAtUtc, time) &&
  ['idle', 'pending', 'running'].includes(v.manualState as string) && isNullOr(v.nextManualAllowedAtUtc, time) &&
  isNullOr(v.error, x => isText(x, 1000)) && typeof v.workerOnline === 'boolean' &&
  Array.isArray(v.discrepancies) && v.discrepancies.every(isMonitorDiscrepancy)
export const isMonitorRunAccepted = (v: unknown): v is MonitorRunAccepted => isRecord(v) && isGuid(v.requestId) && isAccountMonitor(v.monitor)
export const isMonitorWatch = (v: unknown): v is MonitorWatch => isRecord(v) && isGuid(v.linkId) && isGuid(v.playId) && isText(v.orderId, 128) &&
  ['entry', 'stop', 'target', 'exit'].includes(v.role as string) && ['watching', 'resolved', 'unverifiable'].includes(v.state as string) &&
  time(v.startedAtUtc) && isNullOr(v.endedAtUtc, time)
