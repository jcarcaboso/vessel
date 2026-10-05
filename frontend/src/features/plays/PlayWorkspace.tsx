import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import type { SizingDocument } from '@/api/sizing'
import { ExternalLink, Info, PencilLine, RefreshCw } from 'lucide-react'
import { statusLabels, type PlayStatus } from '@/api/plays'
import { useVenues } from '@/api/venues'
import { Input } from '@/components/ui/input'
import type { DraftEvidence, PlayDraft } from './draft'
import { captureFileName, createEvidence, evidenceLimits } from './evidence'
import { DirectionToggle } from './DirectionToggle'
import { InstrumentPicker } from './InstrumentPicker'
import { pairLabel, useInstrumentCatalog } from './instruments'
import { keepPercentLevelPrices, leverageOf, percentLevels } from './levels'
import { LeverageChangeDialog } from './LeverageChangeDialog'
import { defaultSizeUnits, estimatedLiquidation, playBudget, type SizeUnits } from './sizing'
import { planSuggestions } from './suggestions'
import { SuggestionsPanel } from './Suggestions'
import { PlanNotices } from './PlanNotices'
import { PositionEditor, defaultMaxLeverage, type SuggestionMarks } from './PositionEditor'
import { ChartPanel } from './PlayChart'
import { CapitalContext, PlayJournal, PositionSummary } from './WorkspacePanels'
import './plays-workspace.css'

export function PlayWorkspace({ accounts, portfolios, api, draft, onChange, onReload, loading = false, status = 'draft', actions, notice,
  lockInstrument = false, readOnly = false, execution, sizing = null, onRiskChange }: {
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
  /** Execution tab content for a saved play. */
  execution?: ReactNode
  /** Risk settings and record for sizing suggestions, which only apply to editable plays. */
  sizing?: SizingDocument | null
  onRiskChange?: (riskPercent: string) => Promise<void>
}) {
  const fieldId = useId()
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

  const venues = useVenues()
  const catalog = useInstrumentCatalog(api, account)
  const instrumentInfo = draft.instrumentSource === 'venue' ? catalog.catalog?.instruments.find(item => item.contractId === draft.instrument) : undefined
  const instrumentName = instrumentInfo ? pairLabel(instrumentInfo) : draft.instrument
  const maxLeverage = instrumentInfo?.maxLeverage ?? null
  const units: SizeUnits = instrumentInfo
    ? { quote: instrumentInfo.quoteAsset, base: instrumentInfo.contractId, quantityDecimals: instrumentInfo.quantityDecimals }
    : defaultSizeUnits

  const tradeUrl = account ? venues.tradeUrl(account.venueId, draft.instrument, draft.instrumentSource) : null
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

  const leftColumn = useRef<HTMLDivElement>(null)
  // Runs after the expanded chart closes, so the journal is in the page again.
  const showEvidence = () => requestAnimationFrame(() =>
    leftColumn.current?.querySelector('[data-testid="journal-panel"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

  // Suggestions sit in their own panel above the workspace; the fields only carry a marker.
  const leverage = leverageOf(draft.leverage)
  // An accepted leverage applies like a preset: with percent levels it first asks how they follow.
  const [pendingLeverage, setPendingLeverage] = useState<number | null>(null)
  function acceptLeverage(next: number) {
    if (percentLevels(draft.entries).length) setPendingLeverage(next)
    else onChange({ ...draft, leverage: String(next) })
  }
  function finishLeverage(keep?: 'prices' | 'percentages') {
    if (keep && pendingLeverage !== null) onChange({ ...draft, leverage: String(pendingLeverage),
      entries: keep === 'prices' ? keepPercentLevelPrices(draft.entries, leverage, pendingLeverage) : draft.entries })
    setPendingLeverage(null)
  }
  const balance = account?.balanceUsd != null && Number(account.balanceUsd) > 0 ? Number(account.balanceUsd) : null
  const available = account?.availableStablecoinNominalUsd ?? null
  const suggestions = sizing && !readOnly ? planSuggestions({ draft, leverage, maxLeverage, sizing, units, balance,
    budget: status === 'draft' ? playBudget(draft, available)?.amount ?? null : null, defaultMaximum: defaultMaxLeverage }) : null
  const marks: SuggestionMarks | null = suggestions ? {
    size: !!suggestions.size, leverage: !!suggestions.leverage,
    levels: new Set([...suggestions.stops, ...suggestions.targets].map(level => level.levelId)),
  } : null
  function acceptLevel(entryId: string, kind: 'stop' | 'target', levelId: string, value: string) {
    onChange({ ...draft, entries: draft.entries.map(entry => entry.id !== entryId ? entry : kind === 'stop'
      ? { ...entry, stops: entry.stops.map(stop => stop.id === levelId ? { ...stop, value } : stop) }
      : { ...entry, targets: entry.targets.map(target => target.id === levelId ? { ...target, value } : target) }) })
  }

  function chooseAccount(id: string) {
    const next = enabledAccounts.find(account => account.id === id)
    onChange({ ...draft, accountId: id, instrument: '',
      instrumentSource: next && venues.can(next.venueId, 'instruments') ? 'venue' : 'manual', budgetOverride: null })
  }

  return <section className="plays-page" aria-label="Play draft workspace">
    <h1 className="sr-only">Plays</h1>
    <div className="plays-draft-heading">
      <div className="page-heading-copy">
        <input className="plays-title-input" aria-label="Play title" value={draft.title} maxLength={200}
          placeholder="Name this play" disabled={readOnly} onChange={event => onChange({ ...draft, title: event.target.value })} />
      </div>
      <div className="plays-heading-actions">
        {tradeUrl && <a className="plays-venue-link" href={tradeUrl} target="_blank" rel="noopener noreferrer"
          title="Place the planned orders on the venue. Vessel never sends orders.">
          <ExternalLink size={14} aria-hidden="true" />Open {instrumentName} on {venues.name(account!.venueId)}</a>}
        {actions ?? <span className="workspace-badge"><PencilLine size={13} />Local draft</span>}
      </div>
    </div>
    {notice && <p className="plays-draft-notice" role="status"><Info size={14} aria-hidden="true" /><span>{notice}</span></p>}
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
      <div className="plays-account-field"><label htmlFor={`${fieldId}-account`} className="field-label">Account</label>
        <div className="plays-select-row">
          <select id={`${fieldId}-account`} value={lockInstrument ? draft.accountId : accountId} disabled={lockInstrument || (loading && !accounts.length)} onChange={event => chooseAccount(event.target.value)}>
            <option value="">Choose an account</option>
            {lockInstrument && !account && <option value={draft.accountId}>Unavailable or disabled account</option>}
            {filteredAccounts.map(account => <option key={account.id} value={account.id}>{account.name} · {venues.name(account.venueId)}</option>)}
          </select>
          {onReload && <button type="button" className="plays-reload-accounts" aria-label="Reload accounts" title="Reload accounts"
            onClick={onReload} disabled={loading} aria-busy={loading}>
            <RefreshCw size={13} className={loading ? 'is-spinning' : ''} aria-hidden="true" /></button>}
        </div>
      </div>
      {lockInstrument ? <div className="plays-instrument-field"><label htmlFor="plays-fixed-instrument">Instrument</label>
        <Input id="plays-fixed-instrument" aria-label="Perpetual instrument" value={instrumentName} readOnly />
        <div className="instrument-feedback"><p>Fixed once planned.</p></div>
      </div> : <InstrumentPicker key={accountId} catalog={catalog} value={draft.instrument} source={draft.instrumentSource}
        onChange={(instrument, instrumentSource) => {
          // A new contract can allow less leverage than the plan uses; keep the plan within the venue maximum.
          const max = instrumentSource === 'venue' ? catalog.catalog?.instruments.find(item => item.contractId === instrument)?.maxLeverage : undefined
          const leverage = max !== undefined && leverageOf(draft.leverage) > max ? String(max) : draft.leverage
          onChange({ ...draft, instrument, instrumentSource, leverage })
        }} />}
      <div className="direction-field"><span className="field-label">Direction</span>
        <DirectionToggle value={draft.direction} onChange={direction => onChange({ ...draft, direction })} />
      </div>
      <div className="plays-context-status"><span className="field-label">Status</span><span className={`badge play-status-${status}`}>{statusLabels[status]}</span></div>
    </fieldset>
    <PlanNotices draft={draft} onChange={onChange} readOnly={readOnly} maxLeverage={maxLeverage} />
    {!loading && !enabledAccounts.length && <p className="plays-context-note">No enabled accounts yet. You can outline the play and add an account later.</p>}
    <CapitalContext accounts={enabledAccounts} portfolios={portfolios} draft={{ ...draft, accountId }} />
    {suggestions && sizing && onRiskChange && <SuggestionsPanel plan={suggestions} sizing={sizing} draft={draft} leverage={leverage} units={units}
      onSize={size => onChange({ ...draft, size })} onLevel={acceptLevel} onRiskChange={onRiskChange}
      onLeverage={acceptLeverage} />}
    {pendingLeverage !== null && <LeverageChangeDialog draft={draft} from={leverage} to={pendingLeverage} units={units}
      onKeepPrices={() => finishLeverage('prices')} onKeepPercentages={() => finishLeverage('percentages')} onCancel={() => finishLeverage()} />}
    <div className="workspace" data-testid="workspace">
      <div ref={leftColumn} className="left-column" data-testid="left-column">
        <ChartPanel entries={draft.entries} selectedId={selectedId} onSelect={id => {
          setSelectedId(id)
          setSelectionRequest(current => current + 1)
        }} instrument={draft.instrument} instrumentName={instrumentName} venue={account ? venues.name(account.venueId) : null} direction={draft.direction}
        intervals={account ? venues.find(account.venueId)?.intervals : undefined} priceStep={instrumentInfo?.priceStep ?? null}
        streamable={account ? venues.can(account.venueId, 'stream') : false}
        leverage={leverageOf(draft.leverage)} liquidation={estimatedLiquidation(draft.entries, draft.direction, leverageOf(draft.leverage), maxLeverage)}
        source={account && venues.can(account.venueId, 'candles') && draft.instrumentSource === 'venue' ? { api, accountId: account.id } : null}
        onEntriesChange={entries => planChange({ ...draft, entries })}
        drawings={drawingKey ? draft.drawings[drawingKey] : undefined}
        onDrawingsChange={drawings => { if (drawingKey) planChange({ ...draft, drawings: { ...draft.drawings, [drawingKey]: drawings } }) }}
        editable={!readOnly} onCapture={addCapture} onShowEvidence={showEvidence} />
        <PlayJournal notes={draft.notes} onChange={notes => onChange({ ...draft, notes: readOnly ? { ...draft.notes, review: notes.review } : notes })}
          execution={execution} readOnly={readOnly}
          evidence={draft.evidence} onEvidenceChange={updateEvidence} evidenceRequest={evidenceRequest} />
      </div>
      {readOnly ? <fieldset className="plays-readonly-position" disabled><legend className="sr-only">Position (read-only)</legend>
        <PositionEditor draft={draft} onChange={planChange} selectedId={selectedId} selectionRequest={selectionRequest} onSelect={setSelectedId} maxLeverage={maxLeverage} units={units} availableBudget={available} checkBudget={false} />
      </fieldset> : <PositionEditor draft={draft} onChange={onChange} selectedId={selectedId} selectionRequest={selectionRequest} onSelect={setSelectedId}
        maxLeverage={maxLeverage} instrumentName={instrumentName} units={units} availableBudget={available} checkBudget={status === 'draft'}
        marks={marks} />}
    </div>
    <PositionSummary draft={draft} units={units} instrumentName={instrumentName} />
  </section>
}
