import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { addEntry as withEntry, createNextEntry, removeEntry as withoutEntry, splitEqually as equalSplit, type DraftEntry, type PlayDraft } from './draft'
import { EntryForm } from './EntryForm'
import { formatDraggedPrice, keepPercentLevelPrices, leverageOf, percentLevels } from './levels'
import { LeverageChangeDialog } from './LeverageChangeDialog'
import {
  convertSize, defaultSizeUnits, estimatedLiquidation, formatMoney, formatQuantity, formatRewardToRisk, marginOverBudget, playBudget, positionSize, rewardToRisk, sizeForBudget, type SizeUnits,
} from './sizing'
import { Equal, Expand, Plus, Trash2 } from 'lucide-react'
import type { SizingDocument } from '@/api/sizing'
import { SuggestionLine, TrackRecord } from './Suggestions'
import { exposureLabels, riskSize, suggestLeverage, suggestSize } from './suggestions'

const leveragePresets = [1, 5, 10, 25, 50]
/** Control range when the venue maximum is unknown, e.g. manual instruments. Saved plans accept up to 100×. */
const defaultMaxLeverage = 100

function allocatedShare(entries: DraftEntry[]) {
  const shares = entries.map(entry => entry.share.trim()).filter(Boolean).map(Number)
  if (!shares.length || shares.some(share => !Number.isFinite(share))) return null
  return Number(shares.reduce((total, share) => total + share, 0).toFixed(2))
}
import { AvailableBudget } from './WorkspacePanels'

export function PositionEditor({ draft, onChange, selectedId, selectionRequest = 0, onSelect, maxLeverage = null, instrumentName = '', units = defaultSizeUnits, availableBudget = null, checkBudget = true,
  sizing = null, balance = null, onRiskChange }: {
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
  /** What the account has available, used as the budget unless a manual one is set. */
  availableBudget?: string | null
  /** Holds the margin to the budget. Off once orders may rest, since the venue then counts their margin as used. */
  checkBudget?: boolean
  /** Risk settings, record and limits for suggestions; null hides them (read-only plays, or the record did not load). */
  sizing?: SizingDocument | null
  /** The play account's balance, the reference for the risk-based size. */
  balance?: string | null
  /** Saves the risk per trade from the track record line. */
  onRiskChange?: (riskPercent: string) => Promise<void>
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
  const liquidation = estimatedLiquidation(draft.entries, draft.direction, leverage, maxLeverage)
  const overBudget = checkBudget ? marginOverBudget(draft, leverage, availableBudget) : null
  const budgetSize = overBudget ? sizeForBudget(draft, leverage, overBudget.budget.value, units) : null
  // Suggestions only show; each applies through the same paths as typing when the owner accepts it.
  const balanceAmount = balance != null && Number(balance) > 0 ? Number(balance) : null
  const heldBudget = checkBudget ? playBudget(draft, availableBudget)?.amount ?? null : null
  const sizeSuggestion = sizing ? suggestSize(draft, leverage, balanceAmount, sizing, units, heldBudget) : null
  const risked = sizing ? riskSize(draft, leverage, balanceAmount, sizing, units) : null
  const leverageSuggestion = sizing && leverageDraft === null
    ? suggestLeverage(draft, leverage, maxLeverage, heldBudget, sizing, risked?.notional ?? null, defaultMaxLeverage) : null
  const limits = sizing ? { maxStopPercent: Number(sizing.limits.maxStopPercent), minRewardRisk: Number(sizing.limits.minRewardRisk),
    maxStopSource: sizing.limits.maxStopSource, minRewardRiskSource: sizing.limits.minRewardRiskSource } : null
  const exposure = sizing && sizing.exposure.level !== 'full' ? ` · ${exposureLabels[sizing.exposure.level]}` : ''
  const formatSize = (value: string) => draft.sizingMode === 'margin' ? formatMoney(Number(value), units) : formatQuantity(Number(value), units)
  // One entry takes the whole position, so its share and the split are fixed.
  const single = draft.entries.length === 1

  function splitEqually() {
    onChange({ ...draft, entries: equalSplit(draft.entries) })
  }

  function addEntry() {
    const entry = createNextEntry(draft.entries)
    onChange({ ...draft, entries: withEntry(draft.entries, entry) })
    onSelect(entry.id)
  }

  function removeEntry(id: string) {
    if (single) return
    const entries = withoutEntry(draft.entries, id)
    onChange({ ...draft, entries })
    if (selected?.id === id) onSelect(entries[0]!.id)
  }

  const shown = (id: string) => selected?.id === id && !(expanded && selected?.id === id)
  return <section className="plays-position panel position-panel" aria-label="Position" data-testid="position-panel">
    <h2 className="sr-only">Position</h2>
      <div className="position-context position-sizing position-builder">
        <AvailableBudget key={draft.accountId} draft={draft} onChange={onChange} available={availableBudget} />
        <div className="whole-size-input">
          <label htmlFor={`${prefix}-size`}>
            <span>{draft.sizingMode === 'margin' ? 'Margin' : 'Quantity'}</span>
            <Input id={`${prefix}-size`} type="number" min={0} step="any" value={draft.size} placeholder="0"
              aria-invalid={overBudget ? true : undefined} aria-describedby={overBudget ? `${prefix}-over-budget` : undefined}
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
                }}>{mode === 'margin' ? '$' : units.base === defaultSizeUnits.base ? 'Qty' : units.base}</button>)}
            </div>
          </div>
          {sized.notional !== null || sized.margin !== null || liquidation !== null ? <p className="position-size-readout" data-testid="size-readout">
            {sized.notional !== null && <span>Position <strong>{formatMoney(sized.notional, units)}</strong></span>}
            {draft.sizingMode === 'quantity' && sized.margin !== null && <span>Margin <strong>{formatMoney(sized.margin, units)}</strong></span>}
            {sized.quantity !== null && draft.sizingMode === 'margin' && <span>≈ <strong>{formatQuantity(sized.quantity, units)}</strong></span>}
            <small>at {leverage}×</small>
            {liquidation !== null && <span className="size-liquidation" data-testid="liquidation-estimate"
              title="Estimated for isolated margin with every entry filled at its planned price; ignores fees, funding and margin tiers. Cross margin liquidates further away. The venue shows the real price once the position is open.">
              Liq. ≈ <strong>{formatDraggedPrice(liquidation)}</strong></span>}
          </p> : null}
          {overBudget && <p id={`${prefix}-over-budget`} className="size-over-budget" role="alert">
            <span>Margin {formatMoney(overBudget.margin, units)} is above the {formatMoney(overBudget.budget.amount, units)} {overBudget.budget.source === 'manual' ? 'budget' : 'available'}.</span>
            {budgetSize !== null && <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...draft, size: budgetSize })}>
              Use {draft.sizingMode === 'margin' ? formatMoney(overBudget.budget.amount, units) : formatQuantity(Number(budgetSize), units)}</Button>}
          </p>}
          {sizeSuggestion && (sizeSuggestion.overBudget === null
            ? <SuggestionLine testId="size-suggestion" label="Accept suggested size" onAccept={() => onChange({ ...draft, size: sizeSuggestion.value })}
              title={`${sizeSuggestion.effectiveRiskPercent}% of the account balance lost if the stops fill, before fees`}>
              Size for {formatMoney(sizeSuggestion.risk, units)} risk{exposure}: <strong>{formatSize(sizeSuggestion.value)}</strong></SuggestionLine>
            : <SuggestionLine testId="size-suggestion" label="Accept suggested size"
              title={`${sizeSuggestion.effectiveRiskPercent}% of the account balance lost if the stops fill, before fees`}>
              {formatMoney(sizeSuggestion.risk, units)} risk{exposure} needs {formatMoney(sizeSuggestion.margin, units)} margin, above the budget{leverageSuggestion ? '; raise leverage.' : ` at ${leverage}×.`}</SuggestionLine>)}
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
        {leverageSuggestion && <SuggestionLine testId="leverage-suggestion" label="Accept suggested leverage"
          title="Lowest whole leverage that fits the margin in the budget with the estimated liquidation beyond the farthest stop"
          onAccept={() => needsConfirmation ? commitLeverage(String(leverageSuggestion.leverage)) : updateLeverage(String(leverageSuggestion.leverage))}>
          Leverage <strong>{leverageSuggestion.leverage}×</strong> fits the budget, liq. past the stops</SuggestionLine>}
        {sizing && onRiskChange && <TrackRecord sizing={sizing} onRiskChange={onRiskChange} />}
        {leverage > leverageLimit && <p className="leverage-warning" role="alert">{leverage}× is above the {leverageLimit}× venue maximum for {instrumentName || 'this contract'}.</p>}
        {pendingLeverage !== null && <LeverageChangeDialog draft={draft} from={leverage} to={pendingLeverage} units={units}
          onKeepPrices={() => finishLeverage('prices')} onKeepPercentages={() => finishLeverage('percentages')} onCancel={() => finishLeverage()} />}
      </div>
        <div className="entries-heading">
          <h3>Entries <span className="entry-count">{draft.entries.length}</span></h3>
          <span className="entries-allocated" data-complete={allocated === 100} title="Share of the position's quantity given to entries">{allocated === null ? '—' : `${allocated}%`}</span>
          <Button type="button" variant="ghost" size="icon-sm" className="split-equally" aria-label="Split equally" title={single ? 'A single entry takes the whole position' : 'Split shares equally'} disabled={single} onClick={splitEqually}><Equal size={14} aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon-sm" className="add-entry" aria-label="Add entry" title="Add entry" onClick={addEntry}><Plus size={14} aria-hidden="true" /></Button>
          <Dialog open={expanded} onOpenChange={open => {
            if (open) sidebarBeforeExpansion.current = { selectedId, scrollTop: sidebar.current?.scrollTop ?? 0 }
            setExpanded(open)
          }}>
            <DialogTrigger asChild>
              <Button ref={expandButton} type="button" variant="ghost" size="icon-sm" className="expand-entry" aria-label="Expand selected entry" title="Expand selected entry" disabled={!selected}><Expand size={14} aria-hidden="true" /></Button>
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
              {selected && <EntryForm key={selected.id} entry={selected} onChange={updateEntry} idPrefix={`${prefix}-expanded-${selected.id}`} direction={draft.direction} leverage={leverage} shareLocked={single} maxLeverage={maxLeverage} liquidation={liquidation} limits={limits} />}
            </DialogContent>
          </Dialog>
        </div>
        <div ref={sidebar} className="entry-sidebar" data-testid="entry-sidebar" tabIndex={0} aria-label="Entries">
          {draft.entries.map(entry => <article key={entry.id} className="entry-card" data-selected={selected?.id === entry.id}
            style={{ '--entry-color': entry.color } as CSSProperties} aria-label={`${entry.name} editor`}>
            <div className="entry-header-row">
              <button type="button" className="entry-header" aria-pressed={selected?.id === entry.id} aria-expanded={selected?.id === entry.id}
                ref={node => { if (node) entryButtons.current.set(entry.id, node); else entryButtons.current.delete(entry.id) }}
                onClick={() => selectEntry(entry.id)}>
                <strong><i aria-hidden="true" />{entry.name}</strong>
                <span className="entry-header-price">{entry.price ? `@ ${entry.price}` : 'No price'}</span>
                <span>{entry.share === '' ? '—' : `${entry.share}%`}</span>
                <RewardToRisk entry={entry} direction={draft.direction} leverage={leverage} />
                {selected?.id !== entry.id && <small className="entry-header-levels">{levelCount(entry)}</small>}
              </button>
              {draft.entries.length > 1 && <Button type="button" variant="ghost" size="icon-sm" className="remove-entry" aria-label={`Remove ${entry.name}`}
                title={`Remove ${entry.name}`} onClick={() => removeEntry(entry.id)}><Trash2 size={13} aria-hidden="true" /></Button>}
            </div>
            {shown(entry.id) && <EntryForm entry={entry} onChange={updateEntry} idPrefix={`${prefix}-sidebar-${entry.id}`} direction={draft.direction} leverage={leverage} shareLocked={single} maxLeverage={maxLeverage} liquidation={liquidation} limits={limits} />}
            {expanded && selected?.id === entry.id && <p className="muted expanded-placeholder">Editing in the expanded view.</p>}
          </article>)}
        </div>
  </section>
}

/** Planned reward to risk in the entry header; a dash until it has a price, a stop and a target. */
function RewardToRisk({ entry, direction, leverage }: { entry: DraftEntry; direction: PlayDraft['direction']; leverage: number }) {
  const ratio = rewardToRisk(entry, direction, leverage)
  return <span className="entry-header-rr" data-weak={ratio !== null && ratio < 1 ? true : undefined}
    title="Planned reward to risk: share-weighted target distance over stop distance, before fees">
    <small>R:R</small> {ratio === null ? '—' : formatRewardToRisk(ratio)}
  </span>
}

/** "2 SL · 1 TP" for a collapsed entry, counting levels with a value. */
function levelCount(entry: DraftEntry) {
  const stops = entry.stops.filter(stop => stop.value.trim() !== '').length
  const targets = entry.targets.filter(target => target.value.trim() !== '').length
  return [stops && `${stops} SL`, targets && `${targets} TP`].filter(Boolean).join(' · ')
}
