import { useId, useRef, useState, type ChangeEvent } from 'react'
import { Download, ImagePlus, PenLine, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { DraftEvidence } from './draft'
import { createEvidence, evidenceAccept, evidenceLimits, evidenceProblem, formatBytes, imageUrl, releaseImageUrl } from './evidence'
import { flattenMarkup, hasMarks, markedFileName, markupDataUrl, type ImageMarkup } from './markup'
import { MarkupEditor } from './MarkupEditor'

const timeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })
const describe = (item: DraftEvidence) => item.source === 'capture' ? `Chart capture${item.context ? ` · ${item.context}` : ''}` : item.name
const itemLabel = (item: DraftEvidence, index: number) => `Image ${index + 1}: ${describe(item)}`

/** The image with its marks layered on top; both share the same fit, so the marks stay aligned. */
function MarkedImage({ item, marked, alt, fit }: { item: DraftEvidence; marked: boolean; alt: string; fit: 'cover' | 'contain' }) {
  return <span className="marked-image" data-fit={fit}>
    <img src={imageUrl(item.image)} alt={alt} />
    {marked && hasMarks(item.markup) && <img className="marked-image-overlay" src={markupDataUrl(item.markup)} alt="" data-testid="marks-overlay" />}
  </span>
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Chart captures and uploaded images with a note each. They stay in this browser until the Play is saved. */
export function EvidencePanel({ evidence, onChange }: {
  evidence: DraftEvidence[]
  /** Receives an update of the current list; uploads finish asynchronously. */
  onChange: (update: (evidence: DraftEvidence[]) => DraftEvidence[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [view, setView] = useState<'marked' | 'original'>('marked')
  const [editing, setEditing] = useState(false)
  const id = useId()
  const viewed = evidence.find(item => item.id === viewing) ?? null
  const full = evidence.length >= evidenceLimits.maxItems

  const setNote = (itemId: string, note: string) => onChange(current => current.map(item => item.id === itemId ? { ...item, note } : item))
  const setMarkup = (itemId: string, markup: ImageMarkup | null) => onChange(current => current.map(item => item.id === itemId ? { ...item, markup } : item))
  const open = (itemId: string) => { setViewing(itemId); setView('marked'); setEditing(false) }
  async function download(item: DraftEvidence, marked: boolean) {
    if (!marked || !hasMarks(item.markup)) { save(item.image, item.name); return }
    const flattened = await flattenMarkup(item.image, item.markup).catch(() => null)
    if (flattened) save(flattened, markedFileName(item.name))
    else setError('The marked image could not be created. The original is unchanged.')
  }
  const remove = (item: DraftEvidence) => {
    releaseImageUrl(item.image)
    onChange(current => current.filter(other => other.id !== item.id))
    setConfirming(null)
    if (viewing === item.id) setViewing(null)
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...event.target.files ?? []]
    event.target.value = ''
    const added: DraftEvidence[] = []
    const problems: string[] = []
    for (const file of files) {
      const problem = await evidenceProblem(file)
      if (problem) problems.push(`${file.name}: ${problem}`)
      else added.push(createEvidence('upload', file, file.name))
    }
    // The count limit applies to the list at the time the files are added.
    onChange(current => {
      const room = Math.max(0, evidenceLimits.maxItems - current.length)
      if (added.length > room) problems.push(`Only ${room} more ${room === 1 ? 'image fits' : 'images fit'}; a play holds at most ${evidenceLimits.maxItems}.`)
      return added.length ? [...current, ...added.slice(0, room)] : current
    })
    setError(problems.join(' '))
  }

  const noteField = (item: DraftEvidence, index: number, rows: number) => <textarea className="evidence-note" rows={rows}
    aria-label={`Note for image ${index + 1}`} value={item.note} maxLength={evidenceLimits.maxNoteLength}
    placeholder="What does this show? Add a note." onChange={event => setNote(item.id, event.target.value)} />

  return <div className="evidence-panel" aria-labelledby={`${id}-title`}>
    <div className="evidence-toolbar">
      <div>
        <strong id={`${id}-title`}>Images</strong>
        <small>{evidence.length} of {evidenceLimits.maxItems} · Kept in this browser until the play is saved</small>
      </div>
      <input ref={input} type="file" accept={evidenceAccept} multiple hidden onChange={event => void upload(event)} />
      <Button type="button" size="sm" variant="outline" disabled={full} title={full ? `At most ${evidenceLimits.maxItems} images` : undefined}
        onClick={() => input.current?.click()}><Upload size={13} aria-hidden="true" />Upload image</Button>
    </div>
    {error && <p className="evidence-error" role="alert">{error}</p>}
    {evidence.length === 0
      ? <div className="evidence-empty"><ImagePlus size={18} aria-hidden="true" /><p>No images yet. Capture the chart with the camera button in its toolbar, or upload a PNG, JPEG or WebP image up to {evidenceLimits.maxBytes / 1024 / 1024} MB.</p></div>
      : <ul className="evidence-list" aria-label="Evidence images">
        {evidence.map((item, index) => <li key={item.id} className="evidence-card">
          <div className="evidence-frame">
            <button type="button" className="evidence-thumb" aria-label={`Open ${itemLabel(item, index)}`} onClick={() => open(item.id)}>
              <MarkedImage item={item} marked alt="" fit="cover" />
            </button>
            {hasMarks(item.markup) && <span className="evidence-marked">Marked</span>}
            {confirming === item.id
              ? <div className="evidence-confirm" role="group" aria-label={`Remove image ${index + 1}?`}>
                <span>Remove this image?</span>
                <div>
                  <Button type="button" size="sm" variant="destructive" onClick={() => remove(item)}>Remove</Button>
                  <Button type="button" size="sm" variant="ghost" autoFocus onClick={() => setConfirming(null)}>Cancel</Button>
                </div>
              </div>
              : <div className="evidence-actions">
                <button type="button" className="evidence-action" aria-label={`Download image ${index + 1}`} title={hasMarks(item.markup) ? 'Download with marks' : 'Download'}
                  onClick={() => void download(item, true)}><Download size={13} aria-hidden="true" /></button>
                <button type="button" className="evidence-action" aria-label={`Remove image ${index + 1}`} title="Remove" onClick={() => setConfirming(item.id)}><Trash2 size={13} aria-hidden="true" /></button>
              </div>}
          </div>
          <div className="evidence-meta">
            <span className="evidence-kind" data-source={item.source}>{item.source === 'capture' ? 'Capture' : 'Upload'}</span>
            <span className="evidence-name" title={describe(item)}>{item.source === 'capture' ? item.context || 'Chart' : item.name}</span>
            <time dateTime={item.addedAt} title={`${timeFormat.format(new Date(item.addedAt))} UTC`}>{timeFormat.format(new Date(item.addedAt))}</time>
          </div>
          {noteField(item, index, 2)}
        </li>)}
      </ul>}
    <Dialog open={viewed !== null} onOpenChange={next => { if (!next) { setViewing(null); setEditing(false) } }}>
      {viewed && <DialogContent className="plays-entry-dialog evidence-dialog"
        onEscapeKeyDown={event => { if (editing) event.preventDefault() }}>
        <DialogTitle>{describe(viewed)}</DialogTitle>
        <DialogDescription>{viewed.source === 'capture' ? 'Captured' : 'Added'} {timeFormat.format(new Date(viewed.addedAt))} UTC · {formatBytes(viewed.image.size)}. Kept in this browser until the play is saved.</DialogDescription>
        {editing
          ? <MarkupEditor imageUrl={imageUrl(viewed.image)} alt={describe(viewed)} markup={viewed.markup}
            onChange={markup => setMarkup(viewed.id, markup)} onDone={() => { setEditing(false); setView('marked') }} />
          : <>
            <div className="evidence-view-bar">
              {hasMarks(viewed.markup)
                ? <div className="evidence-view-toggle" role="group" aria-label="Image version">
                  <button type="button" aria-pressed={view === 'marked'} onClick={() => setView('marked')}>Marked</button>
                  <button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>Original</button>
                </div>
                : <span className="evidence-view-note">No marks yet</span>}
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}><PenLine size={13} aria-hidden="true" />{hasMarks(viewed.markup) ? 'Edit marks' : 'Mark up'}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void download(viewed, view === 'marked')}>
                <Download size={13} aria-hidden="true" />{view === 'marked' && hasMarks(viewed.markup) ? 'Download marked' : 'Download original'}</Button>
            </div>
            <div className="evidence-dialog-image"><MarkedImage item={viewed} marked={view === 'marked'} alt={`${describe(viewed)}${view === 'marked' && hasMarks(viewed.markup) ? ', with marks' : ''}`} fit="contain" /></div>
          </>}
        {noteField(viewed, evidence.indexOf(viewed), 3)}
      </DialogContent>}
    </Dialog>
  </div>
}

