import { vi } from 'vitest'
import type { BrokerAccount, CandleSeries, InstrumentCatalog, MarketContext, Overview, Portfolio, WorkspaceApi } from '@/api/workspace'

export const portfolioFixture: Portfolio = {
  id: '11111111-2222-3333-4444-555555555555', name: 'Swing trading', accountCount: 1,
  totalValueUsd: '1250.123456', valueCoverage: 'complete',
}
export const accountFixture: BrokerAccount = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', portfolioId: portfolioFixture.id,
  name: 'Main account', venueId: 'manual', address: null, accountValueUsd: '1250.123456',
  lastSyncedAtUtc: null, syncStatus: 'manual', lastSyncError: null, positionCount: 0, historyNotice: null, isEnabled: true, settingsRevision: 1,
}
export const emptyOverview: Overview = {
  portfolios: [], accounts: [],
  totals: { portfolioCount: 0, accountCount: 0, totalAccountValueUsd: null, valuedAccountCount: 0, openPositionCount: 0, importedFillCount: 0 },
  recentActivity: [], scopeNote: 'Values are only known account records. Provider history can be incomplete.',
}
export const overviewFixture: Overview = {
  ...emptyOverview, portfolios: [portfolioFixture], accounts: [accountFixture],
  totals: { ...emptyOverview.totals, portfolioCount: 1, accountCount: 1, totalAccountValueUsd: '1250.123456', valuedAccountCount: 1 },
}

export const instrumentCatalogFixture: InstrumentCatalog = {
  venueId: 'hyperliquid', marketScope: 'perpetuals', scope: 'primary-perpetual-dex',
  instruments: [
    { contractId: 'BTC', quantityDecimals: 5, maxLeverage: 40 },
    { contractId: '1000PEPE', quantityDecimals: 0, maxLeverage: 10 },
  ],
  notice: 'Primary perpetual DEX metadata only. No orders, balances or execution refresh.',
}

/** Synthetic test candles only; never shown as market data. */
export const candleSeriesFixture: CandleSeries = {
  venueId: 'hyperliquid', instrument: 'BTC', interval: '1h', priceSource: 'trades',
  candles: [
    { openTime: 1_790_000_000_000, closeTime: 1_790_003_599_999, open: '100.5', high: '102', low: '99.25', close: '101', volume: '12.5', trades: 40 },
    { openTime: 1_790_003_600_000, closeTime: 1_790_007_199_999, open: '101', high: '103.75', low: '100', close: '103', volume: '9', trades: 31 },
  ],
  requestedFrom: 1_788_200_000_000, requestedTo: 1_790_007_200_000, retrievedAt: '2026-10-01T12:00:00Z',
  historyExhausted: false, notice: 'Hyperliquid exposes only the latest 5,000 candles per interval. Prices are trade candles, not fills.',
}

/** Synthetic test statistics only. */
export const marketContextFixture: MarketContext = {
  venueId: 'hyperliquid', instrument: 'BTC', markPrice: '103.5', oraclePrice: '103.4', midPrice: '103.45',
  previousDayPrice: '100', dayNotionalVolume: '1234567.891', openInterest: '42.5', fundingRate: '0.0000125', premium: '-0.0001',
  observedAt: '2026-10-01T12:00:00Z', notice: 'Venue market context for the primary perpetual DEX.',
}

/** A market stream that stays open without events until the caller aborts it. */
export const idleMarketStream: WorkspaceApi['marketStream'] = (_id, _query, signal) =>
  new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true }))

/** Saved-play API stubs: no saved plays, and every write rejects unless a test overrides it. */
export function playApiStubs(): Pick<WorkspaceApi, 'plays' | 'play' | 'createPlay' | 'updatePlay' | 'changePlayStatus' | 'playHistory' |
  'deletePlay' | 'evidence' | 'evidenceImage' | 'uploadEvidence' | 'updateEvidenceNote' | 'updateEvidenceMarkup' | 'deleteEvidence'> {
  const unexpected = () => Promise.reject(new Error('Unexpected play API call in this test.'))
  return {
    plays: vi.fn().mockResolvedValue([]), play: vi.fn(unexpected), createPlay: vi.fn(unexpected), updatePlay: vi.fn(unexpected),
    changePlayStatus: vi.fn(unexpected), playHistory: vi.fn().mockResolvedValue({ revisions: [], statusChanges: [] }),
    deletePlay: vi.fn(unexpected), evidence: vi.fn().mockResolvedValue([]), evidenceImage: vi.fn(unexpected),
    uploadEvidence: vi.fn(unexpected), updateEvidenceNote: vi.fn(unexpected), updateEvidenceMarkup: vi.fn(unexpected), deleteEvidence: vi.fn(unexpected),
  }
}
