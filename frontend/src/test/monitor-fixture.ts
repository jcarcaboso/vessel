import type { AccountMonitor, MonitorDiscrepancy, MonitorEvent, MonitorSummary } from '@/api/monitor'
import { accountFixture, savedPlayFixture } from './workspace-fixture'

export const discrepancyFixture: MonitorDiscrepancy = {
  id: '00000000-0000-4000-8000-0000000000d1', accountId: accountFixture.id, playId: savedPlayFixture.summary.id,
  contractId: 'BTC', kind: 'position-mismatch', severity: 'warning', state: 'open', openedAtUtc: '2026-10-14T10:00:00Z',
  confirmedAtUtc: null, resolvedAtUtc: null, dismissedAtUtc: null, note: null, details: { venueQuantity: '0.100000000000000001', playQuantity: '0.1' },
}
export const monitorFixture: AccountMonitor = {
  accountId: accountFixture.id, state: 'live', lastAttemptAtUtc: '2026-10-14T10:00:00Z', lastSuccessAtUtc: '2026-10-14T10:00:00Z',
  nextRunAtUtc: '2026-10-14T10:10:00Z', manualState: 'idle', nextManualAllowedAtUtc: null, error: null, workerOnline: true, discrepancies: [],
}
export const monitorSummaryFixture: MonitorSummary = { workerOnline: true, heartbeatAtUtc: '2026-10-14T10:00:00Z', accounts: [monitorFixture] }
export const monitorEventFixture: MonitorEvent = {
  id: '00000000-0000-4000-8000-0000000000e1', type: 'play.opened', version: 1, ownerId: 'fixture-owner', sequence: '9007199254740993',
  runId: '00000000-0000-4000-8000-0000000000e2', dedupKey: 'fixture-dedup', severity: 'info',
  occurredAt: '2026-10-14T10:00:00Z', detectedAt: '2026-10-14T10:00:10Z', timeliness: 'timely', relevance: 'current', expiresAt: null,
  subject: { accountId: accountFixture.id, playId: savedPlayFixture.summary.id }, source: { trigger: 'scheduled' }, data: {},
}
