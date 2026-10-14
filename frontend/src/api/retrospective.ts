import { isActivityDocument, type ActivityOperation } from './activity'
import type { ImportedFill } from './workspace'

export interface RetrospectivePreview {
  eligible: boolean
  reasons: string[]
  fingerprint: string
  operation: ActivityOperation
  notice: string
}
export interface CreateRetrospectivePlayRequest {
  requestId: string
  accountId: string
  operationId: string
  expectedFingerprint: string
  title: string
  review?: string
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const guid = (v: unknown): v is string => text(v, 36) && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
const operationId = (v: unknown): v is string => text(v, 48) && /^[\da-f-]{36}:(long|short)$/.test(v) && guid(v.slice(0, 36))

/** Validate the original operation with the same bounded fact guard used by Activity. */
export function isRetrospectivePreview(value: unknown, isFill: (value: unknown) => value is ImportedFill): value is RetrospectivePreview {
  if (!object(value) || typeof value.eligible !== 'boolean' || !text(value.fingerprint, 256) || !text(value.notice, 4000) ||
    !Array.isArray(value.reasons) || value.reasons.length > 10_000 || !value.reasons.every(reason => text(reason, 2000)) ||
    !object(value.operation)) return false
  const op = value.operation
  return isActivityDocument({
    operations: [op], totalOperationCount: 1, retainedFillCount: op.fillCount,
    omittedOperationCount: 0, coverage: [], scopeNote: value.notice,
  }, isFill) && (!value.eligible || value.reasons.length === 0 && op.status === 'closed' &&
    op.direction !== null && op.playAssociation === 'unassigned' && op.omittedFillCount === 0 &&
    (op.fills as ActivityOperation['fills']).every(part => part.fill.playId === null &&
      (part.role === 'entry' && part.fill.positionEffect === 'open' || part.role === 'exit' && part.fill.positionEffect === 'close')))
}

export function isCreateRetrospectivePlayRequest(value: unknown): value is CreateRetrospectivePlayRequest {
  return object(value) && guid(value.requestId) && guid(value.accountId) && operationId(value.operationId) &&
    text(value.expectedFingerprint, 256) && text(value.title, 200) &&
    (value.review === undefined || typeof value.review === 'string' && value.review.length <= 10_000)
}

export function retrospectivePreviewPath(accountId: string, operationId: string): string {
  return `/api/activity/retrospective?${new URLSearchParams({ accountId, operationId })}`
}
export function retrospectivePlayPath(): string { return '/api/plays/retrospective' }
