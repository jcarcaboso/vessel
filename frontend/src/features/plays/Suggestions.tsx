import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { riskPercentRange, type SizingDocument } from '@/api/sizing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { failure } from './saved'
import { exposureLabels } from './suggestions'

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
/** "1.25" from an API decimal string, or null when it is missing or not a number. */
const decimal = (value: string | null) => value === null || !Number.isFinite(Number(value)) ? null : number.format(Number(value))

/**
 * One suggestion: a short warning-colour line with an Accept button. Nothing applies until the
 * owner accepts; accepting changes only the field the line belongs to.
 */
export function SuggestionLine({ children, label, onAccept, title, testId }: {
  children: ReactNode
  /** What Accept does, for assistive technology, e.g. "Accept suggested size". */
  label: string
  /** Without it the line only informs. */
  onAccept?: (() => void) | undefined
  title?: string
  testId?: string
}) {
  return <p className="sizing-suggestion" title={title} data-testid={testId}>
    <span>{children}</span>
    {onAccept && <Button type="button" variant="outline" size="sm" aria-label={label} onClick={onAccept}>Accept</Button>}
  </p>
}

/** Record details and the exposure reason, one fact per line, for the track record tooltip. */
function recordDetails(sizing: SizingDocument) {
  const { record, exposure, limits } = sizing
  const lines = [exposure.reason]
  if (record.decidedPlays) {
    lines.push(`Last ${Math.min(record.decidedPlays, record.window)} decided of ${record.closedPlays} closed: ${record.wins} wins, ${record.losses} losses${record.scratches ? `, ${record.scratches} scratches` : ''}.`)
    const gain = decimal(record.averageGainPercent)
    const loss = decimal(record.averageLossPercent)
    if (gain !== null || loss !== null) lines.push(`Average gain ${gain ?? '—'}%, average loss ${loss ?? '—'}%.`)
    const winR = decimal(record.averageWinR)
    const lossR = decimal(record.averageLossR)
    if (winR !== null || lossR !== null) lines.push(`Average R: wins ${winR ?? '—'}, losses ${lossR ?? '—'}.`)
    const breakEven = decimal(record.breakEvenRewardRisk)
    if (breakEven !== null) lines.push(`Break-even R:R 1:${breakEven}.`)
  }
  lines.push(`Effective risk ${decimal(limits.effectiveRiskPercent) ?? '—'}% · max stop ${decimal(limits.maxStopPercent) ?? '—'}% · min R:R 1:${decimal(limits.minRewardRisk) ?? '—'}.`)
  if (sizing.notice) lines.push(sizing.notice)
  return lines.join('\n')
}

/**
 * Closed-play record in one line: batting average, win/loss ratio and the exposure level while it is
 * reduced, with the details in a tooltip. The risk per trade is edited in place.
 */
export function TrackRecord({ sizing, onRiskChange }: {
  sizing: SizingDocument
  /** Saves the risk setting; rejects with the reason it was not saved. */
  onRiskChange: (riskPercent: string) => Promise<void>
}) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const { record, exposure, settings } = sizing
  const risk = Number(settings.riskPercent)
  const typed = Number(value)
  const valid = /^\d+(\.\d+)?$/.test(value.trim()) && typed >= riskPercentRange.min && typed <= riskPercentRange.max

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid) { setError(`${riskPercentRange.min} to ${riskPercentRange.max}%`); return }
    setSaving(true)
    try {
      await onRiskChange(value.trim())
      setEditing(false)
      setError('')
    } catch (cause) {
      setError(failure(cause))
    } finally {
      setSaving(false)
    }
  }

  const batting = decimal(record.battingAverage === null ? null : String(Number(record.battingAverage) * 100))
  const ratio = decimal(record.winLossRatio)
  const summary = record.decidedPlays === 0
    ? record.closedPlays === 0 ? 'No closed plays yet' : 'No wins or losses yet'
    : `Wins ${batting ?? '—'}% · W/L ${ratio ?? '—'}`

  return <div className="track-record" data-testid="track-record">
    <span className="track-record-summary" title={recordDetails(sizing)} tabIndex={0}>
      {summary}
      {exposure.level !== 'full' && <> · <strong className="track-record-exposure">{exposureLabels[exposure.level]}</strong></>}
    </span>
    {editing ? <form className="track-record-risk" onSubmit={event => { void save(event) }} noValidate
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setEditing(false); setError('') } }}>
      <label htmlFor={`${id}-risk`}>Risk</label>
      <Input id={`${id}-risk`} type="number" step="any" min={riskPercentRange.min} max={riskPercentRange.max} autoFocus value={value}
        aria-label="Risk per trade (%)" aria-invalid={!!error || undefined} aria-describedby={error || typed > riskPercentRange.warnAbove ? `${id}-risk-note` : undefined}
        disabled={saving} onChange={event => { setValue(event.target.value); setError('') }} />
      <span aria-hidden="true">%</span>
      <Button type="submit" variant="ghost" size="icon-sm" aria-label="Save risk per trade" disabled={saving}><Check size={13} aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" disabled={saving} onClick={() => { setEditing(false); setError('') }}><X size={13} aria-hidden="true" /></Button>
      {(error || typed > riskPercentRange.warnAbove) && <small id={`${id}-risk-note`} className="track-record-note" role={error ? 'alert' : undefined}>
        {error || `Above ${riskPercentRange.warnAbove}%`}</small>}
    </form> : <button type="button" className="track-record-edit" data-warning={risk > riskPercentRange.warnAbove || undefined}
      aria-label={`Risk per trade ${decimal(settings.riskPercent)}%. Edit`}
      title={risk > riskPercentRange.warnAbove ? `Above ${riskPercentRange.warnAbove}% per trade` : 'Risk per trade, as a share of the account balance'}
      onClick={() => { setValue(settings.riskPercent); setError(''); setEditing(true) }}>
      risk {decimal(settings.riskPercent)}%
    </button>}
  </div>
}
