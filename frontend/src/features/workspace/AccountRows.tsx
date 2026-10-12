import type { BrokerAccount } from '@/api/workspace'
import { useVenues } from '@/api/venues'
import { Button } from '@/components/ui/button'
import { ArrowUpRight, Pencil, RefreshCw, Wallet } from 'lucide-react'
import { money, time } from './format'

export function AccountRows({ accounts, portfolioNames, refreshing, onDetail, onSync, onManage }: {
  accounts: BrokerAccount[]; portfolioNames: Record<string, string>; refreshing: string | null
  onDetail: (id: string) => void; onSync: (id: string) => void; onManage: (account: BrokerAccount) => void
}) {
  const venues = useVenues()
  return <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Account</th><th>Known value</th><th>Latest update</th><th>Connection</th><th><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{accounts.map(account => <tr key={account.id}>
      <td><button className="account-row-name" onClick={() => onDetail(account.id)}><span className={`venue-mark${venues.can(account.venueId, 'sync') ? ' synced' : ''}`}><Wallet size={17} /></span><span><strong>{account.name}</strong><small>{venues.name(account.venueId)} · {account.portfolioId ? portfolioNames[account.portfolioId] ?? 'Portfolio' : 'Unassigned'}</small></span></button></td>
      <td className="numeric">{venues.can(account.venueId, 'stablecoinWallet') ?
        <><strong>{money(account.availableStablecoinNominalUsd ?? null)}</strong><small>Wallet stablecoins available · nominal</small><small>Perps equity {money(account.accountValueUsd)}</small></> :
        <><strong>{money(account.accountValueUsd)}</strong><small>{account.accountValueUsd === null ? 'No value recorded' : venues.can(account.venueId, 'sync') ? 'USD · venue-reported account value' : 'USD · manual value'}</small></>}<small>Available balance {money(account.isEnabled === false ? null : account.availableBalanceUsd ?? null)} · {account.availableBalanceSource === 'wallet' ? 'wallet' : account.availableBalanceSource === 'margin' ? 'reported margin' : account.availableBalanceSource === 'withdrawable' ? 'reported withdrawal' : 'unknown'}</small></td>
      <td><strong>{time(account.lastSyncedAtUtc)}</strong><small>{account.positionCount} reported positions</small></td>
      <td><span className={`workspace-badge ${account.isEnabled === false || account.syncStatus === 'error' ? 'warning-badge' : ''}`}>{account.isEnabled === false ? 'Disabled' : account.syncStatus === 'manual' ? 'Manual' : account.syncStatus === 'synced' ? 'Read-only' : account.syncStatus === 'error' ? 'Refresh failed' : 'Not refreshed'}</span></td>
      <td><div className="row-actions"><Button variant="ghost" size="sm" onClick={() => onDetail(account.id)} aria-label={`View ${account.name}`}>View<ArrowUpRight size={14} /></Button>
        <button className="icon-button" onClick={() => onManage(account)} aria-label={`Manage ${account.name}`} title="Rename, move, disable or delete"><Pencil size={14} /></button>
        {venues.can(account.venueId, 'sync') && <button className="icon-button" disabled={refreshing !== null || account.isEnabled === false} aria-busy={refreshing === account.id} onClick={() => onSync(account.id)} aria-label={`Refresh ${account.name}`} title={account.isEnabled === false ? 'Enable this account before refreshing' : 'Refresh current state and recent executions'}><RefreshCw size={15} className={refreshing === account.id ? 'is-spinning' : ''} /></button>}</div></td>
    </tr>)}</tbody></table></div>
}
