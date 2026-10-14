import { useEffect, useRef, useState } from 'react'
import type { ReviewExclusions as Exclusions, ReviewQuery } from '@/api/review'
import type { WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/errors'

export function ReviewExclusions({ api, initialQuery, onOpenPlay }: {
  api: WorkspaceApi; initialQuery: ReviewQuery; onOpenPlay: (id: string, signal: AbortSignal) => Promise<void>
}) {
  const [offset, setOffset] = useState(0)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ api: WorkspaceApi; offset: number; retry: number; value: Exclusions | null; error: string | null } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [api])
  useEffect(() => {
    const controller = new AbortController()
    const query = { ...initialQuery, offset }
    if (api.reviewExclusions) {
      api.reviewExclusions(query, controller.signal).then(value => {
        if (!controller.signal.aborted) setState({ api, offset, retry, value, error: null })
      }).catch(cause => {
        if (!controller.signal.aborted) setState({ api, offset, retry, value: null,
          error: cause instanceof ApiError ? cause.message : 'Excluded Plays could not be loaded.' })
      })
    }
    return () => controller.abort()
  }, [api, initialQuery, offset, retry])
  async function open(id: string) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setOpening(id); setOpenError(null)
    try { await onOpenPlay(id, controller.signal) }
    catch (cause) { if (!controller.signal.aborted) setOpenError(cause instanceof ApiError ? cause.message : 'The Play could not be opened.') }
    finally { if (!controller.signal.aborted) setOpening(null) }
  }
  if (!api.reviewExclusions) return <p role="alert">Exclusion inspection is unavailable on this connection. Reload the workspace after updating the server.</p>
  const pending = state === null || state.api !== api || state.offset !== offset || state.retry !== retry
  if (pending) return <p role="status">Loading excluded Plays…</p>
  if (state.error) return <div role="alert"><p>{state.error}</p><button className="pr-outline-button" onClick={() => setRetry(n => n + 1)}>Retry exclusions</button></div>
  const page = state.value!
  return <>
    {openError && <p role="alert">{openError}</p>}
    <p className="pr-exclusion-notice">{page.notice}</p>
    <ul className="pr-exclusion-list">{page.items.map(item => <li key={item.playId}>
      <button className="pr-play-link" disabled={opening !== null} aria-label={`Open excluded Play ${item.title || item.instrument}`} onClick={() => { void open(item.playId) }}>{item.title || item.instrument}{opening === item.playId ? ' · Opening…' : ''}</button>
      <p>{item.accountName} · {item.instrument}</p>
      <small>Play {item.playId} · Account {item.accountId}</small>
      <ul>{item.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
    </li>)}</ul>
    {!page.items.length && <p>No excluded Plays in this selection.</p>}
    <div className="pr-pagination pr-exclusion-pagination"><button className="pr-outline-button" disabled={page.offset === 0} onClick={() => setOffset(Math.max(0, page.offset - 50))}>Previous exclusions</button>
      <span>{page.items.length ? page.offset + 1 : 0}–{page.offset + page.items.length} of {page.total}</span>
      <button className="pr-outline-button" disabled={page.nextOffset === null} onClick={() => { if (page.nextOffset !== null) setOffset(page.nextOffset) }}>Next exclusions</button>
    </div>
  </>
}
