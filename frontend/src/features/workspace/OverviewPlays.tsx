import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen } from 'lucide-react'
import { statusLabels, type PlaySummary } from '@/api/plays'
import type { BrokerAccount, WorkspaceApi } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PlayIdentity } from '@/features/plays/PlayIdentity'
import { errorMessage } from '@/api/errors'
import { time } from '@/lib/format'

const filters = [
  { id: 'progress', label: 'In progress', description: 'Saved drafts, planned, paused and open plays' },
  { id: 'review', label: 'Needs review', description: 'Closed or cancelled plays without a saved review note' },
  { id: 'all', label: 'All', description: 'All saved plays, most recently updated first' },
] as const
type Filter = typeof filters[number]['id']
const ended = (play: PlaySummary) => play.status === 'closed' || play.status === 'cancelled'
const matches = (play: PlaySummary, filter: Filter) => filter === 'all' ||
  (filter === 'progress' ? !ended(play) : ended(play) && !play.hasReview)

export function OverviewPlays({ api, accounts, reloadGeneration, onBrowse, onOpen, scopeAccountIds }: {
  api: WorkspaceApi
  accounts: BrokerAccount[]
  scopeAccountIds?: readonly string[]
  reloadGeneration: number
  onBrowse: () => void
  onOpen: (id: string, signal: AbortSignal) => Promise<void>
}) {
  const [filter, setFilter] = useState<Filter>('progress')
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    api: WorkspaceApi; reloadGeneration: number; retry: number
    plays?: PlaySummary[]; error?: string
  } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const openRequest = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    openRequest.current = controller
    return () => controller.abort()
  }, [])
  useEffect(() => {
    const request = new AbortController()
    const generation = { api, reloadGeneration, retry }
    api.plays(request.signal)
      .then(plays => {
        if (!request.signal.aborted) setResult({ ...generation, plays: [...plays].sort((a, b) =>
          Date.parse(b.updatedAtUtc) - Date.parse(a.updatedAtUtc) || a.id.localeCompare(b.id)) })
      })
      .catch(cause => { if (!request.signal.aborted) setResult({ ...generation, error: errorMessage(cause, 'The change could not be completed. Try again.') }) })
    return () => request.abort()
  }, [api, reloadGeneration, retry])
  const loaded = result?.api === api && result.reloadGeneration === reloadGeneration && result.retry === retry
  const plays = (loaded ? result.plays ?? [] : []).filter(play => scopeAccountIds === undefined || scopeAccountIds.includes(play.accountId))

  async function open(id: string) {
    const signal = openRequest.current!.signal
    setOpening(id); setOpenError(null)
    try { await onOpen(id, signal) }
    catch (cause) { if (!signal.aborted) setOpenError(errorMessage(cause, 'The change could not be completed. Try again.')) }
    finally { if (!signal.aborted) setOpening(null) }
  }

  return <section className="shell-panel overview-plays" aria-label="Plays overview">
    <header className="shell-panel-heading"><h2>Plays</h2>
      <button className="text-action" onClick={onBrowse}>View all<ArrowRight size={14} /></button>
    </header>
    <Tabs value={filter} onValueChange={value => setFilter(value as Filter)} className="overview-play-tabs">
      <TabsList aria-label="Show overview plays">
        {filters.map(item => <TabsTrigger key={item.id} value={item.id} title={item.description}>
          {item.label}{' '}<span className="overview-play-count">{loaded && !result.error ? plays.filter(play => matches(play, item.id)).length : '—'}</span>
        </TabsTrigger>)}
      </TabsList>
      {!loaded && <p className="workspace-loading" role="status">Loading plays…</p>}
      {loaded && result.error && <div className="workspace-alert" role="alert"><span>{result.error}</span>
        <Button variant="ghost" size="sm" onClick={() => setRetry(current => current + 1)}>Try again</Button></div>}
      {openError && <div className="workspace-alert" role="alert">{openError}</div>}
      {filters.map(item => {
        const shown = plays.filter(play => matches(play, item.id))
        return <TabsContent key={item.id} value={item.id}>
          {loaded && !result.error && (shown.length ? <ul className="overview-play-list">
            {shown.map(play => <li key={play.id}>
              <button className="overview-play-row" disabled={opening !== null} aria-busy={opening === play.id}
                aria-label={`Open ${play.title || 'Untitled play'}`} aria-describedby={`overview-play-identity-${play.id}`} onClick={() => { void open(play.id) }}>
                <span className="overview-play-copy"><strong>{play.title || 'Untitled play'}</strong>
                  <PlayIdentity id={`overview-play-identity-${play.id}`} instrument={play.instrument} source={play.instrumentSource} venueId={play.venueId}
                    accountName={accounts.find(account => account.id === play.accountId)?.name ?? 'Unknown account'} />
                  <span className={`overview-play-direction ${play.direction}`}>{play.direction === 'long' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{play.direction === 'long' ? 'Long' : 'Short'}</span>
                </span>
                <span className="overview-play-state">
                  <span className={`workspace-badge ${play.status === 'open' ? 'positive-badge' : ended(play) && !play.hasReview ? 'warning-badge' : ''}`}>{statusLabels[play.status]}</span>
                  <small>{opening === play.id ? 'Opening…' : time(play.updatedAtUtc)}</small>
                </span>
              </button>
            </li>)}
          </ul> : <div className="workspace-empty small-empty"><BookOpen size={25} />
            <strong>{item.id === 'progress' ? 'No plays in progress' : item.id === 'review' ? 'No plays waiting for review' : 'No saved plays yet'}</strong>
            <Button variant="outline" size="sm" onClick={onBrowse}>Open Plays<ArrowRight size={13} /></Button>
          </div>)}
        </TabsContent>
      })}
    </Tabs>
  </section>
}
