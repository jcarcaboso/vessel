import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { statusLabels, type PlayStatus, type PlaySummary, type StatusRequest } from '@/api/plays'
import { Button } from '@/components/ui/button'
import { venueName } from '@/features/workspace/format'
import { ArrowLeft, History, Pause, Play, Plus, Save, Trash2, X } from 'lucide-react'
import { createDraft, type PlayDraft } from './draft'
import { PlayWorkspace } from './PlayWorkspace'
import { CancelDialog, DeleteDialog, HistoryDialog, RevisionDialog } from './PlayDialogs'
import {
  createPlaysSession, draftFromSaved, failure, fieldsFromDraft, isDirty, loadSavedPlay, planChanged, savedState, syncEvidence,
  type PlaysSession, type SavedState,
} from './saved'


const ended: PlayStatus[] = ['closed', 'cancelled']
const filters = [['active', 'In progress'], ['ended', 'Closed and cancelled'], ['all', 'All']] as const
type Filter = typeof filters[number][0]

function hasContent(draft: PlayDraft) {
  return !!(draft.title.trim() || draft.accountId || draft.instrument || draft.size || draft.evidence.length ||
    Object.values(draft.drawings).some(items => items.length) || Object.values(draft.notes).some(note => note.trim()) ||
    draft.entries.some(entry => entry.price || entry.stop.value || entry.targets.some(target => target.value)))
}

export function PlaysPage({ accounts, portfolios, api, session, onSession, onReload, loading = false }: {
  accounts: BrokerAccount[]
  portfolios: Portfolio[]
  api: WorkspaceApi
  session: PlaysSession
  onSession: (session: PlaysSession) => void
  onReload?: (() => void) | undefined
  loading?: boolean
}) {
  const latest = useRef(session)
  useEffect(() => { latest.current = session })
  const update = useCallback((next: Partial<PlaysSession>) => {
    latest.current = { ...latest.current, ...next }
    onSession(latest.current)
  }, [onSession])
  const [busy, setBusy] = useState<null | 'save' | 'status' | 'open' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | 'revision' | 'cancel' | 'delete' | 'history'>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const { draft, saved } = session
  const dirty = saved ? isDirty(draft, saved) : hasContent(draft)
  const status = saved?.summary.status ?? 'draft'

  /** Saves the draft and its evidence. Returns the saved state, or null when the save failed. */
  async function save(reason?: string): Promise<SavedState | null> {
    const { draft: sent, saved: before } = latest.current
    if (!sent.accountId) { setError('Choose an account before saving.'); return null }
    setBusy('save'); setError(null); setDialogError(null)
    try {
      const fields = fieldsFromDraft(sent)
      const play = before
        ? await api.updatePlay(before.summary.id, { ...fields, expectedVersion: before.summary.version, ...(reason ? { revisionReason: reason } : {}) })
        : await api.createPlay(fields)
      const synced = await syncEvidence(api, play.summary.id, sent.evidence, before?.evidenceIds ?? [])
      const stored = draftFromSaved(play, synced.evidence)
      const state = savedState(play, stored)
      const next = { ...state, evidenceIds: [...state.evidenceIds, ...synced.pendingDeletes] }
      // Edits made while saving stay; only their evidence learns its server identity.
      const current = latest.current.draft
      const ids = new Map(synced.evidence.map(item => [item.id, item]))
      update({
        saved: next,
        draft: current === sent ? stored : { ...current, evidence: current.evidence.map(item => ids.get(item.id) ?? item) },
      })
      if (synced.error) setError(`The play was saved, but an image did not sync: ${failure(synced.error)} Save again to retry.`)
      setDialog(null)
      return next
    } catch (cause) {
      if (dialog === 'revision') setDialogError(failure(cause))
      else setError(failure(cause))
      return null
    } finally {
      setBusy(null)
    }
  }

  async function changeStatus(request: StatusRequest) {
    let state = latest.current.saved
    if (request.status === 'planned' && status === 'draft' && (!state || isDirty(latest.current.draft, state))) {
      state = await save()
      if (!state) return
    }
    if (!state) return
    setBusy('status'); setError(null); setDialogError(null)
    try {
      const play = await api.changePlayStatus(state.summary.id, state.summary.version, request)
      update({ saved: { ...state, summary: play.summary } })
      setDialog(null)
    } catch (cause) {
      if (dialog === 'cancel') setDialogError(failure(cause))
      else setError(failure(cause))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!saved) return
    setBusy('delete'); setDialogError(null)
    try {
      await api.deletePlay(saved.summary.id)
      setDialog(null)
      update(createPlaysSession())
    } catch (cause) {
      setDialogError(failure(cause))
    } finally {
      setBusy(null)
    }
  }

  async function open(id: string) {
    setBusy('open'); setError(null)
    try {
      const loaded = await loadSavedPlay(api, id)
      update({ view: 'editor', ...loaded })
    } catch (cause) {
      setError(failure(cause))
    } finally {
      setBusy(null)
    }
  }

  if (session.view === 'list') {
    return <PlayList api={api} accounts={accounts} busy={busy === 'open'} error={error}
      unsaved={dirty ? draft.title.trim() || 'Untitled play' : null}
      onOpen={id => { void open(id) }}
      onNew={() => { setError(null); update({ view: 'editor', draft: createDraft(), saved: null }) }}
      onContinue={() => update({ view: 'editor' })}
      onDiscard={() => update(createPlaysSession())} />
  }

  const saving = busy === 'save'
  const locked = status !== 'draft'
  const readOnly = ended.includes(status)
  const needsReason = !!saved && locked && !readOnly && planChanged(draft, saved)
  const statusBlocked = dirty ? 'Save your changes first' : undefined
  const pending = busy !== null

  const actions = <div className="play-actions">
    {saved && <Button variant="ghost" size="sm" onClick={() => setDialog('history')}><History size={14} />History</Button>}
    <Button size="sm" variant={status === 'draft' ? 'outline' : 'default'} disabled={!dirty || pending || !draft.accountId}
      title={!draft.accountId ? 'Choose an account to save' : undefined}
      onClick={() => { if (needsReason) { setDialogError(null); setDialog('revision') } else void save() }}>
      <Save size={14} />{saving ? 'Saving…' : !dirty && saved ? 'Saved' : status === 'draft' ? 'Save draft' : 'Save changes'}</Button>
    {status === 'draft' && <Button size="sm" disabled={pending || !draft.accountId || !draft.instrument}
      title={!draft.instrument ? 'Choose an instrument and price an entry to plan' : 'Commit to this plan. Later changes become revisions.'}
      onClick={() => { void changeStatus({ status: 'planned' }) }}><Play size={14} />Plan it</Button>}
    {status === 'planned' && <Button size="sm" variant="outline" disabled={pending || dirty} title={statusBlocked ?? 'Orders withdrawn, idea still valid'}
      onClick={() => { void changeStatus({ status: 'paused' }) }}><Pause size={14} />Pause</Button>}
    {status === 'paused' && <Button size="sm" disabled={pending || dirty} title={statusBlocked}
      onClick={() => { void changeStatus({ status: 'planned' }) }}><Play size={14} />Resume</Button>}
    {(status === 'planned' || status === 'paused') && <Button size="sm" variant="ghost" className="danger-action" disabled={pending || dirty}
      title={statusBlocked} onClick={() => { setDialogError(null); setDialog('cancel') }}><X size={14} />Cancel play</Button>}
    {saved && status === 'draft' && <Button size="sm" variant="ghost" className="danger-action" disabled={pending}
      onClick={() => { setDialogError(null); setDialog('delete') }}><Trash2 size={14} />Delete</Button>}
  </div>

  const notice = !saved ? 'Not saved yet. Save the draft to keep it, with its drawings and images. Nothing is sent to a venue.'
    : readOnly ? `${statusLabels[status]}. The plan is kept as it was; you can still write the review and add images.`
    : locked ? `${statusLabels[status]} · revision ${saved.summary.planRevision}. Stops, targets and untaken entries can still change; each saved change asks why and becomes a revision. Vessel never sends orders.`
    : dirty ? 'Unsaved changes. Save to keep them.' : 'Saved draft. Plan it when you are ready to place the orders.'

  return <>
    <Button variant="ghost" size="sm" className="plays-back" onClick={() => update({ view: 'list' })}><ArrowLeft size={14} />All plays</Button>
    {error && <div className="workspace-alert" role="alert"><span>{error}</span><Button variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button></div>}
    <PlayWorkspace accounts={accounts} portfolios={portfolios} api={api} draft={draft} onChange={next => update({ draft: next })}
      {...(onReload ? { onReload } : {})} loading={loading} status={status} actions={actions} notice={notice} lockInstrument={locked} readOnly={readOnly} />
    {dialog === 'revision' && saved && <RevisionDialog revision={saved.summary.planRevision} pending={saving} error={dialogError}
      onSave={reason => { void save(reason) }} onClose={() => setDialog(null)} />}
    {dialog === 'cancel' && <CancelDialog pending={busy === 'status'} error={dialogError}
      onCancel={(reason, note) => { void changeStatus({ status: 'cancelled', reason, ...(note ? { note } : {}) }) }} onClose={() => setDialog(null)} />}
    {dialog === 'delete' && <DeleteDialog pending={busy === 'delete'} error={dialogError} onDelete={() => { void remove() }} onClose={() => setDialog(null)} />}
    {dialog === 'history' && saved && <HistoryDialog api={api} playId={saved.summary.id} onClose={() => setDialog(null)} />}
  </>
}

function PlayList({ api, accounts, busy, error, unsaved, onOpen, onNew, onContinue, onDiscard }: {
  api: WorkspaceApi
  accounts: BrokerAccount[]
  busy: boolean
  error: string | null
  /** Title of the play with unsaved changes, if any. */
  unsaved: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onContinue: () => void
  onDiscard: () => void
}) {
  const [filter, setFilter] = useState<Filter>('active')
  const [result, setResult] = useState<{ plays: PlaySummary[] } | { error: string } | null>(null)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api.plays(controller.signal).then(plays => setResult({ plays }))
      .catch(cause => { if (!controller.signal.aborted) setResult({ error: failure(cause) }) })
    return () => controller.abort()
  }, [api, generation])
  const plays = result && 'plays' in result ? result.plays : []
  const shown = plays.filter(play => filter === 'all' || (filter === 'ended') === ended.includes(play.status))
  const accountName = (id: string) => accounts.find(account => account.id === id)?.name ?? 'Unknown account'

  return <section className="plays-page plays-list-page" aria-label="Saved plays">
    <div className="plays-draft-heading">
      <div className="page-heading-copy"><span className="eyebrow">A LITTLE INTENTION BEFORE THE TRADE</span>
        <h1>Plays</h1><p>Each idea from plan to review. Planned plays keep every revision of the plan.</p></div>
      <div className="plays-heading-actions"><Button onClick={onNew} disabled={!!unsaved || busy}><Plus size={15} />New play</Button></div>
    </div>
    {unsaved && <div className="workspace-alert plays-unsaved" role="status"><span>Unsaved changes in <strong>{unsaved}</strong>. Save or discard them before opening another play.</span>
      <Button variant="outline" size="sm" onClick={onContinue}>Continue editing</Button>
      <Button variant="ghost" size="sm" className="danger-action" onClick={onDiscard}>Discard changes</Button></div>}
    {error && <div className="workspace-alert" role="alert"><span>{error}</span></div>}
    <div className="plays-list-filters" role="group" aria-label="Show plays">
      {filters.map(([value, label]) => <button key={value} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value}
        onClick={() => setFilter(value)}>{label}</button>)}
    </div>
    {result === null && <p className="workspace-loading" role="status">Loading plays…</p>}
    {result && 'error' in result && <div className="workspace-alert" role="alert"><span>{result.error}</span>
      <Button variant="ghost" size="sm" onClick={() => { setResult(null); setGeneration(current => current + 1) }}>Try again</Button></div>}
    {result && 'plays' in result && (shown.length ? <ul className="plays-list">
      {shown.map(play => <li key={play.id}>
        <button type="button" className="plays-list-item" disabled={!!unsaved || busy} onClick={() => onOpen(play.id)} aria-label={`Open ${play.title || 'Untitled play'}`}>
          <span className="plays-list-title"><strong>{play.title || 'Untitled play'}</strong>
            <small>{play.instrument ?? 'No instrument'} · {venueName(play.venueId)} · {accountName(play.accountId)}</small></span>
          <span className={`direction-chip ${play.direction}`}>{play.direction === 'long' ? 'Long' : 'Short'}</span>
          <span className={`badge play-status-${play.status}`}>{statusLabels[play.status]}</span>
          <small className="plays-list-meta">{play.planRevision > 1 ? `${play.planRevision} revisions · ` : ''}Updated {new Date(play.updatedAtUtc).toLocaleDateString()}</small>
        </button>
      </li>)}
    </ul> : <div className="plays-list-empty"><p>{plays.length ? 'No plays in this view.' : 'No saved plays yet. Start one to write down the idea before the trade.'}</p></div>)}
  </section>
}
