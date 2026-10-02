import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DraftEntry, PlayDraft } from './draft'
import {
  addChartStop, addChartTarget, applyLevelDrag, formatDraggedPrice, overlayPrice, parseOverlayId, removeTarget, setTargetShare,
} from './levels'

const decimal = /^\d+(\.\d+)?$/

/**
 * In-chart editor for one planned level. The chart always edits a price; levels entered as a
 * percentage keep that unit and store the equivalent distance, as dragging does.
 */
export function LevelEditor({ entry, entryIndex, overlayId, anchor, direction, onApply, onClose }: {
  entry: DraftEntry
  entryIndex: number
  overlayId: string
  anchor: { x: number; y: number }
  direction: PlayDraft['direction']
  onApply: (next: DraftEntry, label: string) => void
  onClose: () => void
}) {
  const ref = parseOverlayId(overlayId)
  const target = ref?.kind === 'target' ? entry.targets.find(current => current.id === ref.targetId) ?? null : null
  const current = overlayPrice(entry, overlayId, direction)
  const [price, setPrice] = useState(current === null ? '' : formatDraggedPrice(current))
  const [share, setShare] = useState(target?.share ?? '')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const [bounds, setBounds] = useState({ width: 600, height: 400, own: 190 })
  useEffect(() => { input.current?.select() }, [])
  // Keep the editor inside the chart area next to the level it edits.
  useLayoutEffect(() => {
    const parent = form.current?.parentElement
    if (parent?.clientWidth) setBounds({ width: parent.clientWidth, height: parent.clientHeight, own: form.current!.offsetHeight || 190 })
  }, [])
  if (!ref) return null

  const targetIndex = target ? entry.targets.indexOf(target) : -1
  const name = ref.kind === 'entry' ? 'Entry' : ref.kind === 'stop' ? 'Stop' : `Target ${targetIndex + 1}`
  const tag = `E${entryIndex + 1}`
  const percentUnit = ref.kind === 'stop' ? entry.stop.unit === 'percent' : target?.unit === 'percent'
  const stopPlotted = overlayPrice(entry, `${entry.id}|stop`, direction) !== null
  const entryPriced = overlayPrice(entry, `${entry.id}|entry`, direction) !== null

  function save(event: FormEvent) {
    event.preventDefault()
    if (!decimal.test(price.trim()) || Number(price) <= 0) { setError('Enter a price above zero.'); return }
    if (target && share.trim() !== '' && (!decimal.test(share.trim()) || Number(share) > 100)) { setError('Share must be 0 to 100%.'); return }
    let next = applyLevelDrag([entry], overlayId, Number(price), direction)[0]!
    if (target) next = setTargetShare(next, target.id, share.trim())
    onApply(next, `Edit ${tag} ${name.toLowerCase()}`)
    onClose()
  }
  const act = (next: DraftEntry | null, label: string) => { if (next) { onApply(next, label); onClose() } }

  const width = 236
  const left = Math.max(8, Math.min(anchor.x + 10, bounds.width - width - 8))
  const top = Math.max(8, Math.min(anchor.y - 24, bounds.height - bounds.own - 8))
  return <form ref={form} className="level-editor" style={{ left, top, width }} aria-label={`Edit ${tag} ${name}`} onSubmit={save}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header>
      <i style={{ background: entry.color }} aria-hidden="true" />
      <strong>{tag} · {name}</strong>
      <button type="button" className="level-editor-close" aria-label="Close level editor" onClick={onClose}><X size={13} aria-hidden="true" /></button>
    </header>
    <div className="level-editor-fields">
      <label>Price<input ref={input} inputMode="decimal" value={price} aria-invalid={error !== ''} onChange={event => { setPrice(event.target.value); setError('') }} /></label>
      {target && <label>Share <small>% of entry</small><input inputMode="decimal" value={share} onChange={event => { setShare(event.target.value); setError('') }} /></label>}
    </div>
    {percentUnit && <p className="level-editor-note">Stored as a % from entry, the unit chosen in the editor.</p>}
    {error && <p className="level-editor-error" role="alert">{error}</p>}
    <div className="level-editor-actions">
      <Button type="submit" size="sm">Save</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
    </div>
    <div className="level-editor-more">
      <button type="button" disabled={!entryPriced} title={entryPriced ? undefined : 'Set the entry price first'}
        onClick={() => act(addChartTarget(entry, direction), `Add ${tag} target`)}><Plus size={12} aria-hidden="true" />Add target</button>
      {!stopPlotted && entryPriced && <button type="button" onClick={() => act(addChartStop(entry, direction), `Add ${tag} stop`)}><Plus size={12} aria-hidden="true" />Add stop</button>}
      {target && <button type="button" onClick={() => act(removeTarget(entry, target.id), `Remove ${tag} target ${targetIndex + 1}`)}><Trash2 size={12} aria-hidden="true" />Remove target</button>}
    </div>
  </form>
}
