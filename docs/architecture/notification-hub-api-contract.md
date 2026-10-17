# Notification Hub API contract

October 17, 2026. The browser contract for in-app notifications, implementing the [Notification Hub plan](notification-hub-plan.md). Every route requires the bearer token, is owner-scoped and answers `Cache-Control: no-store`. JSON uses web casing; optional values are explicit `null`; times are UTC ISO strings.

## Shapes

```ts
type Severity = 'info' | 'warning' | 'critical'
type Category = 'executions' | 'links' | 'discrepancies' | 'monitor' | 'credentials' | 'test'
type Kind = 'run' | 'discrepancy' | 'monitor' | 'credential' | 'test'
type State = 'unread' | 'read' | 'withdrawn'
type LinkKind = 'play' | 'play-execution' | 'account' | 'account-credential'

interface NotificationLink { kind: LinkKind; label: string; playId: string | null; accountId: string | null }
interface NotificationSubject {
  accountId: string | null; accountName: string | null; venueId: string | null
  playId: string | null; playTitle: string | null; instrument: string | null
}
interface NotificationContent {
  title: string            // at most 160 characters
  summary: string | null   // at most 200
  lines: string[]          // at most 8, each at most 200
  late: boolean
  links: NotificationLink[] // at most 3, labels at most 60
  subject: NotificationSubject
}
interface Notification {
  id: string; kind: Kind; category: Category; severity: Severity; content: NotificationContent
  occurredAt: string; detectedAt: string; createdAt: string; state: State; readAt: string | null
}
```

All text is plain server-authored text with exact decimal strings; render it as text, never as HTML. Map links to the shell's own navigation (`play` → open the Play; `play-execution` → open the Play, and its Execution tab once the shell can select it; `account` → account detail; `account-credential` → account detail's token section). Never navigate to a URL from content. A link to a Play or account that no longer exists shows a short notice.

## Cursor

`{epoch}.{resetVersion}.{sequence}`: the event stream's epoch as 32 lowercase hex digits (or `0` before the owner has any event), then two non-negative integers. Only `frontend/src/api/event-cursor.ts` parses or compares it. A cursor from another epoch or reset version, or ahead of the head, gets a reset.

## Routes

| Route | Answer |
|---|---|
| `GET /api/notifications/head` | `{ nextCursor, unreadCount, enabled, workerOnline, heartbeatAtUtc }` from one snapshot |
| `GET /api/notifications?tab=unread\|all&category=&severity=&page=&pageSize=` | `{ items: Notification[], page, pageSize, total, unreadTotal, allTotal }`, newest first. `pageSize` 1–100 (UI 25, 50, 100), `page` clamped to the last page. Notifications of disabled accounts are hidden. Bad values answer 400 |
| `POST /api/notifications/claim` | `{ popups: Notification[], more: number }`. Atomically claims every unread, unshown, visible notification while the channel is enabled. `popups` are the claimed ones created within the popup window (24 hours), most severe then newest, at most three; `more` counts the rest of this claim. A concurrent claim from another tab gets none of them |
| `POST /api/notifications/{id}/read` | The `Notification` in its current state (a withdrawn one stays withdrawn); 404 when unknown |
| `POST /api/notifications/read` | Body `{ upTo: cursor }`. Marks read every unread notification that existed at that head (by its immutable created sequence). Answers `{ read: number }`; 400 for a malformed cursor, 409 for another epoch or a cursor ahead of the head (reload, then retry) |
| `GET /api/notifications/preferences` | `{ enabled, minimumSeverity, categories, revision, workerOnline, heartbeatAtUtc, subscriptionStatus, failedDeliveries }`; `categories` lists the enabled ones among `executions`, `links`, `discrepancies`, `monitor`, `credentials`; `subscriptionStatus` is `active`, `lagging` (events aged out before the hub handled them) or `null` before provisioning; `failedDeliveries` counts events the hub gave up on |
| `PUT /api/notifications/preferences` | Body `{ enabled, minimumSeverity, categories, expectedRevision }`. Answers the saved preferences; 409 on a stale revision, 400 on invalid values. Saving resets every notification cursor |
| `POST /api/notifications/test` | 202, then a test notification arrives through the stream like any other. 429 with `Retry-After` (seconds) within 10 seconds of the last request |

## Stream

`GET /api/events/stream?after={eventCursor}&notificationsAfter={notificationCursor}`. Without `notificationsAfter` nothing changes. With it:

- After the usual first `status` frame comes `event: notifications` with `{ state: 'ready' | 'reset', nextCursor, unreadCount, enabled }`. `ready` echoes the accepted cursor; `reset` names the head.
- Each changed notification is `event: notification` with `{ cursor, unreadCount, enabled, notification }`. `cursor` is that row's own position; resume from the last one handled. These frames have **no** `id:` line; the parser keeps the last event `id`, so never read a notification cursor from it.
- A later reset is another `notifications` frame with `state: 'reset'`.
- Event frames, the event `status` frame and their resets are unchanged and independent of notification resets.
- A notification frame is the current state of that notification: `unread` (new or still unread), `read` or `withdrawn` (remove its popup in every tab, update the list and badge). `unreadCount` is the head's count when the frame was read.

## Browser flow

1. After the event head, read `GET /api/notifications/head`; its failure must not hold up workspace reads (stream without `notificationsAfter`, retry later).
2. Open the stream with both cursors; keep the two cursors and their resets separate.
3. When the tab is visible and focused, `POST /claim` at start-up and whenever a frame brings an `unread` notification not seen before. Show only the returned popups, plus one summary popup when `more > 0`.
4. On a notification reset: read the head again, drop popups whose notifications are no longer unread, reload the Notifications page if open; ignore answers from an older epoch or reset version.
5. Refresh `workerOnline` from the head on the existing 60-second fallback timer.
