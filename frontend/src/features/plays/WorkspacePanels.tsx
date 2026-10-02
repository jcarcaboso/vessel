import { useId, useState, type FormEvent } from 'react'
import { NotebookPen, Pencil } from 'lucide-react'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { money } from '../workspace/format'
import type { PlayDraft } from './draft'
import { averageEntryPrice, formatDraggedPrice } from './levels'
import './plays-workspace.css'

const displayMoney = (value: string | null | undefined) => value == null ? 'Unavailable' : money(value)
// Placeholder values stay readable but recede, so real figures carry the visual weight.
const isPlaceholder = (value: string) => ['Unavailable', 'Not calculated', 'Not chosen', 'Not set'].includes(value)

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
  ['evidence', 'Evidence', 'Evidence notes only. Chart captures and uploads arrive with evidence storage.'],
  ['review', 'Review', 'Reflect on what happened, separately from the original thesis.'],
] as const

export function PlayJournal({ notes, onChange }: {
  notes: PlayDraft['notes']
  onChange: (notes: PlayDraft['notes']) => void
}) {
  const id = useId()
  return <section className="panel journal-panel" aria-label="Play journal" data-testid="journal-panel">
    <Tabs defaultValue="thesis" className="journal-tabs">
      <header className="panel-heading journal-header">
        <div className="journal-heading"><span className="journal-icon" aria-hidden="true"><NotebookPen size={15} /></span><h2>Play journal</h2></div>
        <TabsList className="journal-tab-list" aria-label="Journal sections">
          {journalSections.map(([key, label]) => <TabsTrigger key={key} value={key}>{label}</TabsTrigger>)}
        </TabsList>
        <span className="journal-draft-label">Draft notes</span>
      </header>
      {journalSections.map(([key, label, help]) => <TabsContent key={key} value={key} className="journal-tab-content">
        <label className="sr-only" htmlFor={`${id}-${key}`}>{label}</label>
        <p className="muted" id={`${id}-${key}-help`}>{help}</p>
        <textarea id={`${id}-${key}`} value={notes[key]} aria-describedby={`${id}-${key}-help`}
          placeholder={`Write your ${label.toLowerCase()} notes.`}
          onChange={(event) => onChange({ ...notes, [key]: event.target.value })} />
      </TabsContent>)}
    </Tabs>
  </section>
}

export function PositionSummary({ draft }: { draft: PlayDraft }) {
  const size = draft.size ? `${draft.size} ${draft.sizingMode === 'margin' ? 'currency units' : 'instrument units'}` : 'Not chosen'
  const count = draft.entries.length
  // Same quantity-weighted planned average as the chart's AVG line, for one or more priced entries.
  const average = averageEntryPrice(draft.entries, 1)
  const values: Array<[string, string]> = [
    [draft.sizingMode === 'margin' ? 'Chosen margin' : 'Chosen quantity', size],
    ['Chosen leverage', draft.leverage ? `${draft.leverage}×` : 'Not chosen'],
    ...['Committed margin', 'Notional exposure'].map((label): [string, string] => [label, 'Not calculated']),
    ['Planned average entry', average === null ? 'Not set' : formatDraggedPrice(average)],
    ...['Reward / risk', 'All-stops loss', 'All-targets profit'].map((label): [string, string] => [label, 'Not calculated']),
  ]
  return <section className="panel summary" aria-label="Full-position summary" data-testid="summary-panel">
    <div className="summary-intro">
      <h2>Full-position summary</h2>
      <strong>{count} {count === 1 ? 'entry' : 'entries'} · <span data-direction={draft.direction}>{draft.direction === 'long' ? 'Long' : 'Short'}</span></strong>
      <small>{draft.instrument || 'No instrument'} · Leverage {draft.leverage || '–'}×</small>
    </div>
    <dl>
      {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd data-placeholder={isPlaceholder(value)}>{value}</dd></div>)}
    </dl>
    <p className="summary-note">Planned position only. Financial calculations are deferred, and no execution or realized return is implied.</p>
  </section>
}
