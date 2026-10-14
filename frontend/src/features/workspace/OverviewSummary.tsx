import { useEffect, useState } from 'react'
import type { Overview, WorkspaceApi } from '@/api/workspace'
import type { OverviewQuery, OverviewSummaryDocument, SummaryAmount } from '@/api/overview-summary'
import { useVenues } from '@/api/venues'
import { Button } from '@/components/ui/button'
import { failure } from '@/features/plays/saved'
import { PortfolioIcon } from './PortfolioIcon'
import { VenueLogo } from '@/components/venues/VenueBadge'
import { balanceShare } from './overview-share'
import { money } from './format'
import './overview-summary.css'

function Coverage({ value, operations = false }: { value: SummaryAmount; operations?: boolean }) {
  const c = value.coverage
  return <small className="overview-coverage" title={c.reasons.map(r => `${r.count}: ${r.reason}`).join('\n')}>
    {c.contributingAccountCount} of {c.totalAccountCount} {c.totalAccountCount === 1 ? 'account' : 'accounts'}{operations && ` · ${c.contributingOperationCount} closed`}
    {c.excludedOperationCount > 0 && ` · ${c.excludedOperationCount} excluded`}
    {c.reasons.length > 0 && <span className="overview-coverage-limit"> · limited coverage</span>}
  </small>
}
const signClass = (value: string | null) => value === null || /^-?0(?:\.0+)?$/.test(value) ? '' : value.startsWith('-') ? 'overview-negative' : 'overview-positive'
export function OverviewSummary({ api, query, onQuery, reloadGeneration, fallback, accountCount }: {
  api: WorkspaceApi; query: OverviewQuery; onQuery: (query: OverviewQuery) => void; reloadGeneration: number; fallback: Overview; accountCount: number
}) {
  const venues = useVenues()
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ api: WorkspaceApi; key: string; document?: OverviewSummaryDocument; error?: string } | null>(null)
  const key = JSON.stringify([query.groupBy, query.period, query.scope, reloadGeneration, retry])
  useEffect(() => {
    const controller = new AbortController()
    api.overviewSummary(query, controller.signal).then(document => {
      if (!controller.signal.aborted) setState({ api, key, document })
    }).catch(cause => { if (!controller.signal.aborted) setState({ api, key, error: failure(cause) }) })
    return () => controller.abort()
  }, [api, key, query])
  const current = state?.api === api && state.key === key ? state : null
  const totals = current?.document?.totals
  // The existing owner-wide endpoint is a fallback only while the All read loads. Never show All amounts under a narrower scope.
  const loadingAll = !current && query.scope === 'all'
  const balance = totals?.balance.amountUsd ?? (loadingAll ? fallback.totals.totalBalanceUsd ?? null : null)
  const available = totals?.available.amountUsd ?? (loadingAll ? fallback.totals.availableBalanceUsd ?? null : null)
  return <>
    <section className="workspace-stat-grid overview-metrics" aria-label="Scoped overview totals">
      <div className="shell-panel metric"><span>Total balance</span><strong>{money(balance)}</strong>{totals ? <Coverage value={totals.balance} /> : <small>{loadingAll ? `${fallback.totals.balanceAccountCount ?? 0} of ${accountCount} enabled accounts · ${fallback.totals.balanceCoverage ?? 'unavailable'} · loading summary` : current?.error ? 'Balance coverage unavailable' : 'Loading balance coverage…'}</small>}<small>Nominal USD</small></div>
      <div className="shell-panel metric"><span>Available balance</span><strong>{money(available)}</strong>{totals ? <Coverage value={totals.available} /> : <small>{loadingAll ? `${fallback.totals.availableBalanceAccountCount ?? 0} of ${accountCount} enabled accounts · ${fallback.totals.availableBalanceCoverage ?? 'unavailable'} · loading summary` : current?.error ? 'Availability coverage unavailable' : 'Loading availability coverage…'}</small>}<small>Wallet, reported margin or withdrawal</small></div>
      <div className="shell-panel metric"><span>Enabled accounts</span><strong>{totals?.accountCount ?? accountCount}</strong><small>In this scope</small></div>
      <div className="shell-panel metric"><span>Perpetual positions</span><strong>{totals?.openPositionCount ?? (loadingAll ? fallback.totals.openPositionCount : '—')}</strong><small className={signClass(totals?.unrealizedPnl.amountUsd ?? null)}>{money(totals?.unrealizedPnl.amountUsd ?? null)} unrealized</small>{totals && <Coverage value={totals.unrealizedPnl} />}<small>From latest retained snapshots</small></div>
      <div className="shell-panel metric"><span>Imported executions</span><strong>{totals?.importedFillCount ?? (loadingAll ? fallback.totals.importedFillCount : '—')}</strong><small>Retained facts in this scope</small></div>
    </section>
    <section className="shell-panel overview-summary" aria-label="Overview summary">
      <header className="shell-panel-heading"><div><h2>Summary</h2><p>Reported balances and closed operation results</p></div><div className="overview-summary-controls">
        <div className="overview-group-toggle" role="group" aria-label="Summary grouping">{(['portfolio', 'account'] as const).map(group => <Button key={group} variant={query.groupBy === group ? 'secondary' : 'ghost'} size="sm" aria-pressed={query.groupBy === group} onClick={() => onQuery({ ...query, groupBy: group })}>By {group}</Button>)}</div>
        <label>Result period<select value={query.period} onChange={e => onQuery({ ...query, period: e.target.value as OverviewQuery['period'] })}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All retained history</option></select></label>
      </div></header>
      {!current && <div className="workspace-loading" role="status">Loading summary…</div>}
      {current?.error && <div className="workspace-alert" role="alert">{current.error}<Button variant="ghost" size="sm" onClick={() => setRetry(n => n + 1)}>Retry summary</Button></div>}
      {current?.document && <>
        {!current.document.rows.length ? <p className="workspace-empty small-empty">No enabled accounts in this scope.</p> : <div className="overview-summary-scroll"><table className="overview-summary-table"><caption className="sr-only">Overview summary by {query.groupBy}</caption><thead><tr><th scope="col">Name</th><th scope="col">Balance</th><th scope="col">Available</th><th scope="col">Share of total</th><th scope="col">Open positions</th><th scope="col">Realized result</th></tr></thead><tbody>
          {current.document.rows.map(row => {
            const share = balanceShare(row.shareOfBalance)
            return <tr key={row.id} onClick={() => onQuery({ ...query, scope: row.id })}>
              <th scope="row"><button className="overview-summary-name" aria-label={`Scope overview to ${row.name}`} onClick={e => { e.stopPropagation(); onQuery({ ...query, scope: row.id }) }}>
                {row.icon ? <PortfolioIcon icon={row.icon} /> : row.venueId ? <VenueLogo venueId={row.venueId} size="md" /> : null}<span>{row.name}<small>{row.venueId ? venues.name(row.venueId) : `${row.totals.accountCount} ${row.totals.accountCount === 1 ? 'account' : 'accounts'}`}</small></span>
              </button></th>
              <td><span>{money(row.totals.balance.amountUsd)}</span><Coverage value={row.totals.balance} /></td>
              <td><span>{money(row.totals.available.amountUsd)}</span><Coverage value={row.totals.available} /></td>
              <td><span title={row.shareOfBalance ? `${row.shareOfBalance.numerator} / ${row.shareOfBalance.denominator} · rounded for display` : 'Share unavailable'}>{share.label}</span><span className="overview-share-track" aria-hidden="true"><span style={{ width: share.width }} /></span></td>
              <td><span>{row.totals.openPositionCount}</span><span className={signClass(row.totals.unrealizedPnl.amountUsd)}>{money(row.totals.unrealizedPnl.amountUsd)} unrealized</span><Coverage value={row.totals.unrealizedPnl} /></td>
              <td><span className={signClass(row.totals.realizedResult.amountUsd)}>{money(row.totals.realizedResult.amountUsd)}</span><Coverage value={row.totals.realizedResult} operations /></td>
            </tr>
          })}
        </tbody></table></div>}
        {current.document.omittedGroupCount > 0 && <p className="workspace-scope-note">{current.document.omittedGroupCount} groups omitted. Totals include them.</p>}
        <div className="overview-realized-total">Scope realized result <strong className={signClass(current.document.totals.realizedResult.amountUsd)}>{money(current.document.totals.realizedResult.amountUsd)}</strong><Coverage value={current.document.totals.realizedResult} operations /></div>
        <details className="operation-scope"><summary>Summary scope and coverage</summary><p className="workspace-scope-note">{current.document.scopeNote}</p><p className="workspace-scope-note">Window ends {new Date(current.document.asOfUtc).toISOString()}{current.document.fromUtc ? `, starts ${new Date(current.document.fromUtc).toISOString()}` : ', all retained history'}.</p>{(['balance', 'available', 'unrealizedPnl', 'realizedResult'] as const).flatMap(name => current.document!.totals[name].coverage.reasons.map((r, i) => <p className="workspace-scope-note" key={`${name}-${i}`}>{name}: {r.count} · {r.reason}</p>))}</details>
      </>}
    </section>
  </>
}
