import { useEffect, useId, useState } from 'react'
import type { BrokerAccount, InstrumentCatalog, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PlayDraft } from './draft'

export function InstrumentPicker({ account, api, value, source, onChange }: {
  account: BrokerAccount | undefined
  api: WorkspaceApi
  value: string
  source: PlayDraft['instrumentSource']
  onChange: (value: string, source: PlayDraft['instrumentSource']) => void
}) {
  const id = useId()
  const [generation, setGeneration] = useState(0)
  const [result, setResult] = useState<{
    api: WorkspaceApi; accountId: string; generation: number
    catalog: InstrumentCatalog | null; error: string | null
  } | null>(null)
  const accountId = account?.isEnabled !== false && account?.venueId === 'hyperliquid' ? account.id : null
  const current = result?.api === api && result.accountId === accountId && result.generation === generation ? result : null
  const loading = accountId !== null && current === null
  const manual = accountId === null || source === 'manual'
  const choices = current?.catalog?.instruments ?? []
  const selected = choices.find(instrument => instrument.contractId === value)

  useEffect(() => {
    if (accountId === null) return
    const controller = new AbortController()
    let active = true
    api.instruments(accountId, controller.signal).then(catalog => {
      if (!active) return
      const matches = catalog.venueId === 'hyperliquid' && catalog.scope === 'primary-perpetual-dex'
      setResult({ api, accountId, generation, catalog: matches ? catalog : null,
        error: matches ? null : 'The catalogue does not match the selected venue.' })
    }).catch(cause => {
      if (active) setResult({ api, accountId, generation, catalog: null,
        error: cause instanceof ApiError ? cause.message : 'The venue catalogue could not be loaded.' })
    })
    return () => { active = false; controller.abort() }
  }, [api, accountId, generation])

  return <div className="plays-instrument-field">
    <label htmlFor={`${id}-instrument`}>Instrument</label>
    {manual ? <Input id={`${id}-instrument`} aria-label="Perpetual instrument" value={value}
      placeholder="Manual contract label" onChange={event => onChange(event.target.value, 'manual')} /> :
      <select id={`${id}-instrument`} aria-label="Perpetual instrument" value={value}
        disabled={loading || !choices.length} aria-busy={loading}
        onChange={event => onChange(event.target.value, 'venue')}>
        <option value="">{loading ? 'Loading venue instruments…' : choices.length ? 'Choose a perpetual' : 'Catalogue unavailable'}</option>
        {value && !selected && <option value={value} disabled>{value} · not in current catalogue</option>}
        {choices.map(instrument => <option key={instrument.contractId} value={instrument.contractId}>{instrument.contractId} perpetual</option>)}
      </select>}
    <div className="instrument-feedback">
      {current?.error && <p role="alert">{current.error}</p>}
      {manual ? <p>Manual label, not venue-validated.</p> :
        current?.catalog && <p>{choices.length ? 'Primary perps' : 'No selectable primary perpetual contracts.'}
          {selected && <abbr title="Catalogue maximum leverage. Full position validation is deferred."> · Max {selected.maxLeverage}×</abbr>}</p>}
      {accountId !== null && <div className="instrument-actions">
        {manual ? <Button type="button" variant="ghost" size="sm" onClick={() => {
          onChange(value, 'venue')
          setGeneration(current => current + 1)
        }}>Use venue catalogue</Button> :
          <Button type="button" variant="ghost" size="sm" aria-label="Enter manually"
            onClick={() => onChange(value, 'manual')}>Manual</Button>}
        {current?.error && <Button type="button" variant="ghost" size="sm"
          onClick={() => setGeneration(current => current + 1)}>Retry instruments</Button>}
      </div>}
    </div>
  </div>
}
