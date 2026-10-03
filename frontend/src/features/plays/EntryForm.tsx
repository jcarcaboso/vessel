import { useId } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createExit, type DraftEntry, type DraftExit, type PlayDraft } from './draft'
import { exitsOf, formatDraggedPrice, levelPrice, priceMovePercent, type ExitKind } from './levels'

function LevelUnits({ value, label, onChange }: {
  value: DraftExit['unit']
  label: string
  onChange: (unit: DraftExit['unit']) => void
}) {
  return <div className="level-unit-switch segmented" role="group" aria-label={label}>
    {(['price', 'percent'] as const).map(unit => <button key={unit} type="button" aria-pressed={unit === value}
      aria-label={unit === 'price' ? 'Price' : '% return at leverage'}
      onClick={() => { if (unit !== value) onChange(unit) }}>
      {unit === 'price' ? 'Price' : '%'}
    </button>)}
  </div>
}

const copy = {
  stop: { legend: 'Planned stops', singular: 'stop', title: 'Stop', price: 'Stop price', percent: 'Loss on margin' },
  target: { legend: 'Partial planned targets', singular: 'target', title: 'Target', price: 'Target price', percent: 'Gain on margin' },
} as const

/** Stops or targets of one entry. Each closes a share of the entry; percentages are returns at the play's leverage. */
function ExitList({ entry, kind, direction, leverage, onChange, prefix }: {
  entry: DraftEntry
  kind: ExitKind
  direction: PlayDraft['direction']
  leverage: number
  onChange: (entry: DraftEntry) => void
  prefix: string
}) {
  const exits = exitsOf(entry, kind)
  const text = copy[kind]
  const set = (next: DraftExit[]) => onChange(kind === 'stop' ? { ...entry, stops: next } : { ...entry, targets: next })
  const update = (id: string, change: Partial<DraftExit>) => set(exits.map(exit => exit.id === id ? { ...exit, ...change } : exit))
  const entryPrice = Number(entry.price) > 0 ? Number(entry.price) : null
  // Single stops keep the short "stop" names; numbering starts once there are several.
  const label = (index: number) => exits.length > 1 || kind === 'target' ? `${kind} ${index + 1}` : kind

  return <fieldset className={kind === 'stop' ? 'entry-targets entry-stops' : 'entry-targets'}>
    <legend>{text.legend}</legend>
    {exits.map((exit, index) => {
      const resolved = exit.unit === 'percent' ? levelPrice(entryPrice, exit, kind, direction, leverage) : null
      const move = exit.unit === 'percent' && Number(exit.value) > 0 ? priceMovePercent(Number(exit.value), leverage) : null
      return <fieldset key={exit.id} className="entry-target">
        <legend>{text.title} {exits.length > 1 || kind === 'target' ? index + 1 : ''}</legend>
        <div className="level-mode">
          <span>{text.title} units</span>
          <LevelUnits label={`${entry.name} ${label(index)} units`} value={exit.unit}
            onChange={unit => update(exit.id, { unit, value: '' })} />
        </div>
        <label className={kind === 'stop' ? 'stop-label' : 'target-label'} htmlFor={`${prefix}-${exit.id}-value`}>
          <span>{exit.unit === 'price' ? text.price : text.percent}
            <small>{exit.unit === 'price' ? 'quote units' : `% at ${leverage}×`}</small></span>
          <Input id={`${prefix}-${exit.id}-value`} type="number" step="any" min={0}
            aria-label={`${entry.name} planned ${label(index)} ${exit.unit === 'price' ? 'price (quote units)' : `return at ${leverage}× leverage (%)`}`}
            value={exit.value} onChange={event => update(exit.id, { value: event.target.value })} />
        </label>
        <label className="target-share" htmlFor={`${prefix}-${exit.id}-share`}>
          <span>Share <small>% of entry</small></span>
          <Input id={`${prefix}-${exit.id}-share`} type="number" step="any" min={0} max={100}
            aria-label={`${entry.name} ${label(index)} share (%)`} value={exit.share}
            onChange={event => update(exit.id, { share: event.target.value })} />
        </label>
        <Button type="button" variant="ghost" size="icon-sm" className="remove-target" aria-label={`Remove ${entry.name} ${label(index)}`}
          onClick={() => set(exits.filter(current => current.id !== exit.id))}>
          <X aria-hidden="true" size={14} />
        </Button>
        {move !== null && <p className="level-resolved">
          {resolved === null ? `A ${formatDraggedPrice(move)}% price move. Set the entry price to place it.`
            : `≈ ${formatDraggedPrice(resolved)} · a ${formatDraggedPrice(move)}% price move at ${leverage}×`}
        </p>}
      </fieldset>
    })}
    <Button type="button" variant="ghost" size="sm" className="add-target" aria-label={`Add ${text.singular} to ${entry.name}`}
      onClick={() => set([...exits, createExit(exits.length ? '' : '100')])}>Add {text.singular}</Button>
  </fieldset>
}

export function EntryForm({ entry, onChange, idPrefix, direction = 'long', leverage = 1 }: {
  entry: DraftEntry
  onChange: (entry: DraftEntry) => void
  idPrefix?: string
  direction?: PlayDraft['direction']
  /** The play's leverage; percentage levels are returns on margin at it. */
  leverage?: number
}) {
  const generatedId = useId()
  const prefix = idPrefix ?? generatedId

  return <div className="entry-fields">
    <label htmlFor={`${prefix}-share`}>
      <span>Quantity share <small>% of full position</small></span>
      <Input id={`${prefix}-share`} type="number" step="any" min={0} max={100}
        aria-label={`${entry.name} quantity share (%)`} value={entry.share}
        onChange={event => onChange({ ...entry, share: event.target.value })} />
    </label>
    <label htmlFor={`${prefix}-price`}>
      <span>Planned entry price <small>quote units</small></span>
      <Input id={`${prefix}-price`} type="number" step="any" min={0}
        aria-label={`${entry.name} planned entry price (quote units)`} value={entry.price}
        onChange={event => onChange({ ...entry, price: event.target.value })} />
    </label>
    <ExitList entry={entry} kind="stop" direction={direction} leverage={leverage} onChange={onChange} prefix={prefix} />
    <ExitList entry={entry} kind="target" direction={direction} leverage={leverage} onChange={onChange} prefix={prefix} />
    <p className="muted">Planned levels, not fills. A % level is the return on margin at the play's leverage, so at {leverage}× it is a {leverage === 1 ? 'price move of the same size' : `${leverage} times smaller price move`}. Switching level units clears the value. Unsaved edits stay in memory.</p>
  </div>
}
