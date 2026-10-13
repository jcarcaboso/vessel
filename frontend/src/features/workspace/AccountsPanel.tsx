import { useState, type ReactNode, type FormEvent } from 'react'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { useVenues } from '@/api/venues'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown, Wallet } from 'lucide-react'
import { ApiError } from '@/api/system'
import { PortfolioDestination } from './PortfolioDestination'
import { usePortfolioDestination } from './usePortfolioDestination'
import { AccountRows } from './AccountRows'
import { emptyAccountFilters, type AccountFilters } from './account-filters'

export function AccountsPanel({ accounts, portfolios, portfolioFilter, onPortfolioFilter, refreshing, filters, onFiltersChange,
  refreshAction, api, onChanged, onReload, onDetail, onSync, onManage, onAdd }: {
  api: WorkspaceApi; onChanged: (message: string) => void; onReload: () => void
  accounts: BrokerAccount[]; portfolios: Portfolio[]; portfolioFilter: string
  onPortfolioFilter: (value: string) => void; refreshing: string | null; refreshAction: ReactNode
  filters: AccountFilters; onFiltersChange: (filters: AccountFilters) => void
  onDetail: (id: string) => void; onSync: (id: string) => void; onManage: (account: BrokerAccount) => void; onAdd: () => void
}) {
  const venues = useVenues()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const destination = usePortfolioDestination(portfolios, api, onReload)
  const [selection, setSelection] = useState<{ visible: string; accounts: BrokerAccount[] }>({ visible: '', accounts: [] })
  const { search, status } = filters
  const venueIds = [...new Set(accounts.map(account => account.venueId))]
  const venue = venueIds.includes(filters.venue) ? filters.venue : ''
  const update = (field: keyof AccountFilters, value: string) => onFiltersChange({ ...filters, [field]: value })
  const query = search.trim().toLowerCase()
  const shown = accounts.filter(account =>
    (!portfolioFilter || (portfolioFilter === 'unassigned' ? account.portfolioId === null : account.portfolioId === portfolioFilter)) &&
    (!query || [account.name, account.sourceId ?? '', account.address ?? ''].some(value => value.toLowerCase().includes(query))) &&
    (!venue || account.venueId === venue) &&
    (!status || (status === 'enabled' ? account.isEnabled !== false : status === 'disabled' ? account.isEnabled === false : account.syncStatus === status)))
  const visible = shown.map(a => a.id).join(',')
  const selectedAccounts = selection.accounts.filter(a => shown.some(current => current.id === a.id))
  const selected = selectedAccounts.map(a => a.id)
  if (selection.visible !== visible) setSelection({ visible, accounts: selectedAccounts })
  const choose = (ids: string[]) => setSelection({ visible, accounts: ids.map(id => selectedAccounts.find(a => a.id === id) ?? shown.find(a => a.id === id)!) })
  async function move(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(null)
    let portfolioCreated = false
    try {
      const target = await destination.resolve(); portfolioCreated = target.created
      await api.moveAccounts(selected, target.portfolioId, selectedAccounts.map(a => ({ accountId: a.id, settingsRevision: a.settingsRevision! })))
      choose([]); onChanged(`${selected.length} account${selected.length === 1 ? '' : 's'} moved${target.portfolioId ? ' to the portfolio' : ' to Unassigned'}.`)
    } catch (cause) {
      const conflict = cause instanceof ApiError && (cause.status === 409 || cause.status === 412)
      if (conflict) choose([])
      setError((portfolioCreated ? 'The new portfolio was created and kept. Retry the move into it; a duplicate portfolio will not be created. ' : '') +
        (conflict ? 'Account settings changed elsewhere. No accounts were moved. Reload and review the rows, then select them again before retrying.' :
          cause instanceof ApiError ? cause.message : 'The move was not confirmed. Reload before retrying.'))
      onReload()
    } finally { setPending(false) }
  }
  const names = Object.fromEntries(portfolios.map(p => [p.id, p.name]))
  const select = (label: string, value: string, onChange: (value: string) => void, options: { value: string; label: string }[]) =>
    <label className="account-filter"><span className="sr-only">{label}</span>
      <select aria-label={label} value={value} disabled={pending} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select><ChevronDown className="account-filter-chevron" size={14} aria-hidden="true" />
    </label>
  return <section className="shell-panel">
    <header className="shell-panel-heading"><div><h2>Account records</h2><p>Automatic venues and manual accounts use the same portfolio context.</p></div>{refreshAction}</header>
    <div className="accounts-filters" role="group" aria-label="Account filters">
      <Input disabled={pending} aria-label="Search accounts" placeholder="Search name or source" value={search} onChange={event => update('search', event.target.value)} />
      {select('Filter by portfolio', portfolioFilter, onPortfolioFilter, [
        { value: '', label: 'All accounts' }, { value: 'unassigned', label: 'Unassigned' },
        ...portfolios.map(p => ({ value: p.id, label: p.name })),
      ])}
      {select('Filter by venue', venue, value => update('venue', value), [{ value: '', label: 'All venues' },
        ...venueIds.map(id => ({ value: id, label: venues.name(id) }))])}
      {select('Filter by status', status, value => update('status', value), [
        { value: '', label: 'All statuses' }, { value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' },
        { value: 'error', label: 'Refresh failed' }, { value: 'not-synced', label: 'Not refreshed' }, { value: 'manual', label: 'Manual' },
      ])}
      <span className="account-result-count" role="status">{shown.length} of {accounts.length} accounts</span>
      <Button variant="ghost" size="sm" disabled={pending || !portfolioFilter && !search && !venue && !status}
        onClick={() => { onPortfolioFilter(''); onFiltersChange(emptyAccountFilters) }}>Reset filters</Button>
    </div>
    {selected.length > 0 && <form className="accounts-bulk-bar" aria-label="Move selected accounts" aria-busy={pending} onSubmit={event => { void move(event) }}>
      <strong>{selected.length} selected</strong>
      <PortfolioDestination destination={destination} inputId="bulk-portfolio" label="Move to" disabled={pending} />
      <Button type="submit" disabled={pending || selected.length > 200}>{pending ? 'Moving…' : 'Move'}</Button>
      <Button type="button" variant="ghost" disabled={pending} onClick={() => { choose([]); setError(null) }}>Clear</Button>
      {selected.length > 200 && <p className="field-help">Move up to 200 accounts at a time.</p>}
    </form>}
    {error && <p className="error bulk-error" role="alert">{error}</p>}
    <p className="workspace-scope-note in-panel">Unassigned accounts appear in All accounts and the Unassigned filter, never a portfolio. Disabled records are shown here so they can be enabled again; their imports and positions remain hidden.</p>
    {!shown.length ? <div className="workspace-empty"><Wallet size={30} /><strong>No accounts in this view</strong>
      <p>{accounts.length ? 'Change or reset the filters to see other accounts.' : 'Import read-only venue accounts or add a manual account. A portfolio is optional.'}</p>
      <Button onClick={onAdd}>Add account</Button></div> :
      <AccountRows selection={{ selected, onChange: choose, disabled: pending }} accounts={shown} portfolioNames={names} refreshing={refreshing} onDetail={onDetail} onSync={onSync} onManage={onManage} />}
  </section>
}
