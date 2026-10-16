# Play monitor API implementation contract

October 14, 2026. Shared contract for the authorized backend/frontend workers. Implements the [monitor plan](play-monitor-plan.md), not notification delivery. Existing Play/execution DTO fields and approved layout remain intact.

All routes are authenticated and owner-scoped. Responses use `Cache-Control: no-store`. Times are ISO UTC or null. Decimal values in event/discrepancy details are strings. Event sequences are decimal strings, avoiding JavaScript integer precision limits. Browser cursors are opaque strings `{epoch}.{sequence}` (or `0` for a stream not yet seen); the epoch is rotated by the restore procedure.

## Monitor state

`GET /api/monitor` returns:

```ts
interface MonitorSummary {
  workerOnline: boolean
  heartbeatAtUtc: string | null
  accounts: AccountMonitor[] // bounded to 200, enabled accounts eligible for monitoring
}
interface AccountMonitor {
  accountId: string
  state: 'live' | 'stale' | 'degraded' | 'credential-error' | 'idle'
  lastAttemptAtUtc: string | null
  lastSuccessAtUtc: string | null
  nextRunAtUtc: string | null
  manualState: 'idle' | 'pending' | 'running'
  nextManualAllowedAtUtc: string | null
  error: string | null // safe server-authored text, never venue payloads or credentials
  workerOnline: boolean
  discrepancies: MonitorDiscrepancy[]
}
```

`GET /api/accounts/{id}/monitor` returns `AccountMonitor`; foreign/missing accounts return 404. The summary endpoint avoids a separate state request per account row. Offline is a system condition rather than a mutually exclusive account state.

`POST /api/accounts/{id}/monitor/run`, with no body, returns 202:

```ts
interface MonitorRunAccepted {
  requestId: string
  monitor: AccountMonitor
}
```

Busy/cooling requests return 429 with `Retry-After`; ineligible accounts return 409. The button counts down from server timestamps, disables during pending/running and does not create runs on page load. Scheduled and manual runs share admission. A failed attempt also starts the configured cooldown.

## Events

`GET /api/events?after={cursor}&limit={1..200}` returns:

```ts
interface MonitorEventPage {
  events: MonitorEvent[]
  nextCursor: string // {epoch}.{sequence}; resume from it
  resetRequired: boolean
}
interface MonitorEvent {
  id: string
  type: string
  version: number
  ownerId: string
  sequence: string
  runId: string
  dedupKey: string
  severity: 'info' | 'warning' | 'critical'
  occurredAt: string
  detectedAt: string
  timeliness: 'timely' | 'late'
  relevance: 'current' | 'superseded'
  expiresAt: string | null
  // Every optional field is present as an explicit null, never omitted.
  subject: { accountId: string | null; venueId: string | null; contractId: string | null; playId: string | null;
             entryId: string | null; levelId: string | null; discrepancyId: string | null }
  source: { trigger: string; orderIds: string[] | null; fillIds: string[] | null }
  data: Record<string, unknown>
}
```

A cursor from another epoch (a restored database), below the retention floor, ahead of the database or a bare pre-epoch sequence returns `resetRequired: true`, no events and the `nextCursor` to resume from after reloading stored state. `0` starts at the beginning of retained history.

`GET /api/events/stream?after={cursor}` uses authenticated fetch SSE through the existing decoder. `event` frames contain `MonitorEvent` and an SSE `id:` line holding that event's resume cursor. `status` frames contain `{ state: 'ready' | 'reset', nextCursor: string }`; `ready` echoes the accepted cursor normalized with the epoch, and reset requires reloading stored state, not replaying historical popups. Keepalive comments need no UI action. Limit to four streams per owner and cancel when the API connection changes/disconnects. One shell subscription serves the browser; it is a database-cursor reader, not a broker subscription.

The UI reloads stored state on relevant events and polls stored state every 60 seconds when disconnected from the stream. These reads do not contact venues. No event/financial-data browser persistence is introduced.

## Execution and discrepancies

`GET /api/plays/{id}/execution` adds `monitor: AccountMonitor | null`, `discrepancies: MonitorDiscrepancy[]` and `watches: MonitorWatch[]`. Keep all existing fields, including P1 execution issues. An untracked/manual/retrospective Play may have null monitor. `POST /api/plays/{id}/execution/check` no longer reads venues: it records the same manual request as `monitor/run` for the Play's account and answers like it (202 `MonitorRunAccepted`, 429 with `Retry-After`, 409 when the Play cannot be monitored).

```ts
// A linked exit of a Closed or Cancelled Play, watched until the venue reports it filled, cancelled or rejected,
// a complete open-order read no longer lists it, or Vessel:Monitor:WatchLifetime (7 days) passes.
interface MonitorWatch {
  linkId: string
  playId: string
  orderId: string
  state: 'watching' | 'resolved' | 'unverifiable' // unverifiable is persistent and never claims the order is gone
  startedAtUtc: string
  endedAtUtc: string | null
}
```

`POST /api/accounts/{id}/sync` (account Refresh) stays synchronous: 200 with the refreshed account, 429 with `Retry-After` while the account is checking or cooling down or the venue deadline applies, 502 when the read failed or changed settings superseded it. Its outcome never changes the monitor state, backoff or scheduled check, and a refused Refresh is never replayed later.

```ts
interface MonitorDiscrepancy {
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
```

`POST /api/plays/{id}/discrepancies/{discrepancyId}/dismiss` accepts `{ note?: string | null }` and returns 204. An instrument-level discrepancy may be dismissed from an involved Play after server validation. `POST /api/accounts/{id}/discrepancies/{discrepancyId}/dismiss` supports the account-detail view and returns 204. Notes are bounded plain text. Dismissal does not stop monitoring or change executions.

Render monitor state within the existing Execution area, exceptional account badges and an offline shell banner. Preserve component theme tokens and accessible controls. No toast/notification system or new layout is included.
