import { isGuid, isNullOr, isPlainDecimal, isRecord, isText, isTimestamp } from './guards'

/** One retained imported fill, unchanged from the venue import. Decimal fields keep the venue's exact text. */
export interface ImportedFill {
  id: string
  accountId: string
  contractId: string
  side: string
  direction: string
  price: string
  quantity: string
  fee: string
  feeToken: string
  closedPnlUsd: string
  occurredAtUtc: string
  orderId: string
  sourceFillId: string
  transactionHash: string
  /** open, close, flip or unknown. */
  positionEffect: string
  /** reported, or standard-account-free when the account tier trades without fees. */
  feeBasis: string
  /** gross (fee separate) or net-of-fee (already taken off the closed PnL). */
  pnlBasis: string
  playId: string | null
}

/** The fill guard shared by Overview, account fills, Activity operations and retrospective previews. */
export const isImportedFill = (v: unknown): v is ImportedFill => isRecord(v) && isGuid(v.id) && isGuid(v.accountId) &&
  ['contractId', 'direction', 'feeToken', 'orderId', 'sourceFillId', 'transactionHash'].every(k => isText(v[k])) &&
  (v.side === 'buy' || v.side === 'sell') && ['open', 'close', 'flip', 'unknown'].includes(v.positionEffect as string) &&
  ['reported', 'standard-account-free'].includes(v.feeBasis as string) && ['gross', 'net-of-fee'].includes(v.pnlBasis as string) &&
  ['price', 'quantity', 'fee', 'closedPnlUsd'].every(k => isPlainDecimal(v[k])) && isTimestamp(v.occurredAtUtc) && isNullOr(v.playId, isGuid)
