import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createNextEntry, type DraftEntry, type PlayDraft } from './draft'
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
    const entry = createNextEntry(draft.entries)
    onChange({ ...draft, entries: [...draft.entries, entry] })
    onSelect(entry.id)
  }

  function removeEntry(id: string) {
    if (draft.entries.length <= 1) return
    const entries = draft.entries.filter(entry => entry.id !== id)
    onChange({ ...draft, entries })
    if (selected?.id === id) onSelect(entries[0]!.id)
  }

  const shown = (id: string) => selected?.id === id && !(expanded && selected?.id === id)
  return <section className="plays-position panel position-panel" aria-label="Position" data-testid="position-panel">
    <h2 className="sr-only">Position</h2>
      <div className="position-context position-sizing position-builder">
        <AvailableBudget key={draft.accountId} draft={draft} onChange={onChange} />
        <div className="whole-size-input">
          <label htmlFor={`${prefix}-size`}>
            <span>{draft.sizingMode === 'margin' ? 'Margin' : 'Quantity'}</span>
            <Input id={`${prefix}-size`} type="number" min={0} step="any" value={draft.size} placeholder="0"
            aria-label={draft.sizingMode === 'margin' ? `Whole-position margin (${units.quote})` : `Whole-position quantity (${units.base})`}
              onChange={event => onChange({ ...draft, size: event.target.value })} />
          </label>
          <div className="size-unit-field">
            <span aria-hidden="true">&nbsp;</span>
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
            <small>at {leverage}×</small>
          </p> : null}
        </div>
        <div className="leverage-controls">
          <label htmlFor={`${prefix}-leverage-slider`}>Leverage {maxLeverage && <small>Max {maxLeverage}×</small>}</label>
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
      </div>
        <div className="entries-heading">
          <h3>Entries <span className="entry-count">{draft.entries.length}</span></h3>
          <span data-complete={allocated === 100}>{allocated === null ? 'Shares not set' : `${allocated}% of quantity allocated`}</span>
          <Button type="button" variant="ghost" size="sm" className="split-equally" onClick={splitEqually}>Split equally</Button>
        </div>
        <div ref={sidebar} className="entry-sidebar" data-testid="entry-sidebar" tabIndex={0} aria-label="Entries">
          {draft.entries.map(entry => <article key={entry.id} className="entry-card" data-selected={selected?.id === entry.id}
            style={{ '--entry-color': entry.color } as CSSProperties} aria-label={`${entry.name} editor`}>
            <button type="button" className="entry-header" aria-pressed={selected?.id === entry.id} aria-expanded={selected?.id === entry.id}
              ref={node => { if (node) entryButtons.current.set(entry.id, node); else entryButtons.current.delete(entry.id) }}
              onClick={() => selectEntry(entry.id)}>
              <strong><i aria-hidden="true" />{entry.name}</strong>
              <span className="entry-header-price">{entry.price ? `@ ${entry.price}` : 'No price'}</span>
              <span>{entry.share === '' ? '—' : `${entry.share}%`}</span>
              {selected?.id !== entry.id && <small className="entry-header-levels">{levelCount(entry)}</small>}
            </button>
            {shown(entry.id) && <>
              <EntryForm entry={entry} onChange={updateEntry} idPrefix={`${prefix}-sidebar-${entry.id}`} direction={draft.direction} leverage={leverage} />
              <div className="entry-actions">
                <Button type="button" variant="ghost" size="sm" className="remove-entry" aria-label={`Remove ${entry.name}`}
                  disabled={draft.entries.length <= 1} onClick={() => removeEntry(entry.id)}><Trash2 size={12} aria-hidden="true" />Remove entry</Button>
              </div>
            </>}
            {expanded && selected?.id === entry.id && <p className="muted expanded-placeholder">Editing in the expanded view.</p>}
          </article>)}
        </div>
    <div className="entry-actions">
      <Button type="button" variant="outline" className="add-entry" onClick={addEntry}><Plus size={14} aria-hidden="true" />Add entry</Button>
      <Dialog open={expanded} onOpenChange={open => {
        if (open) sidebarBeforeExpansion.current = { selectedId, scrollTop: sidebar.current?.scrollTop ?? 0 }
        setExpanded(open)
      }}>
        <DialogTrigger asChild>
          <Button ref={expandButton} type="button" variant="outline" className="expand-entry" aria-label="Expand selected entry" disabled={!selected}><Expand size={14} aria-hidden="true" />Expand</Button>
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
            <DialogDescription className="sr-only">The same entry form with more room. Escape returns to the list.</DialogDescription>
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

/** "2 SL · 1 TP" for a collapsed entry, counting levels with a value. */
function levelCount(entry: DraftEntry) {
  const stops = entry.stops.filter(stop => stop.value.trim() !== '').length
  const targets = entry.targets.filter(target => target.value.trim() !== '').length
  return [stops && `${stops} SL`, targets && `${targets} TP`].filter(Boolean).join(' · ')
}
