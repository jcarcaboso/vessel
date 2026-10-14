import { useEffect, useState } from 'react'
import type { AccountSnapshot, BrokerAccount, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { Button } from '@/components/ui/button'
import { ActivityOperations } from './ActivityOperations'
import { accountStatus, accountStatusTone, amount, money, time } from './format'
import { useVenues } from '@/api/venues'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { VenueLogo } from '@/components/venues/VenueBadge'

export function AccountDetail({ account, api, refreshing, busy = refreshing, onSync, onBack, onManage, reloadGeneration = 0, onOpenPlay, onCreated }: {
  account: BrokerAccount; api: WorkspaceApi; refreshing: boolean; busy?: boolean; onSync: (id: string) => void; onBack: () => void; onManage: () => void; reloadGeneration?: number
  onOpenPlay?: (id: string, signal: AbortSignal) => Promise<void>; onCreated?: () => void
}) {
  const venues = useVenues()
  const synced = venues.can(account.venueId, 'sync')
  const wallet = venues.can(account.venueId, 'stablecoinWallet')
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null)
  const [completed, setCompleted] = useState<{ api: WorkspaceApi; key: string } | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  // A refresh ends with a shell reload, so an in-flight refresh does not start a racing read.
  const requestKey = JSON.stringify([account.id, account.lastSyncedAtUtc, account.isEnabled, reloadGeneration])
  const pending = completed === null || completed.api !== api || completed.key !== requestKey
  const error = pending ? null : detailError
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    // Loading/error visibility derives from the request generation, avoiding a
    // synchronous effect render while keeping prior observations during retries.
    api.snapshot(account.id, controller.signal).then(nextSnapshot => {
      if (active) { setSnapshot(nextSnapshot); setDetailError(null); setCompleted({ api, key: requestKey }) }
    }).catch(cause => {
      if (active) { setDetailError(cause instanceof ApiError ? cause.message : 'Unable to read the account.'); setCompleted({ api, key: requestKey }) }
    })
    return () => { active = false; controller.abort() }
  }, [api, account.id, requestKey])
  return <div className="workspace-page-content">
    <div className="detail-actions"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={15} />All accounts</Button><div className="detail-management"><Button variant="outline" onClick={onManage}>Manage account</Button>{synced && <Button variant="outline" onClick={() => onSync(account.id)} disabled={busy || account.isEnabled === false}><RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} />{refreshing ? 'Refreshing…' : 'Refresh account'}</Button>}</div></div>
    <section className="shell-panel account-detail-heading"><VenueLogo venueId={account.venueId} size="lg" /><div><h2>{account.name}</h2><p>{venues.name(account.venueId)} · {synced ? 'read-only perpetuals' : account.venueId === 'manual' ? 'manual record' : 'reader not enabled'} · {time(account.lastSyncedAtUtc)}</p></div><span className={`workspace-badge ${accountStatusTone(account)}`}>{accountStatus(account)}</span></section>
    {(account.sourceId ?? account.address) && <p className="account-source"><span>Source</span> {account.sourceId ?? account.address}</p>}
    {synced && <p className="workspace-scope-note">{account.lastSyncedAtUtc ? `Retained venue observations last refreshed ${time(account.lastSyncedAtUtc)}.` : 'No successful venue refresh is recorded yet.'} Refresh account rereads supported current state and bounded recent executions, not complete lifetime history.{venues.can(account.venueId, 'readOnlyCredential') && ' If order access is unavailable or expired, use Manage account to inspect or replace the read-only token.'}</p>}
    {error && <div className="workspace-alert" role="alert">{error}</div>}
    {account.isEnabled === false && <div className="workspace-alert" role="status">This account is disabled. Retained imports and positions are hidden and excluded from workspace totals. Use Manage account to enable it again.</div>}
    <div className="workspace-stat-grid three">
      <div className="shell-panel metric"><span>{wallet ? 'Wallet stablecoins available' : synced ? 'Account value · reported' : 'Known manual value'}</span><strong>{money(wallet ? account.availableStablecoinNominalUsd ?? null : account.accountValueUsd)}</strong><small>{account.isEnabled === false ? 'Hidden while disabled' : !wallet ? (synced ? `Perpetuals equity in ${venues.valueUnit(account.venueId)} · nominal` : 'Entered manually') : snapshot?.stablecoinWallet ? `${snapshot.stablecoinWallet.accountMode} · nominal total minus held` : 'Refresh to read the stablecoin wallet'}</small></div>
      <div className="shell-panel metric"><span>Available balance</span><strong>{money(account.isEnabled === false ? null : account.availableBalanceUsd ?? null)}</strong><small>{account.isEnabled === false ? 'Hidden while disabled' : account.availableBalanceSource === 'wallet' ? 'Wallet total minus held · nominal' : account.availableBalanceSource === 'margin' ? 'Venue-reported available margin · not guaranteed withdrawable' : account.availableBalanceSource === 'withdrawable' ? 'Venue-reported perps withdrawable' : 'Not reported by this venue'}</small><small>Perps withdrawable {money(account.isEnabled === false ? null : snapshot?.withdrawableUsd ?? null)} · separate field</small></div>
      <div className="shell-panel metric"><span>Margin used · reported</span><strong>{money(snapshot?.marginUsedUsd ?? null)}</strong><small>{snapshot?.positions.length ?? 0} positions in last snapshot</small></div>
    </div>
    {wallet && <section className="shell-panel"><header className="shell-panel-heading"><div><h2>Stablecoin wallet</h2><p>Supported stablecoins in the venue wallet. Other assets are excluded.</p></div><span className="workspace-badge">{snapshot?.stablecoinWallet?.accountMode ?? 'Not observed'}</span></header>
      {account.isEnabled === false ? <div className="workspace-empty small-empty"><strong>Wallet balances hidden while disabled</strong></div> :
        !snapshot?.stablecoinWallet ? <div className="workspace-empty small-empty"><strong>Stablecoin wallet not retrieved yet</strong><p>Use Refresh account to read it. A prior perpetual snapshot alone does not describe a unified wallet.</p></div> :
        <><div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Stablecoin</th><th>Total token units</th><th>Held token units</th><th>Available token units</th></tr></thead><tbody>{snapshot.stablecoinWallet.balances.map(b => <tr key={b.tokenId}><td><strong>{b.symbol}</strong></td><td>{amount(b.total)}</td><td>{amount(b.held)}</td><td><strong>{amount(b.available)}</strong></td></tr>)}</tbody></table></div><p className="workspace-scope-note in-panel">{snapshot.stablecoinWallet.notice}</p></>}
    </section>}
    {snapshot && wallet && <p className="workspace-scope-note">Separate {venues.name(account.venueId)} perpetuals equity: {money(snapshot.accountValueUsd)}. This is not summed with wallet balances as total account equity.</p>}
    <section className="shell-panel"><header className="shell-panel-heading"><h2>Perpetual positions</h2><span className="muted">{pending ? 'Loading…' : 'Latest snapshot'}</span></header>
      {account.isEnabled === false ? <div className="workspace-empty small-empty"><strong>Positions hidden while disabled</strong><p>The stored snapshot is retained. Enable the account to read it again.</p></div> : !snapshot?.positions.length ? <div className="workspace-empty small-empty"><strong>{pending ? 'Reading the snapshot…' : 'No positions in the latest snapshot'}</strong><p>{snapshot ? 'These are venue-reported positions, not planned plays.' : 'Refresh a read-only account to get a snapshot. A missing snapshot is not proof of zero exposure.'}</p></div> :
        <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Contract</th><th>Signed quantity</th><th>Entry price</th><th>Unrealized P&amp;L</th><th>Leverage</th></tr></thead><tbody>{snapshot.positions.map(p => <tr key={p.contractId}><td><strong>{p.contractId}</strong></td><td>{amount(p.signedQuantity)}</td><td>{money(p.entryPrice)}</td><td>{money(p.unrealizedPnlUsd)}</td><td>{p.leverage === null ? '—' : `${p.leverage}×`}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="shell-panel"><header className="shell-panel-heading"><h2>Recent executions</h2><span className="muted">{account.isEnabled === false ? 'Disabled account' : 'Position operations'}</span></header>{account.isEnabled === false ? <div className="workspace-empty small-empty"><strong>Imported movements hidden while disabled</strong><p>Nothing was deleted. Enable the account to restore this view.</p></div> : <ActivityOperations key={requestKey} api={api} accountId={account.id} accounts={[account]} reloadGeneration={reloadGeneration} {...(onOpenPlay ? { onOpenPlay } : {})} {...(onCreated ? { onCreated } : {})} />}</section>
    {account.historyNotice && <p className="workspace-scope-note">{account.historyNotice}</p>}
  </div>
}
