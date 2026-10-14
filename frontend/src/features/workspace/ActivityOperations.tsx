import { emptyFilters, filterOperations, type Filters } from './activity-filters'
import { useEffect, useRef, useState } from 'react'
import type { ActivityDocument } from '@/api/activity'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { OperationsTable } from './OperationsTable'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RetrospectivePreview } from './RetrospectivePreview'
import './activity-operations.css'

export function ActivityOperations({ api, accounts, portfolios = [], accountId, compact = false, filters: showFilters = false, reloadGeneration = 0,
  filterValues, onFiltersChange, scopeAccountIds, onOpenPlay, onCreated }: {
  api: WorkspaceApi; accounts: BrokerAccount[]; portfolios?: Portfolio[]; accountId?: string | undefined; compact?: boolean; filters?: boolean; reloadGeneration?: number
  scopeAccountIds?: readonly string[]; filterValues?: Filters; onFiltersChange?: (filters: Filters) => void
  onOpenPlay?: (id: string, signal: AbortSignal) => Promise<void>; onCreated?: () => void
}) {
  const [state, setState] = useState<{ key: string; api: WorkspaceApi; document: ActivityDocument | null; error: string | null; receivedAt: number } | null>(null)
  const [retry, setRetry] = useState(0)
  const [localFilters, setLocalFilters] = useState(emptyFilters)
  const [selection, setSelection] = useState<{ accountId: string; operationId: string } | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const selectedFilters = filterValues ?? localFilters
  const setFilters = onFiltersChange ?? setLocalFilters
  const key = JSON.stringify([accountId, reloadGeneration, retry])
  const pending = state === null || state.key !== key || state.api !== api
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    api.activity(accountId, controller.signal).then(document => {
      if (active) setState({ key, api, document, error: null, receivedAt: Date.now() })
    }).catch(cause => {
      if (active) setState({ key, api, document: null, receivedAt: Date.now(), error: errorMessage(cause, 'Operations could not be loaded.') })
    })
    return () => { active = false; controller.abort() }
  }, [api, accountId, key])
  if (pending) return <div className="workspace-loading" role="status">Loading operations…</div>
  if (state.error) return <div className="workspace-alert" role="alert">{state.error}<Button variant="ghost" size="sm" onClick={() => setRetry(n => n + 1)}>Retry operations</Button></div>
  const document = state.document!
  const enabled = accounts.filter(a => a.isEnabled !== false && (scopeAccountIds === undefined || scopeAccountIds.includes(a.id)))
  const loaded = document.operations.filter(op => enabled.some(a => a.id === op.accountId))
  const contracts = [...new Set(loaded.map(op => op.contractId))].sort()
  const filters = {
    ...selectedFilters,
    account: enabled.some(a => a.id === selectedFilters.account) ? selectedFilters.account : '',
    portfolio: selectedFilters.portfolio === 'unassigned' || portfolios.some(p => p.id === selectedFilters.portfolio) ? selectedFilters.portfolio : '',
    contract: contracts.includes(selectedFilters.contract) ? selectedFilters.contract : '',
  }
  const visible = showFilters ? filterOperations(loaded, accounts, filters, state.receivedAt) : compact ? loaded.slice(0, 5) : loaded
  const update = (field: keyof Filters, value: string) => setFilters({ ...filters, [field]: value })
  return <div className="activity-operations">
    {showFilters && <fieldset className="operation-filters"><legend>Filter operations</legend>
      <label>Account<NativeSelect value={filters.account} onChange={e => update('account', e.target.value)}><option value="">All enabled accounts</option>{enabled.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></label>
      <label>Portfolio<NativeSelect value={filters.portfolio} onChange={e => update('portfolio', e.target.value)}><option value="">All portfolios</option><option value="unassigned">Unassigned accounts</option>{portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></label>
      <label>Instrument<NativeSelect value={filters.contract} onChange={e => update('contract', e.target.value)}><option value="">All instruments</option>{contracts.map(c => <option key={c}>{c}</option>)}</NativeSelect></label>
      <label>Direction<NativeSelect value={filters.direction} onChange={e => update('direction', e.target.value)}><option value="">All directions</option><option value="long">Long</option><option value="short">Short</option></NativeSelect></label>
      <label>Status<NativeSelect value={filters.status} onChange={e => update('status', e.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="partial">Partially closed</option><option value="closed">Closed</option><option value="incomplete">Incomplete</option></NativeSelect></label>
      <label>Period<NativeSelect value={filters.period} onChange={e => update('period', e.target.value)}><option value="all">All retained activity</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Date range · UTC</option></NativeSelect></label>
      {filters.period === 'custom' && <><label>From date<input type="date" value={filters.from} onChange={e => update('from', e.target.value)} /></label><label>Through date<input type="date" value={filters.to} min={filters.from || undefined} onChange={e => update('to', e.target.value)} /></label></>}
      <Button variant="outline" size="sm" onClick={() => setFilters(emptyFilters)}>Reset filters</Button>
    </fieldset>}
    <p className="workspace-scope-note in-panel" role="status">Showing {visible.length} of {loaded.length} loaded operations{document.omittedOperationCount > 0 ? ` · ${document.omittedOperationCount} older operations omitted` : ''}.{showFilters && ' Dates filter the latest execution, in UTC.'}</p>
    <OperationsTable operations={visible} accounts={accounts} compact={compact} onPreview={operation => {
      trigger.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
      setSelection({ accountId: operation.accountId, operationId: operation.id })
    }} />
    {!compact && <><details className="operation-scope"><summary>Scope and coverage</summary><p className="workspace-scope-note">{document.scopeNote}</p><p className="workspace-scope-note">Activity describes retained imported operations, not account balances or saved-Play Review. Manual Play executions do not enter this feed. Retrospective creation requires an inspected, eligible server preview.</p>{document.coverage.filter(c => enabled.some(a => a.id === c.accountId)).map((c, index) => <p className="workspace-scope-note" key={index}><strong>{accounts.find(a => a.id === c.accountId)?.name}{c.contractId ? ` · ${c.contractId}` : ''}</strong>: {c.notice}</p>)}</details></>}
    <Dialog open={selection !== null && enabled.some(a => a.id === selection.accountId)} onOpenChange={open => { if (!open) setSelection(null) }}>
      <DialogContent className="retrospective-dialog" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}>
        <DialogHeader><DialogTitle>Retrospective operation preview</DialogTitle><DialogDescription>Inspect original facts and associations before confirming a completed Play.</DialogDescription></DialogHeader>
        {selection && enabled.some(a => a.id === selection.accountId) && <RetrospectivePreview api={api} {...selection} {...(onOpenPlay ? { onOpenPlay } : {})} {...(onCreated ? { onCreated } : {})} />}
      </DialogContent>
    </Dialog>
  </div>
}
