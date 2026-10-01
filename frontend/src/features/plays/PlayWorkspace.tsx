import { useEffect, useState } from 'react'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { Info, PencilLine, RefreshCw } from 'lucide-react'
import { venueName } from '@/features/workspace/format'
import type { PlayDraft } from './draft'
import { DirectionToggle } from './DirectionToggle'
import { InstrumentPicker } from './InstrumentPicker'
import { PositionEditor } from './PositionEditor'
import { ChartPanel } from './PlayChart'
import { CapitalContext, PlayJournal, PositionSummary } from './WorkspacePanels'
import './plays-workspace.css'

export function PlayWorkspace({ accounts, portfolios, api, draft, onChange, onReload, loading = false }: {
  accounts: BrokerAccount[]
  portfolios: Portfolio[]
  api: WorkspaceApi
  draft: PlayDraft
  onChange: (draft: PlayDraft) => void
  onReload?: () => void
  loading?: boolean
}) {
  const [selectedId, setSelectedId] = useState(draft.entries[0]!.id)
  const [selectionRequest, setSelectionRequest] = useState(0)
  const [portfolioFilter, setPortfolioFilter] = useState('')
  const enabledAccounts = accounts.filter(account => account.isEnabled !== false)
  const account = enabledAccounts.find(account => account.id === draft.accountId)
  const accountId = account?.id ?? ''
  const matchesFilter = (account: BrokerAccount, filter: string) => !filter ||
    (filter === 'unassigned' ? account.portfolioId === null : account.portfolioId === filter)
  const filterExists = portfolioFilter === 'unassigned' ? enabledAccounts.some(account => account.portfolioId === null) :
    portfolios.some(portfolio => portfolio.id === portfolioFilter)
  const effectiveFilter = filterExists && (!account || matchesFilter(account, portfolioFilter)) ? portfolioFilter : ''
  if (portfolioFilter !== effectiveFilter) setPortfolioFilter(effectiveFilter)
  const filteredAccounts = enabledAccounts.filter(account => matchesFilter(account, effectiveFilter))

  // A reload can disable or delete the chosen account. Clear it like an account change so a
  // venue contract is never shown as a manual label. Loading keeps the last known list.
  const accountGone = draft.accountId !== '' && !loading && !account
  useEffect(() => {
    if (accountGone) onChange({ ...draft, accountId: '', instrument: '', instrumentSource: 'manual', budgetOverride: null })
  }, [accountGone, draft, onChange])

  function chooseAccount(id: string) {
    const next = enabledAccounts.find(account => account.id === id)
    onChange({ ...draft, accountId: id, instrument: '',
      instrumentSource: next?.venueId === 'hyperliquid' ? 'venue' : 'manual', budgetOverride: null })
  }

  return <section className="plays-page" aria-label="Play draft workspace">
    <h1 className="sr-only">Plays</h1>
    <div className="plays-draft-heading">
      <div className="page-heading-copy"><span className="eyebrow">A LITTLE INTENTION BEFORE THE TRADE</span>
        <input className="plays-title-input" aria-label="Play title" value={draft.title} maxLength={200}
          placeholder="Name this play" onChange={event => onChange({ ...draft, title: event.target.value })} />
        <p>A place for the setup, the decisions, and what you learn.</p>
      </div>
      <div className="plays-heading-actions"><span className="workspace-badge"><PencilLine size={13} />Local draft</span>
        {onReload && <Button variant="outline" onClick={onReload} disabled={loading} aria-busy={loading}>
          <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />Reload accounts
        </Button>}
      </div>
    </div>
    <p className="plays-draft-notice" role="status"><Info size={14} aria-hidden="true" /><span>Unsaved draft. Edits stay in this session while you navigate. Reloading the page or disconnecting discards them. Draft edits are not sent to a venue.</span></p>
    <div className="plays-draft-fields">
      <label className="plays-portfolio-field">Portfolio<select value={effectiveFilter} onChange={event => {
        const next = event.target.value
        setPortfolioFilter(next)
        if (account && next && (next === 'unassigned' ? account.portfolioId !== null : account.portfolioId !== next)) chooseAccount('')
      }}>
        <option value="">All accounts</option>
        {portfolios.map(portfolio => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}
        {enabledAccounts.some(account => account.portfolioId === null) && <option value="unassigned">Unassigned accounts</option>}
      </select></label>
      <label>Account<select value={accountId} disabled={loading && !accounts.length} onChange={event => chooseAccount(event.target.value)}>
        <option value="">Choose an account</option>
        {filteredAccounts.map(account => <option key={account.id} value={account.id}>{account.name} · {venueName(account.venueId)}</option>)}
      </select></label>
      <InstrumentPicker key={accountId} account={account} api={api} value={draft.instrument} source={draft.instrumentSource}
        onChange={(instrument, instrumentSource) => onChange({ ...draft, instrument, instrumentSource })} />
      <div className="direction-field"><span className="field-label">Direction</span>
        <DirectionToggle value={draft.direction} onChange={direction => onChange({ ...draft, direction })} />
      </div>
      <div className="plays-context-status"><span className="field-label">Status</span><span className="badge">Draft</span></div>
    </div>
    <p className="plays-context-note">{!loading && !enabledAccounts.length ? 'No enabled accounts are available. You can outline a draft before adding an account. ' : ''}Perpetuals only. Planned levels are not fills. Position validation and execution assignment are deferred.</p>
    <CapitalContext accounts={enabledAccounts} portfolios={portfolios} draft={{ ...draft, accountId }} />
    <div className="workspace-toolbar"><span><i />THE PLAY <small>Your idea, before hindsight.</small></span><span>Side-by-side · Layout locked</span></div>
    <div className="workspace" data-testid="workspace">
      <div className="left-column" data-testid="left-column">
        <ChartPanel entries={draft.entries} selectedId={selectedId} onSelect={id => {
          setSelectedId(id)
          setSelectionRequest(current => current + 1)
        }} instrument={draft.instrument} venue={account ? venueName(account.venueId) : null} direction={draft.direction}
        source={account?.venueId === 'hyperliquid' && draft.instrumentSource === 'venue' ? { api, accountId: account.id } : null}
        onEntriesChange={entries => onChange({ ...draft, entries })} />
        <PlayJournal notes={draft.notes} onChange={notes => onChange({ ...draft, notes })} />
      </div>
      <PositionEditor draft={draft} onChange={onChange} selectedId={selectedId} selectionRequest={selectionRequest} onSelect={setSelectedId} />
    </div>
    <PositionSummary draft={draft} />
  </section>
}
