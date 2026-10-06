import type { ImageMarkup } from '@/features/plays/markup'

export const playStatuses = ['draft', 'planned', 'paused', 'open', 'closed', 'cancelled'] as const
export type PlayStatus = typeof playStatuses[number]
export const cancelReasons = ['invalidated', 'missed', 'changed-mind', 'expired', 'mistake', 'other'] as const
export type CancelReason = typeof cancelReasons[number]

/** A stop or target. A percent value is the return on margin at the plan's leverage; share is the part of the entry it closes. */
export interface PlanExit { id: string; unit: 'price' | 'percent'; value: string; share: string }
export interface PlanEntry { id: string; name: string; color: string; share: string; price: string; stops: PlanExit[]; targets: PlanExit[] }
/** The plan as stored and revised. Number fields keep the exact text entered. */
export interface PlayPlan {
  direction: 'long' | 'short'
  sizingMode: 'margin' | 'quantity'
  size: string
  leverage: string
  budgetOverride: string | null
  entries: PlanEntry[]
  notes: { thesis: string; invalidation: string; strategy: string; evidence: string }
}
export interface PlaySummary {
  id: string
  title: string
  status: PlayStatus
  accountId: string
  venueId: string
  instrument: string | null
  instrumentSource: 'venue' | 'manual'
  direction: 'long' | 'short'
  planRevision: number
  version: number
  cancelReason: CancelReason | null
  createdAtUtc: string
  updatedAtUtc: string
  plannedAtUtc: string | null
  endedAtUtc: string | null
}
export interface SavedPlay {
  summary: PlaySummary
  plan: PlayPlan
  /** Chart drawings per venue instrument key; validated by the chart when loaded. */
  drawings: Record<string, unknown[]>
  review: string
}
export interface PlayFields {
  accountId: string
  instrument: string | null
  instrumentSource: 'venue' | 'manual'
  title: string
  plan: PlayPlan
  drawings: Record<string, unknown[]>
  review: string
}
export interface PlanRevision { number: number; status: PlayStatus; reason: string; createdAtUtc: string; plan: PlayPlan }
export interface StatusChange { from: PlayStatus; to: PlayStatus; reason: CancelReason | null; note: string | null; occurredAtUtc: string; source?: 'owner' | 'venue' }
export interface PlayHistory { revisions: PlanRevision[]; statusChanges: StatusChange[] }
export type StatusRequest =
  | { status: 'planned' | 'paused' }
  | { status: 'cancelled'; reason: CancelReason; note?: string }
export interface SavedEvidence {
  id: string
  playId: string
  source: 'capture' | 'upload'
  contentType: string
  sizeBytes: number
  sha256: string
  note: string
  createdAtUtc: string
  updatedAtUtc: string
  markup: ImageMarkup | null
}

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max = 20_000): v is string => typeof v === 'string' && v.length <= max
const guid = (v: unknown) => text(v) && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
const date = (v: unknown) => text(v, 64) && Number.isFinite(Date.parse(v))
const nullable = <T>(check: (v: unknown) => boolean) => (v: unknown): v is T | null => v === null || check(v)
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const exit = (v: unknown): v is PlanExit => object(v) && text(v.id, 64) && (v.unit === 'price' || v.unit === 'percent') &&
  text(v.value, 64) && text(v.share, 64)
const entry = (v: unknown): v is PlanEntry => object(v) && text(v.id, 64) && text(v.name, 100) && text(v.color, 16) &&
  text(v.share, 64) && text(v.price, 64) && Array.isArray(v.stops) && v.stops.every(exit) && Array.isArray(v.targets) && v.targets.every(exit)
export const isPlayPlan = (v: unknown): v is PlayPlan => object(v) && (v.direction === 'long' || v.direction === 'short') &&
  (v.sizingMode === 'margin' || v.sizingMode === 'quantity') && text(v.size, 64) && text(v.leverage, 8) &&
  nullable(x => text(x, 64))(v.budgetOverride) && Array.isArray(v.entries) && v.entries.length > 0 && v.entries.every(entry) &&
  object(v.notes) && ['thesis', 'invalidation', 'strategy', 'evidence'].every(k => text((v.notes as Record<string, unknown>)[k]))
export const isPlaySummary = (v: unknown): v is PlaySummary => object(v) && guid(v.id) && text(v.title, 200) &&
  playStatuses.includes(v.status as PlayStatus) && guid(v.accountId) && text(v.venueId, 64) && nullable(x => text(x, 128))(v.instrument) &&
  (v.instrumentSource === 'venue' || v.instrumentSource === 'manual') && (v.direction === 'long' || v.direction === 'short') &&
  count(v.planRevision) && count(v.version) && nullable(x => cancelReasons.includes(x as CancelReason))(v.cancelReason) &&
  date(v.createdAtUtc) && date(v.updatedAtUtc) && nullable(date)(v.plannedAtUtc) && nullable(date)(v.endedAtUtc)
export const isSavedPlay = (v: unknown): v is SavedPlay => object(v) && isPlaySummary(v.summary) && isPlayPlan(v.plan) &&
  object(v.drawings) && Object.values(v.drawings).every(Array.isArray) && text(v.review)
export const isPlayHistory = (v: unknown): v is PlayHistory => object(v) && Array.isArray(v.revisions) && Array.isArray(v.statusChanges) &&
  v.revisions.every(r => object(r) && count(r.number) && playStatuses.includes(r.status as PlayStatus) && text(r.reason, 2000) &&
    date(r.createdAtUtc) && isPlayPlan(r.plan)) &&
  v.statusChanges.every(c => object(c) && playStatuses.includes(c.from as PlayStatus) && playStatuses.includes(c.to as PlayStatus) &&
    nullable(x => cancelReasons.includes(x as CancelReason))(c.reason) && nullable(x => text(x, 2000))(c.note) && date(c.occurredAtUtc) &&
    (c.source === undefined || c.source === 'owner' || c.source === 'venue'))
export const isSavedEvidence = (v: unknown): v is SavedEvidence => object(v) && guid(v.id) && guid(v.playId) &&
  (v.source === 'capture' || v.source === 'upload') && text(v.contentType, 64) && count(v.sizeBytes) && text(v.sha256, 64) &&
  text(v.note, 4000) && date(v.createdAtUtc) && date(v.updatedAtUtc) && (v.markup === null || object(v.markup))

export const statusLabels: Record<PlayStatus, string> = {
  draft: 'Draft', planned: 'Planned', paused: 'Paused', open: 'Open', closed: 'Closed', cancelled: 'Cancelled',
}
export const cancelReasonLabels: Record<CancelReason, string> = {
  invalidated: 'Thesis invalidated', missed: 'Missed the entry', 'changed-mind': 'Changed my mind',
  expired: 'Expired', mistake: 'Created by mistake', other: 'Other',
}

/** A venue order as last seen. Prices and sizes keep the venue's exact decimals. */
export interface ExecutionOrder {
  orderId: string
  side: 'A' | 'B'
  orderType: string
  limitPrice: string
  triggerPrice: string | null
  reduceOnly: boolean
  isPositionTpsl: boolean
  originalSize: string
  remainingSize: string
  placedAtUtc: string
  status: 'open' | 'filled' | 'triggered' | 'canceled' | 'rejected' | 'other'
  venueStatus: string
  statusAtUtc: string
}
export interface ExecutionFill {
  sourceFillId: string
  direction: string
  price: string
  quantity: string
  fee: string
  feeToken: string
  closedPnlUsd: string
  occurredAtUtc: string
}
export type LinkRole = 'entry' | 'stop' | 'target' | 'exit'
export interface OrderLink {
  id: string
  role: LinkRole
  entryId: string | null
  /** Stop or target ID within the entry; null for entries and unplanned exits. */
  levelId: string | null
  state: 'linked' | 'suggested'
  source: 'automatic' | 'owner'
  order: ExecutionOrder | null
  filledQuantity: string
  fills: ExecutionFill[]
}
export interface PlayExecution {
  playId: string
  status: PlayStatus
  tracked: boolean
  reason: string | null
  checkedAtUtc: string | null
  totals: { enteredQuantity: string; exitedQuantity: string; openQuantity: string; closedPnlUsd: string; fees: Array<{ token: string; amount: string }> }
  entries: Array<{ entryId: string; filledQuantity: string; averageFillPrice: string | null; restingOrders: number }>
  links: OrderLink[]
  suggestions: OrderLink[]
  unlinkedOrders: ExecutionOrder[]
  notice: string
}
export interface LinkOrder { orderId: string; role: LinkRole; entryId?: string; levelId?: string }

const decimalText = (v: unknown) => text(v, 100) && /^-?\d+(\.\d+)?$/.test(v)
const executionOrder = (v: unknown): v is ExecutionOrder => object(v) && text(v.orderId, 128) && (v.side === 'A' || v.side === 'B') &&
  text(v.orderType, 32) && decimalText(v.limitPrice) && (v.triggerPrice === null || decimalText(v.triggerPrice)) &&
  typeof v.reduceOnly === 'boolean' && typeof v.isPositionTpsl === 'boolean' && decimalText(v.originalSize) && decimalText(v.remainingSize) &&
  date(v.placedAtUtc) && ['open', 'filled', 'triggered', 'canceled', 'rejected', 'other'].includes(v.status as string) &&
  text(v.venueStatus, 64) && date(v.statusAtUtc)
const executionFill = (v: unknown): v is ExecutionFill => object(v) && text(v.sourceFillId, 128) && text(v.direction, 128) &&
  decimalText(v.price) && decimalText(v.quantity) && decimalText(v.fee) && text(v.feeToken, 64) && decimalText(v.closedPnlUsd) && date(v.occurredAtUtc)
const orderLink = (v: unknown): v is OrderLink => object(v) && guid(v.id) && ['entry', 'stop', 'target', 'exit'].includes(v.role as string) &&
  nullable(x => text(x, 64))(v.entryId) && nullable(x => text(x, 64))(v.levelId) && (v.state === 'linked' || v.state === 'suggested') &&
  (v.source === 'automatic' || v.source === 'owner') && (v.order === null || executionOrder(v.order)) && decimalText(v.filledQuantity) &&
  Array.isArray(v.fills) && v.fills.every(executionFill)
export const isPlayExecution = (v: unknown): v is PlayExecution => object(v) && guid(v.playId) && playStatuses.includes(v.status as PlayStatus) &&
  typeof v.tracked === 'boolean' && nullable(x => text(x, 500))(v.reason) && nullable(date)(v.checkedAtUtc) &&
  object(v.totals) && ['enteredQuantity', 'exitedQuantity', 'openQuantity', 'closedPnlUsd'].every(k => decimalText((v.totals as Record<string, unknown>)[k])) &&
  Array.isArray(v.totals.fees) && v.totals.fees.every(f => object(f) && text(f.token, 64) && decimalText(f.amount)) &&
  Array.isArray(v.entries) && v.entries.every(e => object(e) && text(e.entryId, 64) && decimalText(e.filledQuantity) &&
    nullable(decimalText)(e.averageFillPrice) && count(e.restingOrders)) &&
  Array.isArray(v.links) && v.links.every(orderLink) && Array.isArray(v.suggestions) && v.suggestions.every(orderLink) &&
  Array.isArray(v.unlinkedOrders) && v.unlinkedOrders.every(executionOrder) && text(v.notice, 1000)
