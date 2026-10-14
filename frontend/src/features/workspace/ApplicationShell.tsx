import { createRef, useCallback, useEffect, useRef, useState } from 'react'
import { Tooltip } from 'radix-ui'
import type { BrokerAccount, Overview, WorkspaceApi } from '@/api/workspace'
import { errorMessage } from '@/api/errors'
import type { SystemInfo } from '@/api/system'
import { Button } from '@/components/ui/button'
import { NotificationProvider } from '@/components/notifications/NotificationProvider'
import { useNotifications } from '@/components/notifications/notifications'
import { PlaysPage } from '@/features/plays/PlaysPage'
import { createPlaysSession, startNewPlay } from '@/features/plays/saved'
import { AccountDetail } from './AccountDetail'
import { ActivityOperations } from './ActivityOperations'
import { CreateAccountDialog, CreatePortfolioDialog } from './CreateDialogs'
import { ManageAccountDialog, ManagePortfolioDialog } from './ManageDialogs'
import { PortfolioIcon } from './PortfolioIcon'
import type { OverviewQuery } from '@/api/overview-summary'
import { OverviewScope } from './OverviewScope'
import { overviewAccounts, resolveOverviewScope } from './overview-scope'
import { OverviewSummary } from './OverviewSummary'
import { OverviewPlays } from './OverviewPlays'
import { ReviewPage } from '@/features/review/ReviewPage'
import { AppearanceSettings, CurrentThemeName } from '@/features/settings/AppearanceSettings'
import { showAppearanceSection } from '@/features/settings/appearance'
import { money } from '@/lib/format'
import { AccountRows } from './AccountRows'
import { AccountsPanel } from './AccountsPanel'
import { emptyAccountFilters } from './account-filters'
import { emptyFilters } from './activity-filters'
import { OverviewActions } from './OverviewActions'
import { VenuesProvider, useVenues } from '@/api/venues'
import {
  Activity, ArrowRight, BarChart3, CircleHelp, Database, Folder, LayoutDashboard,
  LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Settings2, ShieldCheck, Wallet, BookOpen, Pencil, X,
} from 'lucide-react'
import './application-shell.css'

const pages = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'Your accounts and recent execution history, in one place.' },
  { id: 'plays', label: 'Plays', icon: BookOpen, description: 'Document the idea, define the position and keep your reasoning separate from execution.' },
  { id: 'review', label: 'Review', icon: BarChart3, description: 'Portfolio performance from closed Plays.' },
  { id: 'portfolios', label: 'Portfolios', icon: Folder, description: 'Group accounts around the way you trade.' },
  { id: 'accounts', label: 'Accounts', icon: Wallet, description: 'Read-only venue connections and manual account records.' },
  { id: 'activity', label: 'Activity', icon: Activity, description: 'Imported executions, separate from trading intent.' },
  { id: 'settings', label: 'Settings', icon: Settings2, description: 'Appearance, your self-hosted workspace and available capabilities.' },
] as const
type Page = typeof pages[number]['id']
const pageFromHash = (): Page => pages.find(p => p.id === window.location.hash.slice(1))?.id ?? 'overview'


type ShellProps = { system: SystemInfo; disconnect: () => void; api: WorkspaceApi }

export function ApplicationShell(props: ShellProps) {
  return <Tooltip.Provider delayDuration={250} skipDelayDuration={400}><NotificationProvider><VenuesProvider venues={props.system.venues}><Shell {...props} /></VenuesProvider></NotificationProvider></Tooltip.Provider>
}

function Shell({ system, disconnect, api }: ShellProps) {
  const { notify } = useNotifications()
  const venues = useVenues()
  const [page, setPage] = useState<Page>(pageFromHash)
  const [playsSession, setPlaysSession] = useState(createPlaysSession)
  const [playsLifetime, setPlaysLifetime] = useState(() => ({ api, visited: page === 'plays', generation: 0, work: createRef<symbol>() }))
  // Shell navigation hides the Plays UI without destroying the owner of an in-flight mutation.
  // A new API identity starts a new private session and invalidates all old callbacks.
  if (playsLifetime.api !== api) {
    setPlaysLifetime({ api, visited: page === 'plays', generation: playsLifetime.generation + 1, work: createRef<symbol>() })
    setPlaysSession(createPlaysSession())
  } else if (page === 'plays' && !playsLifetime.visited) {
    setPlaysLifetime({ ...playsLifetime, visited: true })
  }
  const [requestedPlay, setRequestedPlay] = useState<{ api: WorkspaceApi; id: string } | null>(null)
  const [disconnectedApi, setDisconnectedApi] = useState<WorkspaceApi | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [navigationCollapsed, setNavigationCollapsed] = useState(false)
  const [data, setData] = useState<Overview | null>(null)
  const [loaded, setLoaded] = useState<{ api: WorkspaceApi; key: number } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const refreshSession = useRef<{ api: WorkspaceApi; controller: AbortController; busy: boolean } | null>(null)
  const [refreshState, setRefreshState] = useState<{
    api: WorkspaceApi; accountId: string; progress: { current: number; total: number } | null
  } | null>(null)
  const refreshing = refreshState?.api === api ? refreshState.accountId : null
  const refreshProgress = refreshState?.api === api ? refreshState.progress : null
  useEffect(() => {
    const controller = new AbortController()
    refreshSession.current = { api, controller, busy: false }
    return () => controller.abort()
  }, [api])
  const disconnectSession = () => { refreshSession.current?.controller.abort(); setDisconnectedApi(api); setRequestedPlay(null); setPlaysSession(createPlaysSession()); disconnect() }
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [portfolioFilter, setPortfolioFilter] = useState('')
  const [accountFilters, setAccountFilters] = useState(emptyAccountFilters)
  const [overviewQuery, setOverviewQuery] = useState<OverviewQuery>({ groupBy: 'portfolio', period: '30', scope: 'all' })
  const [activityFilters, setActivityFilters] = useState(emptyFilters)
  const [portfolioDialog, setPortfolioDialog] = useState(false)
  const [accountDialog, setAccountDialog] = useState(false)
  const [focusPortfolioAccounts, setFocusPortfolioAccounts] = useState(false)
  const [managedPortfolioId, setManagedPortfolioId] = useState<string | null>(null)
  const [managedAccountId, setManagedAccountId] = useState<string | null>(null)
  const setNotice = useCallback((message: string) => { notify({ tone: 'success', message }) }, [notify])
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(key => key + 1), [])
  // Derived from the request generation so Reload shows progress and a repeated
  // failure visibly clears and returns, without a synchronous effect render.
  const loading = loaded === null || loaded.api !== api || loaded.key !== reloadKey
  const pending = loading && data === null
  const error = loading ? null : loadError
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
    if (disconnectedApi === api) return
    const controller = new AbortController()
    let active = true
    api.overview(controller.signal).then(next => { if (active) { setData(next); setOverviewQuery(query => { const scope = resolveOverviewScope(query.scope, next.accounts, next.portfolios); return scope === query.scope ? query : { ...query, scope } }); setLoadError(null); setLoaded({ api, key: reloadKey }) } })
      .catch(cause => { if (active) { setLoadError(errorMessage(cause, 'The workspace could not be loaded.')); setLoaded({ api, key: reloadKey }) } })
    return () => { active = false; controller.abort() }
  }, [api, reloadKey, disconnectedApi])
  useEffect(() => {
    if (!menuOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
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
      document.body.style.overflow = previousOverflow
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
  function browsePlays() {
    setPlaysSession(session => ({ ...session, view: 'list' }))
    navigate('plays')
  }
  async function viewPlay(id: string, signal: AbortSignal) {
    if (signal.aborted) return
    // PlaysPage owns draft protection and loading. Navigation must not replace the editor session.
    setRequestedPlay({ api, id })
    navigate('plays')
  }
  async function sync(id: string) {
    const session = refreshSession.current
    if (!session || session.api !== api) return
    const { signal } = session.controller
    if (session.busy || signal.aborted) return
    session.busy = true
    setRefreshState({ api, accountId: id, progress: null })
    try {
      await api.sync(id, signal)
      if (!signal.aborted) setNotice('Account refreshed. Recent execution facts remain unassigned to plays.')
    } catch (cause) {
      if (!signal.aborted) notify({ tone: 'error', key: 'account-refresh', message: errorMessage(cause, 'The venue refresh did not complete.') })
    } finally {
      session.busy = false
      if (!signal.aborted) { setRefreshState(null); reload() }
    }
  }
  const portfolios = data?.portfolios ?? [], accounts = data?.accounts ?? []
  const enabledAccounts = accounts.filter(account => account.isEnabled !== false)
  const portfolioNames = Object.fromEntries(portfolios.map(p => [p.id, p.name]))
  const activePortfolioFilter = portfolioFilter === 'unassigned' || portfolios.some(p => p.id === portfolioFilter) ? portfolioFilter : ''
  const managedPortfolio = portfolios.find(p => p.id === managedPortfolioId) ?? null
  const managedAccount = accounts.find(a => a.id === managedAccountId) ?? null
  const manageAccount = (account: BrokerAccount) => setManagedAccountId(account.id)
  const refreshable = enabledAccounts.filter(account => venues.can(account.venueId, 'sync'))
  const selectedAccount = accounts.find(a => a.id === selectedAccountId)
  const currentPage = pages.find(p => p.id === page)!
  const created = () => { reload(); setNotice('Saved to your workspace.') }
  const managementChanged = (message: string) => {
    if (managedPortfolio && message.startsWith('Portfolio deleted') && portfolioFilter === managedPortfolio.id) setPortfolioFilter('')
    if (managedAccount && message.startsWith('Account and') && selectedAccountId === managedAccount.id) setSelectedAccountId(null)
    reload(); setNotice(message)
  }

  function newPlay() {
    // Read the owner's guard, not render-time busy/dirty state: either may still be stale.
    if (playsLifetime.work.current) {
      notify({ tone: 'info', message: 'A Play change is still pending. Your current work is kept until it finishes.' })
      navigate('plays')
      return
    }
    const next = startNewPlay(playsSession)
    if (next.draft === playsSession.draft)
      notify({ tone: 'info', message: 'Your unsaved changes are still open. Save or discard them before starting a new play.' })
    setPlaysSession(next)
    navigate('plays')
  }
  async function refreshAll() {
    const session = refreshSession.current
    if (!session || session.api !== api) return
    const { signal } = session.controller
    if (session.busy || signal.aborted || !refreshable.length) return
    session.busy = true
    const failures: string[] = []
    try {
      for (const [index, account] of refreshable.entries()) {
        if (signal.aborted) return
        setRefreshState({ api, accountId: account.id, progress: { current: index + 1, total: refreshable.length } })
        try { await api.sync(account.id, signal) }
        catch { failures.push(account.name) }
      }
      if (!signal.aborted) notify({ tone: failures.length ? 'error' : 'success', key: 'account-refresh',
        message: `${refreshable.length - failures.length} of ${refreshable.length} accounts refreshed.${failures.length ? ` Failed: ${failures.join(', ')}.` : ''}` })
    } finally {
      session.busy = false
      if (!signal.aborted) { setRefreshState(null); reload() }
    }
  }
  const refreshAllAction = <Button variant="outline" size="sm" onClick={() => { void refreshAll() }}
    disabled={refreshing !== null || loading || !refreshable.length} aria-busy={refreshProgress !== null}>
    <RefreshCw size={14} className={refreshProgress ? 'is-spinning' : ''} />
    <span role={refreshProgress ? 'status' : undefined}>{refreshProgress ? `Refreshing ${refreshProgress.current} of ${refreshProgress.total}` : 'Refresh all'}</span>
  </Button>

  if (disconnectedApi === api) return null
  return <div className={`journal-shell ${navigationCollapsed ? 'navigation-collapsed' : ''}`}>
    <aside id="workspace-nav" className={`shell-sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation" role={menuOpen ? 'dialog' : undefined} aria-modal={menuOpen ? true : undefined}>
      <a className="shell-brand" href="#overview" aria-label="Vessel overview" title="Vessel overview" onClick={() => navigate('overview')}><span className="shell-monogram" aria-hidden="true">V</span><span className="sidebar-copy">vessel<small>THE TRADING JOURNAL</small></span></a>
      {menuOpen && <button type="button" className="icon-button sidebar-close" aria-label="Close navigation" title="Close navigation" onClick={() => setMenuOpen(false)}><X size={19} aria-hidden="true" /></button>}
      <button type="button" className="icon-button sidebar-toggle" aria-label={navigationCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={navigationCollapsed ? 'Expand navigation' : 'Collapse navigation'} aria-controls="workspace-nav" aria-expanded={!navigationCollapsed} onClick={() => setNavigationCollapsed(collapsed => !collapsed)}>
        {navigationCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
      </button>
      <div className="nav-section-label">WORKSPACE</div>
      <nav>{pages.filter(p => p.id !== 'settings').map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} className={`shell-nav-item ${page === id ? 'active' : ''}`} aria-label={label} title={label} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={18} aria-hidden="true" /><span className="sidebar-copy">{label}</span>{id === 'accounts' && accounts.length > 0 && <small>{accounts.length}</small>}</a>)}</nav>
      <div className="nav-section-label later-section">LATER</div>
      <div className="shell-nav-later" role="link" aria-label="Strategies" aria-disabled="true" title="Strategies are not available yet"><Folder size={18} aria-hidden="true" /><span className="sidebar-copy">Strategies</span></div>
      <div className="shell-sidebar-bottom">
        <a href="#settings" className={`shell-nav-item ${page === 'settings' ? 'active' : ''}`} aria-label="Settings" title="Settings" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><Settings2 size={18} aria-hidden="true" /><span className="sidebar-copy">Settings</span></a>
        <button className="owner-card" onClick={disconnectSession} aria-label={`Disconnect ${system.owner.displayName}'s session`} title={`Disconnect ${system.owner.displayName}'s browser session`}><span className="owner-avatar" aria-hidden="true">{system.owner.displayName.slice(0, 1).toUpperCase()}</span><span className="sidebar-copy"><strong>{system.owner.displayName}</strong><small>Private workspace</small></span><LogOut size={15} aria-hidden="true" /></button>
      </div>
    </aside>
    <div className="shell-main" inert={menuOpen}>
      <header className="shell-header"><button id="workspace-menu" className="icon-button mobile-menu" aria-label="Open navigation" title="Open navigation" aria-expanded={menuOpen} aria-controls="workspace-nav" onClick={() => setMenuOpen(true)}><Menu size={19} aria-hidden="true" /></button></header>
      <main className="shell-content">
        {page !== 'plays' && page !== 'review' && <section className="shell-page-heading"><div><div className="eyebrow">YOUR PRIVATE WORKSPACE</div><h1>{selectedAccount ? selectedAccount.name : currentPage.label}</h1><p>{currentPage.description}</p></div><div className="shell-heading-actions">
          {page !== 'settings' && <Button variant="outline" onClick={reload} disabled={loading || refreshing !== null} aria-busy={loading}><RefreshCw size={14} className={loading ? 'is-spinning' : ''} />Reload</Button>}
          {page === 'overview' ? <OverviewActions disabled={pending || !data} onNewPlay={newPlay} onPortfolio={() => setPortfolioDialog(true)} onAccount={() => setAccountDialog(true)} /> : page === 'portfolios' ? <Button onClick={() => setPortfolioDialog(true)}><Plus size={15} />New portfolio</Button> : page !== 'settings' && page !== 'activity' && <Button onClick={() => setAccountDialog(true)} disabled={pending || !data}><Plus size={15} />Add account</Button>}
        </div></section>}
        {error && <div className="workspace-alert" role="alert"><CircleHelp size={17} /><span>{error}</span><Button variant="ghost" size="sm" onClick={reload}>Try again</Button></div>}
        {pending && <div className="workspace-loading" role="status">Loading your workspace…</div>}
        {!pending && !data && !error && <div className="workspace-alert">No workspace data is available.</div>}

        {playsLifetime.visited && <PlaysPage key={playsLifetime.generation} workRef={playsLifetime.work} active={page === 'plays'} accounts={accounts} portfolios={portfolios} api={api} session={playsSession} onSession={setPlaysSession} onReload={reload} loading={loading} requestedPlayId={requestedPlay?.api === api ? requestedPlay.id : null} onRequestedPlayHandled={() => setRequestedPlay(null)} />}
        {page === 'review' && <ReviewPage api={api} reloadGeneration={reloadKey} onOpenPlay={viewPlay} />}

        {page === 'overview' && data && <>
          <OverviewScope scope={overviewQuery.scope} onScope={scope => setOverviewQuery(query => ({ ...query, scope }))} accounts={accounts} portfolios={portfolios} />
          <OverviewSummary api={api} query={overviewQuery} onQuery={setOverviewQuery} reloadGeneration={reloadKey} fallback={data} accountCount={overviewAccounts(overviewQuery.scope, accounts).length} />
          {!accounts.length ? <section className="shell-panel workspace-start"><span className="start-icon"><Wallet size={26} /></span><div className="eyebrow">SET UP YOUR DIARY</div><h2>Start with your accounts.</h2><p>Add a read-only exchange account or a manual record. Portfolios are optional groups you can create now or later.</p><div className="start-steps"><span><i>1</i>Add an account</span><span><i>2</i>Refresh venue facts when ready</span><span><i>3</i>Record or review a Play</span></div><Button onClick={() => setAccountDialog(true)}>Add your first account<ArrowRight size={15} /></Button><Button variant="ghost" onClick={() => setPortfolioDialog(true)}>Create an optional portfolio</Button></section> :
            <section className="shell-panel"><header className="shell-panel-heading"><div><h2>Your enabled accounts</h2><p>Disabled records stay in account management; their imported activity is hidden.</p></div><div className="panel-heading-actions">{refreshAllAction}<button className="text-action" onClick={() => navigate('accounts')}>View all<ArrowRight size={14} /></button></div></header>{enabledAccounts.length ? <AccountRows accounts={overviewAccounts(overviewQuery.scope, accounts).slice(0, 4)} portfolioNames={portfolioNames} refreshing={refreshing} onDetail={viewAccount} onSync={id => { void sync(id) }} onManage={manageAccount} /> : <div className="workspace-empty small-empty"><strong>All accounts are disabled</strong><p>Open All accounts to enable a record again. Retained imports have not been deleted.</p><Button variant="outline" onClick={() => navigate('accounts')}>Manage accounts</Button></div>}</section>}
          <div className="overview-bottom-grid"><section className="shell-panel"><header className="shell-panel-heading"><div><h2>Recent activity</h2><p>Aggregated position operations</p></div><button className="text-action" onClick={() => navigate('activity')}>View activity<ArrowRight size={14} /></button></header><ActivityOperations api={api} accounts={accounts} scopeAccountIds={overviewAccounts(overviewQuery.scope, accounts).map(a => a.id)} accountId={overviewQuery.scope.startsWith('account:') ? overviewQuery.scope.slice(8) : undefined} compact reloadGeneration={reloadKey} onOpenPlay={viewPlay} onCreated={reload} /></section><OverviewPlays api={api} accounts={accounts} scopeAccountIds={overviewAccounts(overviewQuery.scope, accounts).map(a => a.id)} reloadGeneration={reloadKey} onBrowse={browsePlays} onOpen={viewPlay} /></div>
          <p className="workspace-scope-note">{data.scopeNote} Balances describe account observations. Activity describes retained imported operations. Review scores eligible saved closed Plays, including manual facts; it is not an account-equity return.</p>
        </>}

        {page === 'portfolios' && data && <section className="workspace-page-content">
          {!portfolios.length ? <div className="shell-panel workspace-empty"><Folder size={30} /><strong>No portfolios yet</strong><p>Portfolios optionally group accounts by purpose. You can use accounts without one.</p>{!accounts.length && <Button onClick={() => setAccountDialog(true)}>Add your first account</Button>}<Button variant="outline" onClick={() => setPortfolioDialog(true)}>Create a portfolio</Button></div> :
            <div className="portfolio-grid">{portfolios.map(p => <article className="shell-panel portfolio-tile" key={p.id}>
              <button className="portfolio-open" aria-label={`Open ${p.name}`} onClick={() => { setPortfolioFilter(p.id); navigate('accounts') }}><span className="portfolio-icon"><PortfolioIcon icon={p.icon} /></span><h2>{p.name}</h2><p>{p.accountCount} {p.accountCount === 1 ? 'account record' : 'account records'}</p><strong>{money(p.balanceUsd === undefined ? p.totalValueUsd : p.balanceUsd)}</strong><small>{(p.balanceCoverage ?? p.valueCoverage) === 'complete' ? 'All enabled account balances recorded' : (p.balanceCoverage ?? p.valueCoverage) === 'partial' ? 'Partial balance · some enabled accounts unavailable' : 'Enabled account balances unavailable'}</small><small>Perps/manual value {money(p.totalValueUsd)}</small><small>Available balance {money(p.availableBalanceUsd ?? null)} · {p.availableBalanceAccountCount ?? 0} of {p.enabledAccountCount ?? 0} enabled · {p.availableBalanceCoverage ?? 'unavailable'}</small></button>
              <button className="icon-button portfolio-manage" aria-label={`Manage portfolio ${p.name}`} title="Rename, change icon, manage accounts or delete portfolio" onClick={() => { setFocusPortfolioAccounts(false); setManagedPortfolioId(p.id) }}><Pencil size={14} /></button>
              <Button variant="outline" size="sm" aria-label={`Add accounts to ${p.name}`} onClick={() => { setFocusPortfolioAccounts(true); setManagedPortfolioId(p.id) }}>Add accounts</Button>
            </article>)}</div>}
        </section>}

        {page === 'accounts' && data && (selectedAccount ? <AccountDetail key={selectedAccount.id} account={selectedAccount} api={api} refreshing={refreshing === selectedAccount.id} busy={refreshing !== null} reloadGeneration={reloadKey} onOpenPlay={viewPlay} onCreated={reload} onSync={id => { void sync(id) }} onManage={() => manageAccount(selectedAccount)} onBack={() => { setSelectedAccountId(null); window.scrollTo({ top: 0, left: 0, behavior: 'auto' }) }} /> :
          <AccountsPanel api={api} onChanged={managementChanged} onReload={reload} filters={accountFilters} onFiltersChange={setAccountFilters} accounts={accounts} portfolios={portfolios} portfolioFilter={activePortfolioFilter} onPortfolioFilter={setPortfolioFilter}
            refreshing={refreshing} refreshAction={refreshAllAction} onDetail={viewAccount} onSync={id => { void sync(id) }} onManage={manageAccount} onAdd={() => setAccountDialog(true)} />)}


        {page === 'activity' && data && <section className="shell-panel"><header className="shell-panel-heading"><div><h2>Position operations</h2><p>Retained fills grouped into position round trips, separate from trading intent.</p></div><span className="workspace-badge">Read-only facts</span></header><ActivityOperations api={api} accounts={accounts} portfolios={portfolios} filters filterValues={activityFilters} onFiltersChange={setActivityFilters} reloadGeneration={reloadKey} onOpenPlay={viewPlay} onCreated={reload} /></section>}

        {page === 'settings' && <div className="settings-grid">
          <AppearanceSettings />
          <section className="shell-panel settings-panel"><ShieldCheck size={23} /><h2>Private session</h2><p>Connected as {system.owner.displayName}. The token lives only in this browser session's memory and is released on disconnect.</p><dl><div><dt>Authentication</dt><dd>Bearer token</dd></div><div><dt>Market scope</dt><dd>Perpetuals only</dd></div><div><dt>Orders and signing</dt><dd>Not enabled</dd></div><div><dt>Theme</dt><dd className="settings-theme"><CurrentThemeName /><Button variant="outline" size="sm" onClick={() => showAppearanceSection('theme-customizer')}>Customize</Button></dd></div></dl><Button variant="outline" onClick={disconnectSession}><LogOut size={15} />Disconnect session</Button></section>
          <section className="shell-panel settings-panel"><Database size={23} /><h2>Venue capabilities</h2><p>Accounts can be added at {venues.creatable().map(v => v.name).join(', ')}. A refresh is explicitly requested, not a background job.</p><div className="venue-capability-list">{system.venues.map(v => <div key={v.id}><span>{v.name}</span><span className="workspace-badge">import {v.capabilities.sync ? 'available' : 'unavailable'} · orders {v.capabilities.orders ? 'read-only' : 'unavailable'}</span></div>)}</div><p className="field-help">Some venues require a verified read-only token for order reads. Manage it on the account. No trading keys or orders are sent; retained imports are not complete lifetime history.</p><Button variant="outline" onClick={() => navigate('accounts')}>Manage account access and refresh</Button></section>
        </div>}

      </main>
    </div>
    <CreatePortfolioDialog open={portfolioDialog} onOpenChange={setPortfolioDialog} api={api} accounts={accounts} portfolios={portfolios} onCreated={created} />
    <CreateAccountDialog open={accountDialog} onOpenChange={setAccountDialog} api={api} portfolios={portfolios} accounts={accounts} onCreated={reload} />
    {managedPortfolio && <ManagePortfolioDialog key={managedPortfolio.id} portfolio={managedPortfolio} accounts={accounts} portfolios={portfolios} focusAccounts={focusPortfolioAccounts} onStale={reload} api={api} onClose={() => setManagedPortfolioId(null)} onChanged={managementChanged} />}
    {managedAccount && <ManageAccountDialog key={managedAccount.id} account={managedAccount} portfolios={portfolios} api={api} onClose={() => setManagedAccountId(null)} onChanged={managementChanged} onStale={reload} />}
  </div>
}
