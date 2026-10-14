import { useEffect, useRef, useState } from 'react'
import type { CreateRetrospectivePlayRequest, RetrospectivePreview as Preview } from '@/api/retrospective'
import type { WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/errors'
import { newDiaryRequestId } from '@/api/diary'
import { Button } from '@/components/ui/button'
import { money, time } from './format'
import { OperationDirection } from './OperationDirection'

export function RetrospectivePreview({ api, accountId, operationId, onOpenPlay, onCreated }: {
  api: WorkspaceApi; accountId: string; operationId: string
  onOpenPlay?: (id: string, signal: AbortSignal) => Promise<void>
  onCreated?: () => void
}) {
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<{ generation: number; value: Preview | null; error: string | null } | null>(null)
  const [title, setTitle] = useState('')
  const [review, setReview] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [attempt, setAttempt] = useState<CreateRetrospectivePlayRequest | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const mutation = useRef<AbortController | null>(null)
  useEffect(() => () => mutation.current?.abort(), [api])
  useEffect(() => {
    const controller = new AbortController()
    if (api.retrospectivePreview) {
      api.retrospectivePreview(accountId, operationId, controller.signal).then(value => {
        if (!controller.signal.aborted) setState({ generation, value, error: null })
      }).catch(cause => {
        if (!controller.signal.aborted) setState({ generation, value: null,
          error: cause instanceof ApiError ? cause.message : 'The operation preview could not be loaded.' })
      })
    }
    return () => controller.abort()
  }, [api, accountId, operationId, generation])

  function refresh() {
    mutation.current?.abort()
    setAttempt(null); setSaveError(null); setConflict(false)
    setGeneration(n => n + 1)
  }
  async function openCreated(id: string, controller: AbortController) {
    if (!onOpenPlay) return
    setSaveError(null)
    try { await onOpenPlay(id, controller.signal) }
    catch (cause) { if (!controller.signal.aborted) setSaveError(cause instanceof ApiError ? cause.message : 'The Play could not be opened. Retry the Play action below; no new creation is needed.') }
  }
  async function create() {
    const preview = state?.value
    if (!api.createRetrospectivePlay || !preview?.eligible || conflict || saving || createdId) return
    // Keep the complete payload and key after an uncertain response. A retry must not create a second Play.
    const body = attempt ?? {
      requestId: newDiaryRequestId(), accountId, operationId, expectedFingerprint: preview.fingerprint,
      title: title.trim(), ...(review.trim() ? { review: review.trim() } : {}),
    }
    if (!body.title) return
    setAttempt(body); setSaving(true); setSaveError(null)
    const controller = new AbortController()
    mutation.current = controller
    try {
      const saved = await api.createRetrospectivePlay(body, controller.signal)
      if (controller.signal.aborted) return
      setCreatedId(saved.summary.id)
      onCreated?.()
      await openCreated(saved.summary.id, controller)
    } catch (cause) {
      if (!controller.signal.aborted) {
        const stale = cause instanceof ApiError && cause.status === 409
        setConflict(stale)
        setSaveError(stale ? 'The operation or its associations changed. Refresh the preview and inspect it again before confirming.' :
          cause instanceof ApiError ? cause.message : 'Creation could not be confirmed. Retry the same request to avoid duplicates.')
      }
    } finally { if (!controller.signal.aborted) setSaving(false) }
  }
  if (!api.retrospectivePreview) return <p role="alert">Retrospective preview is unavailable on this connection. Reload after updating the server.</p>
  if (state === null || state.generation !== generation) return <p role="status">Loading original operation facts…</p>
  if (state.error) return <div role="alert"><p>{state.error}</p><Button variant="outline" onClick={refresh}>Retry preview</Button></div>
  const preview = state.value!
  const op = preview.operation
  return <div className="retrospective-preview">
    <div className="retrospective-summary"><strong>{op.contractId}</strong><OperationDirection direction={op.direction} /><span className="workspace-badge">{op.status} · {op.playAssociation}</span></div>
    <p className="workspace-scope-note">Operation {op.id} · Account {op.accountId}</p>
    <dl className="retrospective-times"><div><dt>Original opening</dt><dd>{op.openedAtUtc ? time(op.openedAtUtc) : 'Unknown'}</dd></div><div><dt>Original closing</dt><dd>{op.closedAtUtc ? time(op.closedAtUtc) : 'Unknown'}</dd></div><div><dt>Net execution result</dt><dd title={op.netResultUsd ?? 'Unknown'}>{money(op.netResultUsd)}</dd></div></dl>
    <p className="workspace-scope-note">{preview.notice}</p>
    <p className="workspace-scope-note">P&amp;L basis: {op.pnlBasis}. Fees follow the reported basis, with no second deduction from net-of-fee P&amp;L. Separate funding cashflows are not added; RISEx funding inclusion is unverified.</p>
    {!preview.eligible && <div role="status"><strong>Cannot create a retrospective Play</strong><ul className="operation-coverage">{preview.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul></div>}
    {op.coverage.length > 0 && <ul className="operation-coverage">{op.coverage.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
    <h3>Original imported fills and associations</h3>
    <p className="workspace-scope-note">Exact retained facts below are unchanged. Operation roles and allocated quantities are shown separately.</p>
    <div className="workspace-table-wrap retrospective-fills"><table className="workspace-table"><caption className="sr-only">Original imported fills and associations</caption><thead><tr><th>Record / time</th><th>Side / effect / role</th><th>Original quantity / price</th><th>Original fee / P&amp;L</th><th>Order / Play</th></tr></thead><tbody>{op.fills.map((part, index) => {
      const fill = part.fill
      return <tr key={`${fill.id}-${index}`}><td><strong>{fill.id}</strong><small>{fill.occurredAtUtc}</small><small>Source fill {fill.sourceFillId}</small><small>Transaction {fill.transactionHash || 'Not reported'}</small></td>
        <td>{fill.side}<small>Effect {fill.positionEffect}</small><small>Operation role {part.role}</small></td>
        <td>{fill.quantity}<small>Price {fill.price}</small><small>Allocated quantity {part.quantity}</small></td>
        <td>{fill.fee} {fill.feeToken}<small>{fill.feeBasis}</small><small>Closed P&amp;L {fill.closedPnlUsd}</small><small>{fill.pnlBasis}</small><small>Allocated fee {part.fee} · P&amp;L {part.closedPnlUsd}</small></td>
        <td>{fill.orderId}<small>{fill.playId ? `Play ${fill.playId}` : 'Unassigned'}</small></td></tr>
    })}</tbody></table></div>
    {op.omittedFillCount > 0 && <p className="operation-incomplete">{op.omittedFillCount} original fills omitted by the response limit. This operation cannot be confirmed here.</p>}
    {op.playId && onOpenPlay && <Button variant="outline" onClick={() => {
      mutation.current?.abort(); const controller = new AbortController(); mutation.current = controller
      void openCreated(op.playId!, controller)
    }}>Open linked Play</Button>}
    {createdId ? <div role="status"><p>Retrospective Play saved. Its original facts remain intact.</p>{onOpenPlay && <Button variant="outline" onClick={() => {
      mutation.current?.abort(); const controller = new AbortController(); mutation.current = controller
      void openCreated(createdId, controller)
    }}>Open saved Play</Button>}</div> : preview.eligible && <>
      <p className="workspace-scope-note">Create a completed retrospective record with today's creation/review time and the original execution times. No pre-trade plan, thesis, stop or initial-risk R is invented. It is excluded from the sizing ladder.</p>
      <label className="retrospective-field">Retrospective title<input maxLength={200} value={title} disabled={attempt !== null} onChange={e => setTitle(e.target.value)} /></label>
      <label className="retrospective-field">Review note, optional<textarea maxLength={10_000} rows={3} value={review} disabled={attempt !== null} onChange={e => setReview(e.target.value)} /></label>
      {!api.createRetrospectivePlay && <p role="alert">Creation is unavailable on this connection.</p>}
      <Button disabled={!api.createRetrospectivePlay || !title.trim() || saving || conflict} onClick={() => { void create() }}>{saving ? 'Saving retrospective…' : attempt ? 'Retry same creation' : 'Confirm retrospective Play'}</Button>
      {saving && <p className="workspace-scope-note" role="status">Closing this preview stops waiting, but cannot undo a write already accepted by the server. Refresh Activity before another attempt.</p>}
    </>}
    {saveError && <p className="workspace-alert" role="alert">{saveError}</p>}
    {!saving && !createdId && (!attempt || conflict) && <Button variant="outline" onClick={refresh}>Refresh preview</Button>}
    {attempt && !conflict && !saving && !createdId && <p className="workspace-scope-note">Title and note are held for the same request until its outcome is confirmed.</p>}
  </div>
}
