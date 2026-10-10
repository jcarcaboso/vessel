import { useId, useRef, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3,
  BookOpen, Check, ChevronDown, ChevronRight, Folder, Info, LayoutDashboard,
  Settings2, ShieldCheck, SlidersHorizontal, Wallet,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  accounts, AS_OF, assets, breakdown, dailyResults, defaultFilters, eligible, inPeriod, inScope,
  mockPlays, money, multiple, percent, periods, portfolios, shortDate, summarize,
  type Filters, type Group, type Period, type ReviewPlay, type Source,
} from './model'
import '@/features/review/review.css'

const tone = (value: number | null) => value === null || value === 0 ? '' : value > 0 ? 'positive' : 'negative'
const metricDefinitions = [
  ['One result per Play', 'A fully closed Play is one result, however many entries, exits or fills it has. Confirmed imported closed Plays count too, without an invented thesis or plan. Open, ambiguous and fee-incomplete records are excluded here.'],
  ['Closed-play P&L', 'The complete net result is attributed to the final close time. This is not a daily cash ledger: partial exits on still-open Plays are not included. Reported execution fees are deducted once, respecting gross and net-of-fee venue facts. Funding is not included.'],
  ['Batting average', 'Wins divided by wins plus losses. A positive net result wins, a negative result loses and an exact zero is a scratch. Scratches are shown separately and do not break streaks.'],
  ['Average gain / loss', 'Mean winning return divided by the absolute mean losing return. Each Play return is net P&L divided by executed entry notional, not margin or account equity. Each Play has equal weight. This follows the sizing record definition, but uses the selected period rather than its last 20 decided Plays.'],
  ['Profit factor and expectancy', 'Profit factor is total winning net P&L divided by the absolute total losing net P&L. Expectancy is total net P&L divided by all scored Plays, including scratches. A missing denominator is N/A, never zero or infinity.'],
  ['P&L drawdown', 'The largest peak-to-trough drop in cumulative closed-play P&L, starting at zero for this period. The metric walks individual closes; the chart shows daily closing points and may hide intraday drops. This is not account-equity drawdown.'],
  ['R and review coverage', 'R is net P&L divided by recorded initial planned risk. Missing risk stays unknown, especially for imported history. Average R shows its own sample size. A written review is not proof of plan adherence or a good decision.'],
  ['Scope and currency', 'All portfolios pools individual results, not portfolio percentages, and includes unassigned enabled accounts once. Disabled accounts are excluded. This fixture uses nominal USD only; production must keep incomparable currencies separate and disclose stablecoin assumptions.'],
  ['Time and history', '1D, 7D, Month and Year are rolling 24-hour, 7-day, 30-day and 365-day windows, ending at 8 October 2026, 18:00 UTC in this frozen demo. The lower boundary is exclusive. All means all recorded history, not lifetime history. Gaps and bounded venue imports must remain visible.'],
]

function PerformanceChart({ rows, period }: { rows: ReviewPlay[]; period: Period }) {
  const [mode, setMode] = useState<'cumulative' | 'daily' | 'drawdown'>('cumulative')
  const [hovered, setHovered] = useState<number | null>(null)
  const id = useId().replaceAll(':', '')
  const series = dailyResults(rows, period)
  const values = [0, ...series.map(point => mode === 'daily' ? point.net : point[mode])]
  const min = Math.min(...values), max = Math.max(...values)
  const spread = Math.max(max - min, 10000)
  const low = min - spread * .12, high = max + spread * .12
  const x = (index: number) => 14 + (index + 1) / series.length * 716
  const y = (value: number) => 15 + (high - value) / (high - low) * 196
  const points = [{ x: 14, value: 0 }, ...series.map((point, i) => ({ x: x(i), value: mode === 'daily' ? point.net : point[mode] }))]
  const line = points.map((point, i) => `${i ? 'L' : 'M'}${point.x},${y(point.value)}`).join(' ')
  const selected = hovered === null ? undefined : series[hovered]
  const selectedValue = selected ? mode === 'daily' ? selected.net : selected[mode] : null
  const chartValue = rows.length ? mode === 'drawdown' ? min : series.at(-1)!.cumulative : null
  const labels = [...new Set([0, Math.floor((series.length - 1) / 3), Math.floor((series.length - 1) * 2 / 3), series.length - 1])]
  return <section className="pr-panel pr-chart">
    <header className="pr-panel-heading">
      <h2>{mode === 'drawdown' ? 'Daily-closing drawdown' : mode === 'daily' ? 'Daily P&L' : 'Cumulative P&L'}</h2>
      <div className="pr-segmented" aria-label="Chart view">
        {(['cumulative', 'daily', 'drawdown'] as const).map(view => <button key={view} aria-pressed={mode === view} onClick={() => { setMode(view); setHovered(null) }}>{view === 'cumulative' ? 'P&L' : view === 'daily' ? 'Daily' : 'Drawdown'}</button>)}
      </div>
    </header>
    <div className="pr-chart-caption" aria-live="polite">
      {selected ? <><strong className={tone(selectedValue)}>{money(selectedValue, true)}</strong><span>{shortDate(selected.date)} · {selected.count} closed Plays</span></>
        : <strong className={tone(chartValue)}>{money(chartValue, true)}</strong>}
    </div>
    {!rows.length ? <div className="pr-chart-empty">No scored Plays in this selection.</div> : <svg className="pr-chart-svg" viewBox="0 0 810 252" role="img" aria-label={`${mode} closed-play P&L chart. ${mode === 'drawdown' ? 'Maximum daily-closing drawdown' : 'Period total'} ${money(chartValue)}.`}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--pr-green)" stopOpacity=".19" /><stop offset="100%" stopColor="var(--pr-green)" stopOpacity="0" /></linearGradient></defs>
      {[max, (max + min) / 2, min].filter((v, i, list) => list.indexOf(v) === i).map(value => <g key={value}><line x1="14" x2="735" y1={y(value)} y2={y(value)} stroke="var(--pr-border)" strokeDasharray="3 5" /><text x="805" y={y(value) + 4} textAnchor="end">{money(value)}</text></g>)}
      <line x1="14" x2="735" y1={y(0)} y2={y(0)} stroke="var(--pr-muted)" opacity=".3" />
      {mode === 'daily' ? series.map((point, i) => <rect key={point.date} x={x(i) - Math.max(1, 620 / series.length) / 2} y={Math.min(y(point.net), y(0))} width={Math.max(1, 620 / series.length)} height={Math.max(1, Math.abs(y(point.net) - y(0)))} fill={point.net >= 0 ? 'var(--pr-green)' : 'var(--pr-red)'} opacity=".8" rx="1" />) : <>
        <path d={`${line} L730,${y(0)} L14,${y(0)} Z`} fill={mode === 'drawdown' ? 'var(--pr-red)' : `url(#${id})`} opacity={mode === 'drawdown' ? .12 : 1} />
        <path d={line} fill="none" stroke={mode === 'drawdown' || (chartValue !== null && chartValue < 0) ? 'var(--pr-red)' : 'var(--pr-green)'} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      </>}
      {labels.map(i => <text key={i} x={x(i)} y="242" textAnchor={i === series.length - 1 ? 'end' : 'start'}>{shortDate(series[i]!.date)}</text>)}
      {series.map((point, i) => <rect key={point.date} x={x(i) - 358 / series.length} width={716 / series.length} y="0" height="217" fill="transparent" onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}><title>{shortDate(point.date)}: {money(point.net, true)}, {point.count} closed Plays</title></rect>)}
      {selected && <line x1={x(hovered!)} x2={x(hovered!)} y1="10" y2="216" stroke="var(--pr-muted)" strokeDasharray="3 3" pointerEvents="none" />}
    </svg>}
    <details className="pr-chart-data"><summary>Chart data</summary><div className="pr-table-scroll"><table><caption className="sr-only">Daily chart values in nominal USD</caption><thead><tr><th>Date UTC</th><th>Plays</th><th>Net P&L</th><th>Cumulative</th><th>Drawdown</th></tr></thead><tbody>{series.map(point => <tr key={point.date}><th scope="row">{point.date}</th><td>{point.count}</td><td>{money(point.net, true)}</td><td>{money(point.cumulative, true)}</td><td>{money(point.drawdown)}</td></tr>)}</tbody></table></div></details>
  </section>
}

export function PortfolioReview() {
  const [filters, setFilters] = useState<Filters>(defaultFilters)
  const [period, setPeriod] = useState<Period>('month')
  const [group, setGroup] = useState<Group>('portfolio')
  const [methods, setMethods] = useState(false)
  const [detail, setDetail] = useState<{ title: string; rows: ReviewPlay[] } | null>(null)
  const modalTrigger = useRef<HTMLElement | null>(null)
  const rememberFocus = () => { modalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }
  const restoreFocus = (event: Event) => { event.preventDefault(); modalTrigger.current?.focus() }
  const showMethods = () => { rememberFocus(); setMethods(true) }
  const showDetail = (value: NonNullable<typeof detail>) => { rememberFocus(); setDetail(value) }
  const scoped = inScope(mockPlays, filters)
  const observed = inPeriod(scoped, period)
  const rows = observed.filter(eligible)
  const stats = summarize(rows)
  const groups = breakdown(rows, group)
  const assetGroups = breakdown(rows, 'asset')
  const best = assetGroups[0], worst = assetGroups.at(-1)
  const excluded = observed.filter(row => !eligible(row))
  const knownAccounts = accounts.filter(a => filters.portfolio === 'all' || a.portfolio === filters.portfolio)
  const dates = dailyResults(rows, period)
  const imported = rows.filter(row => row.source === 'imported').length
  const activeFilters = Object.entries(filters).some(([key, value]) => value !== defaultFilters[key as keyof Filters])
  const averageOutcomeMax = Math.max(stats.averageWin ?? 0, stats.averageLossCents ?? 0, 1)
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters(previous => ({ ...previous, [key]: value, ...(key === 'portfolio' ? { account: 'all' } : {}) }))
  const inspect = (id: string, title: string) => showDetail({
    title,
    rows: rows.filter(row => group === 'asset' ? row.asset === id : group === 'account' ? row.account === id : accounts.find(a => a.id === row.account)!.portfolio === id),
  })
  return <div className="portfolio-review">
    <a className="pr-skip" href="#review-main">Skip to review</a>
    <aside className="pr-sidebar">
      <a className="pr-brand" href="/"><span className="pr-monogram">V</span>vessel<span className="pr-brand-dot">.</span></a>
      <div className="pr-nav-caption">WORKSPACE</div>
      <nav aria-label="Proposal navigation">
        <a href="/#overview"><LayoutDashboard size={17} />Overview</a>
        <a href="/#plays"><BookOpen size={17} />Plays</a>
        <a href="#review-main" className="active" aria-current="page"><BarChart3 size={17} />Review</a>
        <a href="/#portfolios"><Folder size={17} />Portfolios</a>
        <a href="/#accounts"><Wallet size={17} />Accounts</a>
        <a href="/#activity"><Activity size={17} />Activity</a>
      </nav>
      <div className="pr-sidebar-bottom">
        <a href="/#settings"><Settings2 size={17} />Settings</a>
        <a href="/" className="pr-back"><ArrowLeft size={15} />Back to Vessel</a>
      </div>
    </aside>
    <div className="pr-main">
      <header className="pr-topbar"><span>Workspace <ChevronRight size={12} /><strong>Review</strong></span><span><span className="pr-sample-dot" />Mock data <span className="pr-topbar-date">· 8 Oct 2026</span></span></header>
      <main id="review-main" className="pr-content">
        <div className="pr-heading"><h1>Portfolio review</h1><button className="pr-outline-button" onClick={showMethods}><Info size={15} />Definitions</button></div>

        <section className="pr-filters" aria-label="Review filters">
          <label><span>Portfolio</span><span className="pr-select"><select value={filters.portfolio} onChange={e => setFilter('portfolio', e.target.value)}><option value="all">All portfolios</option>{portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="unassigned">Unassigned accounts</option></select><ChevronDown size={14} aria-hidden="true" /></span></label>
          <label><span>Account</span><span className="pr-select"><select value={filters.account} onChange={e => setFilter('account', e.target.value)}><option value="all">All accounts</option>{knownAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></span></label>
          <label><span>Asset</span><span className="pr-select"><select value={filters.asset} onChange={e => setFilter('asset', e.target.value)}><option value="all">All assets</option>{assets.map(asset => <option key={asset}>{asset}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></span></label>
          <label><span>Play origin</span><span className="pr-select"><select value={filters.source} onChange={e => setFilter('source', e.target.value as Source)}><option value="all">All origins</option><option value="planned">Planned Plays</option><option value="imported">Imported Plays</option></select><ChevronDown size={14} aria-hidden="true" /></span></label>
          <button className="pr-reset" disabled={!activeFilters} onClick={() => setFilters(defaultFilters)}><SlidersHorizontal size={15} />Reset</button>
        </section>
        <div className="pr-scope"><span>Nominal USD{filters.portfolio === 'all' ? ' · includes unassigned' : ''}</span><span>Closed Plays · funding excluded</span></div>
        <section className="pr-periods" aria-label="Performance period">
          {periods.map(item => {
            const summary = summarize(inPeriod(scoped, item.id))
            return <button key={item.id} aria-pressed={period === item.id} aria-label={`${item.label}: ${item.title}`} onClick={() => setPeriod(item.id)}>
              <span>{item.title}{period === item.id && <span className="pr-period-selected"><Check size={12} />Selected</span>}</span>
              <strong className={tone(summary.count ? summary.net : null)}>{money(summary.count ? summary.net : null, true)}</strong><small>{summary.count} Plays</small>
            </button>
          })}
        </section>
        <div className="pr-section-label"><span className="pr-date-range">{shortDate(dates[0]!.date)} {new Date(dates[0]!.date).getUTCFullYear()} to {shortDate(AS_OF)} 2026 · UTC</span><button onClick={() => showDetail({ title: 'Included closed Plays', rows })}>{stats.count} Plays<ArrowRight size={12} /></button></div>
        <section className="pr-scorecard" aria-label="Performance scorecard" aria-live="polite">
          <article><span>Batting average</span><strong>{percent(stats.batting === null ? null : stats.batting * 100)}</strong><div className="pr-outcomes" aria-hidden="true"><i style={{ flex: stats.wins, background: 'var(--pr-green)' }} /><i style={{ flex: stats.losses, background: 'var(--pr-red)' }} /><i style={{ flex: stats.scratches, background: 'var(--pr-muted)' }} /></div><small><b className="positive">{stats.wins}W</b><b className="negative">{stats.losses}L</b><b>{stats.scratches} {stats.scratches === 1 ? 'scratch' : 'scratches'}</b></small></article>
          <article><span>Avg. gain / loss</span><strong>{multiple(stats.payoff)}</strong><small><span className="positive">{percent(stats.averageGain)}</span><span> / </span><span className="negative">{percent(stats.averageLoss)}</span></small></article>
          <article><span>Profit factor</span><strong>{multiple(stats.profitFactor)}</strong></article>
          <article><span>Expectancy per Play</span><strong className={tone(stats.expectancy)}>{money(stats.expectancy, true)}</strong>{stats.count < 20 && <small>Small sample</small>}</article>
        </section>
        <div className="pr-chart-grid">
          <PerformanceChart key={`${period}-${JSON.stringify(filters)}`} rows={rows} period={period} />
          <section className="pr-panel pr-outcome-card"><header className="pr-panel-heading"><h2>Average outcome</h2><BarChart3 size={17} /></header>
            <div className="pr-outcome-bars">
              <div><span><span className="pr-dot positive" />Winning Play</span><strong className="positive">{money(stats.averageWin, true)}</strong><i><b style={{ width: `${(stats.averageWin ?? 0) / averageOutcomeMax * 100}%`, background: 'var(--pr-green)' }} /></i></div>
              <div><span><span className="pr-dot negative" />Losing Play</span><strong className="negative">{money(stats.averageLossCents === null ? null : -stats.averageLossCents)}</strong><i><b style={{ width: `${(stats.averageLossCents ?? 0) / averageOutcomeMax * 100}%`, background: 'var(--pr-red)' }} /></i></div>
            </div>
            <dl className="pr-outcome-details"><div><dt>Avg. realized R</dt><dd>{multiple(stats.averageR)} <small>{stats.riskCount}/{stats.count} with risk</small></dd></div><div><dt>Max. P&L drawdown</dt><dd className="negative">{money(stats.drawdown === null ? null : -stats.drawdown)}</dd></div><div><dt>Longest streaks</dt><dd><span className="positive">{stats.maxWins}W</span> <span className="pr-divider">/</span> <span className="negative">{stats.maxLosses}L</span></dd></div></dl>
          </section>
        </div>
        {best && worst && best.id !== worst.id && <div className="pr-insights">
          <button onClick={() => setFilter('asset', best.id)}><span className="pr-insight-icon positive"><ArrowUpRight size={18} /></span><span><small>HIGHEST ASSET P&L</small><strong>{best.name}<b className={tone(best.net)}>{money(best.net, true)}</b></strong></span><span className="pr-insight-count">{best.count} Plays<ChevronRight size={14} /></span></button>
          <button onClick={() => setFilter('asset', worst.id)}><span className="pr-insight-icon negative"><ArrowDownRight size={18} /></span><span><small>LOWEST ASSET P&L</small><strong>{worst.name}<b className={tone(worst.net)}>{money(worst.net, true)}</b></strong></span><span className="pr-insight-count">{worst.count} Plays<ChevronRight size={14} /></span></button>
        </div>}
        <section className="pr-panel pr-breakdown">
          <header className="pr-panel-heading"><h2>Breakdown</h2><div className="pr-segmented" aria-label="Break down results by">{(['portfolio', 'account', 'asset'] as const).map(item => <button key={item} aria-pressed={group === item} onClick={() => setGroup(item)}>{item === 'portfolio' ? 'Portfolios' : item === 'account' ? 'Accounts' : 'Assets'}</button>)}</div></header>
          <div className="pr-table-scroll"><table className="pr-breakdown-table"><caption className="sr-only">{group} performance ranked by net closed-play P&L</caption><thead><tr><th>{group === 'portfolio' ? 'Portfolio' : group === 'account' ? 'Account' : 'Asset'}</th><th>Plays</th><th>Batting avg.</th><th>Avg. gain / loss</th><th>Profit factor</th><th>Net P&L</th><th><span className="sr-only">Inspect</span></th></tr></thead><tbody>
            {groups.map((row, index) => <tr key={row.id}><th scope="row"><button onClick={() => inspect(row.id, row.name)}><span className="pr-rank">{String(index + 1).padStart(2, '0')}</span><span><strong>{row.name}</strong><small>{row.detail}{row.count < 20 ? ' · Small sample' : ''}</small></span></button></th><td>{row.count}<small>{row.wins}W · {row.losses}L · {row.scratches}S</small></td><td>{percent(row.batting === null ? null : row.batting * 100)}</td><td>{multiple(row.payoff)}</td><td>{multiple(row.profitFactor)}</td><td className={tone(row.net)}><strong>{money(row.net, true)}</strong><i className="pr-pnl-bar"><b style={{ width: `${Math.abs(row.net) / Math.max(...groups.map(g => Math.abs(g.net)), 1) * 100}%`, background: row.net >= 0 ? 'var(--pr-green)' : 'var(--pr-red)' }} /></i></td><td><button className="pr-row-open" aria-label={`Inspect ${row.name}`} onClick={() => inspect(row.id, row.name)}><ChevronRight size={16} /></button></td></tr>)}
            {!groups.length && <tr><td colSpan={7}><div className="pr-empty"><BarChart3 size={25} /><strong>No closed Plays in this selection</strong><p>Try a wider period or reset the filters.</p><button className="pr-outline-button" onClick={() => { setFilters(defaultFilters); setPeriod('month') }}>Reset view</button></div></td></tr>}
          </tbody>{groups.length > 0 && <tfoot><tr><th scope="row">Combined result</th><td>{stats.count}</td><td>{percent(stats.batting === null ? null : stats.batting * 100)}</td><td>{multiple(stats.payoff)}</td><td>{multiple(stats.profitFactor)}</td><td className={tone(stats.net)}>{money(stats.net, true)}</td><td /></tr></tfoot>}</table></div>
        </section>
        <section className="pr-coverage" aria-label="Data coverage"><ShieldCheck size={16} /><details><summary>{stats.count} scored · {excluded.length} excluded · {stats.reviewed} reviewed</summary><p>{excluded.filter(p => p.status === 'unresolved').length} unresolved imports · {excluded.filter(p => p.status === 'open').length} open · {excluded.filter(p => p.status === 'closed').length} incomplete fees</p><p>{rows.length - imported} planned · {imported} imported</p></details></section>
      </main>
    </div>
    <Dialog open={methods} onOpenChange={setMethods}><DialogContent className="pr-dialog" onCloseAutoFocus={restoreFocus}><DialogHeader><DialogTitle>How the scorecard is calculated</DialogTitle><DialogDescription>Proposed definitions. This preview contains synthetic data only.</DialogDescription></DialogHeader><div className="pr-methods">{metricDefinitions.map(([title, description]) => <section key={title}><h3>{title}</h3><p>{description}</p></section>)}</div></DialogContent></Dialog>
    <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null) }}><DialogContent className="pr-dialog pr-detail-dialog" onCloseAutoFocus={restoreFocus}><DialogHeader><DialogTitle>{detail?.title}</DialogTitle><DialogDescription>{detail?.rows.length ?? 0} closed Plays · mock data</DialogDescription></DialogHeader>
      <div className="pr-detail-summary"><span>Net P&L<strong className={tone(detail ? summarize(detail.rows).net : null)}>{money(detail?.rows.length ? summarize(detail.rows).net : null, true)}</strong></span><span>Recorded risk<strong>{detail?.rows.filter(p => p.riskCents !== null).length ?? 0} / {detail?.rows.length ?? 0}</strong></span><span>Review notes<strong>{detail?.rows.filter(p => p.reviewed).length ?? 0} / {detail?.rows.length ?? 0}</strong></span></div>
      <div className="pr-table-scroll pr-play-list"><table><caption className="sr-only">Contributing closed Plays</caption><thead><tr><th>Play / account</th><th>Closed UTC</th><th>Net P&L</th><th>R</th><th>Review</th></tr></thead><tbody>{detail?.rows.slice().reverse().map(play => <tr key={play.id}><th scope="row">{play.asset} <small>{play.id} · {accounts.find(a => a.id === play.account)!.name}</small><span className="pr-origin">{play.source === 'imported' ? 'Imported' : 'Planned'}</span></th><td>{shortDate(play.at)}<small>{new Date(play.at).getUTCFullYear()}</small></td><td className={tone(play.netCents)}>{money(play.netCents, true)}</td><td>{multiple(play.riskCents === null ? null : play.netCents / play.riskCents)}</td><td>{play.reviewed ? 'Written' : 'Not yet'}</td></tr>)}</tbody></table></div>
    </DialogContent></Dialog>
  </div>
}
