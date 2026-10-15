import type { BrokerAccount } from '@/api/workspace'
import { useVenues } from '@/api/venues'
import { Button } from '@/components/ui/button'
import { VenueLogo } from '@/components/venues/VenueBadge'
import { ArrowUpRight, Pencil, RefreshCw } from 'lucide-react'
import { accountStatus, accountStatusTone, money, shortSource, time } from '@/lib/format'
import './accounts.css'

export function AccountRows({ accounts, portfolioNames, refreshing, selection, onDetail, onSync, onManage }: {
  accounts: BrokerAccount[]; portfolioNames: Record<string, string>; refreshing: string | null
  selection?: { selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }
  onDetail: (id: string) => void; onSync: (id: string) => void; onManage: (account: BrokerAccount) => void
}) {
  const venues = useVenues()
  return <div className="workspace-table-wrap"><table className="workspace-table account-table"><thead><tr>{selection && <th className="account-select-cell"><input type="checkbox" aria-label="Select all visible accounts" disabled={selection.disabled}
      checked={accounts.length > 0 && accounts.every(a => selection.selected.includes(a.id))}
      ref={input => { if (input) input.indeterminate = selection.selected.length > 0 && !accounts.every(a => selection.selected.includes(a.id)) }}
      onChange={event => selection.onChange(event.target.checked ? accounts.map(a => a.id) : [])} /></th>}<th>Account</th><th>Portfolio</th><th>Balance</th><th>Sync</th><th><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{accounts.map(account => {
      const source = account.sourceId ?? account.address
      const portfolio = account.portfolioId ? portfolioNames[account.portfolioId] ?? 'Portfolio' : null
      return <tr key={account.id} className={account.isEnabled === false ? 'is-disabled' : undefined}>
        {selection && <td className="account-select-cell"><input type="checkbox" aria-label={`Select ${account.name}`} disabled={selection.disabled} checked={selection.selected.includes(account.id)}
          onChange={event => selection.onChange(event.target.checked ? [...selection.selected, account.id] : selection.selected.filter(id => id !== account.id))} /></td>}
        <td><button disabled={selection?.disabled} className="account-row-name" onClick={() => onDetail(account.id)}>
          <VenueLogo venueId={account.venueId} size="md" />
          <span><strong>{account.name}</strong><small className="account-row-meta"><span>{venues.name(account.venueId)}</span>
            {source && <span className="account-source-id" title={source}>{shortSource(source)}</span>}</small></span>
        </button></td>
        <td><span className={`account-portfolio${portfolio ? '' : ' is-unassigned'}`}>{portfolio ?? 'Unassigned'}</span></td>
        <td className="numeric">{venues.can(account.venueId, 'stablecoinWallet') ?
          <><strong>{money(account.availableStablecoinNominalUsd ?? null)}</strong><small>Wallet stablecoins available · nominal</small><small>Perps equity {money(account.accountValueUsd)}</small></> :
          <><strong>{money(account.accountValueUsd)}</strong><small>{account.accountValueUsd === null ? 'No value recorded' : venues.can(account.venueId, 'sync') ? `${venues.valueUnit(account.venueId)} · venue-reported account value · nominal` : 'USD · manual value'}</small></>}<small>Available balance {money(account.isEnabled === false ? null : account.availableBalanceUsd ?? null)} · {account.availableBalanceSource === 'wallet' ? 'wallet' : account.availableBalanceSource === 'margin' ? 'reported margin' : account.availableBalanceSource === 'withdrawable' ? 'reported withdrawal' : 'unknown'}</small></td>
        <td><span className={`workspace-badge ${accountStatusTone(account)}`}>{accountStatus(account)}</span><small>{time(account.lastSyncedAtUtc)}</small><small>{account.positionCount} reported positions</small></td>
        <td><div className="row-actions"><Button disabled={selection?.disabled} variant="ghost" size="sm" onClick={() => onDetail(account.id)} aria-label={`View ${account.name}`}>View<ArrowUpRight size={14} /></Button>
          <button disabled={selection?.disabled} className="icon-button" onClick={() => onManage(account)} aria-label={`Manage ${account.name}`} title="Rename, move, disable or delete"><Pencil size={14} /></button>
          {venues.can(account.venueId, 'sync') && <button className="icon-button" disabled={selection?.disabled || refreshing !== null || account.isEnabled === false} aria-busy={refreshing === account.id} onClick={() => onSync(account.id)} aria-label={`Refresh ${account.name}`} title={account.isEnabled === false ? 'Enable this account before refreshing' : 'Refresh current state and recent executions'}><RefreshCw size={15} className={refreshing === account.id ? 'is-spinning' : ''} /></button>}</div></td>
      </tr>
    })}</tbody></table></div>
}
