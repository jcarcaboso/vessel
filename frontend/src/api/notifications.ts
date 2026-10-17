import { isCount, isFilledText, isListOf, isNonEmptyGuid, isNullOr, isRecord as object, isText, isTimestamp } from './guards'
import { isNotificationCursor, type NotificationCursor } from './event-cursor'
import { ApiError } from './errors'

export const notificationSeverities = ['info', 'warning', 'critical'] as const
export type NotificationSeverity = typeof notificationSeverities[number]
/** Categories the owner can switch off. `test` notifications follow the channel switch alone. */
export const notificationPreferenceCategories = ['executions', 'links', 'discrepancies', 'monitor', 'credentials'] as const
export type NotificationPreferenceCategory = typeof notificationPreferenceCategories[number]
export const notificationCategories = [...notificationPreferenceCategories, 'test'] as const
export type NotificationCategory = typeof notificationCategories[number]
const kinds = ['run', 'discrepancy', 'monitor', 'credential', 'test'] as const
const states = ['unread', 'read', 'withdrawn'] as const
const linkKinds = ['play', 'play-execution', 'account', 'account-credential'] as const

/** Maps to the shell's own navigation; content never carries a URL. */
export interface NotificationLink {
  kind: typeof linkKinds[number]
  label: string
  playId: string | null
  accountId: string | null
}
/** Names snapshotted when the notification was composed. */
export interface NotificationSubject {
  accountId: string | null
  accountName: string | null
  venueId: string | null
  playId: string | null
  playTitle: string | null
  instrument: string | null
}
/** Plain server-authored text with exact decimal strings; render it as text. */
export interface NotificationContent {
  title: string
  summary: string | null
  lines: string[]
  late: boolean
  links: NotificationLink[]
  subject: NotificationSubject
}
export interface InAppNotification {
  id: string
  kind: typeof kinds[number]
  category: NotificationCategory
  severity: NotificationSeverity
  content: NotificationContent
  occurredAt: string
  detectedAt: string
  createdAt: string
  state: typeof states[number]
  readAt: string | null
}
export interface NotificationHead {
  nextCursor: NotificationCursor
  unreadCount: number
  enabled: boolean
  workerOnline: boolean
  heartbeatAtUtc: string | null
}
export type NotificationTab = 'unread' | 'all'
export interface NotificationQuery {
  tab: NotificationTab
  category?: NotificationCategory
  severity?: NotificationSeverity
  page: number
  pageSize: number
}
export interface NotificationPage {
  items: InAppNotification[]
  page: number
  pageSize: number
  total: number
  unreadTotal: number
  allTotal: number
}
export interface NotificationClaim { popups: InAppNotification[]; more: number }
export interface NotificationPreferenceFields {
  enabled: boolean
  minimumSeverity: NotificationSeverity
  categories: NotificationPreferenceCategory[]
}
export interface NotificationPreferences extends NotificationPreferenceFields {
  revision: number
  workerOnline: boolean
  heartbeatAtUtc: string | null
  /** `lagging` once events aged out before the hub handled them; null before provisioning. */
  subscriptionStatus: 'active' | 'lagging' | null
  /** Events the hub gave up on after its retries. */
  failedDeliveries: number
}
/** A changed notification from the event stream. `cursor` is its own feed position, read from the frame data. */
export interface NotificationFrame { cursor: NotificationCursor; unreadCount: number; enabled: boolean; notification: InAppNotification }
/** `ready` echoes the accepted cursor; `reset` names the head to continue from. */
export interface NotificationsStatus { state: 'ready' | 'reset'; nextCursor: NotificationCursor; unreadCount: number; enabled: boolean }

/** Shown when a save raced another tab or window: the Settings page reloads and asks again. */
export const notificationPreferencesConflict = 'Notification preferences changed elsewhere. The current settings are loaded; review them and save again.'
/** Shown when Mark all as read raced a reset: the page reloads and the owner may try again. */
export const notificationReadAllConflict = 'Notifications changed while marking them read. The list is reloaded; try again.'

const keys = (v: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(v).length === expected.length && expected.every(key => key in v)
const oneOf = <T extends string>(values: readonly T[]) => (v: unknown): v is T => values.includes(v as T)
// UTC strings as the API writes them, with up to seven fractional digits.
const date = (v: unknown): v is string => isTimestamp(v, 64) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(v)
const guid = (v: unknown) => isNullOr(v, isNonEmptyGuid)
const name = (v: unknown) => isNullOr(v, value => isFilledText(value, 200))
export const isNotificationSeverity = oneOf(notificationSeverities)
export const isNotificationCategory = oneOf(notificationCategories)
const isPreferenceCategory = oneOf(notificationPreferenceCategories)

const link = (v: unknown): v is NotificationLink => object(v) && keys(v, ['kind', 'label', 'playId', 'accountId']) &&
  oneOf(linkKinds)(v.kind) && isFilledText(v.label, 60) && guid(v.playId) && guid(v.accountId) &&
  // A link names what it opens.
  (v.kind === 'play' || v.kind === 'play-execution' ? v.playId !== null : v.accountId !== null)
const subject = (v: unknown): v is NotificationSubject => object(v) &&
  keys(v, ['accountId', 'accountName', 'venueId', 'playId', 'playTitle', 'instrument']) &&
  guid(v.accountId) && name(v.accountName) && isNullOr(v.venueId, value => isFilledText(value, 64)) &&
  guid(v.playId) && name(v.playTitle) && isNullOr(v.instrument, value => isFilledText(value, 128))
const content = (v: unknown): v is NotificationContent => object(v) && keys(v, ['title', 'summary', 'lines', 'late', 'links', 'subject']) &&
  isFilledText(v.title, 160) && isNullOr(v.summary, value => isText(value, 200)) &&
  isListOf(v.lines, line => isText(line, 200), 8) && typeof v.late === 'boolean' && isListOf(v.links, link, 3) && subject(v.subject)

export const isInAppNotification = (v: unknown): v is InAppNotification => object(v) &&
  keys(v, ['id', 'kind', 'category', 'severity', 'content', 'occurredAt', 'detectedAt', 'createdAt', 'state', 'readAt']) &&
  isNonEmptyGuid(v.id) && oneOf(kinds)(v.kind) && isNotificationCategory(v.category) && isNotificationSeverity(v.severity) &&
  content(v.content) && date(v.occurredAt) && date(v.detectedAt) && date(v.createdAt) && oneOf(states)(v.state) &&
  // Only a read notification has a read time; a withdrawn one may have been read before it was withdrawn.
  (v.state === 'unread' ? v.readAt === null : v.state === 'read' ? date(v.readAt) : isNullOr(v.readAt, date))

export const isNotificationHead = (v: unknown): v is NotificationHead => object(v) &&
  keys(v, ['nextCursor', 'unreadCount', 'enabled', 'workerOnline', 'heartbeatAtUtc']) && isNotificationCursor(v.nextCursor) &&
  isCount(v.unreadCount) && typeof v.enabled === 'boolean' && typeof v.workerOnline === 'boolean' && isNullOr(v.heartbeatAtUtc, date)

const distinct = (items: InAppNotification[]) => new Set(items.map(item => item.id)).size === items.length
export const isNotificationPage = (v: unknown, query: NotificationQuery): v is NotificationPage => object(v) &&
  keys(v, ['items', 'page', 'pageSize', 'total', 'unreadTotal', 'allTotal']) &&
  isListOf(v.items, isInAppNotification, query.pageSize) && distinct(v.items as InAppNotification[]) &&
  isCount(v.page) && v.page >= 1 && v.page <= query.page && v.pageSize === query.pageSize &&
  isCount(v.total) && isCount(v.unreadTotal) && isCount(v.allTotal) &&
  (query.tab === 'unread' ? (v.items as InAppNotification[]).every(item => item.state === 'unread') : true) &&
  (query.category === undefined || (v.items as InAppNotification[]).every(item => item.category === query.category)) &&
  (query.severity === undefined || (v.items as InAppNotification[]).every(item => item.severity === query.severity))

export const isNotificationClaim = (v: unknown): v is NotificationClaim => object(v) && keys(v, ['popups', 'more']) &&
  isListOf(v.popups, isInAppNotification, 3) && distinct(v.popups as InAppNotification[]) && isCount(v.more)

export const isNotificationPreferences = (v: unknown): v is NotificationPreferences => object(v) &&
  keys(v, ['enabled', 'minimumSeverity', 'categories', 'revision', 'workerOnline', 'heartbeatAtUtc', 'subscriptionStatus', 'failedDeliveries']) &&
  typeof v.enabled === 'boolean' && isNotificationSeverity(v.minimumSeverity) &&
  isListOf(v.categories, isPreferenceCategory, notificationPreferenceCategories.length) &&
  new Set(v.categories).size === v.categories.length && isCount(v.revision) &&
  typeof v.workerOnline === 'boolean' && isNullOr(v.heartbeatAtUtc, date) &&
  (v.subscriptionStatus === null || v.subscriptionStatus === 'active' || v.subscriptionStatus === 'lagging') && isCount(v.failedDeliveries)

export const isNotificationReadAll = (v: unknown): v is { read: number } => object(v) && keys(v, ['read']) && isCount(v.read)

/** The `notifications` stream frame: the feed's ready or reset status. */
export const isNotificationsStatus = (v: unknown): v is NotificationsStatus => object(v) &&
  keys(v, ['state', 'nextCursor', 'unreadCount', 'enabled']) && (v.state === 'ready' || v.state === 'reset') &&
  isNotificationCursor(v.nextCursor) && isCount(v.unreadCount) && typeof v.enabled === 'boolean'

/** The `notification` stream frame. Its cursor is in the data; the SSE `id:` line belongs to events. */
export const isNotificationFrame = (v: unknown): v is NotificationFrame => object(v) &&
  keys(v, ['cursor', 'unreadCount', 'enabled', 'notification']) && isNotificationCursor(v.cursor) &&
  isCount(v.unreadCount) && typeof v.enabled === 'boolean' && isInAppNotification(v.notification)

/** The page request path. The API accepts 1 to 100 rows; the UI offers 25, 50 and 100. */
export function notificationPagePath(query: NotificationQuery) {
  if (!['unread', 'all'].includes(query.tab) || !isCount(query.page) || query.page < 1 ||
    !isCount(query.pageSize) || query.pageSize < 1 || query.pageSize > 100 ||
    query.category !== undefined && !isNotificationCategory(query.category) ||
    query.severity !== undefined && !isNotificationSeverity(query.severity)) {
    throw new ApiError('invalid-response', 'The notification filters are invalid.')
  }
  const params = new URLSearchParams({ tab: query.tab })
  if (query.category) params.set('category', query.category)
  if (query.severity) params.set('severity', query.severity)
  params.set('page', String(query.page))
  params.set('pageSize', String(query.pageSize))
  return `/api/notifications?${params}`
}

export const isNotificationPreferenceFields = (v: NotificationPreferenceFields) => typeof v.enabled === 'boolean' &&
  isNotificationSeverity(v.minimumSeverity) && Array.isArray(v.categories) && v.categories.every(isPreferenceCategory) &&
  new Set(v.categories).size === v.categories.length
