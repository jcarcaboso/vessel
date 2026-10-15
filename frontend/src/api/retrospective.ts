import { isActivityDocument, isOperationId, type ActivityOperation } from './activity'
import { isGuid, isNonBlankText, isRecord, isText } from './guards'

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
/** Validate the original operation with the same bounded fact guard used by Activity. */
export function isRetrospectivePreview(value: unknown): value is RetrospectivePreview {
  if (!isRecord(value) || typeof value.eligible !== 'boolean' || !isNonBlankText(value.fingerprint, 256) || !isNonBlankText(value.notice, 4000) ||
    !Array.isArray(value.reasons) || value.reasons.length > 10_000 || !value.reasons.every(reason => isNonBlankText(reason, 2000)) ||
    !isRecord(value.operation)) return false
  const op = value.operation
  return isActivityDocument({
    operations: [op], totalOperationCount: 1, retainedFillCount: op.fillCount,
    omittedOperationCount: 0, coverage: [], scopeNote: value.notice,
  }) && (!value.eligible || value.reasons.length === 0 && op.status === 'closed' &&
    op.direction !== null && op.playAssociation === 'unassigned' && op.omittedFillCount === 0 &&
    (op.fills as ActivityOperation['fills']).every(part => part.fill.playId === null &&
      (part.role === 'entry' && part.fill.positionEffect === 'open' || part.role === 'exit' && part.fill.positionEffect === 'close')))
}

export function isCreateRetrospectivePlayRequest(value: unknown): value is CreateRetrospectivePlayRequest {
  return isRecord(value) && isGuid(value.requestId) && isGuid(value.accountId) && isOperationId(value.operationId) &&
    isNonBlankText(value.expectedFingerprint, 256) && isNonBlankText(value.title, 200) &&
    (value.review === undefined || isText(value.review, 10_000))
}

export function retrospectivePreviewPath(accountId: string, operationId: string): string {
  return `/api/activity/retrospective?${new URLSearchParams({ accountId, operationId })}`
}
export function retrospectivePlayPath(): string { return '/api/plays/retrospective' }
