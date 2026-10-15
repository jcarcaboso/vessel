import { useEffect, useState } from 'react'
import type { AccountMonitor, MonitorDiscrepancy } from '@/api/monitor'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import './monitor.css'

const labels = { live: 'Monitored', stale: 'Monitor stale', degraded: 'Monitor degraded', 'credential-error': 'Monitor credential error', idle: 'Monitor idle' }
const time = (value: string | null) => value ? new Date(value).toLocaleString() : 'not recorded'

export function MonitorBadge({ monitor }: { monitor?: AccountMonitor | null }) {
  return monitor && monitor.state !== 'live' && monitor.state !== 'idle'
    ? <span className="monitor-badge" title={monitor.error ?? undefined}>{labels[monitor.state]}</span> : null
}

export function MonitorPanel({ monitor, busy, error, retryAtUtc, statusUnavailable = false, onCheck, onManageCredential }: {
  monitor: AccountMonitor; busy: boolean; error: string | null; retryAtUtc?: string | undefined
  onCheck: () => void; onManageCredential?: (() => void) | undefined
  statusUnavailable?: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  const until = Math.max(Date.parse(monitor.nextManualAllowedAtUtc ?? '') || 0, Date.parse(retryAtUtc ?? '') || 0)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const remaining = Math.max(0, Math.ceil((until - now) / 1000))
  const running = busy || monitor.manualState !== 'idle'
  return <section className="monitor-panel" aria-label="Background monitor">
    <div className="monitor-heading">
      <div><strong>{labels[monitor.state]}</strong>
        <p className="muted">Last successful check {time(monitor.lastSuccessAtUtc)} · next scheduled {time(monitor.nextRunAtUtc)}</p>
      </div>
      <Button size="sm" variant="outline" disabled={running || remaining > 0 || statusUnavailable} aria-busy={running} onClick={onCheck}>
        <RefreshCw size={13} className={running ? 'is-spinning' : ''} />{running ? monitor.manualState === 'pending' ? 'Check pending…' : 'Checking…' : remaining ? `Check in ${remaining}s` : 'Check'}
      </Button>
    </div>
    {!monitor.workerOnline && <p className="monitor-warning">Worker offline. Scheduled checks and requested runs may be delayed.</p>}
    {monitor.state === 'stale' && <p className="monitor-warning">Fills may be missing. Last attempt {time(monitor.lastAttemptAtUtc)}.</p>}
    {monitor.state === 'degraded' && <p className="monitor-warning">The latest read has incomplete coverage. Discrepancies are not corrections.</p>}
    {monitor.error && <p className="monitor-warning">{monitor.error}</p>}
    {monitor.state === 'credential-error' && (onManageCredential
      ? <Button size="sm" variant="outline" onClick={onManageCredential}>Manage account credential</Button>
      : <a href="#accounts">Manage account credential</a>)}
    {error && <p className="error" role="alert">{error}</p>}
    {statusUnavailable && <p className="monitor-warning">Check is blocked until stored monitor status can be refreshed.</p>}
  </section>
}

export function MonitorDiscrepancies({ discrepancies, busy, onDismiss }: {
  discrepancies: MonitorDiscrepancy[]; busy: boolean; onDismiss: (id: string, note?: string) => Promise<void>
}) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function dismiss(id: string) {
    if (pending || busy) return
    setPending(id); setError(null)
    try { await onDismiss(id, notes[id]?.trim() || undefined) } catch {
      setError('Dismissal was not confirmed. Reload stored state before trying again.')
    } finally { setPending(null) }
  }
  if (!discrepancies.length) return null
  return <section className="monitor-discrepancies" aria-label="Monitor discrepancies">
    <h3>Monitor discrepancies</h3>
    <p className="muted">Dismissal acknowledges a warning. It does not change executions or stop checks, including resting exits after closure or cancellation.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <ul>{discrepancies.map(item => <li key={item.id}>
      <div><strong>{item.kind.replaceAll('-', ' ').replaceAll('_', ' ')} · {item.contractId}</strong>
        <span className="monitor-badge" data-severity={item.severity}>{item.severity} · {item.state}</span></div>
      <small>Opened {time(item.openedAtUtc)}{item.confirmedAtUtc ? ` · confirmed ${time(item.confirmedAtUtc)}` : ''}</small>
      {Object.keys(item.details).length > 0 && <details><summary>Recorded details</summary><pre>{JSON.stringify(item.details, null, 2)}</pre></details>}
      {item.note && <p>{item.note}</p>}
      {item.state === 'open' && <div className="monitor-dismiss">
        <label><span className="sr-only">Dismissal note for {item.kind} {item.contractId}</span>
          <input maxLength={500} placeholder="Optional dismissal note" value={notes[item.id] ?? ''}
            disabled={busy || pending !== null} onChange={event => setNotes({ ...notes, [item.id]: event.target.value })} /></label>
        <Button size="sm" variant="outline" disabled={busy || pending !== null} onClick={() => { void dismiss(item.id) }}>
          {pending === item.id ? 'Dismissing…' : 'Dismiss'}</Button>
      </div>}
    </li>)}</ul>
  </section>
}
