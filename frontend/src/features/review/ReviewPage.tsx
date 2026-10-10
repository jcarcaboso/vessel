import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronDown, ChevronRight, Info, RefreshCw, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { defaultReviewQuery, reviewPeriods, type ReviewDocument, type ReviewGroupBy, type ReviewQuery } from '@/api/review'
import { ReviewChart } from './ReviewChart'
import { negative, reviewDate, reviewMoney, reviewMultiple, reviewPercent, tone } from './format'
import './review.css'

const definitions = [
  ['Closed-play P&L', 'One saved, fully closed Play counts once. The full result is attributed to its last linked exit, not the day it was refreshed. Partial exits on open Plays are excluded. Reported execution fees are deducted once according to the venue P&L basis; Separate funding cashflows are not added. Whether RISEx reported realized P&L includes funding remains unverified.'],
  ['Batting average', 'Wins divided by wins plus losses. Positive net P&L wins, negative loses, exact zero is a scratch. Scratches do not break streaks.'],
  ['Average gain / loss', 'Mean winning return divided by the absolute mean losing return. Play return is net P&L divided by executed entry notional, not margin or account equity. Each Play has equal weight. The sizing assistant still uses its own last-20-decided-Play window.'],
  ['Profit factor and expectancy', 'Profit factor is total winning net P&L divided by absolute losing net P&L. Expectancy is the average net result of all scored Plays, including scratches, not a forecast. Missing denominators are N/A.'],
  ['Drawdown', 'The metric is the largest drop from a preceding peak in cumulative closed-play P&L, starting at zero for this period. The chart uses closing values per day, or larger labeled buckets for long histories; it can hide losses between points. Neither is account-equity drawdown.'],
  ['Risk and reviews', 'Realized R uses an initial planned-risk estimate: executed entry notional × share-weighted stop distance. A revision must predate entry and every planned entry must have complete, valid stops. It is not actual loss risk or a retrospective estimate; incomplete risk stays unknown. Written reviews do not establish plan adherence or decision quality.'],
  ['Scope', 'All portfolios pools individual outcomes and includes unassigned enabled accounts once. Current portfolio membership applies to historical results. Disabled accounts are excluded. Asset keys retain their contract multipliers; no symbol aliases are guessed. Amounts are nominal USD, not stablecoin FX-adjusted values.'],
  ['Imports and coverage', 'Linked imported fills contribute to saved Plays. Unassigned fills are not scored Plays; confirmed retrospective imported-Play grouping is not yet available. Missing openings, unmatched quantities, flips, unsupported fees and incomplete links are excluded, not treated as zero. Retained history may be bounded and is not lifetime performance.'],
  ['Time', '1D, 7D, Month and Year mean rolling 24-hour, 7-day, 30-day and 365-day windows ending at the displayed report time, in UTC. All means all retained eligible results. Open-play counts describe current state. Drill-down pages read a fresh snapshot; results may change after sync or link edits.'],
]

function useReport(api: WorkspaceApi, query: ReviewQuery, generation: number) {
  const [loaded, setLoaded] = useState<{ api: WorkspaceApi; query: ReviewQuery; generation: number; value: ReviewDocument | null; error: string | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    api.review(query, controller.signal).then(value => {
      if (active) setLoaded({ api, query, generation, value, error: null })
    }).catch(error => {
      if (active) setLoaded(previous => ({ api, query, generation, value: previous?.api === api ? previous.value : null,
        error: error instanceof ApiError ? error.message : 'The review could not be loaded.' }))
    })
    return () => { active = false; controller.abort() }
  }, [api, query, generation])
  const loading = loaded === null || loaded.api !== api || loaded.query !== query || loaded.generation !== generation
  return {
    loading, error: loading ? null : loaded.error, report: loading || loaded.error ? null : loaded.value,
    // Previous options keep the controls usable while a new request runs; old results are never shown as current.
    options: loaded?.api === api ? loaded.value?.options : undefined,
  }
}

function ReviewPlays({ api, initialQuery, onOpenPlay }: {
  api: WorkspaceApi; initialQuery: ReviewQuery; onOpenPlay: (id: string, signal: AbortSignal) => Promise<void>
}) {
  const [query, setQuery] = useState(initialQuery)
  const [generation, setGeneration] = useState(0)
  const { report, loading, error } = useReport(api, query, generation)
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const openingRequest = useRef<AbortController | null>(null)
  useEffect(() => () => openingRequest.current?.abort(), [])
  async function open(id: string) {
    openingRequest.current?.abort()
    const controller = new AbortController()
    openingRequest.current = controller
    setOpening(id); setOpenError(null)
    try { await onOpenPlay(id, controller.signal) }
    catch (cause) { if (!controller.signal.aborted) setOpenError(cause instanceof ApiError ? cause.message : 'The Play could not be opened.') }
    finally { if (!controller.signal.aborted) setOpening(null) }
  }
  return <>
    {loading && <p role="status">Loading Plays…</p>}
    {error && <div role="alert"><p>{error}</p><button className="pr-outline-button" onClick={() => setGeneration(n => n + 1)}>Retry</button></div>}
    {openError && <p role="alert">{openError}</p>}
    {report && <>
      <div className="pr-detail-summary"><span>Net P&L<strong className={tone(report.metrics.net)}>{reviewMoney(report.metrics.net, true)}</strong></span><span>Planned risk<strong>{report.metrics.riskCount} / {report.metrics.count}</strong></span><span>Written reviews<strong>{report.metrics.reviewed} / {report.metrics.count}</strong></span></div>
      <div className="pr-table-scroll pr-play-list"><table><caption className="sr-only">Contributing closed Plays</caption><thead><tr><th>Play / account</th><th>Closed UTC</th><th>Net P&L</th><th>R</th><th>Review</th></tr></thead><tbody>
        {report.plays.map(play => <tr key={play.id}><th scope="row"><button className="pr-play-link" disabled={opening !== null} onClick={() => { void open(play.id) }} aria-label={`Open Play ${play.title || play.instrument}`}>{play.title || play.instrument}<ArrowUpRight size={12} /></button><small>{play.instrument} · {play.accountName}</small><small>{play.venueId}{opening === play.id ? ' · Opening…' : ''}</small></th><td>{reviewDate(play.closedAtUtc, true)}</td><td className={tone(play.net)}>{reviewMoney(play.net, true)}</td><td>{reviewMultiple(play.rMultiple)}</td><td>{play.reviewed ? 'Written' : 'Not yet'}</td></tr>)}
        {!report.plays.length && <tr><td colSpan={5}>No scored Plays in this selection.</td></tr>}
      </tbody></table></div>
      <div className="pr-pagination"><button className="pr-outline-button" disabled={report.offset === 0} onClick={() => setQuery({ ...query, offset: Math.max(0, report.offset - 50) })}>Previous</button><span>{report.plays.length ? report.offset + 1 : 0}–{report.offset + report.plays.length} of {report.metrics.count}</span><button className="pr-outline-button" disabled={report.nextOffset === null} onClick={() => { if (report.nextOffset !== null) setQuery({ ...query, offset: report.nextOffset }) }}>Next</button></div>
    </>}
  </>
}

export function ReviewPage({ api, reloadGeneration, onOpenPlay }: {
  api: WorkspaceApi; reloadGeneration: number; onOpenPlay: (id: string, signal: AbortSignal) => Promise<void>
}) {
  const [query, setQuery] = useState<ReviewQuery>(defaultReviewQuery)
  const [reload, setReload] = useState(0)
  const [group, setGroup] = useState<ReviewGroupBy>('portfolios')
  const [methods, setMethods] = useState(false)
  const [detail, setDetail] = useState<{ title: string; query: ReviewQuery } | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const { report, loading, error, options } = useReport(api, query, reload + reloadGeneration)
  const remember = () => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }
  const restore = (event: Event) => { event.preventDefault(); trigger.current?.focus() }
  function inspect(id?: string, title = 'Closed Plays') {
    remember()
    const filter = id === undefined ? {} : group === 'portfolios' ? { portfolio: id } : group === 'accounts' ? { accountId: id } : { instrument: id }
    setDetail({ title, query: { ...query, ...filter, offset: 0 } })
  }
  const accounts = options?.accounts.filter(a => query.portfolio === 'all' ||
    (query.portfolio === 'unassigned' ? a.portfolioId === null : a.portfolioId === query.portfolio)) ?? []
  const stats = report?.metrics
  const groups = report?.groups[group] ?? []
  const assets = report?.groups.assets ?? []
  const best = assets[0], worst = assets.at(-1)
  const averageMax = Math.max(Number(stats?.averageWin), Number(stats?.averageLossUsd), 1)
  const filtered = query.portfolio !== 'all' || query.accountId !== undefined || query.instrument !== undefined
  const activeAccounts = accounts.filter(a => query.accountId === undefined || a.id === query.accountId)
  return <section className="portfolio-review review-workspace" aria-label="Portfolio review">
    <div className="pr-heading"><h1>Portfolio review</h1><div className="pr-heading-actions"><button className="pr-outline-button" onClick={() => { remember(); setMethods(true) }}><Info size={15} />Definitions</button><button className="pr-outline-button" disabled={loading} onClick={() => setReload(n => n + 1)} aria-label="Reload review"><RefreshCw size={15} /></button></div></div>
    <section className="pr-filters" aria-label="Review filters">
      <label><span>Portfolio</span><span className="pr-select"><select value={query.portfolio} onChange={e => setQuery(previous => { const next = { ...previous, portfolio: e.target.value }; delete next.accountId; return next })}><option value="all">All portfolios</option>{options?.portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="unassigned">Unassigned accounts</option>{query.portfolio !== 'all' && query.portfolio !== 'unassigned' && !options?.portfolios.some(p => p.id === query.portfolio) && <option value={query.portfolio}>Unavailable portfolio</option>}</select><ChevronDown size={14} aria-hidden="true" /></span></label>
      <label><span>Account</span><span className="pr-select"><select value={query.accountId ?? ''} onChange={e => setQuery(previous => { const next = { ...previous }; if (e.target.value) next.accountId = e.target.value; else delete next.accountId; return next })}><option value="">All accounts</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}{query.accountId && !accounts.some(a => a.id === query.accountId) && <option value={query.accountId}>Unavailable account</option>}</select><ChevronDown size={14} aria-hidden="true" /></span></label>
      <label><span>Asset</span><span className="pr-select"><select value={query.instrument ?? ''} onChange={e => setQuery(previous => { const next = { ...previous }; if (e.target.value) next.instrument = e.target.value; else delete next.instrument; return next })}><option value="">All assets</option>{options?.instruments.map(asset => <option key={asset}>{asset}</option>)}{query.instrument && !options?.instruments.includes(query.instrument) && <option value={query.instrument}>{query.instrument} · unavailable</option>}</select><ChevronDown size={14} aria-hidden="true" /></span></label>
      <button className="pr-reset" disabled={!filtered} onClick={() => setQuery({ ...defaultReviewQuery, period: query.period })}><SlidersHorizontal size={15} />Reset</button>
    </section>
    <div className="pr-scope"><span>Nominal USD{query.portfolio === 'all' ? ' · includes unassigned' : ''}</span><span>Closed Plays · reported P&L</span></div>
    {loading && <div className="pr-loading" role="status">Loading review…</div>}
    {error && <div className="pr-empty" role="alert"><p>{error}</p><button className="pr-outline-button" onClick={() => setReload(n => n + 1)}>Retry review</button></div>}
    {report && stats && <>
      <section className="pr-periods" aria-label="Performance period">{reviewPeriods.map(item => {
        const period = report.periods.find(p => p.id === item.id)!
        return <button key={item.id} aria-pressed={query.period === item.id} aria-label={item.label} onClick={() => setQuery(previous => ({ ...previous, period: item.id }))}><span>{item.label}{query.period === item.id && <span className="pr-period-selected"><Check size={12} />Selected</span>}</span><strong className={tone(period.net)}>{reviewMoney(period.net, true)}</strong><small>{period.count} Plays</small></button>
      })}</section>
      <div className="pr-section-label"><span className="pr-date-range">{report.fromUtc ? `${reviewDate(report.fromUtc, true)} to ` : ''}{reviewDate(report.asOfUtc, true)} · {new Date(report.asOfUtc).toISOString().slice(11, 16)} UTC</span><button onClick={() => inspect()}>{stats.count} Plays<ArrowRight size={12} /></button></div>
      <section className="pr-scorecard" aria-label="Performance scorecard">
        <article><span>Batting average</span><strong>{reviewPercent(stats.batting, true)}</strong><div className="pr-outcomes" aria-hidden="true"><i style={{ flex: stats.wins, background: 'var(--pr-green)' }} /><i style={{ flex: stats.losses, background: 'var(--pr-red)' }} /><i style={{ flex: stats.scratches, background: 'var(--pr-muted)' }} /></div><small><b className="positive">{stats.wins}W</b><b className="negative">{stats.losses}L</b><b>{stats.scratches} {stats.scratches === 1 ? 'scratch' : 'scratches'}</b></small></article>
        <article><span>Avg. gain / loss</span><strong>{reviewMultiple(stats.payoff)}</strong><small><span className="positive">{reviewPercent(stats.averageGain)}</span> / <span className="negative">{reviewPercent(stats.averageLoss)}</span></small></article>
        <article><span>Profit factor</span><strong>{reviewMultiple(stats.profitFactor)}</strong></article>
        <article><span>Expectancy per Play</span><strong className={tone(stats.expectancy)}>{reviewMoney(stats.expectancy, true)}</strong>{stats.count < 20 && <small>Small sample</small>}</article>
      </section>
      <div className="pr-chart-grid">
        <ReviewChart key={`${report.asOfUtc}-${JSON.stringify(query)}`} report={report} />
        <section className="pr-panel pr-outcome-card"><header className="pr-panel-heading"><h2>Average outcome</h2><BarChart3 size={17} /></header>
          <div className="pr-outcome-bars"><div><span><span className="pr-dot positive" />Winning Play</span><strong className="positive">{reviewMoney(stats.averageWin, true)}</strong><i><b style={{ width: `${Number(stats.averageWin) / averageMax * 100}%`, background: 'var(--pr-green)' }} /></i></div><div><span><span className="pr-dot negative" />Losing Play</span><strong className="negative">{reviewMoney(negative(stats.averageLossUsd))}</strong><i><b style={{ width: `${Number(stats.averageLossUsd) / averageMax * 100}%`, background: 'var(--pr-red)' }} /></i></div></div>
          <dl className="pr-outcome-details"><div><dt>Avg. realized R</dt><dd>{reviewMultiple(stats.averageR)} <small>{stats.riskCount}/{stats.count} with risk</small></dd></div><div><dt>Max. P&L drawdown</dt><dd className="negative">{reviewMoney(negative(stats.drawdown))}</dd></div><div><dt>Longest streaks</dt><dd><span className="positive">{stats.maxWins}W</span><span className="pr-divider">/</span><span className="negative">{stats.maxLosses}L</span></dd></div></dl>
        </section>
      </div>
      {best && worst && best.id !== worst.id && <div className="pr-insights">
        <button onClick={() => setQuery(previous => ({ ...previous, instrument: best.id }))}><span className="pr-insight-icon positive"><ArrowUpRight size={18} /></span><span><small>HIGHEST ASSET P&L</small><strong>{best.name}<b className={tone(best.metrics.net)}>{reviewMoney(best.metrics.net, true)}</b></strong></span><span className="pr-insight-count">{best.metrics.count} Plays<ChevronRight size={14} /></span></button>
        <button onClick={() => setQuery(previous => ({ ...previous, instrument: worst.id }))}><span className="pr-insight-icon negative"><ArrowDownRight size={18} /></span><span><small>LOWEST ASSET P&L</small><strong>{worst.name}<b className={tone(worst.metrics.net)}>{reviewMoney(worst.metrics.net, true)}</b></strong></span><span className="pr-insight-count">{worst.metrics.count} Plays<ChevronRight size={14} /></span></button>
      </div>}
      <section className="pr-panel pr-breakdown"><header className="pr-panel-heading"><h2>Breakdown</h2><div className="pr-segmented" aria-label="Break down results by">{(['portfolios', 'accounts', 'assets'] as const).map(item => <button key={item} aria-pressed={group === item} onClick={() => setGroup(item)}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}</div></header>
        <div className="pr-table-scroll"><table className="pr-breakdown-table"><caption className="sr-only">{group} ranked by net closed-play P&L</caption><thead><tr><th>{group === 'portfolios' ? 'Portfolio' : group === 'accounts' ? 'Account' : 'Asset'}</th><th>Plays</th><th>Batting avg.</th><th>Avg. gain / loss</th><th>Profit factor</th><th>Net P&L</th><th><span className="sr-only">Inspect</span></th></tr></thead><tbody>
          {groups.map((row, index) => <tr key={row.id}><th scope="row"><button onClick={() => inspect(row.id, row.name)}><span className="pr-rank">{String(index + 1).padStart(2, '0')}</span><span><strong>{row.name}</strong><small>{row.detail}{row.metrics.count < 20 ? ' · Small sample' : ''}</small></span></button></th><td>{row.metrics.count}<small>{row.metrics.wins}W · {row.metrics.losses}L · {row.metrics.scratches}S</small></td><td>{reviewPercent(row.metrics.batting, true)}</td><td>{reviewMultiple(row.metrics.payoff)}</td><td>{reviewMultiple(row.metrics.profitFactor)}</td><td className={tone(row.metrics.net)}><strong>{reviewMoney(row.metrics.net, true)}</strong><i className="pr-pnl-bar"><b style={{ width: `${Math.abs(Number(row.metrics.net)) / Math.max(...groups.map(g => Math.abs(Number(g.metrics.net))), 1) * 100}%`, background: Number(row.metrics.net) >= 0 ? 'var(--pr-green)' : 'var(--pr-red)' }} /></i></td><td><button className="pr-row-open" aria-label={`Inspect ${row.name}`} onClick={() => inspect(row.id, row.name)}><ChevronRight size={16} /></button></td></tr>)}
          {!groups.length && <tr><td colSpan={7}><div className="pr-empty"><BarChart3 size={25} /><strong>No scored closed Plays</strong><p>Try a wider period or check the execution coverage below.</p>{filtered && <button className="pr-outline-button" onClick={() => setQuery(defaultReviewQuery)}>Reset view</button>}</div></td></tr>}
        </tbody>{groups.length > 0 && <tfoot><tr><th scope="row">Combined result</th><td>{stats.count}</td><td>{reviewPercent(stats.batting, true)}</td><td>{reviewMultiple(stats.payoff)}</td><td>{reviewMultiple(stats.profitFactor)}</td><td className={tone(stats.net)}>{reviewMoney(stats.net, true)}</td><td /></tr></tfoot>}</table></div>
      </section>
      <section className="pr-coverage" aria-label="Data coverage"><ShieldCheck size={16} /><details><summary>{stats.count} scored · {report.coverage.incompleteFees + report.coverage.incompleteExecutions} excluded · {stats.reviewed} reviewed</summary>
        <p>{report.coverage.incompleteFees} incomplete fees · {report.coverage.incompleteExecutions} incomplete executions · {report.coverage.openPlays} currently open</p>
        <p>{report.coverage.unassignedFills} unassigned fills in this period. Imported-Play grouping is not available.</p>
        <p>{report.coverage.notice}</p>
        {report.coverage.firstFillAtUtc && <p>Earliest retained fill in this scope: {reviewDate(report.coverage.firstFillAtUtc, true)}.</p>}
        <ul>{activeAccounts.map(a => <li key={a.id}><strong>{a.name}</strong> · {a.syncStatus} · {a.lastSyncedAtUtc ? `last refreshed ${reviewDate(a.lastSyncedAtUtc, true)}` : 'not refreshed'}{a.historyNotice && <p>{a.historyNotice}</p>}</li>)}</ul>
      </details></section>
    </>}
    <Dialog open={methods} onOpenChange={setMethods}><DialogContent className="pr-dialog" onCloseAutoFocus={restore}><DialogHeader><DialogTitle>Definitions</DialogTitle><DialogDescription>Closed-Play results from retained execution facts.</DialogDescription></DialogHeader><div className="pr-methods">{definitions.map(([title, text]) => <section key={title}><h3>{title}</h3><p>{text}</p></section>)}</div></DialogContent></Dialog>
    <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null) }}><DialogContent className="pr-dialog pr-detail-dialog" onCloseAutoFocus={restore}><DialogHeader><DialogTitle>{detail?.title}</DialogTitle><DialogDescription>Contributing closed Plays. Select a Play to open its journal.</DialogDescription></DialogHeader>
      {detail && <ReviewPlays api={api} initialQuery={detail.query} onOpenPlay={onOpenPlay} />}
    </DialogContent></Dialog>
  </section>
}
