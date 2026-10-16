import type { RetrospectivePreview } from '@/api/retrospective'
import type { SavedPlay } from '@/api/plays'
import { activityFillFixture, operationWithFillsFixture } from '@/test/activity-fixture'
import { savedPlayFixture } from '@/test/workspace-fixture'

const exit = { ...activityFillFixture, id: 'aaaaaaaa-1234-1234-1234-123456789abc',
  side: 'sell', direction: 'Close Long', positionEffect: 'close', price: '110.123456789123456789',
  closedPnlUsd: '20', occurredAtUtc: '2026-10-12T12:00:00Z', orderId: '2', sourceFillId: '2' }
/** Bounded backend-shaped synthetic complete operation. Never used in production. */
export const retrospectiveFixture: RetrospectivePreview = {
  eligible: true, reasons: [], fingerprint: 'verified-facts-v1',
  notice: 'Retained imported facts only. Revalidated under the account lock at creation.',
  operation: { ...operationWithFillsFixture, status: 'closed', closedAtUtc: exit.occurredAtUtc, lastOccurredAtUtc: exit.occurredAtUtc,
    totalExitedQuantity: '2', openQuantity: '0', averageExitPrice: exit.price,
    exitOrderCount: 1, fillCount: 2, reportedClosedPnlUsd: '20', stablecoinFeesNominalUsd: '0.02', netResultUsd: '19.98',
    fills: [...operationWithFillsFixture.fills, { fill: exit, role: 'exit', quantity: exit.quantity, fee: exit.fee, closedPnlUsd: exit.closedPnlUsd }],
  },
}
export const retrospectiveSavedFixture: SavedPlay = {
  ...savedPlayFixture,
  summary: { ...savedPlayFixture.summary, title: 'Retrospective BTC', status: 'closed', venueId: 'hyperliquid',
    instrumentSource: 'venue', origin: 'retrospective', planRevision: 0, plannedAtUtc: null,
    createdAtUtc: '2026-10-13T12:00:00Z', updatedAtUtc: '2026-10-13T12:00:00Z',
    endedAtUtc: exit.occurredAtUtc, reviewedAtUtc: null },
  plan: { ...savedPlayFixture.plan, entries: [], leverage: '0', notes: { thesis: '', invalidation: '', strategy: '', evidence: '' } },
}
