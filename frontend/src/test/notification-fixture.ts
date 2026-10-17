import type { InAppNotification, NotificationHead, NotificationPreferences } from '@/api/notifications'
import { fixtureEpoch } from './monitor-fixture'
import { accountFixture, savedPlayFixture } from './workspace-fixture'

/** Test-only cursor construction; production code leaves cursor syntax to `@/api/event-cursor`. */
export const notificationCursor = (sequence: string | number, reset: string | number = 0, epoch = fixtureEpoch) => `${epoch}.${reset}.${sequence}`

export const notificationFixture: InAppNotification = {
  id: '00000000-0000-4000-8000-0000000000f1', kind: 'run', category: 'executions', severity: 'info',
  content: {
    title: 'BTC Long opened', summary: 'Entry filled at 64250.5', lines: ['Bought 0.100000000000000001 BTC at 64250.5'], late: false,
    links: [{ kind: 'play', label: 'Open Play', playId: savedPlayFixture.summary.id, accountId: null }],
    subject: { accountId: accountFixture.id, accountName: accountFixture.name, venueId: accountFixture.venueId, playId: savedPlayFixture.summary.id,
      playTitle: 'BTC breakout', instrument: 'BTC' },
  },
  occurredAt: '2026-10-17T10:00:00Z', detectedAt: '2026-10-17T10:00:05Z', createdAt: '2026-10-17T10:00:06.1234567+00:00',
  state: 'unread', readAt: null,
}
/** A notification with its own ID and the title `Notification {n}`. */
export const notificationWith = (n: number, overrides: Partial<InAppNotification> = {}): InAppNotification => ({
  ...notificationFixture, id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  ...overrides, content: { ...notificationFixture.content, ...overrides.content, title: `Notification ${n}` },
})
export const notificationHeadFixture: NotificationHead = {
  nextCursor: notificationCursor(10), unreadCount: 0, enabled: true, workerOnline: true, heartbeatAtUtc: '2026-10-17T10:00:00Z',
}
export const notificationPreferencesFixture: NotificationPreferences = {
  enabled: true, minimumSeverity: 'info', categories: ['executions', 'links', 'discrepancies', 'monitor', 'credentials'], revision: 3,
  workerOnline: true, heartbeatAtUtc: '2026-10-17T10:00:00Z', subscriptionStatus: 'active', failedDeliveries: 0,
}
