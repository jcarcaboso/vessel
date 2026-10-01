import { useCallback, useEffect, useState } from 'react'
import type { BrokerAccount, Overview, Portfolio, WorkspaceApi } from '@/api/workspace'
import { ApiError, type SystemInfo } from '@/api/system'
import { Button } from '@/components/ui/button'
import { AccountDetail } from './AccountDetail'
import { ActivityTable } from './ActivityTable'
import { CreateAccountDialog, CreatePortfolioDialog } from './CreateDialogs'
import { ManageAccountDialog, ManagePortfolioDialog } from './ManageDialogs'
import { money, shortAddress, time, venueName } from './format'
import {
  Activity, ArrowRight, ArrowUpRight, Check, CircleHelp, Database, Folder, LayoutDashboard,
  LogOut, Menu, Plus, RefreshCw, Settings2, ShieldCheck, Wallet, X, BookOpen, Pencil,
} from 'lucide-react'
import './application-shell.css'

const pages = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'Your accounts and recent execution history, in one place.' },
  { id: 'portfolios', label: 'Portfolios', icon: Folder, description: 'Group accounts around the way you trade.' },
  { id: 'accounts', label: 'Accounts', icon: Wallet, description: 'Read-only venue connections and manual account records.' },
  { id: 'activity', label: 'Activity', icon: Activity, description: 'Imported executions, separate from trading intent.' },
  { id: 'settings', label: 'Settings', icon: Settings2, description: 'Your self-hosted workspace and available capabilities.' },
] as const
type Page = typeof pages[number]['id']
const pageFromHash = (): Page => pages.find(p => p.id === window.location.hash.slice(1))?.id ?? 'overview'

function AccountRows({ accounts, portfolioNames, refreshing, onDetail, onSync, onManage }: {
  accounts: BrokerAccount[]; portfolioNames: Record<string, string>; refreshing: string | null
  onDetail: (id: string) => void; onSync: (id: string) => void; onManage: (account: BrokerAccount) => void
}) {
  return <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Account</th><th>Known value</th><th>Latest update</th><th>Connection</th><th><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{accounts.map(account => <tr key={account.id}>
      <td><button className="account-row-name" onClick={() => onDetail(account.id)}><span className={`venue-mark ${account.venueId}`}><Wallet size={17} /></span><span><strong>{account.name}</strong><small>{venueName(account.venueId)} · {account.portfolioId ? portfolioNames[account.portfolioId] ?? 'Portfolio' : 'Unassigned'}</small></span></button></td>
      <td className="numeric">{account.venueId === 'hyperliquid' ?
        <><strong>{money(account.availableStablecoinNominalUsd ?? null)}</strong><small>Wallet stablecoins available · nominal</small><small>Primary perps equity {money(account.accountValueUsd)}</small></> :
        <><strong>{money(account.accountValueUsd)}</strong><small>{account.accountValueUsd === null ? 'No value recorded' : 'USD · manual value'}</small></>}</td>
      <td><strong>{time(account.lastSyncedAtUtc)}</strong><small>{account.positionCount} reported positions</small></td>
      <td><span className={`workspace-badge ${account.isEnabled === false || account.syncStatus === 'error' ? 'warning-badge' : ''}`}>{account.isEnabled === false ? 'Disabled' : account.syncStatus === 'manual' ? 'Manual' : account.syncStatus === 'synced' ? 'Read-only' : account.syncStatus === 'error' ? 'Refresh failed' : 'Not refreshed'}</span></td>
      <td><div className="row-actions"><Button variant="ghost" size="sm" onClick={() => onDetail(account.id)} aria-label={`View ${account.name}`}>View<ArrowUpRight size={14} /></Button>
        <button className="icon-button" onClick={() => onManage(account)} aria-label={`Manage ${account.name}`} title="Rename, move, disable or delete"><Pencil size={14} /></button>
        {account.venueId === 'hyperliquid' && <button className="icon-button" disabled={refreshing !== null || account.isEnabled === false} onClick={() => onSync(account.id)} aria-label={`Refresh ${account.name}`} title={account.isEnabled === false ? 'Enable this account before refreshing' : 'Refresh current state and recent executions'}><RefreshCw size={15} className={refreshing === account.id ? 'is-spinning' : ''} /></button>}</div></td>
    </tr>)}</tbody></table></div>
}

export function ApplicationShell({ system, disconnect, api }: { system: SystemInfo; disconnect: () => void; api: WorkspaceApi }) {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [menuOpen, setMenuOpen] = useState(false)
  const [data, setData] = useState<Overview | null>(null)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [portfolioFilter, setPortfolioFilter] = useState('')
  const [portfolioDialog, setPortfolioDialog] = useState(false)
  const [accountDialog, setAccountDialog] = useState(false)
  const [managedPortfolio, setManagedPortfolio] = useState<Portfolio | null>(null)
  const [managedAccount, setManagedAccount] = useState<BrokerAccount | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(key => key + 1), [])
  useEffect(() => {
    const handle = () => {
      const next = pageFromHash()
      setPage(next); setMenuOpen(false)
      if (next !== 'accounts') setSelectedAccountId(null)
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }
    window.addEventListener('hashchange', handle)
    return () => window.removeEventListener('hashchange', handle)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    api.overview(controller.signal).then(next => { if (active) { setData(next); setPending(false); setError(null) } })
      .catch(cause => { if (active) { setError(cause instanceof ApiError ? cause.message : 'The workspace could not be loaded.'); setPending(false) } })
    return () => { active = false; controller.abort() }
  }, [api, reloadKey])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5500)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (!menuOpen) return
    const sidebar = document.getElementById('workspace-nav')!
    const controls = () => [...sidebar.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>('a[href],button:not(:disabled)')]
    controls()[0]?.focus()
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); setMenuOpen(false)
      } else if (event.key === 'Tab') {
        const list = controls(), first = list[0], last = list.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    const resize = () => { if (window.innerWidth > 800) setMenuOpen(false) }
    window.addEventListener('keydown', handle)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('keydown', handle)
      window.removeEventListener('resize', resize)
      document.getElementById('workspace-menu')?.focus({ preventScroll: true })
    }
  }, [menuOpen])
  function navigate(next: Page) {
    window.location.hash = next
    setPage(next); setMenuOpen(false); setSelectedAccountId(null)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }
  function viewAccount(id: string) {
    if (page !== 'accounts') { window.location.hash = 'accounts'; setPage('accounts') }
    setSelectedAccountId(id); setMenuOpen(false)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }
  async function sync(id: string) {
    if (refreshing) return
    setRefreshing(id); setMutationError(null)
    try {
      await api.sync(id); setNotice('Account refreshed. Recent execution facts remain unassigned to plays.')
    } catch (cause) {
      setMutationError(cause instanceof ApiError ? cause.message : 'The venue refresh did not complete.')
    } finally { setRefreshing(null); reload() }
  }
  const portfolios = data?.portfolios ?? [], accounts = data?.accounts ?? []
  const enabledAccounts = accounts.filter(account => account.isEnabled !== false)
  const portfolioNames = Object.fromEntries(portfolios.map(p => [p.id, p.name]))
  const filteredAccounts = portfolioFilter ? accounts.filter(a => a.portfolioId === portfolioFilter) : accounts
  const selectedAccount = accounts.find(a => a.id === selectedAccountId)
  const currentPage = pages.find(p => p.id === page)!
  const created = () => { reload(); setNotice('Saved to your workspace.') }
  const managementChanged = (message: string) => {
    if (managedPortfolio && message.startsWith('Portfolio deleted') && portfolioFilter === managedPortfolio.id) setPortfolioFilter('')
    if (managedAccount && message.startsWith('Account and') && selectedAccountId === managedAccount.id) setSelectedAccountId(null)
    reload(); setNotice(message)
  }

  return <div className="journal-shell">
    {menuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside id="workspace-nav" className={`shell-sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation" role={menuOpen ? 'dialog' : undefined} aria-modal={menuOpen ? true : undefined}>
      <a className="shell-brand" href="#overview" onClick={() => navigate('overview')}><span className="shell-monogram">V</span><span>vessel<small>THE TRADING JOURNAL</small></span></a>
      <div className="nav-section-label">WORKSPACE</div>
      <nav>{pages.filter(p => p.id !== 'settings').map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} className={`shell-nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={18} /><span>{label}</span>{id === 'accounts' && accounts.length > 0 && <small>{accounts.length}</small>}</a>)}</nav>
      <div className="nav-section-label later-section">LATER</div>
      <div className="shell-nav-later" aria-disabled="true"><BookOpen size={18} /><span>Plays</span><small>Next</small></div>
      <div className="shell-nav-later" aria-disabled="true"><Folder size={18} /><span>Strategies</span></div>
      <div className="shell-sidebar-bottom">
        <div className="read-only-note"><ShieldCheck size={17} /><div><strong>Read-only by design</strong><span>Perpetuals first. No order placement.</span></div></div>
        <a href="#settings" className={`shell-nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18} />Settings</a>
        <button className="owner-card" onClick={disconnect} title="Disconnect this browser session"><span className="owner-avatar">{system.owner.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{system.owner.displayName}</strong><small>Private workspace</small></span><LogOut size={15} /></button>
      </div>
    </aside>
    <div className="shell-main" inert={menuOpen}>
      <header className="shell-header"><div><button id="workspace-menu" className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="workspace-nav" onClick={() => setMenuOpen(true)}><Menu size={19} /></button><span className="shell-breadcrumb">Workspace <span>/</span> <strong>{currentPage.label}</strong></span></div><div><span className="connection-indicator"><i />Private session</span><span className="workspace-badge">Perpetuals</span></div></header>
      <main className="shell-content">
        <section className="shell-page-heading"><div><div className="eyebrow">YOUR PRIVATE WORKSPACE</div><h1>{selectedAccount ? selectedAccount.name : currentPage.label}</h1><p>{currentPage.description}</p></div><div className="shell-heading-actions">
          {page !== 'settings' && <Button variant="outline" onClick={reload} disabled={pending}><RefreshCw size={14} />Reload</Button>}
          {page === 'portfolios' ? <Button onClick={() => setPortfolioDialog(true)}><Plus size={15} />New portfolio</Button> : page !== 'settings' && page !== 'activity' && <Button onClick={() => setAccountDialog(true)} disabled={pending || !data}><Plus size={15} />Add account</Button>}
        </div></section>
        {(error || mutationError) && <div className="workspace-alert" role="alert"><CircleHelp size={17} /><span>{mutationError ?? error}</span><Button variant="ghost" size="sm" onClick={error ? reload : () => setMutationError(null)}>{error ? 'Try again' : 'Dismiss'}</Button></div>}
        {pending && <div className="workspace-loading" role="status">Loading your workspace…</div>}
        {!pending && !data && !error && <div className="workspace-alert">No workspace data is available.</div>}

        {page === 'overview' && data && <>
          <section className="workspace-stat-grid">
            <div className="shell-panel metric">{enabledAccounts.some(a => a.venueId === 'hyperliquid') ?
              <><span>Available wallet stablecoins</span><strong>{money(data.totals.availableStablecoinNominalUsd ?? null)}</strong><small>{data.totals.stablecoinAccountCount ?? 0} observed enabled accounts · nominal only</small></> :
              <><span>Known nominal value</span><strong>{money(data.totals.totalAccountValueUsd)}</strong><small>{data.totals.valuedAccountCount} of {enabledAccounts.length} enabled accounts have a value · no FX adjustment</small></>}</div>
            <div className="shell-panel metric"><span>Enabled accounts</span><strong>{enabledAccounts.length}</strong><small>{accounts.length - enabledAccounts.length} disabled · {data.totals.portfolioCount} portfolios</small></div>
            <div className="shell-panel metric"><span>Perpetual positions</span><strong>{data.totals.openPositionCount}</strong><small>From latest retained snapshots</small></div>
            <div className="shell-panel metric"><span>Imported executions</span><strong>{data.totals.importedFillCount}</strong><small>Recorded facts, not inferred intent</small></div>
          </section>
          {!accounts.length ? <section className="shell-panel workspace-start"><span className="start-icon"><Folder size={26} /></span><div className="eyebrow">SET UP YOUR DIARY</div><h2>Start with your accounts.</h2><p>Create a portfolio, then add a read-only Hyperliquid account or a manual record. Your trades and decisions will have a place to belong.</p><div className="start-steps"><span><i>1</i>Create a portfolio</span><span><i>2</i>Add an account</span><span><i>3</i>Review recent executions</span></div><Button onClick={() => portfolios.length ? setAccountDialog(true) : setPortfolioDialog(true)}>{portfolios.length ? 'Add your first account' : 'Create your first portfolio'}<ArrowRight size={15} /></Button></section> :
            <section className="shell-panel"><header className="shell-panel-heading"><div><h2>Your enabled accounts</h2><p>Disabled records stay in account management; their imported activity is hidden.</p></div><button className="text-action" onClick={() => navigate('accounts')}>View all<ArrowRight size={14} /></button></header>{enabledAccounts.length ? <AccountRows accounts={enabledAccounts.slice(0, 4)} portfolioNames={portfolioNames} refreshing={refreshing} onDetail={viewAccount} onSync={id => { void sync(id) }} onManage={setManagedAccount} /> : <div className="workspace-empty small-empty"><strong>All accounts are disabled</strong><p>Open All accounts to enable a record again. Retained imports have not been deleted.</p><Button variant="outline" onClick={() => navigate('accounts')}>Manage accounts</Button></div>}</section>}
          <div className="overview-bottom-grid"><section className="shell-panel"><header className="shell-panel-heading"><div><h2>Recent activity</h2><p>Venue-reported executions</p></div><button className="text-action" onClick={() => navigate('activity')}>View activity<ArrowRight size={14} /></button></header><ActivityTable fills={data.recentActivity.slice(0, 5)} accounts={accounts} compact /></section><section className="shell-panel next-workflow"><div className="eyebrow">COMING NEXT</div><BookOpen size={27} /><h2>The Play workspace</h2><p>The approved layout stays separate while we build the account and history foundation. Imported fills will not create a thesis or be silently assigned to a play.</p><span className="workspace-badge">Not enabled yet</span></section></div>
          <p className="workspace-scope-note">{data.scopeNote}</p>
        </>}

        {page === 'portfolios' && data && <section className="workspace-page-content">
          {!portfolios.length ? <div className="shell-panel workspace-empty"><Folder size={30} /><strong>No portfolios yet</strong><p>Group accounts by purpose, such as swing or intraday trading.</p><Button onClick={() => setPortfolioDialog(true)}>Create a portfolio</Button></div> :
            <div className="portfolio-grid">{portfolios.map(p => <article className="shell-panel portfolio-tile" key={p.id}>
              <button className="portfolio-open" aria-label={`Open ${p.name}`} onClick={() => { setPortfolioFilter(p.id); navigate('accounts') }}><span className="portfolio-icon"><Folder size={21} /></span><h2>{p.name}</h2><p>{p.accountCount} {p.accountCount === 1 ? 'account record' : 'account records'}</p><strong>{money(p.totalValueUsd)}</strong><small>{p.valueCoverage === 'complete' ? 'All enabled account values recorded' : p.valueCoverage === 'partial' ? 'Partial value · some enabled accounts unavailable' : 'Enabled account values unavailable'}</small></button>
              <button className="icon-button portfolio-manage" aria-label={`Manage portfolio ${p.name}`} title="Rename or delete portfolio" onClick={() => setManagedPortfolio(p)}><Pencil size={14} /></button>
            </article>)}</div>}
        </section>}

        {page === 'accounts' && data && (selectedAccount ? <AccountDetail key={selectedAccount.id} account={selectedAccount} api={api} refreshing={refreshing === selectedAccount.id} reloadGeneration={reloadKey} onSync={id => { void sync(id) }} onManage={() => setManagedAccount(selectedAccount)} onBack={() => { setSelectedAccountId(null); window.scrollTo({ top: 0, left: 0, behavior: 'auto' }) }} /> :
          <section className="shell-panel"><header className="shell-panel-heading"><div><h2>Account records</h2><p>Automatic venues and manual accounts use the same portfolio context.</p></div><label className="account-filter"><span className="sr-only">Filter by portfolio</span><select aria-label="Filter by portfolio" value={portfolioFilter} onChange={event => setPortfolioFilter(event.target.value)}><option value="">All accounts</option>{portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></header>
            <p className="workspace-scope-note in-panel">Unassigned accounts appear only in All accounts. Disabled records are shown here so they can be enabled again; their imports and positions remain hidden.</p>
            {!filteredAccounts.length ? <div className="workspace-empty"><Wallet size={30} /><strong>No accounts in this view</strong><p>Add a Hyperliquid public address or a manual account. A portfolio is optional.</p><Button onClick={() => setAccountDialog(true)}>Add account</Button></div> : <AccountRows accounts={filteredAccounts} portfolioNames={portfolioNames} refreshing={refreshing} onDetail={viewAccount} onSync={id => { void sync(id) }} onManage={setManagedAccount} />}
          </section>)}

        {page === 'activity' && data && <section className="shell-panel"><header className="shell-panel-heading"><div><h2>Imported execution history</h2><p>Recent records only. Full-history backfills and retrospective review are later work.</p></div><span className="workspace-badge">Read-only facts</span></header><ActivityTable fills={data.recentActivity} accounts={accounts} /><p className="workspace-scope-note in-panel">Price touches are not fills. The same account and instrument can have multiple plays; these executions remain unassigned.</p></section>}

        {page === 'settings' && <div className="settings-grid">
          <section className="shell-panel settings-panel"><ShieldCheck size={23} /><h2>Private session</h2><p>Connected as {system.owner.displayName}. The token lives only in this browser session's memory and is released on disconnect.</p><dl><div><dt>Authentication</dt><dd>Bearer token</dd></div><div><dt>Market scope</dt><dd>Perpetuals only</dd></div><div><dt>Orders and signing</dt><dd>Not enabled</dd></div><div><dt>Theme</dt><dd>Graphite</dd></div></dl><Button variant="outline" onClick={disconnect}><LogOut size={15} />Disconnect session</Button></section>
          <section className="shell-panel settings-panel"><Database size={23} /><h2>Venue capabilities</h2><p>Only Hyperliquid and manual accounts can be added in this step. A refresh is explicitly requested, not a background job.</p><div className="venue-capability-list">{system.venues.map(v => <div key={v.id}><span>{v.name}</span><span className="workspace-badge">{v.status}</span></div>)}</div><p className="field-help">No venue credential, private key, full-history promise or automatic Play matching is involved.</p></section>
        </div>}

        <footer className="shell-footer"><span>VESSEL / PRIVATE TRADING DIARY</span><span>{enabledAccounts.filter(a => a.venueId === 'hyperliquid').length} enabled read-only account records · <span className="address-note">{selectedAccount ? shortAddress(selectedAccount.address) : 'No order execution'}</span></span></footer>
      </main>
    </div>
    <CreatePortfolioDialog open={portfolioDialog} onOpenChange={setPortfolioDialog} api={api} onCreated={created} />
    <CreateAccountDialog open={accountDialog} onOpenChange={setAccountDialog} api={api} portfolios={portfolios} onCreated={created} />
    {managedPortfolio && <ManagePortfolioDialog key={managedPortfolio.id} portfolio={managedPortfolio} api={api} onClose={() => setManagedPortfolio(null)} onChanged={managementChanged} />}
    {managedAccount && <ManageAccountDialog key={managedAccount.id} account={managedAccount} portfolios={portfolios} api={api} onClose={() => setManagedAccount(null)} onChanged={managementChanged} />}
    {notice && <div className="workspace-toast" role="status"><Check size={16} />{notice}<button aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={14} /></button></div>}
  </div>
}
