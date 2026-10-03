import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { NotebookPen, Pencil } from 'lucide-react'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { money } from '../workspace/format'
import type { DraftEvidence, PlayDraft } from './draft'
import { EvidencePanel } from './EvidencePanel'
import { averageEntryPrice, formatDraggedPrice, leverageOf } from './levels'
import { defaultSizeUnits, formatMoney, formatQuantity, positionSize, type SizeUnits } from './sizing'
import './plays-workspace.css'

const displayMoney = (value: string | null | undefined) => value == null ? 'Unavailable' : money(value)
// Placeholder values stay readable but recede, so real figures carry the visual weight.
const isPlaceholder = (value: string) => ['Unavailable', 'Not calculated', 'Not chosen', 'Not set', 'Needs a size', 'Needs an entry price'].includes(value)

export function AvailableBudget({ draft, onChange }: {
  draft: PlayDraft
  onChange: (draft: PlayDraft) => void
}) {
  const [editing, setEditing] = useState(false)
  const [budget, setBudget] = useState('')
  const [error, setError] = useState('')
  const id = useId()

  function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = budget.trim()
    if (value && !/^\d+(\.\d+)?$/.test(value)) {
      setError('Enter a non-negative USD amount, or leave blank to remove the override.')
      return
    }
    onChange({ ...draft, budgetOverride: value || null })
    setEditing(false)
    setError('')
  }

  return <div className="available-budget">
    <label htmlFor={`${id}-budget`}><span>Available budget</span>{' '}<small>Nominal USD</small></label>
    {editing ? <form onSubmit={saveBudget} noValidate>
      <Input id={`${id}-budget`} inputMode="decimal" autoFocus value={budget} maxLength={100}
        aria-invalid={!!error} aria-describedby={`${id}-budget-help${error ? ` ${id}-budget-error` : ''}`}
        onChange={(event) => { setBudget(event.target.value); setError('') }} />
      <p id={`${id}-budget-help`} className="muted">Local override only. Leave blank to remove it.</p>
      {error && <p id={`${id}-budget-error`} className="error" role="alert">{error}</p>}
      <div className="budget-actions">
        <Button type="submit" size="sm">Save budget</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
      </div>
    </form> : <>
      <div className="budget-value-row">
        <Input id={`${id}-budget`} readOnly value={displayMoney(draft.budgetOverride)} data-placeholder={draft.budgetOverride === null}
          title={draft.budgetOverride ?? undefined} aria-describedby={`${id}-budget-help`} />
        <Button type="button" variant="outline" size="icon" aria-label="Edit available budget"
          onClick={() => { setBudget(draft.budgetOverride ?? ''); setError(''); setEditing(true) }}>
          <Pencil aria-hidden="true" size={14} />
        </Button>
      </div>
      <p id={`${id}-budget-help`} className="muted">
        {draft.budgetOverride === null ? 'No automatic budget policy. Use the pencil to set a local override.' : 'Your local override. Account and portfolio values are unchanged.'}
      </p>
    </>}
  </div>
}

export function CapitalContext({ accounts, portfolios, draft }: {
  accounts: BrokerAccount[]
  portfolios: Portfolio[]
  draft: PlayDraft
}) {
  const account = accounts.find(item => item.id === draft.accountId && item.isEnabled !== false)
  const portfolio = portfolios.find(item => item.id === account?.portfolioId)
  const hyperliquid = account?.venueId === 'hyperliquid'
  return <section className="panel capital-context" aria-label="Capital context" data-testid="capital-context">
    <div className="capital-values">
      <h2 className="capital-title sr-only">Capital context</h2>
      <dl className="capital-metrics">
        <div><dt>Portfolio value · USD</dt>
          <dd title={portfolio?.totalValueUsd ?? undefined} data-placeholder={portfolio?.totalValueUsd == null}>{displayMoney(portfolio?.totalValueUsd)}</dd>
          <small>Coverage: {portfolio?.valueCoverage ?? 'unavailable'}. Known account values only.</small>
        </div>
        <div><dt>{hyperliquid ? 'Primary perps equity · USD' : 'Known account value · USD'}</dt>
          <dd title={account?.accountValueUsd ?? undefined} data-placeholder={account?.accountValueUsd == null}>{displayMoney(account?.accountValueUsd)}</dd>
          <small>{account ? `${account.name} · ${portfolio?.name ?? (account.portfolioId === null ? 'Unassigned account' : 'Portfolio unavailable')}` : 'Select an enabled account above to see its capital context.'}</small>
        </div>
        <div><dt>Margin / portfolio</dt><dd data-placeholder="true">Not calculated</dd><small>Committed capital, not exposure</small></div>
        <div><dt>Exposure / portfolio</dt><dd data-placeholder="true">Not calculated</dd><small>Notional exposure, not margin</small></div>
      </dl>
    </div>
    {hyperliquid && <p className="capital-wallet-note"><span>Supported-wallet available · nominal USD</span>{' '}
      <strong title={account.availableStablecoinNominalUsd ?? undefined}>{displayMoney(account.availableStablecoinNominalUsd)}</strong>{' '}
      <small>{account.stablecoinScope ?? 'Supported stablecoin wallet only'}{account.accountMode ? ` · ${account.accountMode}` : ''}</small>
    </p>}
    <p className="capital-scope-note">Account and portfolio values are nominal USD. Coverage may be incomplete.
      {hyperliquid && ' Wallet availability uses a nominal 1 token = 1 USD basis, not market valuation, verified trading collateral or withdrawal capacity. Wallet funds are not added to primary perps equity or portfolio value.'}
    </p>
    <details className="sizing-assistant"><summary><span className="assistant-icon">↗</span><span><strong>Sizing assistant</strong><small>Define entry prices, shares and exits first. Suggestions are deferred.</small></span><span className="assistant-status">Deferred</span></summary>
      <p>Position suggestions and financial calculations are not available. Enter your own position size and leverage in the editor.</p>
    </details>
  </section>
}

const journalSections = [
  ['thesis', 'Thesis', 'Record the reasoning behind this play.'],
  ['invalidation', 'Invalidation', 'Describe what would invalidate the thesis.'],
  ['strategy', 'Strategy', 'Record strategy notes. Strategy versions are not linked in this draft.'],
  ['evidence', 'Evidence', 'General evidence notes. Each image above keeps its own note.'],
  ['review', 'Review', 'Reflect on what happened, separately from the original thesis.'],
] as const

export function PlayJournal({ notes, onChange, evidence = [], onEvidenceChange, evidenceRequest = 0, readOnly = false, notesLabel = 'Draft notes', execution }: {
  notes: PlayDraft['notes']
  onChange: (notes: PlayDraft['notes']) => void
  evidence?: DraftEvidence[]
  onEvidenceChange?: (update: (evidence: DraftEvidence[]) => DraftEvidence[]) => void
  /** Incremented to bring the Evidence tab forward, e.g. after a chart capture. */
  evidenceRequest?: number
  /** Keeps the pre-trade notes fixed; the review stays editable. */
  readOnly?: boolean
  notesLabel?: string
  /** Linked venue orders and fills of a saved play, shown as an Execution tab before the review. */
  execution?: ReactNode
}) {
  const id = useId()
  const [tab, setTab] = useState('thesis')
  const [shownRequest, setShownRequest] = useState(evidenceRequest)
  if (shownRequest !== evidenceRequest) {
    setShownRequest(evidenceRequest)
    setTab('evidence')
  }
  return <section className="panel journal-panel" aria-label="Play journal" data-testid="journal-panel">
    <Tabs value={tab} onValueChange={setTab} className="journal-tabs">
      <header className="panel-heading journal-header">
        <div className="journal-heading"><span className="journal-icon" aria-hidden="true"><NotebookPen size={15} /></span><h2>Play journal</h2></div>
        <TabsList className="journal-tab-list" aria-label="Journal sections">
          {journalSections.map(([key, label]) => <TabsTrigger key={key} value={key}>{label}
            {key === 'evidence' && evidence.length > 0 && <span className="journal-tab-count" aria-hidden="true">{evidence.length}</span>}
          </TabsTrigger>).flatMap((trigger, index) => execution && journalSections[index]![0] === 'evidence'
            ? [trigger, <TabsTrigger key="execution" value="execution">Execution</TabsTrigger>] : [trigger])}
        </TabsList>
        <span className="journal-draft-label">{notesLabel}</span>
      </header>
      {journalSections.map(([key, label, help]) => <TabsContent key={key} value={key} className="journal-tab-content">
        {key === 'evidence' && onEvidenceChange && <EvidencePanel evidence={evidence} onChange={onEvidenceChange} />}
        <label className="sr-only" htmlFor={`${id}-${key}`}>{label}</label>
        <p className="muted" id={`${id}-${key}-help`}>{help}</p>
        <textarea id={`${id}-${key}`} value={notes[key]} aria-describedby={`${id}-${key}-help`}
          placeholder={`Write your ${label.toLowerCase()} notes.`} readOnly={readOnly && key !== 'review'}
          onChange={(event) => onChange({ ...notes, [key]: event.target.value })} />
      </TabsContent>)}
      {execution && <TabsContent value="execution" className="journal-tab-content">{execution}</TabsContent>}
    </Tabs>
  </section>
}

export function PositionSummary({ draft, units = defaultSizeUnits, instrumentName }: { draft: PlayDraft; units?: SizeUnits; instrumentName?: string }) {
  const size = draft.size ? `${draft.size} ${draft.sizingMode === 'margin' ? 'currency units' : 'instrument units'}` : 'Not chosen'
  const count = draft.entries.length
  // Same quantity-weighted planned average as the chart's AVG line, for one or more priced entries.
  const average = averageEntryPrice(draft.entries, 1)
  const sized = positionSize(draft, leverageOf(draft.leverage))
  const missing = draft.size ? 'Needs an entry price' : 'Needs a size'
  const values: Array<[string, string]> = [
    [draft.sizingMode === 'margin' ? 'Chosen margin' : 'Chosen quantity', size],
    ['Chosen leverage', draft.leverage ? `${draft.leverage}×` : 'Not chosen'],
    ['Committed margin', sized.margin === null ? missing : formatMoney(sized.margin, units)],
    ['Position size', sized.notional === null ? missing : formatMoney(sized.notional, units)],
    ['Planned quantity', sized.quantity === null ? missing : formatQuantity(sized.quantity, units)],
    ['Planned average entry', average === null ? 'Not set' : formatDraggedPrice(average)],
    ...['Reward / risk', 'All-stops loss', 'All-targets profit'].map((label): [string, string] => [label, 'Not calculated']),
  ]
  return <section className="panel summary" aria-label="Full-position summary" data-testid="summary-panel">
    <div className="summary-intro">
      <h2>Full-position summary</h2>
      <strong>{count} {count === 1 ? 'entry' : 'entries'} · <span data-direction={draft.direction}>{draft.direction === 'long' ? 'Long' : 'Short'}</span></strong>
      <small>{instrumentName || draft.instrument || 'No instrument'} · Leverage {draft.leverage || '–'}×</small>
    </div>
    <dl>
      {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd data-placeholder={isPlaceholder(value)}>{value}</dd></div>)}
    </dl>
    <p className="summary-note">Planned position only. Margin, size and quantity are before fees, funding and venue margin rules; payoff calculations are deferred. No execution or realized return is implied.</p>
  </section>
}
