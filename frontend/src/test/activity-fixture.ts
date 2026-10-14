import type { ActivityDocument, ActivityOperation } from '@/api/activity'
import type { ImportedFill } from '@/api/workspace'
import { accountFixture } from './workspace-fixture'

export const activityFillFixture: ImportedFill = {
  id: '12345678-1234-1234-1234-123456789abc', accountId: accountFixture.id, contractId: 'BTC',
  side: 'buy', direction: 'Open Long', positionEffect: 'open', feeBasis: 'reported', pnlBasis: 'gross',
  price: '100.123456789123456789', quantity: '2', fee: '0.01', feeToken: 'USDC', closedPnlUsd: '0',
  occurredAtUtc: '2026-10-12T10:00:00Z', orderId: '1', sourceFillId: '1', transactionHash: '', playId: null,
}
export const operationFixture: ActivityOperation = {
  id: `${activityFillFixture.id}:long`, accountId: accountFixture.id, contractId: 'BTC', direction: 'long', status: 'open',
  openedAtUtc: activityFillFixture.occurredAtUtc, closedAtUtc: null, lastOccurredAtUtc: activityFillFixture.occurredAtUtc,
  quantity: '2', totalEnteredQuantity: '2', totalExitedQuantity: '0', openQuantity: '2', averageEntryPrice: activityFillFixture.price,
  averageExitPrice: null, entryOrderCount: 1, exitOrderCount: 0, fillCount: 1, reportedClosedPnlUsd: '0', grossClosedPnlUsd: '0',
  stablecoinFeesNominalUsd: '0.01', otherFees: [], netResultUsd: '-0.01', pnlBasis: 'gross', playId: null, playAssociation: 'unassigned',
  coverage: [], fills: [{ fill: activityFillFixture, role: 'entry', quantity: '2', fee: '0.01', closedPnlUsd: '0' }], omittedFillCount: 0,
}
export const activityFixture: ActivityDocument = {
  operations: [operationFixture], totalOperationCount: 1, retainedFillCount: 1, omittedOperationCount: 0, coverage: [], scopeNote: 'Retained fixture fills only.',
}
