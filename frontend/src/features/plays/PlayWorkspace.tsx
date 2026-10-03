import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { ExternalLink, Info, PencilLine, RefreshCw } from 'lucide-react'
import { statusLabels, venueTradeUrl, type PlayStatus } from '@/api/plays'
import { Input } from '@/components/ui/input'
import { venueName } from '@/features/workspace/format'
import type { DraftEvidence, PlayDraft } from './draft'
import { captureFileName, createEvidence, evidenceLimits } from './evidence'
import { DirectionToggle } from './DirectionToggle'
import { InstrumentPicker } from './InstrumentPicker'
import { PositionEditor } from './PositionEditor'
import { ChartPanel } from './PlayChart'
import { CapitalContext, PlayJournal, PositionSummary } from './WorkspacePanels'
import './plays-workspace.css'

export function PlayWorkspace({ accounts, portfolios, api, draft, onChange, onReload, loading = false, status = 'draft', actions, notice,
  lockInstrument = false, readOnly = false }: {
  accounts: BrokerAccount[]
  portfolios: Portfolio[]
  api: WorkspaceApi
  draft: PlayDraft
  onChange: (draft: PlayDraft) => void
  onReload?: () => void
  loading?: boolean
  status?: PlayStatus
  /** Save and lifecycle controls; without them the page is an unsaved local draft. */
  actions?: ReactNode
  notice?: ReactNode
  /** Account and instrument are fixed once a Play is planned. */
  lockInstrument?: boolean
  /** Closed and cancelled Plays keep their plan; only the review and evidence change. */
  readOnly?: boolean
}) {
  const [selectedId, setSelectedId] = useState(draft.entries[0]!.id)
  const [selectionRequest, setSelectionRequest] = useState(0)
  const [portfolioFilter, setPortfolioFilter] = useState('')
  const [evidenceRequest, setEvidenceRequest] = useState(0)
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
  const accountGone = draft.accountId !== '' && !loading && !account && !lockInstrument
  useEffect(() => {
    if (accountGone) onChange({ ...draft, accountId: '', instrument: '', instrumentSource: 'manual', budgetOverride: null })
  }, [accountGone, draft, onChange])

  // Drawings follow the venue instrument, so switching away and back keeps them.
  const drawingKey = account && draft.instrument && draft.instrumentSource === 'venue' ? `${account.venueId}:${draft.instrument}` : ''

  const tradeUrl = account ? venueTradeUrl(account.venueId, draft.instrument, draft.instrumentSource) : null
  // In a read-only Play, the chart can still be viewed but not edited.
  const planChange = readOnly ? () => {} : onChange

  // Captures and uploads finish asynchronously, so they apply to the latest draft, not the one from the click.
  const latest = useRef({ draft, onChange })
  useEffect(() => { latest.current = { draft, onChange } })
  const updateEvidence = (update: (evidence: DraftEvidence[]) => DraftEvidence[]) => {
    const { draft: current, onChange: change } = latest.current
    change({ ...current, evidence: update(current.evidence) })
  }
  function addCapture(image: Blob, context: string) {
    if (latest.current.draft.evidence.length >= evidenceLimits.maxItems) return `A play can hold at most ${evidenceLimits.maxItems} images.`
    if (image.size > evidenceLimits.maxBytes) return `The capture is larger than ${evidenceLimits.maxBytes / 1024 / 1024} MB.`
    const now = new Date()
    updateEvidence(evidence => [...evidence, createEvidence('capture', image, captureFileName(now), context, now)])
    setEvidenceRequest(current => current + 1)
    return null
  }

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
          placeholder="Name this play" disabled={readOnly} onChange={event => onChange({ ...draft, title: event.target.value })} />
        <p>A place for the setup, the decisions, and what you learn.</p>
      </div>
      <div className="plays-heading-actions">
        {tradeUrl && <a className="plays-venue-link" href={tradeUrl} target="_blank" rel="noopener noreferrer"
          title="Place the planned orders on the venue. Vessel never sends orders.">
          <ExternalLink size={14} aria-hidden="true" />Open {draft.instrument} on {venueName(account!.venueId)}</a>}
        {actions ?? <span className="workspace-badge"><PencilLine size={13} />Local draft</span>}
        {onReload && <Button variant="outline" onClick={onReload} disabled={loading} aria-busy={loading}>
          <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />Reload accounts
        </Button>}
      </div>
    </div>
    <p className="plays-draft-notice" role="status"><Info size={14} aria-hidden="true" /><span>{notice ?? 'Unsaved draft. Edits, captures and images stay in this browser session while you navigate. Reloading the page or disconnecting discards them. Draft edits are not sent to a venue.'}</span></p>
    <fieldset className="plays-draft-fields" disabled={readOnly}>
      <legend className="sr-only">Play context</legend>
      <label className="plays-portfolio-field">Portfolio<select value={effectiveFilter} disabled={lockInstrument} onChange={event => {
        const next = event.target.value
        setPortfolioFilter(next)
        if (account && next && (next === 'unassigned' ? account.portfolioId !== null : account.portfolioId !== next)) chooseAccount('')
      }}>
        <option value="">All accounts</option>
        {portfolios.map(portfolio => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}
        {enabledAccounts.some(account => account.portfolioId === null) && <option value="unassigned">Unassigned accounts</option>}
      </select></label>
      <label>Account<select value={lockInstrument ? draft.accountId : accountId} disabled={lockInstrument || (loading && !accounts.length)} onChange={event => chooseAccount(event.target.value)}>
        <option value="">Choose an account</option>
        {lockInstrument && !account && <option value={draft.accountId}>Unavailable or disabled account</option>}
        {filteredAccounts.map(account => <option key={account.id} value={account.id}>{account.name} · {venueName(account.venueId)}</option>)}
      </select></label>
      {lockInstrument ? <div className="plays-instrument-field"><label htmlFor="plays-fixed-instrument">Instrument</label>
        <Input id="plays-fixed-instrument" aria-label="Perpetual instrument" value={draft.instrument} readOnly />
        <div className="instrument-feedback"><p>Fixed once planned.</p></div>
      </div> : <InstrumentPicker key={accountId} account={account} api={api} value={draft.instrument} source={draft.instrumentSource}
        onChange={(instrument, instrumentSource) => onChange({ ...draft, instrument, instrumentSource })} />}
      <div className="direction-field"><span className="field-label">Direction</span>
        <DirectionToggle value={draft.direction} onChange={direction => onChange({ ...draft, direction })} />
      </div>
      <div className="plays-context-status"><span className="field-label">Status</span><span className={`badge play-status-${status}`}>{statusLabels[status]}</span></div>
    </fieldset>
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
        onEntriesChange={entries => planChange({ ...draft, entries })}
        drawings={drawingKey ? draft.drawings[drawingKey] : undefined}
        onDrawingsChange={drawings => { if (drawingKey) planChange({ ...draft, drawings: { ...draft.drawings, [drawingKey]: drawings } }) }}
        onCapture={addCapture} />
        <PlayJournal notes={draft.notes} onChange={notes => onChange({ ...draft, notes: readOnly ? { ...draft.notes, review: notes.review } : notes })}
          readOnly={readOnly} notesLabel={status === 'draft' ? 'Draft notes' : 'Saved with the play'}
          evidence={draft.evidence} onEvidenceChange={updateEvidence} evidenceRequest={evidenceRequest} />
      </div>
      {readOnly ? <fieldset className="plays-readonly-position" disabled><legend className="sr-only">Position (read-only)</legend>
        <PositionEditor draft={draft} onChange={planChange} selectedId={selectedId} selectionRequest={selectionRequest} onSelect={setSelectedId} />
      </fieldset> : <PositionEditor draft={draft} onChange={onChange} selectedId={selectedId} selectionRequest={selectionRequest} onSelect={setSelectedId} />}
    </div>
    <PositionSummary draft={draft} />
  </section>
}
