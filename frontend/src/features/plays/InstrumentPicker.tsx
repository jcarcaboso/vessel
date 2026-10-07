import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import type { VenueInstrument } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PlayDraft } from './draft'
import { pairLabel, searchInstruments, type InstrumentCatalogState } from './instruments'

/** Tags for non-crypto perpetuals, so a stock or commodity is never mistaken for a token. */
const categoryLabels: Record<string, string> = { stocks: 'Stock', commodity: 'Commodity', index_etf: 'Index/ETF' }

export function InstrumentPicker({ catalog: state, value, source, onChange }: {
  catalog: InstrumentCatalogState
  value: string
  source: PlayDraft['instrumentSource']
  onChange: (value: string, source: PlayDraft['instrumentSource']) => void
}) {
  const id = useId()
  const { accountId, catalog, error, loading } = state
  const manual = accountId === null || source === 'manual'
  const choices = useMemo(() => catalog?.instruments ?? [], [catalog])
  const selected = choices.find(instrument => instrument.contractId === value)

  // Switching between the venue catalogue and a manual label sits beside the field label.
  const sourceSwitch = accountId !== null && (manual
    ? <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(value, 'venue'); state.retry() }}>Use venue catalogue</Button>
    : <Button type="button" variant="ghost" size="sm" aria-label="Enter manually" onClick={() => onChange(value, 'manual')}>Manual</Button>)

  return <div className="plays-instrument-field">
    <div className="plays-field-heading">
      <label htmlFor={`${id}-instrument`}>Instrument</label>
      {sourceSwitch && <span className="instrument-actions">{sourceSwitch}</span>}
    </div>
    {manual ? <Input id={`${id}-instrument`} aria-label="Perpetual instrument" value={value}
      placeholder="Manual contract label" onChange={event => onChange(event.target.value, 'manual')} />
      : <InstrumentSearch id={`${id}-instrument`} choices={choices} value={value} selected={selected}
        disabled={loading || !choices.length} loading={loading} onSelect={contract => onChange(contract, 'venue')} />}
    <div className="instrument-feedback">
      {error && <p role="alert">{error}</p>}
      {manual ? <p>Manual label, not venue-validated.</p> :
        catalog && <p>{!choices.length && 'No selectable perpetual contracts.'}
          {selected && <abbr title="Venue maximum leverage for this contract. The leverage control is limited to it.">Max {selected.maxLeverage}×</abbr>}
          {value && !selected && <span> · {value} is not in the current catalogue</span>}</p>}
      {accountId !== null && error && <div className="instrument-actions">
        <Button type="button" variant="ghost" size="sm" onClick={state.retry}>Retry instruments</Button>
      </div>}
    </div>
  </div>
}

/** Searchable venue contract list. Typing filters; Enter or a click picks; Escape restores the current choice. */
function InstrumentSearch({ id, choices, value, selected, disabled, loading, onSelect }: {
  id: string
  choices: readonly VenueInstrument[]
  value: string
  selected: VenueInstrument | undefined
  disabled: boolean
  loading: boolean
  onSelect: (contractId: string) => void
}) {
  const listId = `${id}-list`
  const display = selected ? pairLabel(selected) : value
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const open = query !== null
  const results = useMemo(() => open ? searchInstruments(choices, query) : [], [choices, open, query])
  const highlighted = results[Math.min(active, results.length - 1)]

  const close = () => setQuery(null)
  const choose = (instrument: VenueInstrument) => {
    onSelect(instrument.contractId)
    close()
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { setQuery(''); setActive(0); return }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(current => Math.max(0, Math.min(results.length - 1, current + step)))
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (highlighted) choose(highlighted)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  return <div className="instrument-search" data-open={open}>
    <Input id={id} role="combobox" aria-label="Perpetual instrument" aria-expanded={open} aria-controls={listId}
      aria-autocomplete="list" aria-activedescendant={open && highlighted ? `${listId}-${highlighted.contractId}` : undefined}
      autoComplete="off" spellCheck={false} disabled={disabled} aria-busy={loading}
      placeholder={loading ? 'Loading venue instruments…' : choices.length ? 'Search, e.g. BTC' : 'Catalogue unavailable'}
      value={open ? query : display}
      // Tabbing in selects the current pair so typing replaces it; a click or the arrow keys open the full list.
      onFocus={event => event.currentTarget.select()}
      onClick={() => { if (!open) { setQuery(''); setActive(0) } }}
      onChange={event => { setQuery(event.target.value); setActive(0) }}
      onBlur={close} onKeyDown={onKeyDown} />
    {open && <ul id={listId} role="listbox" aria-label="Perpetual instruments" className="instrument-options">
      {results.map(instrument => <li key={instrument.contractId} id={`${listId}-${instrument.contractId}`} role="option"
        aria-selected={instrument === highlighted} data-current={instrument.contractId === value}
        // Pointer down keeps focus in the input, so blur does not close the list before the click lands.
        onPointerDown={event => event.preventDefault()} onClick={() => choose(instrument)}>
        <span>{pairLabel(instrument)}{instrument.category && instrument.category !== 'crypto' &&
          <em className="instrument-category">{categoryLabels[instrument.category] ?? instrument.category}</em>}</span><small>{instrument.maxLeverage}×</small>
      </li>)}
      {results.length === 0 && <li className="instrument-empty" role="presentation">No perpetual matches “{query}”.</li>}
    </ul>}
  </div>
}
