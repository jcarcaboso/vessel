import { useState } from 'react'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { useVenues } from '@/api/venues'
import { Input } from '@/components/ui/input'
import { VenueLogo } from '@/components/venues/VenueBadge'
import './accounts.css'

export function PortfolioAccounts({ accounts, portfolios, selected, onChange, disabled, autoFocus = false, maxSelected = 200 }: {
  accounts: BrokerAccount[]; portfolios: Portfolio[]; selected: string[]; onChange: (ids: string[]) => void
  disabled: boolean; autoFocus?: boolean; maxSelected?: number
}) {
  const venues = useVenues()
  const [search, setSearch] = useState('')
  const names = Object.fromEntries(portfolios.map(p => [p.id, p.name]))
  const query = search.trim().toLowerCase()
  const shown = accounts.filter(a => [a.name, venues.name(a.venueId), a.portfolioId ? names[a.portfolioId] ?? '' : 'Unassigned']
    .some(value => value.toLowerCase().includes(query)))
  return <fieldset className="portfolio-membership" disabled={disabled}>
    <legend>Accounts <span className="optional">optional</span></legend>
    <p className="field-help">Selecting an account in another portfolio moves it here. Unchecking a member makes it Unassigned. History stays intact. Up to 200 accounts per change.</p>
    {(accounts.length > 10 || autoFocus) && <Input aria-label="Search portfolio accounts" placeholder="Search accounts, venue or portfolio"
      autoFocus={autoFocus} value={search} onChange={event => setSearch(event.target.value)} />}
    <div className="portfolio-account-list">{shown.map(account => <label className="portfolio-account-choice" key={account.id}>
      <input type="checkbox" aria-label={`Include ${account.name}`} checked={selected.includes(account.id)}
        disabled={disabled || !selected.includes(account.id) && selected.length >= maxSelected}
        onChange={event => onChange(event.target.checked ? [...selected, account.id] : selected.filter(id => id !== account.id))} />
      <VenueLogo venueId={account.venueId} size="md" />
      <span><strong>{account.name}</strong><small>{venues.name(account.venueId)} · {account.portfolioId ? names[account.portfolioId] ?? 'Portfolio' : 'Unassigned'}{account.isEnabled === false ? ' · Disabled' : ''}</small></span>
    </label>)}</div>
    {!shown.length && <p className="field-help">{accounts.length ? 'No matching accounts.' : 'No existing accounts yet. Add accounts later.'}</p>}
  </fieldset>
}
