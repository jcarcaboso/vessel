import { useEffect, useState, type FormEvent } from 'react'
import type { WorkspaceApi } from '@/api/workspace'
import { cancelReasonLabels, cancelReasons, statusLabels, type CancelReason, type PlayHistory } from '@/api/plays'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { describePlanChanges, failure } from './saved'

/** Asks why a planned Play's plan changed; the reason is kept with the revision. */
export function RevisionDialog({ revision, pending, error, onSave, onClose }: {
  revision: number; pending: boolean; error: string | null; onSave: (reason: string) => void; onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); if (reason.trim()) onSave(reason.trim()) }
  return <Dialog open onOpenChange={next => { if (!next && !pending) onClose() }}>
    <DialogContent className="workspace-dialog">
      <DialogHeader><DialogTitle>Why did the plan change?</DialogTitle><DialogDescription>
        This saves revision {revision + 1}. The earlier plan stays in the history, so you can compare what you intended with what you changed.
      </DialogDescription></DialogHeader>
      <form className="workspace-form" onSubmit={submit} aria-busy={pending}>
        <label htmlFor="revision-reason">Reason</label>
        <textarea id="revision-reason" value={reason} maxLength={2000} autoFocus disabled={pending} rows={3}
          placeholder="e.g. Moved the stop under the new swing low" onChange={event => setReason(event.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="management-actions"><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Keep editing</Button>
          <Button type="submit" disabled={pending || !reason.trim()}>{pending ? 'Saving…' : 'Save revision'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}

export function CancelDialog({ pending, error, onCancel, onClose }: {
  pending: boolean; error: string | null; onCancel: (reason: CancelReason, note: string) => void; onClose: () => void
}) {
  const [reason, setReason] = useState<CancelReason | ''>('')
  const [note, setNote] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); if (reason) onCancel(reason, note.trim()) }
  return <Dialog open onOpenChange={next => { if (!next && !pending) onClose() }}>
    <DialogContent className="workspace-dialog">
      <DialogHeader><DialogTitle>Cancel this play?</DialogTitle><DialogDescription>
        A cancelled play keeps its plan and history for review. Remove any resting orders on the venue yourself; Vessel never sends orders.
      </DialogDescription></DialogHeader>
      <form className="workspace-form" onSubmit={submit} aria-busy={pending}>
        <label htmlFor="cancel-reason">Reason</label>
        <select id="cancel-reason" value={reason} disabled={pending} onChange={event => setReason(event.target.value as CancelReason | '')}>
          <option value="">Choose a reason</option>
          {cancelReasons.map(value => <option key={value} value={value}>{cancelReasonLabels[value]}</option>)}
        </select>
        <label htmlFor="cancel-note">Note <small>optional</small></label>
        <textarea id="cancel-note" value={note} maxLength={2000} rows={3} disabled={pending} onChange={event => setNote(event.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="management-actions"><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Keep the play</Button>
          <Button type="submit" variant="destructive" disabled={pending || !reason}>{pending ? 'Cancelling…' : 'Cancel play'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}

export function DeleteDialog({ pending, error, onDelete, onClose }: {
  pending: boolean; error: string | null; onDelete: () => void; onClose: () => void
}) {
  return <Dialog open onOpenChange={next => { if (!next && !pending) onClose() }}>
    <DialogContent className="workspace-dialog">
      <DialogHeader><DialogTitle>Delete this draft?</DialogTitle><DialogDescription>
        The draft, its drawings and its saved images are removed. Planned plays cannot be deleted; cancel them instead so their history stays.
      </DialogDescription></DialogHeader>
      <div className="workspace-form">
        {error && <p className="error" role="alert">{error}</p>}
        <div className="management-actions"><Button variant="outline" onClick={onClose} disabled={pending}>Keep draft</Button>
          <Button variant="destructive" onClick={onDelete} disabled={pending}>{pending ? 'Deleting…' : 'Delete draft'}</Button></div>
      </div>
    </DialogContent>
  </Dialog>
}

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type HistoryItem = { at: string; key: string; title: string; detail: string[] }

/** Plan revisions with what changed, and status changes, newest first. */
export function HistoryDialog({ api, playId, onClose }: { api: WorkspaceApi; playId: string; onClose: () => void }) {
  const [result, setResult] = useState<{ history: PlayHistory } | { error: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    api.playHistory(playId, controller.signal).then(history => setResult({ history }))
      .catch(cause => { if (!controller.signal.aborted) setResult({ error: failure(cause) }) })
    return () => controller.abort()
  }, [api, playId])
  const items: HistoryItem[] = result && 'history' in result ? [
    ...result.history.revisions.map((revision, index, all): HistoryItem => ({
      at: revision.createdAtUtc, key: `r${revision.number}`, title: `Plan revision ${revision.number} · ${revision.reason}`,
      detail: index === 0 ? ['The plan as first committed.'] : describePlanChanges(all[index - 1]!.plan, revision.plan),
    })),
    ...result.history.statusChanges.map((change, index): HistoryItem => ({
      at: change.occurredAtUtc, key: `s${index}`, title: `${statusLabels[change.from]} → ${statusLabels[change.to]}${change.source === 'venue' ? ' · from linked venue fills' : ''}`,
      detail: [change.reason ? cancelReasonLabels[change.reason] : '', change.note ?? ''].filter(Boolean),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key)) : []
  return <Dialog open onOpenChange={next => { if (!next) onClose() }}>
    <DialogContent className="workspace-dialog play-history-dialog">
      <DialogHeader><DialogTitle>Play history</DialogTitle><DialogDescription>
        Every plan revision since planning, with the reason you gave, and every status change.
      </DialogDescription></DialogHeader>
      {result === null && <p role="status">Loading history…</p>}
      {result && 'error' in result && <p className="error" role="alert">{result.error}</p>}
      {result && 'history' in result && (items.length ? <ol className="play-history">
        {items.map(item => <li key={item.key}><time dateTime={item.at}>{when(item.at)}</time><strong>{item.title}</strong>
          {item.detail.length > 0 && <ul>{item.detail.map((line, index) => <li key={index}>{line}</li>)}</ul>}</li>)}
      </ol> : <p className="muted">Nothing yet. History starts when the play is planned.</p>)}
    </DialogContent>
  </Dialog>
}
