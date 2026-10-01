/** Renderer inputs are independent of plays, journals and execution matching. */
export interface ChartInstrument {
  venueId: string
  instrumentId: string
  label: string
  marketScope: 'perpetuals'
  baseUnit: string
  quoteUnit: string
}

export interface Candle {
  time: number // UTC Unix milliseconds
  open: number
  high: number
  low: number
  close: number
}

export interface PriceOverlay {
  id: string
  label: string
  price: number
  color: string
  kind: 'entry' | 'stop' | 'target'
}

export interface ChartData {
  instrument: ChartInstrument
  timeframe: string
  source: string
  isSample: boolean
  candles: readonly Candle[]
  gaps: readonly { from: number; to: number }[]
}
