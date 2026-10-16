import type { ActivityFills, ActivityOperation, ActivityPage, OperationFill, OperationWithFills } from '@/api/activity'
import type { ImportedFill } from '@/api/fills'
import { accountFixture } from './workspace-fixture'

export const activityFillFixture: ImportedFill = {
  id: '12345678-1234-1234-1234-123456789abc', accountId: accountFixture.id, contractId: 'BTC',
  side: 'buy', direction: 'Open Long', positionEffect: 'open', feeBasis: 'reported', pnlBasis: 'gross',
  price: '100.123456789123456789', quantity: '2', fee: '0.01', feeToken: 'USDC', closedPnlUsd: '0',
  occurredAtUtc: '2026-10-12T10:00:00Z', orderId: '1', sourceFillId: '1', transactionHash: '', playId: null,
}
export const operationFillsFixture: OperationFill[] = [{ fill: activityFillFixture, role: 'entry', quantity: '2', fee: '0.01', closedPnlUsd: '0' }]
export const operationFixture: ActivityOperation = {
  id: `${activityFillFixture.id}:long`, accountId: accountFixture.id, contractId: 'BTC', direction: 'long', status: 'open',
  openedAtUtc: activityFillFixture.occurredAtUtc, closedAtUtc: null, lastOccurredAtUtc: activityFillFixture.occurredAtUtc,
  quantity: '2', totalEnteredQuantity: '2', totalExitedQuantity: '0', openQuantity: '2', averageEntryPrice: activityFillFixture.price,
  averageExitPrice: null, entryOrderCount: 1, exitOrderCount: 0, fillCount: 1, reportedClosedPnlUsd: '0', grossClosedPnlUsd: '0',
  stablecoinFeesNominalUsd: '0.01', otherFees: [], netResultUsd: '-0.01', pnlBasis: 'gross', playId: null, playAssociation: 'unassigned',
  coverage: [],
}
/** The same operation with its rows, as a retrospective preview carries it. */
export const operationWithFillsFixture: OperationWithFills = { ...operationFixture, fills: operationFillsFixture, omittedFillCount: 0 }
export const activityFillsFixture: ActivityFills = { operationId: operationFixture.id, fills: operationFillsFixture, omittedFillCount: 0 }

/** A backend-shaped page: counts, facets and order follow the given operations unless overridden. */
export function activityPage(operations: ActivityOperation[], overrides: Partial<ActivityPage> = {}): ActivityPage {
  const totalCount = overrides.totalCount ?? operations.length
  return {
    operations, page: 1, pageSize: 25, totalCount, scopeCount: totalCount, retainedFillCount: operations.reduce((n, op) => n + op.fillCount, 0),
    asOfUtc: '2026-10-13T00:00:00Z', version: 'fixture-v1',
    facets: { accountIds: [...new Set(operations.map(op => op.accountId))].sort(), contracts: [...new Set(operations.map(op => op.contractId))].sort() },
    coverage: [], scopeNote: 'Retained fixture fills only.', ...overrides,
  }
}
export const activityFixture: ActivityPage = activityPage([operationFixture])
