import type { SystemInfo } from '@/api/system'

// The shared /api/system contract, not a simulated broker connection.
export const systemFixture: SystemInfo = {
  application: 'Vessel', stage: 'foundation',
  owner: { id: '11111111-1111-1111-1111-111111111111', displayName: 'Owner' },
  marketScope: 'perpetuals', allowsConcurrentPlays: true,
  venues: [
    { id: 'hyperliquid', name: 'Hyperliquid', status: 'planned' },
    { id: 'lighter', name: 'Lighter', status: 'planned' },
    { id: 'quantfury', name: 'Quantfury', status: 'candidate' },
    { id: 'manual', name: 'Manual', status: 'manual' },
  ],
}
