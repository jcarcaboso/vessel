import type { ImportedFill } from './workspace'

export interface OperationFill {
  /** The untouched retained fact. Allocation fields describe only this operation's share. */
  fill: ImportedFill
  role: 'entry' | 'exit' | 'unknown'
  quantity: string
  fee: string
  closedPnlUsd: string
}
export interface ActivityOperation {
  id: string
  accountId: string
  contractId: string
  direction: 'long' | 'short' | null
  status: 'open' | 'closed' | 'incomplete'
  openedAtUtc: string | null
  closedAtUtc: string | null
  lastOccurredAtUtc: string
  quantity: string | null
  totalEnteredQuantity: string | null
  totalExitedQuantity: string | null
  openQuantity: string | null
  averageEntryPrice: string | null
  averageExitPrice: string | null
  entryOrderCount: number
  exitOrderCount: number
  fillCount: number
  reportedClosedPnlUsd: string
  stablecoinFeesNominalUsd: string
  otherFees: { token: string; amount: string }[]
  netResultUsd: string | null
  pnlBasis: 'gross' | 'net-of-fee' | 'mixed'
  playId: string | null
  playAssociation: 'linked' | 'unassigned' | 'mixed'
  coverage: string[]
  fills: OperationFill[]
  omittedFillCount: number
}
export interface ActivityDocument {
  operations: ActivityOperation[]
  totalOperationCount: number
  retainedFillCount: number
  omittedOperationCount: number
  coverage: { accountId: string; contractId: string | null; notice: string }[]
  scopeNote: string
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const guid = (v: unknown): v is string => text(v) && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
const decimal = (v: unknown): v is string => text(v, 160) && /^-?\d+(\.\d+)?$/.test(v)
const unsigned = (v: unknown) => decimal(v) && !v.startsWith('-')
const nullableDecimal = (v: unknown) => v === null || unsigned(v)
const date = (v: unknown): v is string => text(v, 64) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const notices = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(n => text(n))

export function isActivityDocument(value: unknown, isFill: (value: unknown) => value is ImportedFill): value is ActivityDocument {
  if (!object(value) || !Array.isArray(value.operations) || value.operations.length > 500 ||
    !count(value.totalOperationCount) || !count(value.retainedFillCount) || !count(value.omittedOperationCount) ||
    value.totalOperationCount !== value.operations.length + value.omittedOperationCount || !text(value.scopeNote, 4000) ||
    !Array.isArray(value.coverage) || !value.coverage.every(c => object(c) && guid(c.accountId) &&
      (c.contractId === null || text(c.contractId, 128)) && text(c.notice))) return false
  let fillRows = 0
  for (const op of value.operations) {
    if (!object(op) || !text(op.id, 48) || !/^[\da-f-]{36}:(long|short)$/.test(op.id) || !guid(op.id.slice(0, 36)) ||
      !guid(op.accountId) || !text(op.contractId, 128) || !['long', 'short', null].includes(op.direction as string | null) ||
      !['open', 'closed', 'incomplete'].includes(String(op.status)) || !date(op.lastOccurredAtUtc) ||
      !(op.openedAtUtc === null || date(op.openedAtUtc)) || !(op.closedAtUtc === null || date(op.closedAtUtc)) ||
      !['quantity', 'totalEnteredQuantity', 'totalExitedQuantity', 'openQuantity', 'averageEntryPrice', 'averageExitPrice'].every(k => nullableDecimal(op[k])) ||
      !['entryOrderCount', 'exitOrderCount', 'fillCount', 'omittedFillCount'].every(k => count(op[k])) ||
      !decimal(op.reportedClosedPnlUsd) || !decimal(op.stablecoinFeesNominalUsd) || !(op.netResultUsd === null || decimal(op.netResultUsd)) ||
      !['gross', 'net-of-fee', 'mixed'].includes(String(op.pnlBasis)) || !(op.playId === null || guid(op.playId)) ||
      !['linked', 'unassigned', 'mixed'].includes(String(op.playAssociation)) || !notices(op.coverage) ||
      !Array.isArray(op.otherFees) || !op.otherFees.every(f => object(f) && text(f.token, 64) && decimal(f.amount)) ||
      !Array.isArray(op.fills) || op.fills.length > 200 || (op.fillCount as number) !== op.fills.length + (op.omittedFillCount as number) ||
      (op.fillCount as number) === 0 || (op.entryOrderCount as number) > (op.fillCount as number) || (op.exitOrderCount as number) > (op.fillCount as number) ||
      op.fills.some(f => !object(f) || !isFill(f.fill) || f.fill.accountId !== op.accountId || f.fill.contractId !== op.contractId ||
        !['entry', 'exit', 'unknown'].includes(String(f.role)) || !decimal(f.quantity) || f.role !== 'unknown' && !unsigned(f.quantity) || !decimal(f.fee) || !decimal(f.closedPnlUsd)) ||
      (op.playAssociation === 'linked') !== (op.playId !== null)) return false
    if (op.status === 'incomplete') {
      if (op.direction !== null || op.openedAtUtc !== null || op.closedAtUtc !== null || op.quantity !== null || op.openQuantity !== null ||
        op.totalEnteredQuantity !== null || op.totalExitedQuantity !== null || op.averageEntryPrice !== null || op.averageExitPrice !== null || !op.coverage.length) return false
    } else if (op.direction === null || op.openedAtUtc === null || op.quantity === null || op.openQuantity === null ||
      op.totalEnteredQuantity === null || op.totalExitedQuantity === null || op.averageEntryPrice === null ||
      (op.status === 'closed') !== (op.closedAtUtc !== null) || op.closedAtUtc !== null && Date.parse(String(op.closedAtUtc)) < Date.parse(String(op.openedAtUtc))) return false
    fillRows += op.fills.length
  }
  return fillRows <= 10_000 && new Set(value.operations.map(op => (op as ActivityOperation).id)).size === value.operations.length
}
