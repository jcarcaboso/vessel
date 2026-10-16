import { emptyFilters, filterQuery, initialActivityState, type ActivityListState, type Filters } from './activity-filters'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityPage, ActivityQuery } from '@/api/activity'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Pager } from '@/components/ui/pager'
import { isPageSize } from '@/components/ui/paging'
import { useDelayedFlag } from '@/lib/use-delayed-flag'
import { OperationsSkeleton, OperationsTable } from './OperationsTable'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RetrospectivePreview } from './RetrospectivePreview'
import './activity-operations.css'

/** Overview shows this many of the latest operations in its scope, without a pager. */
const compactRows = 5
const count = new Intl.NumberFormat('en-US')

/**
 * Position operations, filtered and paged by the server. The Activity page keeps its filters, page and size
 * in shell memory (`state`); account detail keeps its own; Overview asks for the latest few in its scope.
 */
export function ActivityOperations({ api, accounts, portfolios = [], accountId, scope, compact = false, filters: showFilters = false, reloadGeneration = 0,
  state, onStateChange, onOpenPlay, onCreated }: {
  api: WorkspaceApi; accounts: BrokerAccount[]; portfolios?: Portfolio[]; accountId?: string | undefined
  /** Overview scope: `all`, `unassigned`, `portfolio:{id}` or `account:{id}`. */
  scope?: string | undefined
  compact?: boolean; filters?: boolean; reloadGeneration?: number
  state?: ActivityListState; onStateChange?: (state: ActivityListState) => void
  onOpenPlay?: (id: string, signal: AbortSignal) => Promise<void>; onCreated?: () => void
}) {
  const [localState, setLocalState] = useState(initialActivityState)
  const list = state ?? localState
  const setList = onStateChange ?? setLocalState
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ api: WorkspaceApi; key: string; page: ActivityPage | null; error: string | null } | null>(null)
  // The version of the first page read for these filters; a later page with another version means Activity changed.
  const [baseline, setBaseline] = useState<{ api: WorkspaceApi; key: string; version: string; changed: boolean } | null>(null)
  const [selection, setSelection] = useState<{ accountId: string; operationId: string } | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const top = useRef<HTMLDivElement | null>(null)
  const enabled = accounts.filter(a => a.isEnabled !== false)
  const previous = result?.api === api ? result.page : null
  // Options that disappear fall back to All; instruments come from the scoped set the server reports.
  const selected = list.filters
  const knownContracts = previous?.facets.contracts ?? null
  const filters: Filters = showFilters ? {
    ...selected,
    account: enabled.some(a => a.id === selected.account) ? selected.account : '',
    portfolio: selected.portfolio === 'unassigned' || portfolios.some(p => p.id === selected.portfolio) ? selected.portfolio : '',
    contract: knownContracts === null || knownContracts.includes(selected.contract) ? selected.contract : '',
  } : emptyFilters
  const pageSize = compact ? compactRows : list.pageSize
  const requested: ActivityQuery = {
    ...(scope !== undefined && scope !== 'all' ? { scope } : {}), ...(accountId !== undefined ? { accountId } : {}),
    ...filterQuery(filters), page: compact ? 1 : list.page, pageSize,
  }
  const queryKey = JSON.stringify(requested)
  const query = useMemo(() => JSON.parse(queryKey) as ActivityQuery, [queryKey])
  const key = JSON.stringify([queryKey, reloadGeneration, retry])
  const listKey = JSON.stringify([{ ...query, page: undefined }, reloadGeneration, retry])
  useEffect(() => {
    const controller = new AbortController()
    api.activity(query, controller.signal).then(page => {
      if (controller.signal.aborted) return
      setResult({ api, key, page, error: null })
      setBaseline(current => current?.api !== api || current.key !== listKey || page.page === 1 ? { api, key: listKey, version: page.version, changed: false }
        : current.version === page.version ? current : { ...current, changed: true })
    }).catch(cause => {
      if (!controller.signal.aborted) setResult({ api, key, page: null, error: errorMessage(cause, 'Operations could not be loaded.') })
    })
    return () => controller.abort()
  }, [api, query, key, listKey])
  const pending = result === null || result.api !== api || result.key !== key
  const skeleton = useDelayedFlag(pending && previous === null)
  const changed = baseline?.api === api && baseline.key === listKey && baseline.changed
  const update = (field: keyof Filters, value: string) => setList({ ...list, filters: { ...filters, [field]: value }, page: 1 })
  const reloadActivity = () => { setList({ ...list, page: 1 }); setRetry(n => n + 1) }
  const goTo = (page: number) => {
    setList({ ...list, page })
    top.current?.scrollIntoView?.({ block: 'start' })
  }

  // A rejected filter combination keeps the filters on screen so it can be changed.
  const error = pending ? null : result.error
  const shown = pending ? previous : result.page
  const contracts = shown?.facets.contracts ?? (filters.contract ? [filters.contract] : [])
  return <div className="activity-operations">
    {showFilters && <fieldset className="operation-filters"><legend>Filter operations</legend>
      <label>Account<NativeSelect value={filters.account} onChange={e => update('account', e.target.value)}><option value="">All enabled accounts</option>{enabled.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></label>
      <label>Portfolio<NativeSelect value={filters.portfolio} onChange={e => update('portfolio', e.target.value)}><option value="">All portfolios</option><option value="unassigned">Unassigned accounts</option>{portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></label>
      <label>Instrument<NativeSelect value={filters.contract} onChange={e => update('contract', e.target.value)}><option value="">All instruments</option>{contracts.map(c => <option key={c}>{c}</option>)}</NativeSelect></label>
      <label>Direction<NativeSelect value={filters.direction} onChange={e => update('direction', e.target.value)}><option value="">All directions</option><option value="long">Long</option><option value="short">Short</option></NativeSelect></label>
      <label>Status<NativeSelect value={filters.status} onChange={e => update('status', e.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="partial">Partially closed</option><option value="closed">Closed</option><option value="incomplete">Incomplete</option></NativeSelect></label>
      <label title={`Dates filter the latest execution, in UTC.${shown ? ` Rolling periods count back from ${shown.asOfUtc}.` : ''}`}>Period<NativeSelect value={filters.period} onChange={e => update('period', e.target.value)}><option value="all">All retained activity</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Date range · UTC</option></NativeSelect></label>
      {filters.period === 'custom' && <><label>From date<input type="date" value={filters.from} onChange={e => update('from', e.target.value)} /></label><label>Through date<input type="date" value={filters.to} min={filters.from || undefined} onChange={e => update('to', e.target.value)} /></label></>}
      <Button variant="outline" size="sm" onClick={() => setList({ ...list, filters: emptyFilters, page: 1 })}>Reset filters</Button>
    </fieldset>}
    {changed && <div className="workspace-alert activity-changed" role="status"><span>Activity changed</span>
      <Button variant="ghost" size="sm" aria-label="Reload activity" onClick={reloadActivity}>Reload</Button></div>}
    {error ? <div className="workspace-alert" role="alert">{error}<Button variant="ghost" size="sm" onClick={() => setRetry(n => n + 1)}>Retry operations</Button></div> :
      shown === null ? skeleton ? <OperationsSkeleton compact={compact} rows={compact ? compactRows : 6} /> : <div className="operations-pending" aria-busy="true" /> : <>
      <p className="workspace-scope-note in-panel" role="status">{compact
        ? `Showing ${count.format(shown.operations.length)} of ${count.format(shown.totalCount)} operations.`
        : `Showing ${count.format(shown.totalCount)} of ${count.format(shown.scopeCount)} operations.`}</p>
      <div ref={top} className={pending ? 'operations-results list-refetching' : 'operations-results'} aria-busy={pending || undefined}>
        <OperationsTable api={api} operations={shown.operations} accounts={accounts} compact={compact} onReload={reloadActivity} onPreview={operation => {
          trigger.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
          setSelection({ accountId: operation.accountId, operationId: operation.id })
        }} />
      </div>
      {!compact && <Pager label="Activity pages" page={shown.page} pageSize={shown.pageSize} totalCount={shown.totalCount} disabled={pending}
        onPage={goTo} onPageSize={size => { if (isPageSize(size)) setList({ ...list, page: 1, pageSize: size }) }} />}
      {!compact && <details className="operation-scope"><summary>Scope and coverage</summary><p className="workspace-scope-note">{shown.scopeNote}</p>{shown.coverage.filter(c => enabled.some(a => a.id === c.accountId)).map((c, index) => <p className="workspace-scope-note" key={index}><strong>{accounts.find(a => a.id === c.accountId)?.name}{c.contractId ? ` · ${c.contractId}` : ''}</strong>: {c.notice}</p>)}</details>}
    </>}
    <Dialog open={selection !== null && enabled.some(a => a.id === selection.accountId)} onOpenChange={open => { if (!open) setSelection(null) }}>
      <DialogContent className="retrospective-dialog" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}>
        <DialogHeader><DialogTitle>Retrospective operation preview</DialogTitle><DialogDescription className="sr-only">Inspect original facts and associations before confirming a completed Play.</DialogDescription></DialogHeader>
        {selection && enabled.some(a => a.id === selection.accountId) && <RetrospectivePreview api={api} {...selection} {...(onOpenPlay ? { onOpenPlay } : {})} {...(onCreated ? { onCreated } : {})} />}
      </DialogContent>
    </Dialog>
  </div>
}
