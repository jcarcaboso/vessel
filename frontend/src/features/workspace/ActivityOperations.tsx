import { emptyFilters, filterOperations, type Filters } from './activity-filters'
import { useEffect, useState } from 'react'
import type { ActivityDocument } from '@/api/activity'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { Button } from '@/components/ui/button'
import { OperationsTable } from './OperationsTable'
import './activity-operations.css'

export function ActivityOperations({ api, accounts, portfolios = [], accountId, compact = false, filters: showFilters = false, reloadGeneration = 0 }: {
  api: WorkspaceApi; accounts: BrokerAccount[]; portfolios?: Portfolio[]; accountId?: string; compact?: boolean; filters?: boolean; reloadGeneration?: number
}) {
  const [state, setState] = useState<{ key: string; api: WorkspaceApi; document: ActivityDocument | null; error: string | null } | null>(null)
  const [retry, setRetry] = useState(0)
  const [filters, setFilters] = useState(emptyFilters)
  const [now, setNow] = useState(() => Date.now())
  const key = JSON.stringify([accountId, reloadGeneration, retry])
  const pending = state === null || state.key !== key || state.api !== api
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    api.activity(accountId, controller.signal).then(document => {
      if (active) setState({ key, api, document, error: null })
    }).catch(cause => {
      if (active) setState({ key, api, document: null, error: cause instanceof ApiError ? cause.message : 'Operations could not be loaded.' })
    })
    return () => { active = false; controller.abort() }
  }, [api, accountId, key])
  if (pending) return <div className="workspace-loading" role="status">Loading operations…</div>
  if (state.error) return <div className="workspace-alert" role="alert">{state.error}<Button variant="ghost" size="sm" onClick={() => setRetry(n => n + 1)}>Retry operations</Button></div>
  const document = state.document!
  const enabled = accounts.filter(a => a.isEnabled !== false)
  const loaded = document.operations.filter(op => enabled.some(a => a.id === op.accountId))
  const visible = showFilters ? filterOperations(loaded, accounts, filters, now) : compact ? loaded.slice(0, 5) : loaded
  const update = (field: keyof Filters, value: string) => { setFilters(previous => ({ ...previous, [field]: value })); setNow(Date.now()) }
  return <div className="activity-operations">
    {showFilters && <fieldset className="operation-filters"><legend>Filter operations</legend>
      <label>Account<select value={filters.account} onChange={e => update('account', e.target.value)}><option value="">All enabled accounts</option>{enabled.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Portfolio<select value={filters.portfolio} onChange={e => update('portfolio', e.target.value)}><option value="">All portfolios</option><option value="unassigned">Unassigned accounts</option>{portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Instrument<select value={filters.contract} onChange={e => update('contract', e.target.value)}><option value="">All instruments</option>{[...new Set(loaded.map(op => op.contractId))].sort().map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Direction<select value={filters.direction} onChange={e => update('direction', e.target.value)}><option value="">All directions</option><option value="long">Long</option><option value="short">Short</option></select></label>
      <label>Status<select value={filters.status} onChange={e => update('status', e.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="closed">Closed</option><option value="incomplete">Incomplete</option></select></label>
      <label>Period<select value={filters.period} onChange={e => update('period', e.target.value)}><option value="all">All retained activity</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Date range · UTC</option></select></label>
      {filters.period === 'custom' && <><label>From date<input type="date" value={filters.from} onChange={e => update('from', e.target.value)} /></label><label>Through date<input type="date" value={filters.to} min={filters.from || undefined} onChange={e => update('to', e.target.value)} /></label></>}
      <Button variant="outline" size="sm" onClick={() => { setFilters(emptyFilters); setNow(Date.now()) }}>Reset filters</Button>
    </fieldset>}
    <p className="workspace-scope-note in-panel" role="status">Showing {visible.length} of {loaded.length} loaded operations{document.omittedOperationCount > 0 ? ` · ${document.omittedOperationCount} older operations omitted` : ''}. {document.retainedFillCount} retained fills evaluated.{showFilters && ' Dates filter the latest constituent fill, in UTC.'}</p>
    <OperationsTable operations={visible} accounts={accounts} compact={compact} />
    {!compact && <><details className="operation-scope"><summary>Scope and coverage</summary><p className="workspace-scope-note">{document.scopeNote}</p>{document.coverage.filter(c => enabled.some(a => a.id === c.accountId)).map((c, index) => <p className="workspace-scope-note" key={index}><strong>{accounts.find(a => a.id === c.accountId)?.name}{c.contractId ? ` · ${c.contractId}` : ''}</strong>: {c.notice}</p>)}</details></>}
  </div>
}
