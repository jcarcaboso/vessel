import { useState } from 'react'
import type { LinkOrder, PlayExecution } from '@/api/plays'
import { Button } from '@/components/ui/button'
import { Link2, Link2Off, RefreshCw } from 'lucide-react'
import type { DraftEntry } from './draft'
import { describeOrder, fillSummary, levelName, levelOptions } from './execution'

const time = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Venue orders and fills linked to the play, suggestions to confirm and orders that could be linked by hand. */
const pnlBasisNote = {
  gross: 'As the venue reports it, before fees; fees are listed separately.',
  'net-of-fee': 'As the venue reports it, with fees already taken off; the fees are listed for reference.',
  mixed: 'Some fills report closed PnL before fees and some after.',
} as const

export function ExecutionPanel({ execution, error, busy, entries, onCheck, onLink, onUnlink }: {
  execution: PlayExecution | null
  error: string | null
  busy: boolean
  entries: readonly DraftEntry[]
  onCheck: () => void
  onLink: (request: LinkOrder) => void
  onUnlink: (linkId: string) => void
}) {
  const [choices, setChoices] = useState<Record<string, string>>({})
  if (!execution) return <div className="execution-panel"><p className="muted" role="status">{error ?? 'Loading execution…'}</p></div>
  const editable = ['planned', 'paused', 'open'].includes(execution.status)
  const options = levelOptions(entries, execution.status === 'open')
  const { totals } = execution
  return <div className="execution-panel">
    <div className="execution-header">
      <p className="muted">{execution.tracked
        ? <>Orders link automatically by price and side; Vessel asks only when several plays could own one.{' '}
          {execution.checkedAtUtc ? `Checked ${time(execution.checkedAtUtc)}.` : 'Not checked yet.'}</>
        : execution.reason ?? 'Execution is not tracked for this play.'}</p>
      {execution.tracked && editable && <Button size="sm" variant="outline" onClick={onCheck} disabled={busy} aria-busy={busy}>
        <RefreshCw size={13} className={busy ? 'is-spinning' : ''} />{busy ? 'Checking…' : 'Check venue'}</Button>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <dl className="execution-totals">
      <div><dt>Entered</dt><dd>{totals.enteredQuantity}</dd></div>
      <div><dt>Exited</dt><dd>{totals.exitedQuantity}</dd></div>
      <div><dt>Still open</dt><dd>{totals.openQuantity}</dd></div>
      <div title={pnlBasisNote[totals.closedPnlBasis]}><dt>Venue closed PnL{totals.closedPnlBasis === 'net-of-fee' ? ' · after fees' : ''}</dt><dd>{totals.closedPnlUsd} USD</dd></div>
      <div><dt>Fees</dt><dd>{totals.fees.length ? totals.fees.map(fee => `${fee.amount} ${fee.token}`).join(' · ') : '0'}</dd></div>
    </dl>

    {execution.suggestions.length > 0 && <section aria-label="Orders to confirm" className="execution-section">
      <h3>Confirm these orders</h3>
      <p className="muted">Each also matches another play on this instrument, so Vessel does not assign it on its own.</p>
      <ul className="execution-list">{execution.suggestions.map(link => <li key={link.id}>
        <span><strong>{levelName(entries, link)}</strong>{link.order && <small>{describeOrder(link.order)} · {link.order.status}</small>}</span>
        <span className="execution-actions">
          <Button size="sm" disabled={busy || !editable || !link.order} onClick={() => onLink({ orderId: link.order?.orderId ?? '', role: link.role,
            ...(link.entryId ? { entryId: link.entryId } : {}), ...(link.levelId ? { levelId: link.levelId } : {}) })}>
            <Link2 size={13} />Link here</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onUnlink(link.id)}>Not this play</Button>
        </span>
      </li>)}</ul>
    </section>}

    <section aria-label="Linked orders" className="execution-section">
      <h3>Linked orders</h3>
      {execution.links.length ? <ul className="execution-list">{execution.links.map(link => <li key={link.id}>
        <span><strong>{levelName(entries, link)}</strong>
          <small>{link.order ? `${describeOrder(link.order)} · ${link.order.status}` : 'Order details unavailable'} · filled {link.filledQuantity}
            {link.source === 'automatic' ? ' · linked automatically' : ' · linked by you'}</small>
          {link.fills.length > 0 && <small className="execution-fills" title={link.fills.map(fill =>
            `${fill.direction} ${fill.quantity} at ${fill.price}`).join('\n')}>{fillSummary(link.fills)}</small>}</span>
        {editable && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onUnlink(link.id)} aria-label={`Unlink ${levelName(entries, link)} order`}
          title="Unlink. Vessel will not link this order to this level again."><Link2Off size={13} />Unlink</Button>}
      </li>)}</ul> : <p className="muted">No orders linked yet. Place the planned orders on the venue; matching orders link here.</p>}
    </section>

    {editable && execution.unlinkedOrders.length > 0 && <section aria-label="Other orders on this instrument" className="execution-section">
      <h3>Other orders on this instrument</h3>
      <p className="muted">Placed since this play was created and not linked to any play. Link one by hand if it belongs here.</p>
      <ul className="execution-list">{execution.unlinkedOrders.map(order => {
        const chosen = choices[order.orderId] ?? ''
        const option = options.find(item => item.value === chosen)
        return <li key={order.orderId}>
          <span><strong>{describeOrder(order)}</strong><small>{order.status} · placed {time(order.placedAtUtc)}</small></span>
          <span className="execution-actions">
            <select aria-label={`Level for order ${order.orderId}`} value={chosen} disabled={busy}
              onChange={event => setChoices(current => ({ ...current, [order.orderId]: event.target.value }))}>
              <option value="">Link as…</option>
              {options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={busy || !option} onClick={() => option && onLink({ orderId: order.orderId, ...option.request })}>
              <Link2 size={13} />Link</Button>
          </span>
        </li>
      })}</ul>
    </section>}
    <p className="execution-notice muted">{execution.notice}</p>
  </div>
}
