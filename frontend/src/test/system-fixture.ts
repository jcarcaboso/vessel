import type { SystemInfo, VenueCapabilities } from '@/api/system'

const none: VenueCapabilities = { sync: false, instruments: false, orders: false, candles: false, marketContext: false, stream: false, stablecoinWallet: false }

// The shared /api/system contract, not a simulated broker connection.
export const systemFixture: SystemInfo = {
  application: 'Vessel', stage: 'foundation',
  owner: { id: '11111111-1111-1111-1111-111111111111', displayName: 'Owner' },
  marketScope: 'perpetuals', allowsConcurrentPlays: true,
  venues: [
    { id: 'hyperliquid', name: 'Hyperliquid', status: 'read-only', source: 'evm-address', quoteAsset: 'USDC',
      tradeUrlTemplate: 'https://app.hyperliquid.xyz/trade/{instrument}', priceRule: 'significant-figures',
      intervals: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M'],
      capabilities: { sync: true, instruments: true, orders: true, candles: true, marketContext: true, stream: true, stablecoinWallet: true } },
    { id: 'lighter', name: 'Lighter', status: 'planned', source: 'none', quoteAsset: null, tradeUrlTemplate: null, intervals: [], priceRule: 'significant-figures', capabilities: none },
    { id: 'quantfury', name: 'Quantfury', status: 'candidate', source: 'none', quoteAsset: null, tradeUrlTemplate: null, intervals: [], priceRule: 'significant-figures', capabilities: none },
    { id: 'manual', name: 'Manual', status: 'manual', source: 'none', quoteAsset: null, tradeUrlTemplate: null, intervals: [], priceRule: 'significant-figures', capabilities: none },
  ],
}
