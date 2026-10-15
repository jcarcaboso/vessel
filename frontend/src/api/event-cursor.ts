import type { WorkspaceApi } from './workspace'
import { isSequence } from './monitor'

/**
 * Owner event cursors are opaque server strings. Only this module knows their encoding (today a decimal
 * sequence), so an epoch-aware cursor later changes this file, not its callers.
 */
export type EventCursor = string

// Beyond any retained sequence: the server answers with a reset that names its current head.
const headProbe = '9223372036854775807'

export const isEventCursor = (value: unknown): value is EventCursor => isSequence(value)

/** The cursor to stream from when none is known. Its first status names the head. */
export const unknownCursor: EventCursor = headProbe
export const isUnknownCursor = (cursor: EventCursor) => cursor === headProbe

/** Read the current head before any stored-state read, so later events are streamed rather than missed. */
export async function readHeadCursor(api: WorkspaceApi, signal: AbortSignal): Promise<EventCursor> {
  const page = await api.monitorEvents(headProbe, 1, signal)
  return page.nextSequence
}

/** Whether an event at `position` lies after `cursor`; repeated or older catch-up events do not. */
export function isAfter(position: EventCursor, cursor: EventCursor) {
  return !isUnknownCursor(cursor) && BigInt(position) > BigInt(cursor)
}
