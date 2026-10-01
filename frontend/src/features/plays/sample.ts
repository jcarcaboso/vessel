import type { ChartData } from '@/components/chart/types'

export interface SampleEntry {
  id: string
  name: string
  color: string
  share: string
  price: string
  stop: string
  target: string
}

export const samplePlay = {
  id: 'sample-play-btc',
  title: 'BTC pullback study',
  isSample: true,
  entries: [
    { id: 'entry-1', name: 'Entry 1', color: '#b9c9e4', share: '60', price: '64200', stop: '63100', target: '66800' },
    { id: 'entry-2', name: 'Entry 2', color: '#edd49e', share: '40', price: '63700', stop: '62600', target: '65900' },
  ] satisfies SampleEntry[],
}

export const sampleChart: ChartData = {
  instrument: { venueId: 'hyperliquid', instrumentId: 'sample-btc-perp', label: 'BTC / USD perpetual', marketScope: 'perpetuals', baseUnit: 'BTC', quoteUnit: 'USD' },
  timeframe: '1h', source: 'Generated sample fixture', isSample: true, gaps: [],
  candles: Array.from({ length: 40 }, (_, index) => {
    const open = 63900 + index * 22 + Math.sin(index * 0.7) * 320
    const close = open + Math.sin(index * 1.3 + 1) * 190
    return { time: Date.UTC(2026, 8, 29, index), open, close, high: Math.max(open, close) + 120, low: Math.min(open, close) - 100 }
  }),
}
