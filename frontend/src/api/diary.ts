import { isSavedPlay, type SavedPlay } from './plays'

export interface ManualExecutionInput {
  requestId: string
  expectedVersion: number
  role: 'entry' | 'exit'
  entryId: string | null
  occurredAtUtc: string
  side: 'buy' | 'sell'
  quantity: string
  price: string
  fee: string | null
  feeCurrency: string | null
  source: string
}
export interface ManualExecutionCorrection extends ManualExecutionInput { reason: string }
export interface ManualExecutionRecord extends Omit<ManualExecutionInput, 'requestId' | 'expectedVersion'> {
  id: string
  createdAtUtc: string
  updatedAtUtc: string
}
export interface ManualExecutions {
  play: SavedPlay
  records: ManualExecutionRecord[]
  history: Array<{ id: string; executionId: string; reason: string | null; occurredAtUtc: string; before: ManualExecutionRecord | null; after: ManualExecutionRecord }>
  totals: {
    enteredQuantity: string
    exitedQuantity: string
    openQuantity: string
    grossResultUsd: string | null
    netResultUsd: string | null
    feesComplete: boolean
  }
  notice: string
}

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const guid = (v: unknown) => text(v, 36) && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
const utc = (v: unknown) => text(v, 64) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19)
const decimal = (v: unknown) => text(v, 96) && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d{1,2})?$/.test(v)
const nonnegative = (v: unknown) => decimal(v) && !(v as string).startsWith('-')
const positive = (v: unknown) => nonnegative(v) && /[1-9]/.test((v as string).split(/[eE]/)[0]!)
const plain = (v: string) => !Array.from(v).some(char => {
  const code = char.charCodeAt(0)
  return code < 32 || code >= 127 && code <= 159
})
const facts = (v: Record<string, unknown>) => ['entry', 'exit'].includes(v.role as string) &&
  (v.role === 'entry' ? text(v.entryId, 64) && !!v.entryId : v.entryId === null) && utc(v.occurredAtUtc) &&
  ['buy', 'sell'].includes(v.side as string) && positive(v.quantity) && positive(v.price) &&
  ((v.fee === null && v.feeCurrency === null) || nonnegative(v.fee) && text(v.feeCurrency, 32) && /^[A-Za-z0-9_-]+$/.test(v.feeCurrency)) &&
  text(v.source, 100) && !!v.source.trim() && v.source === v.source.trim() && plain(v.source)
export const isManualExecutionInput = (v: unknown): v is ManualExecutionInput => object(v) && guid(v.requestId) &&
  typeof v.expectedVersion === 'number' && Number.isSafeInteger(v.expectedVersion) && v.expectedVersion > 0 && facts(v)
export const isManualExecutionCorrection = (v: unknown): v is ManualExecutionCorrection => isManualExecutionInput(v) &&
  object(v) && text(v.reason, 2000) && !!v.reason.trim() && plain(v.reason)
export const isManualExecutionRecord = (v: unknown): v is ManualExecutionRecord => object(v) && guid(v.id) &&
  facts(v) && utc(v.createdAtUtc) && utc(v.updatedAtUtc)
export const isManualExecutions = (v: unknown): v is ManualExecutions => object(v) && isSavedPlay(v.play) &&
  Array.isArray(v.records) && v.records.length <= 200 && v.records.every(isManualExecutionRecord) && Array.isArray(v.history) && v.history.length <= 1000 &&
  v.history.every(h => object(h) && guid(h.id) && guid(h.executionId) && (h.reason === null || text(h.reason, 2000)) && utc(h.occurredAtUtc) &&
    (h.before === null || isManualExecutionRecord(h.before)) && isManualExecutionRecord(h.after)) && object(v.totals) &&
  ['enteredQuantity', 'exitedQuantity', 'openQuantity'].every(key => nonnegative((v.totals as Record<string, unknown>)[key])) &&
  (v.totals.grossResultUsd === null || decimal(v.totals.grossResultUsd)) &&
  (v.totals.netResultUsd === null || decimal(v.totals.netResultUsd)) && typeof v.totals.feesComplete === 'boolean' && text(v.notice, 4000)

/** GUID request identities also work on LAN HTTP where randomUUID is unavailable. */
export function newDiaryRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
