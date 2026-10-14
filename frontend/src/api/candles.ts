/** Candle intervals the API knows. Each venue descriptor lists the ones it serves natively. */
export const candleIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M'] as const
export type CandleInterval = typeof candleIntervals[number]
