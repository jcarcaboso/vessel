import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createEntry, type DraftEntry, type PlayDraft } from './draft'
import { EntryForm } from './EntryForm'
import { keepPercentLevelPrices, leverageOf, percentLevels } from './levels'
import { LeverageChangeDialog } from './LeverageChangeDialog'
import { convertSize, defaultSizeUnits, formatMoney, formatQuantity, positionSize, type SizeUnits } from './sizing'
import { Expand, Plus, Trash2 } from 'lucide-react'

const leveragePresets = [1, 5, 10, 25, 50]
/** Control range when the venue maximum is unknown, e.g. manual instruments. Saved plans accept up to 100×. */
const defaultMaxLeverage = 100

// Plain share bookkeeping, not a sizing calculation. Two decimals with the remainder on the last entry.
function equalShares(count: number) {
  const base = Math.floor(10000 / count) / 100
  return Array.from({ length: count }, (_, index) =>
    String(index === count - 1 ? Number((100 - base * (count - 1)).toFixed(2)) : base))
}

function allocatedShare(entries: DraftEntry[]) {
  const shares = entries.map(entry => entry.share.trim()).filter(Boolean).map(Number)
  if (!shares.length || shares.some(share => !Number.isFinite(share))) return null
  return Number(shares.reduce((total, share) => total + share, 0).toFixed(2))
}
import { AvailableBudget } from './WorkspacePanels'

export function PositionEditor({ draft, onChange, selectedId, selectionRequest = 0, onSelect, maxLeverage = null, instrumentName = '', units = defaultSizeUnits }: {
  draft: PlayDraft
  onChange: (draft: PlayDraft) => void
  selectedId: string
  selectionRequest?: number
  onSelect: (id: string) => void
  /** Venue maximum for the chosen contract, or null when unknown. */
  maxLeverage?: number | null
  instrumentName?: string
  /** Quote asset and contract for the size readout. */
  units?: SizeUnits
}) {
  const leverageLimit = maxLeverage ?? defaultMaxLeverage
  const leverage = leverageOf(draft.leverage)
  const presets = leveragePresets.filter(preset => preset < leverageLimit).concat(leverageLimit)
  const prefix = useId()
  const [expanded, setExpanded] = useState(false)
  const sidebar = useRef<HTMLDivElement>(null)
  const entryButtons = useRef(new Map<string, HTMLButtonElement>())
  const expandButton = useRef<HTMLButtonElement>(null)
  const previousSelection = useRef({ id: selectedId, request: selectionRequest })
  const sidebarBeforeExpansion = useRef({ selectedId, scrollTop: 0 })
  const selected = draft.entries.find(entry => entry.id === selectedId) ?? draft.entries[0]
  const allocated = allocatedShare(draft.entries)

  const revealEntry = useCallback((id: string, focus: boolean) => {
    const container = sidebar.current
    const button = entryButtons.current.get(id)
    if (!container || !button) return
    const top = button.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    container.scrollTo({ top: Math.max(0, top - 12), behavior: 'auto' })
    if (focus) button.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (previousSelection.current.id === selectedId && previousSelection.current.request === selectionRequest) return
    previousSelection.current = { id: selectedId, request: selectionRequest }
    revealEntry(selectedId, !expanded)
  }, [selectedId, selectionRequest, expanded, revealEntry])

  function selectEntry(id: string) {
    if (id === selectedId) revealEntry(id, !expanded)
    onSelect(id)
  }

  function updateEntry(entry: DraftEntry) {
    onChange({ ...draft, entries: draft.entries.map(current => current.id === entry.id ? entry : current) })
  }

  // Percentage stops and targets are returns at the leverage, so with any of them a new leverage is
  // previewed in the controls and only applied once the owner chooses what happens to those levels.
  const [leverageDraft, setLeverageDraft] = useState<string | null>(null)
  const [pendingLeverage, setPendingLeverage] = useState<number | null>(null)
  const needsConfirmation = percentLevels(draft.entries).length > 0
  const shownLeverage = leverageDraft ?? draft.leverage
  const clampLeverage = (value: string) => value === '' ? '' : String(Math.min(leverageLimit, Math.max(1, Math.round(Number(value)))))

  function updateLeverage(value: string) {
    const next = clampLeverage(value)
    if (needsConfirmation) setLeverageDraft(next)
    else onChange({ ...draft, leverage: next })
  }

  /** Asks about percentage levels before applying a previewed leverage. A blank value goes back to the current one. */
  function commitLeverage(value = leverageDraft) {
    if (value === null || !needsConfirmation) return
    if (value === '' || Number(value) === leverage) { setLeverageDraft(null); return }
    setLeverageDraft(value)
    setPendingLeverage(Number(value))
  }

  function finishLeverage(apply?: 'prices' | 'percentages') {
    if (apply && pendingLeverage !== null) onChange({
      ...draft, leverage: String(pendingLeverage),
      entries: apply === 'prices' ? keepPercentLevelPrices(draft.entries, leverage, pendingLeverage) : draft.entries,
    })
    setPendingLeverage(null)
    setLeverageDraft(null)
  }

  const sized = positionSize(draft, leverage)

  function splitEqually() {
    const shares = equalShares(draft.entries.length)
    onChange({ ...draft, entries: draft.entries.map((entry, index) => ({ ...entry, share: shares[index]! })) })
  }

  function addEntry() {
    let index = draft.entries.length
    while (draft.entries.some(entry => entry.name === `Entry ${index + 1}`)) index += 1
    const entry = createEntry(index)
    onChange({ ...draft, entries: [...draft.entries, entry] })
    onSelect(entry.id)
  }

  function removeEntry(id: string) {
    if (draft.entries.length <= 1) return
    const entries = draft.entries.filter(entry => entry.id !== id)
    onChange({ ...draft, entries })
    if (selected?.id === id) onSelect(entries[0]!.id)
  }

  return <section className="plays-position panel position-panel" aria-labelledby={`${prefix}-position-title`} data-testid="position-panel">
    <header className="panel-heading"><div><h2 id={`${prefix}-position-title`}>Size the whole position</h2><p>One size. Split across your entries.</p></div></header>
    <div className="position-context position-sizing position-builder">
      <AvailableBudget key={draft.accountId} draft={draft} onChange={onChange} />
      <div className="whole-size-input">
        <label htmlFor={`${prefix}-size`}>
          <span>{draft.sizingMode === 'margin' ? 'Whole-position margin' : 'Whole-position quantity'}
            <small>{draft.sizingMode === 'margin' ? units.quote === defaultSizeUnits.quote ? 'currency units' : units.quote : units.base === defaultSizeUnits.base ? 'instrument units' : units.base}</small></span>
          <Input id={`${prefix}-size`} type="number" min={0} step="any" value={draft.size} placeholder="Enter total size"
            onChange={event => onChange({ ...draft, size: event.target.value })} />
        </label>
        <div className="size-unit-field">
          <span>Size in</span>
          {/* Switching keeps the same position when it can be converted at the leverage and average entry. */}
          <div className="size-unit-switch segmented" role="group" aria-label="Whole-position sizing">
            {(['margin', 'quantity'] as const).map(mode => <button key={mode} type="button" aria-pressed={draft.sizingMode === mode}
              aria-label={mode === 'margin' ? `Margin in ${units.quote}` : `Quantity in ${units.base}`}
              onClick={() => {
                if (mode !== draft.sizingMode) onChange({ ...draft, sizingMode: mode, size: convertSize(draft, leverage, units) })
              }}>{mode === 'margin' ? units.quote === defaultSizeUnits.quote ? 'Currency' : units.quote : units.base === defaultSizeUnits.base ? 'Quantity' : units.base}</button>)}
          </div>
        </div>
        {sized.notional !== null || sized.margin !== null ? <p className="position-size-readout" data-testid="size-readout">
          {sized.notional !== null && <span>Position <strong>{formatMoney(sized.notional, units)}</strong></span>}
          {draft.sizingMode === 'quantity' && sized.margin !== null && <span>Margin <strong>{formatMoney(sized.margin, units)}</strong></span>}
          {sized.quantity !== null && draft.sizingMode === 'margin' && <span>≈ <strong>{formatQuantity(sized.quantity, units)}</strong></span>}
          <small>at {leverage}×{sized.averageEntry === null ? ' · price an entry for the quantity' : ''}</small>
        </p> : draft.size && draft.sizingMode === 'quantity' && <p className="position-size-readout"><small>Price an entry to see the position and margin.</small></p>}
      </div>
      <div className="leverage-controls">
        <label htmlFor={`${prefix}-leverage-slider`}>Leverage <small>{maxLeverage ? `1× to ${maxLeverage}× on ${instrumentName || 'this contract'}` : '1× = unlevered'}</small></label>
        <div className="leverage-input-row">
          <input id={`${prefix}-leverage-slider`} type="range" min={1} max={leverageLimit} step={1} value={Math.min(leverageOf(shownLeverage), leverageLimit)}
            style={{ '--range-progress': `${leverageLimit > 1 ? (Math.min(leverageOf(shownLeverage), leverageLimit) - 1) / (leverageLimit - 1) * 100 : 100}%` } as CSSProperties}
            aria-label="Leverage slider (×)" aria-valuetext={shownLeverage ? `${shownLeverage} times` : 'Not specified'}
            onChange={event => updateLeverage(event.target.value)}
            onPointerUp={event => commitLeverage(clampLeverage(event.currentTarget.value))} onBlur={() => commitLeverage()} />
          <Input id={`${prefix}-leverage`} type="number" min={1} max={leverageLimit} step={1} value={shownLeverage}
            aria-label="Leverage (×)" onChange={event => updateLeverage(event.target.value)} onBlur={() => commitLeverage()}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitLeverage() } }} />
          <span aria-hidden="true">×</span>
        </div>
        <div className="leverage-presets" role="group" aria-label="Leverage presets">
          {presets.map(preset => <button key={preset} type="button" aria-pressed={shownLeverage === String(preset)}
            onClick={() => needsConfirmation ? commitLeverage(String(preset)) : updateLeverage(String(preset))}>{preset}×</button>)}
        </div>
      </div>
      {leverage > leverageLimit && <p className="leverage-warning" role="alert">{leverage}× is above the {leverageLimit}× venue maximum for {instrumentName || 'this contract'}.</p>}
      {pendingLeverage !== null && <LeverageChangeDialog draft={draft} from={leverage} to={pendingLeverage} units={units}
        onKeepPrices={() => finishLeverage('prices')} onKeepPercentages={() => finishLeverage('percentages')} onCancel={() => finishLeverage()} />}
      <p className="muted">Position size is margin × leverage at the planned average entry, before fees, funding and venue margin rules. Payoff calculations are deferred. Switching between margin and quantity converts the size at the leverage and average entry, or clears it without an entry price. {maxLeverage ? 'The leverage range is the venue maximum for this contract.' : 'Without a venue contract, the 1× to 100× range is not venue-validated.'} Percentage stops and targets are returns at this leverage.</p>
    </div>
    <div className="entries-heading">
      <div><h3>Distribute your entries <span className="entry-count">{String(draft.entries.length).padStart(2, '0')}</span></h3>
        <p>Shares split total quantity, not risk or margin.</p></div>
      <div className="entries-allocation">
        <span data-complete={allocated === 100}>{allocated === null ? 'Shares not set' : `${allocated}% allocated`}</span>
        <Button type="button" variant="ghost" size="sm" className="split-equally" onClick={splitEqually}>Split equally</Button>
      </div>
    </div>
    <label className="entry-picker" htmlFor={`${prefix}-selected-entry`}>Selected entry
      <select id={`${prefix}-selected-entry`} value={selected?.id ?? ''} onChange={event => selectEntry(event.target.value)}>
        {draft.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select>
    </label>
    <div ref={sidebar} className="entry-sidebar" data-testid="entry-sidebar" tabIndex={0} aria-label="Bounded entry editor">
      {draft.entries.map(entry => <article key={entry.id} className="entry-card" data-selected={selected?.id === entry.id}
        style={{ '--entry-color': entry.color } as CSSProperties} aria-label={`${entry.name} editor`}>
        <button type="button" className="entry-header" aria-pressed={selected?.id === entry.id}
          ref={node => { if (node) entryButtons.current.set(entry.id, node); else entryButtons.current.delete(entry.id) }}
          onClick={() => selectEntry(entry.id)}>
          <strong><i aria-hidden="true" />{entry.name}</strong>
          {entry.price && <span className="entry-header-price">@ {entry.price}</span>}
          <span>{entry.share === '' ? 'Share not set' : `${entry.share}% of quantity`}</span>
        </button>
        {expanded && selected?.id === entry.id
          ? <p className="muted expanded-placeholder">Editing in the expanded dialog.</p>
          : <EntryForm entry={entry} onChange={updateEntry} idPrefix={`${prefix}-sidebar-${entry.id}`} direction={draft.direction} leverage={leverage} />}
        <div className="entry-actions">
          <Button type="button" variant="ghost" size="sm" className="remove-entry" aria-label={`Remove ${entry.name}`}
            disabled={draft.entries.length <= 1} onClick={() => removeEntry(entry.id)}><Trash2 size={12} aria-hidden="true" />Remove entry</Button>
        </div>
      </article>)}
    </div>
    <div className="entry-actions">
      <Button type="button" variant="outline" className="add-entry" onClick={addEntry}><Plus size={14} aria-hidden="true" />Add entry</Button>
      <Dialog open={expanded} onOpenChange={open => {
        if (open) sidebarBeforeExpansion.current = { selectedId, scrollTop: sidebar.current?.scrollTop ?? 0 }
        setExpanded(open)
      }}>
        <DialogTrigger asChild>
          <Button ref={expandButton} type="button" variant="outline" className="expand-entry" disabled={!selected}><Expand size={14} aria-hidden="true" />Expand selected entry</Button>
        </DialogTrigger>
        <DialogContent className="entry-dialog plays-entry-dialog" onCloseAutoFocus={event => {
          event.preventDefault()
          if (selectedId === sidebarBeforeExpansion.current.selectedId) {
            sidebar.current?.scrollTo({ top: sidebarBeforeExpansion.current.scrollTop, behavior: 'auto' })
          } else {
            revealEntry(selectedId, false)
          }
          expandButton.current?.focus({ preventScroll: true })
        }}>
          <DialogHeader>
            <DialogTitle>Expanded entry editor</DialogTitle>
            <DialogDescription>The same live draft form. Unsaved edits stay in memory. Escape returns to the sidebar.</DialogDescription>
          </DialogHeader>
          <label htmlFor={`${prefix}-expanded-entry`}>Entry
            <select id={`${prefix}-expanded-entry`} value={selected?.id ?? ''} onChange={event => selectEntry(event.target.value)}>
              {draft.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          {selected && <EntryForm key={selected.id} entry={selected} onChange={updateEntry} idPrefix={`${prefix}-expanded-${selected.id}`} direction={draft.direction} leverage={leverage} />}
        </DialogContent>
      </Dialog>
    </div>
  </section>
}
