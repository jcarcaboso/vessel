import { errorMessage } from '@/api/errors'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { statusLabels, type PlayStatus, type PlaySummary, type SavedPlay, type StatusRequest } from '@/api/plays'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications/notifications'
import { preloadLightweightRenderer } from '@/components/chart/lazy'
import { useVenues } from '@/api/venues'
import { VenueBadge } from '@/components/venues/VenueBadge'
import { ArrowLeft, History, Pause, Play, Plus, Save, Trash2, X } from 'lucide-react'
import type { PlayDraft } from './draft'
import { PlayWorkspace } from './PlayWorkspace'
import { instrumentLabel } from './instruments'
import { ExecutionPanel } from './ExecutionPanel'
import { ManualExecutionPanel } from './ManualExecutionPanel'
import { emptyManualDraft, hasManualDraft } from './manual'
import { usePlayExecution } from './usePlayExecution'
import { useSizing } from './useSizing'
import { planIssues, planIssueSummary } from './planChecks'
import { formatMoney, marginOverBudget } from './sizing'
import { leverageOf } from './levels'
import { CancelDialog, DeleteDialog, HistoryDialog, RevisionDialog } from './PlayDialogs'
import {
  createPlaysSession, draftFromSaved, fieldsFromDraft, hasDraftContent, isDirty, loadSavedPlay, mergeSavedEvidence, planChanged, savedState,
  observedPlayVersion, startNewPlay, syncEvidence,
  type PlaysSession, type SavedState,
} from './saved'


const ended: PlayStatus[] = ['closed', 'cancelled']
const filters = [['active', 'In progress'], ['ended', 'Closed and cancelled'], ['pending', 'Pending review'], ['reviewed', 'Reviewed'], ['all', 'All']] as const
type Filter = typeof filters[number][0]
type DialogKind = null | 'revision' | 'cancel' | 'delete' | 'history'
type WorkKind = 'save' | 'status' | 'open' | 'delete' | 'manual'

export function PlaysPage({ accounts, portfolios, api, session, onSession, onReload, loading = false, requestedPlayId, onRequestedPlayHandled, active: visible = true, workRef }: {
  accounts: BrokerAccount[]
  portfolios: Portfolio[]
  api: WorkspaceApi
  session: PlaysSession
  onSession: (session: PlaysSession) => void
  onReload?: (() => void) | undefined
  loading?: boolean
  requestedPlayId?: string | null
  onRequestedPlayHandled?: () => void
  /** The shell retains this mutation owner while another page is visible, not its UI or polling. */
  active?: boolean
  /** Shared with shell actions that could replace the session, before disabled controls render. */
  workRef?: RefObject<symbol | null>
}) {
  useEffect(() => { void preloadLightweightRenderer().catch(() => { /* The adapter shows a load error when mounted. */ }) }, [])
  const latest = useRef(session)
  useEffect(() => { latest.current = session })
  const update = useCallback((next: Partial<PlaysSession>) => {
    latest.current = { ...latest.current, ...next }
    onSession(latest.current)
  }, [onSession])
  const [busy, setBusy] = useState<WorkKind | null>(null)
  const activeWork = useRef(workRef ?? { current: null as symbol | null })
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const requestAttempt = useRef<string | null>(null)
  const requestedId = useRef(requestedPlayId)
  useEffect(() => { requestedId.current = requestedPlayId })
  const openController = useRef<AbortController | null>(null)
  const epoch = useRef(0)
  const mounted = useRef(false)
  const currentApi = useRef(api)
  useEffect(() => { currentApi.current = api })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    const currentEpoch = epoch
    const controllerRef = openController
    const workRef = activeWork.current
    currentEpoch.current++
    workRef.current = null
    requestAttempt.current = null
    let active = true
    queueMicrotask(() => { if (active && !workRef.current) setBusy(null) })
    return () => { active = false; currentEpoch.current++; workRef.current = null; controllerRef.current?.abort() }
  }, [api, activeWork])
  // Acquire synchronously, before React renders disabled controls. Only the owner may release.
  const beginWork = useCallback((kind: WorkKind) => {
    if (!mounted.current || currentApi.current !== api || activeWork.current.current) return null
    const owner = Symbol(kind)
    activeWork.current.current = owner
    setBusy(kind)
    return () => {
      if (activeWork.current.current !== owner) return
      activeWork.current.current = null
      if (mounted.current && currentApi.current === api) setBusy(null)
    }
  }, [api, activeWork])
  // Errors appear as popup notifications; a newer one replaces the last, and starting another action clears it.
  const { notify, dismiss } = useNotifications()
  const setError = useCallback((message: string | null) => {
    if (message) notify({ tone: 'error', key: 'plays-error', message })
    else dismiss('plays-error')
  }, [notify, dismiss])
  // A version identifies the whole saved document, not just its lifecycle.
  const acceptStoredPlay = useCallback((play: SavedPlay) => {
    if (!mounted.current || currentApi.current !== api) return false
    const { draft: currentDraft, saved: current } = latest.current
    if (!current || current.summary.id !== play.summary.id || current.summary.accountId !== play.summary.accountId ||
      play.summary.version < observedPlayVersion(latest.current, api)) return false
    const observedPlay = { api, id: play.summary.id, accountId: play.summary.accountId, version: play.summary.version, conflict: false }
    const stored = draftFromSaved(play, currentDraft.evidence)
    const next = { ...savedState(play, stored), evidenceIds: current.evidenceIds }
    if (next.fieldsKey !== current.fieldsKey) {
      if (isDirty(currentDraft, current)) {
        update({ observedPlay: { ...observedPlay, conflict: true } })
        return true
      }
      update({ saved: next, draft: stored, observedPlay })
    } else {
      update({ saved: next, observedPlay })
    }
    return true
  }, [api, update])
  const [dialog, setDialogState] = useState<DialogKind>(null)
  // An async action may outlive the render, or the dialog that started it.
  const currentDialog = useRef({ kind: null as DialogKind })
  const setDialog = (kind: DialogKind) => {
    currentDialog.current = { kind }
    setDialogState(kind)
    setDialogError(null)
  }
  const closeDialog = (intended: { kind: DialogKind }) => {
    if (currentDialog.current === intended) setDialog(null)
  }
  const actionError = (cause: unknown, intended: { kind: DialogKind }) => {
    const message = errorMessage(cause, 'The change could not be completed. Try again.')
    if (currentDialog.current === intended && intended.kind && intended.kind !== 'history') setDialogError(message)
    else setError(message)
  }
  const [dialogError, setDialogError] = useState<string | null>(null)

  const { draft, saved } = session
  const venues = useVenues()
  const account = accounts.find(item => item.id === (saved?.summary.accountId ?? draft.accountId))
  const manual = !!account && venues.can(account.venueId, 'manualExecutions')
  const retrospective = saved?.summary.origin === 'retrospective'
  // Loaded once per page visit; without it the sizing suggestions stay hidden.
  const sizing = useSizing(api)
  const tracking = usePlayExecution(api, visible && session.view === 'editor' && saved && !manual ? saved.summary.id : null, saved?.summary.status)

  // Linked fills move a play to Open or Closed on the server; take the new status and version.
  const venueStatus = tracking.execution?.playId === saved?.summary.id ? tracking.execution?.status : undefined
  useEffect(() => {
    const state = latest.current.saved
    if (!visible || !venueStatus || !state || venueStatus === state.summary.status) return
    const controller = new AbortController()
    api.play(state.summary.id, controller.signal).then(play => {
      if (!controller.signal.aborted) acceptStoredPlay(play)
    }).catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause, 'The change could not be completed. Try again.')) })
    return () => controller.abort()
  }, [visible, api, saved?.summary.id, saved?.summary.status, venueStatus, acceptStoredPlay, setError])
  // The server keeps the direction once an entry has filled: it decides which side closes the position.
  const filled = venueStatus !== undefined && !!tracking.execution?.links.some(link => link.role === 'entry' && link.fills.length > 0)
  const dirty = useMemo(() => saved ? isDirty(draft, saved) : hasDraftContent(draft), [draft, saved])
  const changedPlan = useMemo(() => !!saved && planChanged(draft, saved), [draft, saved])
  const unsaved = dirty || hasManualDraft(session.manual)
  // A blocked save says why until the plan is fixed.
  const status = saved?.summary.status ?? 'draft'
  const fixed = !planProblem(draft, status)
  useEffect(() => { if (fixed) dismiss('plan-blocked') }, [fixed, dismiss])

  /**
   * Stops and targets on the wrong side of their entry, and a draft's margin above its budget, block
   * saving and planning until they are fixed. Once orders may rest the venue counts their margin as
   * used, so the budget is only held while the play is a draft.
   */
  function planProblem(current: PlayDraft, currentStatus: PlayStatus) {
    if (retrospective) return null
    const issues = planIssues(current.entries, current.direction)
    if (issues.length) return planIssueSummary(issues)
    const account = accounts.find(item => item.id === current.accountId)
    const over = currentStatus === 'draft' ? marginOverBudget(current, leverageOf(current.leverage), account?.availableStablecoinNominalUsd) : null
    const units = { quote: 'USD', base: '', quantityDecimals: null }
    return over && `The margin (${formatMoney(over.margin, units)}) is above the ${formatMoney(over.budget.amount, units)} ${over.budget.source === 'manual' ? 'budget' : 'available'}.`
  }

  function planBlocked() {
    const problem = planProblem(latest.current.draft, latest.current.saved?.summary.status ?? 'draft')
    if (problem) notify({ tone: 'error', key: 'plan-blocked', title: 'Not saved', message: `Fix the plan first. ${problem}` })
    return !!problem
  }

  /** Saves the draft and its evidence. Returns the saved state, or null when the save failed. */
  async function save(reason?: string): Promise<SavedState | null> {
    const finish = beginWork('save')
    if (!finish) return null
    try { return await saveDraft(reason) } finally { finish() }
  }

  /** The caller owns the shared work guard, including a save followed by planning. */
  async function saveDraft(reason?: string): Promise<SavedState | null> {
    const started = epoch.current
    const intendedDialog = currentDialog.current
    const { draft: sent, saved: before } = latest.current
    if (!sent.accountId) { setError('Choose an account before saving.'); return null }
    if (planBlocked()) return null
    setError(null); setDialogError(null)
    try {
      const fields = fieldsFromDraft(sent)
      const play = before
        ? await api.updatePlay(before.summary.id, { ...fields, expectedVersion: before.summary.version, ...(reason ? { revisionReason: reason } : {}) })
        : await api.createPlay(fields)
      if (started !== epoch.current) return null
      if (before && play.summary.version < observedPlayVersion(latest.current, api)) {
        setError('The Play was saved, but this response is older than the latest known Play. Reload the current saved Play before saving again.')
        return null
      }
      update({ observedPlay: { api, id: play.summary.id, accountId: play.summary.accountId, version: play.summary.version,
        conflict: latest.current.observedPlay?.conflict ?? false } })
      const synced = await syncEvidence(api, play.summary.id, sent.evidence, before?.evidenceIds ?? [])
      if (started !== epoch.current) return null
      if (play.summary.version < observedPlayVersion(latest.current, api)) {
        setError('The Play changed again while saving. Reload the current saved Play before saving again.')
        return null
      }
      const stored = draftFromSaved(play, synced.evidence)
      const state = savedState(play, stored)
      const next = { ...state, evidenceIds: [...state.evidenceIds, ...synced.pendingDeletes] }
      // Edits made while saving stay; only their evidence learns its server identity.
      const current = latest.current.draft
      update({
        saved: next,
        observedPlay: { api, id: play.summary.id, accountId: play.summary.accountId, version: play.summary.version, conflict: false },
        draft: current === sent ? stored : { ...current, evidence: mergeSavedEvidence(current.evidence, synced.evidence) },
      })
      if (synced.error) setError(`The play was saved, but an image did not sync: ${errorMessage(synced.error, 'The change could not be completed. Try again.')} Save again to retry.`)
      closeDialog(intendedDialog)
      return next
    } catch (cause) {
      if (started !== epoch.current) return null
      actionError(cause, intendedDialog)
      return null
    }
  }

  async function changeStatus(request: StatusRequest) {
    const intendedDialog = currentDialog.current
    const finish = beginWork('status')
    if (!finish) return
    const started = epoch.current
    try {
      let state = latest.current.saved
      if (request.status === 'planned' && planBlocked()) return
      if (request.status === 'planned' && status === 'draft' && (!state || isDirty(latest.current.draft, state))) {
        state = await saveDraft()
        if (!state) return
        if (isDirty(latest.current.draft, state)) { setError('Changes made during saving are still unsaved. Save them before planning.'); return }
      }
      if (!state) return
      setError(null); setDialogError(null)
      const play = await api.changePlayStatus(state.summary.id, state.summary.version, request)
      if (started !== epoch.current) return
      acceptStoredPlay(play)
      closeDialog(intendedDialog)
    } catch (cause) {
      if (started !== epoch.current) return
      actionError(cause, intendedDialog)
    } finally {
      finish()
    }
  }

  async function remove() {
    const started = epoch.current
    if (!saved) return
    const finish = beginWork('delete')
    if (!finish) return
    setDialogError(null)
    try {
      await api.deletePlay(saved.summary.id)
      if (started !== epoch.current) return
      setDialog(null)
      update({ ...createPlaysSession(), manual: emptyManualDraft() })
    } catch (cause) {
      if (started !== epoch.current) return
      setDialogError(errorMessage(cause, 'The change could not be completed. Try again.'))
    } finally {
      finish()
    }
  }

  async function open(id: string): Promise<boolean> {
    const before = latest.current
    if ((before.saved ? isDirty(before.draft, before.saved) : hasDraftContent(before.draft)) || hasManualDraft(before.manual)) {
      setNavigationError('Keep your current work. Save or explicitly discard it before opening the requested Play.')
      return false
    }
    const finish = beginWork('open')
    if (!finish) return false
    const started = epoch.current
    openController.current?.abort()
    const controller = new AbortController()
    openController.current = controller
    setError(null)
    try {
      const loaded = await loadSavedPlay(api, id, controller.signal)
      if (started !== epoch.current || controller.signal.aborted) return false
      if (latest.current.draft !== before.draft || hasManualDraft(latest.current.manual)) {
        setNavigationError('Your edits made while loading were kept. Save them before trying the requested Play again.')
        return false
      }
      if (before.saved?.summary.id === id && loaded.saved.summary.version < observedPlayVersion(latest.current, api)) {
        setNavigationError('This response is older than the latest known Play. Retry opening the current saved Play.')
        return false
      }
      update({ view: 'editor', ...loaded, manual: emptyManualDraft(), observedPlay: {
        api, id, accountId: loaded.saved.summary.accountId, version: loaded.saved.summary.version, conflict: false,
      } })
      setNavigationError(null)
      return true
    } catch (cause) {
      if (started === epoch.current && !controller.signal.aborted) { setError(errorMessage(cause, 'The change could not be completed. Try again.')); setNavigationError(errorMessage(cause, 'The change could not be completed. Try again.')) }
      return false
    } finally {
      controller.abort()
      finish()
    }
  }

  useEffect(() => {
    if (!visible) return
    if (!requestedPlayId) { requestAttempt.current = null; return }
    if (requestAttempt.current === requestedPlayId || busy) return
    if (saved?.summary.id === requestedPlayId) {
      update({ view: 'editor' })
      requestAttempt.current = requestedPlayId
      onRequestedPlayHandled?.()
      return
    }
    if (unsaved) return
    requestAttempt.current = requestedPlayId
    let active = true
    queueMicrotask(() => { if (active) void open(requestedPlayId).then(success => {
      if (success && requestedId.current === requestedPlayId) onRequestedPlayHandled?.()
    }) })
    return () => { active = false }
    // open reads the live session and guards edits made during loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, requestedPlayId, busy, unsaved, saved?.summary.id, onRequestedPlayHandled, api, update])

  const requested = requestedPlayId && requestedPlayId !== saved?.summary.id ? <div className="workspace-alert plays-request" role="status">
    <span>{unsaved ? 'A Play was requested from another screen. Your current work is kept; save it or explicitly discard it before opening.'
      : navigationError ?? 'Opening the requested Play…'}</span>
    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { update({ view: 'editor' }); onRequestedPlayHandled?.() }}>Keep current work</Button>
    {!unsaved && navigationError && <Button variant="outline" size="sm" disabled={busy !== null}
      onClick={() => { void open(requestedPlayId).then(success => { if (success && requestedId.current === requestedPlayId) onRequestedPlayHandled?.() }) }}>Retry requested Play</Button>}
  </div> : null

  if (!visible) return null
  const conflict = session.observedPlay?.api === api && session.observedPlay.id === saved?.summary.id &&
    session.observedPlay.accountId === saved.summary.accountId && session.observedPlay.conflict
    ? <div className="workspace-alert" role="alert">The saved Play changed elsewhere. Your edits and their original version were kept. Copy any edits you want to keep, then discard the local copy from All plays and reopen the latest saved Play before saving.</div> : null
  if (session.view === 'list') {
    return <>{requested}{conflict}<PlayList api={api} accounts={accounts} busy={busy !== null}
      unsaved={unsaved ? draft.title.trim() || 'Untitled play' : null}
      onOpen={id => { void open(id) }}
      onNew={() => { if (activeWork.current.current) return; setError(null); update(startNewPlay(session)) }}
      onContinue={() => update({ view: 'editor' })}
      onDiscard={() => { if (activeWork.current.current) return; latest.current = createPlaysSession(); onSession(latest.current) }} /></>
  }

  const saving = busy === 'save'
  const locked = status !== 'draft'
  const readOnly = ended.includes(status)
  const needsReason = !!saved && locked && !readOnly && changedPlan
  const statusBlocked = dirty ? 'Save your changes first' : undefined
  const pending = busy !== null

  // The same buttons stay in the same places whether or not the play is saved; unavailable ones are disabled.
  const statusAction = status === 'draft'
    ? <Button size="sm" className="play-primary" disabled={pending || !draft.accountId || !draft.instrument}
      title={!draft.instrument ? 'Choose an instrument and price an entry to plan' : 'Commit to this plan. Later changes become revisions.'}
      onClick={() => { void changeStatus({ status: 'planned' }) }}><Play size={14} />Plan it</Button>
    : status === 'planned' ? <Button size="sm" variant="outline" disabled={pending || dirty} title={statusBlocked ?? 'Orders withdrawn, idea still valid'}
      onClick={() => { void changeStatus({ status: 'paused' }) }}><Pause size={14} />Pause</Button>
    : status === 'paused' ? <Button size="sm" className="play-primary" disabled={pending || dirty} title={statusBlocked}
      onClick={() => { void changeStatus({ status: 'planned' }) }}><Play size={14} />Resume</Button>
    : null
  const cancellable = status === 'planned' || status === 'paused'
  const actions = <div className="play-actions" role="group" aria-label="Play actions">
    <Button variant="outline" size="sm" disabled={!saved} title={saved ? 'Plan revisions and status changes' : 'Save the play first'}
      onClick={() => setDialog('history')}><History size={14} />History</Button>
    <Button size="sm" variant="outline" className="play-save" disabled={!dirty || pending || !draft.accountId}
      title={!draft.accountId ? 'Choose an account to save' : undefined}
      onClick={() => { if (planBlocked()) return; if (needsReason) { setDialogError(null); setDialog('revision') } else void save() }}>
      <Save size={14} />{saving ? 'Saving…' : !dirty && saved ? 'Saved' : 'Save'}</Button>
    {statusAction}
    {cancellable
      ? <Button size="sm" variant="outline" className="danger-action" disabled={pending || dirty}
        title={statusBlocked} onClick={() => { setDialogError(null); setDialog('cancel') }}><X size={14} />Cancel play</Button>
      : status === 'draft' && <Button size="sm" variant="outline" className="danger-action" disabled={pending || !saved}
        title={saved ? 'Delete this draft' : 'Nothing saved yet'} onClick={() => { setDialogError(null); setDialog('delete') }}><Trash2 size={14} />Delete</Button>}
  </div>

  // One short line, only when it changes what the owner can do; the buttons and status badge say the rest.
  const notice = !saved ? null
    : retrospective ? 'Retrospective. No original plan or initial-risk R. Only review and images can change.'
    : readOnly ? `${statusLabels[status]}. Review and images can change${manual && status === 'closed' ? '; manual facts can be corrected without reopening' : ''}.`
    : dirty ? 'Unsaved changes.'
    : locked ? `Revision ${saved.summary.planRevision}. Saved plan changes ask for a reason.` : null

  return <>{requested}{conflict}
    <Button variant="ghost" size="sm" className="plays-back" onClick={() => update({ view: 'list' })}><ArrowLeft size={14} />All plays</Button>
    <PlayWorkspace accounts={accounts} portfolios={portfolios} api={api} draft={draft} onChange={next => update({ draft: next })}
      {...(onReload ? { onReload } : {})} loading={loading} status={status} actions={actions} {...(notice ? { notice } : {})} lockInstrument={locked}
      lockDirection={status === 'open' || filled} readOnly={readOnly} retrospective={retrospective}
      sizing={sizing.sizing} onRiskChange={sizing.updateRisk}
      execution={manual ? <ManualExecutionPanel key={saved?.summary.id ?? 'unsaved'} api={api} saved={saved} entries={draft.entries}
        enabled={account?.isEnabled !== false} dirty={dirty} form={session.manual ?? emptyManualDraft()}
        working={busy !== null}
        observedVersion={observedPlayVersion(session, api)}
        onChange={form => { if (mounted.current && currentApi.current === api && latest.current.saved?.summary.id === saved?.summary.id) update({ manual: form }) }}
        onStored={acceptStoredPlay} onBegin={() => latest.current.saved?.summary.id === saved?.summary.id ? beginWork('manual') : null} />
        : saved && status !== 'draft' ? <ExecutionPanel execution={tracking.execution} error={tracking.error} busy={tracking.busy}
        entries={draft.entries} direction={draft.direction} origin={saved.summary.origin} onCheck={() => { void tracking.check() }} onLink={request => { void tracking.link(request) }}
        onUnlink={linkId => { void tracking.unlink(linkId) }} /> : undefined} />
    {dialog === 'revision' && saved && <RevisionDialog revision={saved.summary.planRevision} pending={saving} error={dialogError}
      onSave={reason => { void save(reason) }} onClose={() => setDialog(null)} />}
    {dialog === 'cancel' && <CancelDialog pending={busy === 'status'} error={dialogError}
      onCancel={(reason, note) => { void changeStatus({ status: 'cancelled', reason, ...(note ? { note } : {}) }) }} onClose={() => setDialog(null)} />}
    {dialog === 'delete' && <DeleteDialog pending={busy === 'delete'} error={dialogError} onDelete={() => { void remove() }} onClose={() => setDialog(null)} />}
    {dialog === 'history' && saved && <HistoryDialog api={api} playId={saved.summary.id} onClose={() => setDialog(null)} />}
  </>
}

function PlayList({ api, accounts, busy, unsaved, onOpen, onNew, onContinue, onDiscard }: {
  api: WorkspaceApi
  accounts: BrokerAccount[]
  busy: boolean
  /** Title of the play with unsaved changes, if any. */
  unsaved: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onContinue: () => void
  onDiscard: () => void
}) {
  const venues = useVenues()
  const [filter, setFilter] = useState<Filter>('active')
  const [result, setResult] = useState<{ plays: PlaySummary[] } | { error: string } | null>(null)
  const [generation, setGeneration] = useState(0)
  // The first mount loads the list, even if a retained save is running. Subsequent work
  // reloads only on completion, including lost responses that leave the version unchanged.
  const [previousBusy, setPreviousBusy] = useState(busy)
  if (previousBusy !== busy) {
    setPreviousBusy(busy)
    if (!busy) setGeneration(current => current + 1)
  }
  useEffect(() => {
    const controller = new AbortController()
    api.plays(controller.signal).then(plays => { if (!controller.signal.aborted) setResult({ plays }) })
      .catch(cause => { if (!controller.signal.aborted) setResult({ error: errorMessage(cause, 'The change could not be completed. Try again.') }) })
    return () => controller.abort()
  }, [api, generation])
  const plays = result && 'plays' in result ? result.plays : []
  const shown = plays.filter(play => {
    if (filter === 'all') return true
    if (filter === 'pending' || filter === 'reviewed') return ended.includes(play.status) &&
      (filter === 'reviewed') === (play.hasReview || !!play.reviewedAtUtc)
    return (filter === 'ended') === ended.includes(play.status)
  })
  const accountName = (id: string) => accounts.find(account => account.id === id)?.name ?? 'Unknown account'

  return <section className="plays-page plays-list-page" aria-label="Saved plays">
    <div className="plays-draft-heading">
      <div className="page-heading-copy"><span className="eyebrow">A LITTLE INTENTION BEFORE THE TRADE</span>
        <h1>Plays</h1><p>Each idea from plan to review. Planned plays keep every revision of the plan.</p></div>
      <div className="plays-heading-actions"><Button onClick={onNew} disabled={!!unsaved || busy}><Plus size={15} />New play</Button></div>
    </div>
    {unsaved && <div className="workspace-alert plays-unsaved" role="status"><span>Unsaved changes in <strong>{unsaved}</strong>. Save or discard them before opening another play.</span>
      <Button variant="outline" size="sm" onClick={onContinue}>Continue editing</Button>
      <Button variant="ghost" size="sm" className="danger-action" disabled={busy} onClick={onDiscard}>Discard changes</Button></div>}
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
          <span className="plays-list-title"><strong>{play.title || 'Untitled play'}</strong>{play.origin === 'retrospective' && <small>Retrospective · no original plan / R</small>}
            <small>{play.instrument ? instrumentLabel(venues.quote(play.venueId), play.instrument, play.instrumentSource) : 'No instrument'} · <VenueBadge venueId={play.venueId} size="xs" /> · {accountName(play.accountId)}</small></span>
          <span className={`direction-chip ${play.direction}`}>{play.direction === 'long' ? 'Long' : 'Short'}</span>
          <span className={`badge play-status-${play.status}`}>{statusLabels[play.status]}</span>
          <small className="plays-list-meta">{ended.includes(play.status) && (play.hasReview || play.reviewedAtUtc ? 'Reviewed · ' : 'Pending review · ')}{play.origin !== 'retrospective' && play.planRevision > 1 ? `${play.planRevision} revisions · ` : ''}Updated {new Date(play.updatedAtUtc).toLocaleDateString()}</small>
        </button>
      </li>)}
    </ul> : <div className="plays-list-empty"><p>{plays.length ? 'No plays in this view.' : 'No saved plays yet. Start one to write down the idea before the trade.'}</p></div>)}
  </section>
}
