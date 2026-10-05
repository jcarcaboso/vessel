import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useVenues } from '@/api/venues'
import { NotebookPen, Pencil, Plus, RotateCcw } from 'lucide-react'
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

/**
 * The play's budget: a manual amount when set, otherwise what the account has available. Without
 * either, only a "Set budget" action shows.
 */
export function AvailableBudget({ draft, onChange, available = null }: {
  draft: PlayDraft
  onChange: (draft: PlayDraft) => void
  /** The account's available wallet amount in nominal USD, or null when unknown. */
  available?: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [budget, setBudget] = useState('')
  const [error, setError] = useState('')
  const id = useId()
  const manual = draft.budgetOverride
  // An empty wallet is not a budget; the owner sets one instead.
  const usable = available != null && Number(available) > 0 ? available : null
  const value = manual ?? usable

  function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = budget.trim()
    if (text && !/^\d+(\.\d+)?$/.test(text)) {
      setError('Enter a non-negative USD amount, or leave it blank to use the available amount.')
      return
    }
    onChange({ ...draft, budgetOverride: text || null })
    setEditing(false)
    setError('')
  }
  const edit = () => { setBudget(manual ?? ''); setError(''); setEditing(true) }

  if (editing) return <form className="available-budget available-budget-editing" onSubmit={saveBudget} noValidate>
    <label htmlFor={`${id}-budget`}>Budget <small>$</small></label>
    <Input id={`${id}-budget`} inputMode="decimal" autoFocus value={budget} maxLength={100} placeholder={usable ?? '0'}
      aria-invalid={!!error} aria-describedby={error ? `${id}-budget-error` : undefined}
      onChange={(event) => { setBudget(event.target.value); setError('') }} />
    {error && <p id={`${id}-budget-error`} className="error" role="alert">{error}</p>}
    <div className="budget-actions">
      <Button type="submit" size="sm">Save budget</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
    </div>
  </form>

  if (value == null) return <div className="available-budget available-budget-empty">
    <Button type="button" variant="ghost" size="sm" className="set-budget" onClick={edit}><Plus size={13} aria-hidden="true" />Set budget</Button>
  </div>

  return <div className="available-budget" role="group" aria-label="Budget">
    <span className="budget-label">Budget</span>
    <strong title={value}>{displayMoney(value)}</strong>
    <small>{manual != null ? 'manual' : 'available'}</small>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit budget" title="Set a budget for this play" onClick={edit}><Pencil aria-hidden="true" size={13} /></Button>
    {manual != null && usable != null && <Button type="button" variant="ghost" size="icon-sm" aria-label="Use the available amount"
      title="Use the available amount" onClick={() => onChange({ ...draft, budgetOverride: null })}><RotateCcw aria-hidden="true" size={13} /></Button>}
  </div>
}

export function CapitalContext({ accounts, portfolios, draft }: {
  accounts: BrokerAccount[]
  portfolios: Portfolio[]
  draft: PlayDraft
}) {
  const account = accounts.find(item => item.id === draft.accountId && item.isEnabled !== false)
  const portfolio = portfolios.find(item => item.id === account?.portfolioId)
  const venues = useVenues()
  const wallet = !!account && venues.can(account.venueId, 'stablecoinWallet')
  // Unified and portfolio-margin accounts keep all balances in the wallet; their perps state is not meaningful.
  const unified = account?.accountMode === 'unifiedAccount' || account?.accountMode === 'portfolioMargin'
  const sized = positionSize(draft, leverageOf(draft.leverage))
  // A portfolio sums its accounts' balances; an unassigned account stands on its own.
  const balance = portfolio ? portfolio.balanceUsd ?? portfolio.totalValueUsd : account?.balanceUsd ?? account?.accountValueUsd ?? null
  const balanceValue = balance == null ? null : Number(balance)
  // Shares of the balance treat the quote asset as USD, like the nominal account values.
  const share = (value: number | null) => value === null || !balanceValue ? '—' : `${(value / balanceValue * 100).toFixed(1)}%`
  const coverage = portfolio?.balanceCoverage ?? portfolio?.valueCoverage
  const metric = (label: string, value: string | null | undefined, title?: string) =>
    <div title={title}><dt>{label}</dt><dd data-placeholder={value == null}>{displayMoney(value)}</dd></div>
  return <section className="panel capital-context" aria-label="Capital context" data-testid="capital-context">
    <div className="capital-values">
      <h2 className="capital-title sr-only">Capital context</h2>
      <dl className="capital-metrics">
        {metric(portfolio ? `${portfolio.name} balance` : 'Account balance', balance,
          `Nominal USD${coverage ? `; coverage ${coverage}` : ''}. Perps equity plus supported stablecoins, or the wallet alone in unified accounts.`)}
        {wallet && metric('Wallet total', account.totalStablecoinNominalUsd,
          `${account.stablecoinScope ?? 'Supported stablecoin wallet'}${account.accountMode ? ` · ${account.accountMode}` : ''}. Nominal 1 token = 1 USD.`)}
        {wallet && metric('Available', account.availableStablecoinNominalUsd, 'Wallet total minus amounts held by open orders.')}
        {wallet && !unified && metric('Perps equity', account.accountValueUsd, 'Primary perpetual account value.')}
        {!wallet && account && metric('Account value', account.accountValueUsd)}
        <div title="Committed margin as a share of the balance"><dt>Margin / balance</dt><dd data-placeholder={share(sized.margin) === '—'}>{share(sized.margin)}</dd></div>
        <div title="Position size (notional) as a share of the balance"><dt>Exposure / balance</dt><dd data-placeholder={share(sized.notional) === '—'}>{share(sized.notional)}</dd></div>
      </dl>
    </div>
  </section>
}

const journalSections = [
  ['thesis', 'Thesis', 'Why this trade?'],
  ['invalidation', 'Invalidation', 'What would prove it wrong?'],
  ['strategy', 'Strategy', 'Which setup or rules apply?'],
  ['evidence', 'Evidence', 'Notes on the evidence'],
  ['review', 'Review', 'What happened, and what did you learn?'],
] as const

export function PlayJournal({ notes, onChange, evidence = [], onEvidenceChange, evidenceRequest = 0, readOnly = false, execution }: {
  notes: PlayDraft['notes']
  onChange: (notes: PlayDraft['notes']) => void
  evidence?: DraftEvidence[]
  onEvidenceChange?: (update: (evidence: DraftEvidence[]) => DraftEvidence[]) => void
  /** Incremented to bring the Evidence tab forward, e.g. after a chart capture. */
  evidenceRequest?: number
  /** Keeps the pre-trade notes fixed; the review stays editable. */
  readOnly?: boolean
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
      </header>
      {journalSections.map(([key, label, help]) => <TabsContent key={key} value={key} className="journal-tab-content">
        {key === 'evidence' && onEvidenceChange && <EvidencePanel evidence={evidence} onChange={onEvidenceChange} />}
        <label className="sr-only" htmlFor={`${id}-${key}`}>{label}</label>
        <textarea id={`${id}-${key}`} value={notes[key]} placeholder={help} readOnly={readOnly && key !== 'review'}
          onChange={(event) => onChange({ ...notes, [key]: event.target.value })} />
      </TabsContent>)}
      {execution && <TabsContent value="execution" className="journal-tab-content">{execution}</TabsContent>}
    </Tabs>
  </section>
}

export function PositionSummary({ draft, units = defaultSizeUnits, instrumentName }: { draft: PlayDraft; units?: SizeUnits; instrumentName?: string }) {
  const count = draft.entries.length
  // Same quantity-weighted planned average as the chart's AVG line, for one or more priced entries.
  const average = averageEntryPrice(draft.entries, 1)
  const sized = positionSize(draft, leverageOf(draft.leverage))
  const missing = draft.size ? 'Needs an entry price' : 'Needs a size'
  const values: Array<[string, string]> = [
    ['Margin', sized.margin === null ? missing : formatMoney(sized.margin, units)],
    ['Position size', sized.notional === null ? missing : formatMoney(sized.notional, units)],
    ['Quantity', sized.quantity === null ? missing : formatQuantity(sized.quantity, units)],
    ['Average entry', average === null ? 'Not set' : formatDraggedPrice(average)],
  ]
  return <section className="panel summary" aria-label="Full-position summary" data-testid="summary-panel">
    <div className="summary-intro">
      <h2 title="Planned position before fees and funding">Summary</h2>
      <strong>{count} {count === 1 ? 'entry' : 'entries'} · <span data-direction={draft.direction}>{draft.direction === 'long' ? 'Long' : 'Short'}</span></strong>
      <small>{instrumentName || draft.instrument || 'No instrument'} · Leverage {draft.leverage || '–'}×</small>
    </div>
    <dl>
      {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd data-placeholder={isPlaceholder(value)}>{value}</dd></div>)}
    </dl>
  </section>
}
