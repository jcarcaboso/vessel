import { isImportedFill, type ImportedFill } from './fills'
import { isCount, isFilledText, isGuid, isIsoTimestamp, isListOf, isNonNegativeDecimal, isNullOr, isPlainDecimal, isRecord } from './guards'

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
  grossClosedPnlUsd: string | null
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
/** Activity allows longer decimal strings than most endpoints. */
const decimalLength = 160

/** `{account GUID}:long` or `:short`, as Activity and retrospective previews identify an operation. */
export const isOperationId = (v: unknown): v is string =>
  isFilledText(v, 48) && /^[\da-f-]{36}:(long|short)$/.test(v) && isGuid(v.slice(0, 36))

export function isActivityDocument(value: unknown): value is ActivityDocument {
  if (!isRecord(value) || !Array.isArray(value.operations) || value.operations.length > 500 ||
    !isCount(value.totalOperationCount) || !isCount(value.retainedFillCount) || !isCount(value.omittedOperationCount) ||
    value.totalOperationCount !== value.operations.length + value.omittedOperationCount || !isFilledText(value.scopeNote, 4000) ||
    !Array.isArray(value.coverage) || !value.coverage.every(c => isRecord(c) && isGuid(c.accountId) &&
      isNullOr(c.contractId, x => isFilledText(x, 128)) && isFilledText(c.notice, 2000))) return false
  let fillRows = 0
  for (const op of value.operations) {
    if (!isRecord(op) || !isOperationId(op.id) ||
      !isGuid(op.accountId) || !isFilledText(op.contractId, 128) || !['long', 'short', null].includes(op.direction as string | null) ||
      !['open', 'closed', 'incomplete'].includes(String(op.status)) || !isIsoTimestamp(op.lastOccurredAtUtc) ||
      !isNullOr(op.openedAtUtc, isIsoTimestamp) || !isNullOr(op.closedAtUtc, isIsoTimestamp) ||
      !['quantity', 'totalEnteredQuantity', 'totalExitedQuantity', 'openQuantity', 'averageEntryPrice', 'averageExitPrice'].every(k => isNullOr(op[k], x => isNonNegativeDecimal(x, decimalLength))) ||
      !['entryOrderCount', 'exitOrderCount', 'fillCount', 'omittedFillCount'].every(k => isCount(op[k])) ||
      !isPlainDecimal(op.reportedClosedPnlUsd, decimalLength) || !isNullOr(op.grossClosedPnlUsd, x => isPlainDecimal(x, decimalLength)) ||
      !isPlainDecimal(op.stablecoinFeesNominalUsd, decimalLength) || !isNullOr(op.netResultUsd, x => isPlainDecimal(x, decimalLength)) ||
      !['gross', 'net-of-fee', 'mixed'].includes(String(op.pnlBasis)) || !isNullOr(op.playId, isGuid) ||
      !['linked', 'unassigned', 'mixed'].includes(String(op.playAssociation)) || !isListOf(op.coverage, n => isFilledText(n, 2000), 100) ||
      !Array.isArray(op.otherFees) || !op.otherFees.every(f => isRecord(f) && isFilledText(f.token, 64) && isPlainDecimal(f.amount, decimalLength)) ||
      !Array.isArray(op.fills) || op.fills.length > 200 || (op.fillCount as number) !== op.fills.length + (op.omittedFillCount as number) ||
      (op.fillCount as number) === 0 || (op.entryOrderCount as number) > (op.fillCount as number) || (op.exitOrderCount as number) > (op.fillCount as number) ||
      op.fills.some(f => !isRecord(f) || !isImportedFill(f.fill) || f.fill.accountId !== op.accountId || f.fill.contractId !== op.contractId ||
        !['entry', 'exit', 'unknown'].includes(String(f.role)) || !isPlainDecimal(f.quantity, decimalLength) || f.role !== 'unknown' && !isNonNegativeDecimal(f.quantity, decimalLength) || !isPlainDecimal(f.fee, decimalLength) || !isPlainDecimal(f.closedPnlUsd, decimalLength)) ||
      (op.playAssociation === 'linked') !== (op.playId !== null)) return false
    if (op.status === 'incomplete') {
      if (!op.coverage.length) return false
      if (op.direction === null) {
        if (op.openedAtUtc !== null || op.closedAtUtc !== null || op.quantity !== null || op.openQuantity !== null ||
          op.totalEnteredQuantity !== null || op.totalExitedQuantity !== null || op.averageEntryPrice !== null || op.averageExitPrice !== null) return false
      } else if (op.openedAtUtc !== null || op.quantity !== null || op.totalEnteredQuantity !== null || op.averageEntryPrice !== null ||
        op.openQuantity === null || op.totalExitedQuantity === null) return false
    } else if (op.direction === null || op.openedAtUtc === null || op.quantity === null || op.openQuantity === null ||
      op.totalEnteredQuantity === null || op.totalExitedQuantity === null || op.averageEntryPrice === null ||
      (op.status === 'closed') !== (op.closedAtUtc !== null) || op.closedAtUtc !== null && Date.parse(String(op.closedAtUtc)) < Date.parse(String(op.openedAtUtc))) return false
    fillRows += op.fills.length
  }
  return fillRows <= 10_000 && new Set(value.operations.map(op => (op as ActivityOperation).id)).size === value.operations.length
}
