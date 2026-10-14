import { isManualExecutionCorrection, isManualExecutionInput, newDiaryRequestId, type ManualExecutionCorrection, type ManualExecutionInput, type ManualExecutionRecord } from '@/api/diary'

/** Kept with the shell's Plays session, including the identity of an uncertain write. */
export interface ManualExecutionDraft {
  executionId: string | null
  role: 'entry' | 'exit'
  entryId: string
  occurredAtUtc: string
  side: 'buy' | 'sell' | ''
  quantity: string
  price: string
  fee: string
  feeCurrency: string
  source: string
  reason: string
  attempt?: ManualExecutionInput | ManualExecutionCorrection
}
export const emptyManualDraft = (): ManualExecutionDraft => ({
  executionId: null, role: 'entry', entryId: '', occurredAtUtc: '', side: '', quantity: '', price: '',
  fee: '', feeCurrency: '', source: '', reason: '',
})
export const hasManualDraft = (draft?: ManualExecutionDraft) => !!draft &&
  !!(draft.executionId || draft.entryId || draft.occurredAtUtc || draft.side || draft.quantity || draft.price || draft.fee || draft.feeCurrency || draft.source || draft.reason || draft.attempt)
export function manualCorrectionDraft(record: ManualExecutionRecord): ManualExecutionDraft {
  return { ...emptyManualDraft(), ...record, executionId: record.id, entryId: record.entryId ?? '', fee: record.fee ?? '',
    feeCurrency: record.feeCurrency ?? '' }
}

export function manualRequest(draft: ManualExecutionDraft, version: number, direction: 'long' | 'short', entryIds: string[]) {
  const openingSide = direction === 'long' ? 'buy' : 'sell'
  if (draft.role === 'entry' && !entryIds.includes(draft.entryId)) return { error: 'Choose an entry from the saved plan.' } as const
  if (draft.side !== (draft.role === 'entry' ? openingSide : openingSide === 'buy' ? 'sell' : 'buy')) {
    return { error: `This ${direction} play needs ${draft.role === 'entry' ? openingSide : openingSide === 'buy' ? 'sell' : 'buy'} for an ${draft.role}.` } as const
  }
  // Unqualified input is UTC; keep explicit UTC suffixes and fractional precision intact.
  const time = draft.occurredAtUtc
  const occurredAtUtc = !time || /(?:Z|\+00:00)$/.test(time) ? time : `${time.length === 16 ? `${time}:00` : time}Z`
  if (Number.isFinite(Date.parse(occurredAtUtc)) && Date.parse(occurredAtUtc) > Date.now()) return { error: 'Execution time must be a nonfuture UTC timestamp.' } as const
  const input: ManualExecutionInput | ManualExecutionCorrection = draft.attempt ?? {
    requestId: newDiaryRequestId(), expectedVersion: version, role: draft.role, entryId: draft.role === 'entry' ? draft.entryId : null,
    occurredAtUtc, side: draft.side, quantity: draft.quantity, price: draft.price,
    fee: draft.fee === '' ? null : draft.fee, feeCurrency: draft.feeCurrency === '' ? null : draft.feeCurrency,
    source: draft.source, ...(draft.executionId ? { reason: draft.reason } : {}),
  }
  if (!isManualExecutionInput(input)) return { error: 'Enter positive decimal quantity and price, a UTC time and a source. Leave both fee fields blank for unknown, or provide an amount and currency (including known zero).' } as const
  if (draft.executionId && !isManualExecutionCorrection(input)) return { error: 'Give a reason for the correction.' } as const
  return { input } as const
}
