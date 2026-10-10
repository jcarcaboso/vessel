import { reviewPeriods, type ReviewDocument, type ReviewMetrics } from '@/api/review'

export const emptyReviewMetrics: ReviewMetrics = {
  count: 0, wins: 0, losses: 0, scratches: 0, net: null, batting: null, averageGain: null, averageLoss: null,
  payoff: null, profitFactor: null, averageWin: null, averageLossUsd: null, expectancy: null, averageR: null,
  riskCount: 0, reviewed: 0, drawdown: null, maxWins: 0, maxLosses: 0,
}
export const emptyReview: ReviewDocument = {
  asOfUtc: '2026-10-09T12:00:00Z', fromUtc: '2026-09-09T12:00:00Z', period: 'month', currency: 'USD',
  options: { portfolios: [], accounts: [], instruments: [] },
  periods: reviewPeriods.map(p => ({ id: p.id, net: null, count: 0 })), metrics: emptyReviewMetrics,
  series: [], bucketDays: 1, groups: { portfolios: [], accounts: [], assets: [] },
  coverage: { closedCandidates: 0, incompleteFees: 0, incompleteExecutions: 0, openPlays: 0, unassignedFills: 0,
    firstFillAtUtc: null, notice: 'Retained history is not lifetime history. Funding excluded.' },
  plays: [], offset: 0, nextOffset: null,
}
const accountId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const portfolioId = '11111111-2222-3333-4444-555555555555'
const metrics: ReviewMetrics = {
  count: 3, wins: 1, losses: 1, scratches: 1, net: '150.123456789', batting: '0.5', averageGain: '2.00123456789',
  averageLoss: '1', payoff: '2.00123456789', profitFactor: '4.00246913578', averageWin: '200.123456789',
  averageLossUsd: '50', expectancy: '50.041152263', averageR: '1', riskCount: 2, reviewed: 1,
  drawdown: '50', maxWins: 1, maxLosses: 1,
}
/** Synthetic API data for tests only, never a production fallback. */
export const reviewFixture: ReviewDocument = {
  ...emptyReview,
  options: {
    portfolios: [{ id: portfolioId, name: 'Swing trading' }],
    accounts: [{ id: accountId, name: 'Main account', portfolioId, venueId: 'hyperliquid', lastSyncedAtUtc: '2026-10-09T12:00:00Z', syncStatus: 'synced', historyNotice: 'Recent history only.' }],
    instruments: ['BTC'],
  },
  metrics, periods: reviewPeriods.map(p => ({ id: p.id, count: metrics.count, net: metrics.net })),
  series: [
    { atUtc: '2026-10-07T00:00:00Z', net: '200.123456789', cumulative: '200.123456789', drawdown: '0', count: 1 },
    { atUtc: '2026-10-08T00:00:00Z', net: '-50', cumulative: '150.123456789', drawdown: '-50', count: 2 },
  ],
  groups: {
    portfolios: [{ id: portfolioId, name: 'Swing trading', detail: '1 account', metrics }],
    accounts: [{ id: accountId, name: 'Main account', detail: 'hyperliquid', metrics }],
    assets: [{ id: 'BTC', name: 'BTC', detail: 'hyperliquid', metrics }],
  },
  coverage: { ...emptyReview.coverage, closedCandidates: 5, incompleteFees: 1, incompleteExecutions: 1, unassignedFills: 12 },
  plays: [{ id: '22222222-3333-4444-5555-666666666666', title: 'BTC breakout', accountId, accountName: 'Main account',
    venueId: 'hyperliquid', instrument: 'BTC', closedAtUtc: '2026-10-07T15:00:00Z',
    net: '200.123456789', returnPercent: '2.00123456789', rMultiple: '2', reviewed: true }],
}
