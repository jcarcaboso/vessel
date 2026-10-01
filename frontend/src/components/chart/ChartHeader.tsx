import type { ReactNode } from 'react'

export interface ChartStat {
  label: string
  /** Small unit or qualifier shown after the label, e.g. "1h" or "notional". */
  hint?: string
  value: ReactNode
  tone?: 'up' | 'down'
}

/** Terminal-style chart header: instrument identity followed by inline market statistics. */
export function ChartHeader({ symbol, caption, stats, statsLabel, notice }: {
  symbol: string
  caption: string
  stats?: readonly ChartStat[] | undefined
  statsLabel?: string | undefined
  notice?: ReactNode
}) {
  return <header className="chart-header">
    <div className="chart-header-symbol">
      <span className="chart-symbol-mark" aria-hidden="true">{symbol ? symbol.slice(0, 3) : '·'}</span>
      <div><h2>{symbol || 'Chart'}</h2><p>{caption}</p></div>
    </div>
    {stats && stats.length > 0 && <dl className="chart-header-stats" aria-label={statsLabel}>
      {stats.map(stat => <div key={stat.label}>
        <dt>{stat.label}{stat.hint && <small>{stat.hint}</small>}</dt>
        <dd data-tone={stat.tone}>{stat.value}</dd>
      </div>)}
    </dl>}
    {notice}
  </header>
}
