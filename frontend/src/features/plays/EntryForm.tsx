import { Input } from '@/components/ui/input'
import type { SampleEntry } from './sample'

export function EntryForm({ entry, onChange }: { entry: SampleEntry; onChange: (entry: SampleEntry) => void }) {
  return <div className="entry-fields">
    {([
      ['share', 'Quantity share', '%'], ['price', 'Planned entry', 'USD'],
      ['stop', 'Stop price', 'USD'], ['target', 'Target price', 'USD'],
    ] as const).map(([field, label, unit]) => <label key={field}>
      <span>{label} <small>{unit}</small></span>
      <Input type="number" step="any" min={field === 'share' ? 0 : undefined} max={field === 'share' ? 100 : undefined}
        aria-label={`${entry.name} ${label.toLowerCase()}`} value={entry[field]}
        onChange={(event) => onChange({ ...entry, [field]: event.target.value })} />
    </label>)}
    <p className="muted">Planned levels, not fills. Sample changes stay in memory.</p>
  </div>
}
