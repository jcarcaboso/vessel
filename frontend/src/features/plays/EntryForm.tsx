import { useId } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createExit, type DraftEntry, type DraftExit, type PlayDraft } from './draft'
import { exitsOf, formatDraggedPrice, levelPrice, priceMovePercent, type ExitKind } from './levels'
import { wrongSide } from './planChecks'

function LevelUnits({ value, label, onChange }: {
  value: DraftExit['unit']
  label: string
  onChange: (unit: DraftExit['unit']) => void
}) {
  return <div className="level-unit-switch segmented" role="group" aria-label={label}>
    {(['price', 'percent'] as const).map(unit => <button key={unit} type="button" aria-pressed={unit === value}
      aria-label={unit === 'price' ? 'Price' : '% return at leverage'}
      onClick={() => { if (unit !== value) onChange(unit) }}>
      {unit === 'price' ? '$' : '%'}
    </button>)}
  </div>
}

const copy = {
  stop: { legend: 'Planned stops', singular: 'stop' },
  target: { legend: 'Planned targets', singular: 'target' },
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

  return <fieldset className={kind === 'stop' ? 'exit-list exit-stops' : 'exit-list exit-targets'}>
    <legend className="sr-only">{text.legend}</legend>
    <div className="exit-list-heading">
      <span>{kind === 'stop' ? 'Stops' : 'Targets'}</span>
      <Button type="button" variant="ghost" size="icon-sm" className="add-target" aria-label={`Add ${text.singular} to ${entry.name}`} title={`Add ${text.singular}`}
        onClick={() => set([...exits, createExit(exits.length ? '' : '100')])}><Plus size={13} aria-hidden="true" /></Button>
    </div>
    {exits.map((exit, index) => {
      const resolved = exit.unit === 'percent' ? levelPrice(entryPrice, exit, kind, direction, leverage) : null
      const move = exit.unit === 'percent' && Number(exit.value) > 0 ? priceMovePercent(Number(exit.value), leverage) : null
      const wrong = wrongSide(entryPrice, exit, kind, direction)
      return <div key={exit.id} className="exit-row" role="group" aria-label={`${entry.name} ${label(index)}`}>
        <LevelUnits label={`${entry.name} ${label(index)} units`} value={exit.unit}
          onChange={unit => update(exit.id, { unit, value: '' })} />
        <Input id={`${prefix}-${exit.id}-value`} type="number" step="any" min={0} className={kind === 'stop' ? 'exit-value-stop' : 'exit-value-target'}
          placeholder={exit.unit === 'price' ? '$' : kind === 'stop' ? 'Loss %' : 'Gain %'}
          aria-label={`${entry.name} planned ${label(index)} ${exit.unit === 'price' ? 'price (quote units)' : `return at ${leverage}× leverage (%)`}`}
          aria-invalid={wrong || undefined} title={wrong ? `A ${direction} ${kind} goes ${(kind === 'target') === (direction === 'long') ? 'above' : 'below'} the entry price` : undefined}
          value={exit.value} onChange={event => update(exit.id, { value: event.target.value })} />
        <Input id={`${prefix}-${exit.id}-share`} type="number" step="any" min={0} max={100} placeholder="Share %" className="exit-share"
          aria-label={`${entry.name} ${label(index)} share (%)`} value={exit.share}
          onChange={event => update(exit.id, { share: event.target.value })} />
        <Button type="button" variant="ghost" size="icon-sm" className="remove-target" aria-label={`Remove ${entry.name} ${label(index)}`}
          onClick={() => set(exits.filter(current => current.id !== exit.id))}>
          <X aria-hidden="true" size={14} />
        </Button>
        {move !== null && <p className="level-resolved">
          {resolved === null ? `${formatDraggedPrice(move)}% price move` : `≈ ${formatDraggedPrice(resolved)} · ${formatDraggedPrice(move)}% move at ${leverage}×`}
        </p>}
      </div>
    })}
  </fieldset>
}

export function EntryForm({ entry, onChange, idPrefix, direction = 'long', leverage = 1, shareLocked = false }: {
  entry: DraftEntry
  onChange: (entry: DraftEntry) => void
  idPrefix?: string
  direction?: PlayDraft['direction']
  /** The play's leverage; percentage levels are returns on margin at it. */
  leverage?: number
  /** A single entry takes the whole position, so its share cannot change. */
  shareLocked?: boolean
}) {
  const generatedId = useId()
  const prefix = idPrefix ?? generatedId

  return <div className="entry-fields">
    <label htmlFor={`${prefix}-share`}>
      <span>Share %</span>
      <Input id={`${prefix}-share`} type="number" step="any" min={0} max={100}
        aria-label={`${entry.name} quantity share (%)`} value={shareLocked ? '100' : entry.share} disabled={shareLocked}
        title={shareLocked ? 'A single entry takes the whole position. Add an entry to split it.' : undefined}
        onChange={event => onChange({ ...entry, share: event.target.value })} />
    </label>
    <label htmlFor={`${prefix}-price`}>
      <span>Entry price</span>
      <Input id={`${prefix}-price`} type="number" step="any" min={0}
        aria-label={`${entry.name} planned entry price (quote units)`} value={entry.price}
        onChange={event => onChange({ ...entry, price: event.target.value })} />
    </label>
    <ExitList entry={entry} kind="stop" direction={direction} leverage={leverage} onChange={onChange} prefix={prefix} />
    <ExitList entry={entry} kind="target" direction={direction} leverage={leverage} onChange={onChange} prefix={prefix} />
  </div>
}
