import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createEntry, type DraftEntry, type PlayDraft } from './draft'
import { EntryForm } from './EntryForm'
import { Expand, Plus, Trash2 } from 'lucide-react'

const leveragePresets = [1, 5, 10, 25]

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

export function PositionEditor({ draft, onChange, selectedId, selectionRequest = 0, onSelect }: {
  draft: PlayDraft
  onChange: (draft: PlayDraft) => void
  selectedId: string
  selectionRequest?: number
  onSelect: (id: string) => void
}) {
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

  function updateLeverage(value: string) {
    const leverage = value === '' ? '' : String(Math.min(100, Math.max(1, Math.round(Number(value)))))
    onChange({ ...draft, leverage })
  }

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
            <small>{draft.sizingMode === 'margin' ? 'currency units' : 'instrument units'}</small></span>
          <Input id={`${prefix}-size`} type="number" min={0} step="any" value={draft.size} placeholder="Enter total size"
            onChange={event => onChange({ ...draft, size: event.target.value })} />
        </label>
        <label htmlFor={`${prefix}-sizing-mode`}>
          <span>Size input</span>
          <select id={`${prefix}-sizing-mode`} aria-label="Whole-position sizing" value={draft.sizingMode}
            onChange={event => {
              const sizingMode = event.target.value as PlayDraft['sizingMode']
              if (sizingMode !== draft.sizingMode) onChange({ ...draft, sizingMode, size: '' })
            }}>
            <option value="margin">Margin · currency</option>
            <option value="quantity">Quantity · instrument</option>
          </select>
        </label>
      </div>
      <div className="leverage-controls">
        <label htmlFor={`${prefix}-leverage-slider`}>Leverage <small>1× = unlevered</small></label>
        <div className="leverage-input-row">
          <input id={`${prefix}-leverage-slider`} type="range" min={1} max={100} step={1} value={draft.leverage || '1'}
            style={{ '--range-progress': `${(Number(draft.leverage || '1') - 1) / 99 * 100}%` } as CSSProperties}
            aria-label="Leverage slider (×)" aria-valuetext={draft.leverage ? `${draft.leverage} times` : 'Not specified'}
            onChange={event => updateLeverage(event.target.value)} />
          <Input id={`${prefix}-leverage`} type="number" min={1} max={100} step={1} value={draft.leverage}
            aria-label="Leverage (×)" onChange={event => updateLeverage(event.target.value)} />
          <span aria-hidden="true">×</span>
        </div>
        <div className="leverage-presets" role="group" aria-label="Leverage presets">
          {leveragePresets.map(preset => <button key={preset} type="button" aria-pressed={draft.leverage === String(preset)}
            onClick={() => updateLeverage(String(preset))}>{preset}×</button>)}
        </div>
      </div>
      <p className="muted">Sizing and payoff calculations are deferred. Changing sizing units clears size. The 1× to 100× control range is not venue-validated.</p>
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
          : <EntryForm entry={entry} onChange={updateEntry} idPrefix={`${prefix}-sidebar-${entry.id}`} />}
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
          {selected && <EntryForm key={selected.id} entry={selected} onChange={updateEntry} idPrefix={`${prefix}-expanded-${selected.id}`} />}
        </DialogContent>
      </Dialog>
    </div>
  </section>
}
