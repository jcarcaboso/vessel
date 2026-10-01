import type { BrokerAccount, InstrumentCatalog, Overview, Portfolio } from '@/api/workspace'

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
