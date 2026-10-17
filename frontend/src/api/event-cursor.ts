import type { WorkspaceApi } from './workspace'

/**
 * Owner event cursors are opaque server strings. Only this module knows their syntax: `0` for the start of a
 * stream not yet seen, otherwise `{epoch}.{sequence}` with the stream epoch as 32 lowercase hex digits. Callers
 * pass cursors through unchanged and ask this module to validate or order them.
 */
export type EventCursor = string

const sequence = /^(0|[1-9]\d{0,18})$/
const cursor = /^([0-9a-f]{32})\.(0|[1-9]\d{0,18})$/

/**
 * The API offers no dedicated head read. A bare sequence predates epochs, so the server always answers it with a
 * reset that names its current head; the largest one also lies beyond any retained sequence. It never leaves here.
 */
const headProbe = '9223372036854775807'

/** A cursor the server issued (`nextCursor`, a `status` frame or an event's SSE `id:` line). */
export const isEventCursor = (value: unknown): value is EventCursor =>
  typeof value === 'string' && (value === '0' || cursor.test(value))

/** An event's own `sequence`: an exact decimal string within one stream epoch, never a cursor. */
export const isEventSequence = (value: unknown): value is string => typeof value === 'string' && sequence.test(value)

/** What the browser may send as `after`: a server cursor, or this module's head probe. */
export const isRequestCursor = (value: unknown): value is EventCursor => isEventCursor(value) || value === headProbe

/** The cursor to stream from when none is known. Its first status names the head. */
export const unknownCursor: EventCursor = headProbe
export const isUnknownCursor = (value: EventCursor) => value === headProbe

/** Read the current head before any stored-state read, so later events are streamed rather than missed. */
export async function readHeadCursor(api: Pick<WorkspaceApi, 'monitorEvents'>, signal: AbortSignal): Promise<EventCursor> {
  const page = await api.monitorEvents(headProbe, 1, signal)
  return page.nextCursor
}

/**
 * Whether an event at `position` lies after `current`; repeated or older catch-up events do not. A position in
 * another stream epoch (a restored database) is new by definition. Nothing lies after the unknown cursor.
 */
export function isAfter(position: EventCursor, current: EventCursor) {
  if (isUnknownCursor(current)) return false
  const next = cursor.exec(position)
  if (!next) return false
  const known = cursor.exec(current)
  if (!known) return true
  return next[1] !== known[1] || BigInt(next[2]!) > BigInt(known[2]!)
}

/**
 * Owner notification cursors: `{epoch}.{reset}.{sequence}`, with the event stream's epoch (32 lowercase hex digits,
 * or `0` before the owner has any event) and the notification reset version. Like event cursors they are opaque to
 * every other module, and a notification frame carries its cursor in its data, never in the SSE `id:` line.
 */
export type NotificationCursor = string

const notificationCursor = /^(0|(?!0{32})[0-9a-f]{32})\.(0|[1-9]\d{0,18})\.(0|[1-9]\d{0,18})$/

/** A notification cursor the server issued (head, `notifications` frame or a `notification` frame's data). */
export const isNotificationCursor = (value: unknown): value is NotificationCursor =>
  typeof value === 'string' && notificationCursor.test(value)

/** Whether two notification cursors belong to the same epoch and reset version, so their positions compare. */
function generation(position: NotificationCursor, current: NotificationCursor) {
  const next = notificationCursor.exec(position), known = notificationCursor.exec(current)
  if (!next || !known || next[1] !== known[1]) return null
  return { next, known }
}

/** Whether a notification at `position` lies after `current` in the same epoch and reset version. */
export function isNotificationAfter(position: NotificationCursor, current: NotificationCursor) {
  const pair = generation(position, current)
  return pair !== null && pair.next[2] === pair.known[2] && BigInt(pair.next[3]!) > BigInt(pair.known[3]!)
}

/**
 * Whether an answer read at `answer` is older than the cursor the stream has adopted: another epoch (the stream resets
 * to a new one before the browser trusts it) or a lower reset version in the same epoch.
 */
export function isStaleNotificationCursor(answer: NotificationCursor, current: NotificationCursor) {
  const pair = generation(answer, current)
  return pair === null || BigInt(pair.next[2]!) < BigInt(pair.known[2]!)
}
