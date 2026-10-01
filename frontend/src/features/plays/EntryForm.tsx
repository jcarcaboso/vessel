import { useId } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createTarget, type DraftEntry, type DraftLevel } from './draft'

function LevelUnits({ value, label, onChange }: {
  value: DraftLevel['unit']
  label: string
  onChange: (unit: DraftLevel['unit']) => void
}) {
  return <div className="level-unit-switch segmented" role="group" aria-label={label}>
    {(['price', 'percent'] as const).map(unit => <button key={unit} type="button" aria-pressed={unit === value}
      aria-label={unit === 'price' ? 'Price' : '% from entry'}
      onClick={() => { if (unit !== value) onChange(unit) }}>
      {unit === 'price' ? 'Price' : '%'}
    </button>)}
  </div>
}

export function EntryForm({ entry, onChange, idPrefix }: {
  entry: DraftEntry
  onChange: (entry: DraftEntry) => void
  idPrefix?: string
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
    <fieldset className="entry-level">
      <legend>Planned stop</legend>
      <div className="level-mode">
        <span>Stop units</span>
        <LevelUnits label={`${entry.name} stop units`} value={entry.stop.unit}
          onChange={unit => onChange({ ...entry, stop: { ...entry.stop, unit, value: '' } })} />
      </div>
      <label className="stop-label" htmlFor={`${prefix}-stop-value`}>
        <span>{entry.stop.unit === 'price' ? 'Stop price' : 'Stop distance from entry'}
          <small>{entry.stop.unit === 'price' ? 'quote units' : '%'}</small></span>
        <Input id={`${prefix}-stop-value`} type="number" step="any" min={0}
          aria-label={`${entry.name} planned stop ${entry.stop.unit === 'price' ? 'price (quote units)' : 'distance from entry (%)'}`}
          value={entry.stop.value}
          onChange={event => onChange({ ...entry, stop: { ...entry.stop, value: event.target.value } })} />
      </label>
    </fieldset>
    <fieldset className="entry-targets">
      <legend>Partial planned targets</legend>
      {entry.targets.map((target, index) => <fieldset key={target.id} className="entry-target">
        <legend>Target {index + 1}</legend>
        <div className="level-mode">
          <span>Target units</span>
          <LevelUnits label={`${entry.name} target ${index + 1} units`} value={target.unit}
            onChange={unit => onChange({
              ...entry,
              targets: entry.targets.map(current => current.id === target.id ? { ...current, unit, value: '' } : current),
            })} />
        </div>
        <label className="target-label" htmlFor={`${prefix}-${target.id}-value`}>
          <span>{target.unit === 'price' ? 'Target price' : 'Target distance from entry'}
            <small>{target.unit === 'price' ? 'quote units' : '%'}</small></span>
          <Input id={`${prefix}-${target.id}-value`} type="number" step="any" min={0}
            aria-label={`${entry.name} planned target ${index + 1} ${target.unit === 'price' ? 'price (quote units)' : 'distance from entry (%)'}`}
            value={target.value}
            onChange={event => onChange({
              ...entry,
              targets: entry.targets.map(current => current.id === target.id ? { ...current, value: event.target.value } : current),
            })} />
        </label>
        <label className="target-share" htmlFor={`${prefix}-${target.id}-share`}>
          <span>Share <small>% of entry</small></span>
          <Input id={`${prefix}-${target.id}-share`} type="number" step="any" min={0} max={100}
            aria-label={`${entry.name} target ${index + 1} share (%)`} value={target.share}
            onChange={event => onChange({
              ...entry,
              targets: entry.targets.map(current => current.id === target.id ? { ...current, share: event.target.value } : current),
            })} />
        </label>
        <Button type="button" variant="ghost" size="icon-sm" className="remove-target" aria-label={`Remove ${entry.name} target ${index + 1}`}
          onClick={() => onChange({ ...entry, targets: entry.targets.filter(current => current.id !== target.id) })}>
          <X aria-hidden="true" size={14} />
        </Button>
      </fieldset>)}
      <Button type="button" variant="ghost" size="sm" className="add-target" aria-label={`Add target to ${entry.name}`}
        onClick={() => onChange({
          ...entry,
          targets: [...entry.targets, createTarget()],
        })}>Add target</Button>
    </fieldset>
    <p className="muted">Planned levels, not fills. Percentages are distances from entry, not leveraged returns. Switching level units clears the value. Unsaved edits stay in memory.</p>
  </div>
}
