import type { ReactNode } from 'react'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { useVenues } from '@/api/venues'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown, Wallet } from 'lucide-react'
import { AccountRows } from './AccountRows'
import { emptyAccountFilters, type AccountFilters } from './account-filters'

export function AccountsPanel({ accounts, portfolios, portfolioFilter, onPortfolioFilter, refreshing, filters, onFiltersChange,
  refreshAction, onDetail, onSync, onManage, onAdd }: {
  accounts: BrokerAccount[]; portfolios: Portfolio[]; portfolioFilter: string
  onPortfolioFilter: (value: string) => void; refreshing: string | null; refreshAction: ReactNode
  filters: AccountFilters; onFiltersChange: (filters: AccountFilters) => void
  onDetail: (id: string) => void; onSync: (id: string) => void; onManage: (account: BrokerAccount) => void; onAdd: () => void
}) {
  const venues = useVenues()
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
  const names = Object.fromEntries(portfolios.map(p => [p.id, p.name]))
  const select = (label: string, value: string, onChange: (value: string) => void, options: { value: string; label: string }[]) =>
    <label className="account-filter"><span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select><ChevronDown className="account-filter-chevron" size={14} aria-hidden="true" />
    </label>
  return <section className="shell-panel">
    <header className="shell-panel-heading"><div><h2>Account records</h2><p>Automatic venues and manual accounts use the same portfolio context.</p></div>{refreshAction}</header>
    <div className="accounts-filters" role="group" aria-label="Account filters">
      <Input aria-label="Search accounts" placeholder="Search name or source" value={search} onChange={event => update('search', event.target.value)} />
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
      <Button variant="ghost" size="sm" disabled={!portfolioFilter && !search && !venue && !status}
        onClick={() => { onPortfolioFilter(''); onFiltersChange(emptyAccountFilters) }}>Reset filters</Button>
    </div>
    <p className="workspace-scope-note in-panel">Unassigned accounts appear in All accounts and the Unassigned filter, never a portfolio. Disabled records are shown here so they can be enabled again; their imports and positions remain hidden.</p>
    {!shown.length ? <div className="workspace-empty"><Wallet size={30} /><strong>No accounts in this view</strong>
      <p>{accounts.length ? 'Change or reset the filters to see other accounts.' : 'Import read-only venue accounts or add a manual account. A portfolio is optional.'}</p>
      <Button onClick={onAdd}>Add account</Button></div> :
      <AccountRows accounts={shown} portfolioNames={names} refreshing={refreshing} onDetail={onDetail} onSync={onSync} onManage={onManage} />}
  </section>
}
