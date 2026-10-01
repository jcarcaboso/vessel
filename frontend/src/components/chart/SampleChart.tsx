import type { ChartData, PriceOverlay } from './types'

/** A sample SVG fixture, not the chosen production chart renderer. */
export function SampleChart({ data, overlays, selectedId, onSelect }: {
  data: ChartData
  overlays: readonly PriceOverlay[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const prices = data.candles.flatMap((candle) => [candle.high, candle.low]).concat(overlays.map((overlay) => overlay.price).filter(Number.isFinite))
  const min = Math.min(...prices) - 150
  const max = Math.max(...prices) + 150
  const y = (price: number) => 240 - (price - min) / (max - min) * 210
  return (
    <section className="panel chart-panel" aria-labelledby="chart-title" data-testid="chart-panel">
      <header className="panel-heading">
        <div><h2 id="chart-title">{data.instrument.label}</h2><p>{data.timeframe} · {data.source}</p></div>
        <span className="badge">Aggregate · sample</span>
      </header>
      <div className="chart-legend" aria-label="Chart entries">
        {overlays.map((overlay) => <button key={overlay.id} type="button" aria-pressed={selectedId === overlay.id}
          onClick={() => onSelect(overlay.id)} style={{ borderColor: overlay.color }}>
          {overlay.label} · {Number.isFinite(overlay.price) ? `${overlay.price.toLocaleString('en-US')} ${data.instrument.quoteUnit}` : 'Price unavailable'}
        </button>)}
      </div>
      <svg viewBox="0 0 760 270" role="img" aria-label="Sample candles and planned entry levels. Not live prices or fills.">
        {[40, 90, 140, 190, 240].map((line) => <line key={line} x1="10" x2="750" y1={line} y2={line} className="chart-grid" />)}
        {data.candles.map((candle, index) => {
          const x = 22 + index * 18
          return <g key={candle.time} className={candle.close >= candle.open ? 'candle-up' : 'candle-down'}>
            <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} />
            <rect x={x - 5} y={Math.min(y(candle.open), y(candle.close))} width="10" height={Math.max(2, Math.abs(y(candle.open) - y(candle.close)))} />
          </g>
        })}
        {overlays.filter((overlay) => Number.isFinite(overlay.price)).map((overlay) => <g key={overlay.id}>
          <line x1="10" x2="750" y1={y(overlay.price)} y2={y(overlay.price)} stroke={overlay.color} strokeDasharray="5 5" />
          <text x="740" y={y(overlay.price) - 6} textAnchor="end" fill={overlay.color}>{overlay.label}</text>
        </g>)}
      </svg>
      <p className="chart-caption">Sample instrument and candles · planned levels only · no execution evidence</p>
    </section>
  )
}
