import { Fragment, useState } from 'react'
import type { ActivityOperation } from '@/api/activity'
import type { BrokerAccount } from '@/api/workspace'
import { ChevronDown, ChevronRight, Inbox } from 'lucide-react'
import { ActivityTable } from './ActivityTable'
import { OperationDirection } from './OperationDirection'
import { duration, resultSign } from './activity-format'
import { amount, money, time } from './format'
import './activity-operations.css'

function Result({ value }: { value: string | null }) {
  return <span className={`operation-result ${resultSign(value)}`} title={value ?? 'Unknown'}>{money(value)}</span>
}

export function OperationsTable({ operations, accounts, compact = false, onPreview }: {
  operations: ActivityOperation[]; accounts: BrokerAccount[]; compact?: boolean
  onPreview?: (operation: ActivityOperation) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Defense in depth: a management reload may disable an account while an earlier activity read is still visible.
  const visible = operations.filter(op => accounts.some(a => a.id === op.accountId && a.isEnabled !== false))
  if (!visible.length) return <div className="workspace-empty small-empty"><Inbox size={27} /><strong>No operations in this view</strong><p>Refresh an enabled exchange account to retrieve fills, or reset the filters. Imported history never supplies trading intent.</p></div>
  return <div className="workspace-table-wrap"><table className="workspace-table operations-table"><thead><tr>
    <th>Operation</th><th>Account / time</th><th>Size</th>{!compact && <><th>Average entry → exit</th><th>Closed P&amp;L</th></>}<th>Net result</th>{!compact && <><th>Fees</th><th>Play</th></>}
  </tr></thead><tbody>{visible.map(op => {
    const open = expanded.has(op.id)
    return <Fragment key={op.id}><tr>
      <td><div className="operation-heading"><button type="button" className="icon-button" aria-label={`${open ? 'Collapse' : 'Expand'} ${op.contractId} operation`} aria-expanded={open} aria-controls={`operation-${op.id}`} onClick={() => setExpanded(previous => {
        const next = new Set(previous); if (next.has(op.id)) next.delete(op.id); else next.add(op.id); return next
      })}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button><div><strong>{op.contractId}</strong><OperationDirection direction={op.direction} /><small className={op.status === 'incomplete' ? 'operation-incomplete' : ''}>{op.status}</small></div></div></td>
      <td><strong>{accounts.find(a => a.id === op.accountId)?.name ?? 'Account'}</strong><small>Opened {op.openedAtUtc === null ? 'unknown' : time(op.openedAtUtc)}</small><small>{op.closedAtUtc === null ? op.status === 'incomplete' ? `Last fill ${time(op.lastOccurredAtUtc)}` : 'Not closed' : `Closed ${time(op.closedAtUtc)}`}</small><small>{duration(op.openedAtUtc, op.closedAtUtc)}</small></td>
      <td className="numeric"><strong title={op.quantity ?? 'Unknown'}>{op.quantity === null ? '—' : amount(op.quantity)}</strong><small>Peak quantity</small>{!compact && <><small>Entered {op.totalEnteredQuantity === null ? '—' : amount(op.totalEnteredQuantity)}</small><small>Exited {op.totalExitedQuantity === null ? '—' : amount(op.totalExitedQuantity)}</small><small>Remaining {op.openQuantity === null ? '—' : amount(op.openQuantity)}</small></>}</td>
      {!compact && <><td className="numeric"><span title={op.averageEntryPrice ?? 'Unknown'}>{money(op.averageEntryPrice)}</span> → <span title={op.averageExitPrice ?? 'Unknown'}>{money(op.averageExitPrice)}</span></td><td className="numeric"><Result value={op.reportedClosedPnlUsd} /><small>{op.pnlBasis}</small></td></>}
      <td className="numeric"><Result value={op.netResultUsd} /><small>{op.status === 'open' ? 'Realized to date' : 'Reported executions'}</small></td>
      {!compact && <><td className="numeric"><span title={op.stablecoinFeesNominalUsd}>{money(op.stablecoinFeesNominalUsd)}</span><small>Stablecoin units · nominal</small>{op.otherFees.map(f => <small key={f.token}>{amount(f.amount)} {f.token}</small>)}</td><td>{op.playId ? <span className="workspace-badge" title={op.playId}>Play {op.playId.slice(0, 8)}</span> : <span className="workspace-badge">{op.playAssociation === 'mixed' ? 'Mixed' : 'Unassigned'}</span>}</td></>}
    </tr>{open && <tr id={`operation-${op.id}`}><td colSpan={compact ? 4 : 8} className="operation-expanded">
      {onPreview && <button className="text-action" aria-label={`Inspect ${op.contractId} retrospective eligibility`} onClick={() => onPreview(op)}>Inspect retrospective eligibility</button>}
      {op.coverage.length > 0 && <ul className="operation-coverage">{op.coverage.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {op.fills.some(part => part.fill.positionEffect === 'flip') && <p className="workspace-scope-note">Flip rows show this operation's allocated quantity, fee and P&amp;L; the original fact stays unchanged.</p>}
      {op.fills.length > 0 ? <ActivityTable fills={op.fills.map(part => ({ ...part.fill, quantity: part.quantity, fee: part.fee, closedPnlUsd: part.closedPnlUsd }))} accounts={accounts} /> : <p className="workspace-scope-note">Execution rows were omitted by the response limit.</p>}
      {op.fills.some(part => part.fill.positionEffect === 'flip') && <details className="operation-originals"><summary>Original flip facts</summary><ActivityTable fills={op.fills.filter(part => part.fill.positionEffect === 'flip').map(part => part.fill)} accounts={accounts} /></details>}
      {op.omittedFillCount > 0 && <p className="operation-incomplete">Some execution rows are not shown because of the display limit; operation totals include them.</p>}
    </td></tr>}</Fragment>
  })}</tbody></table></div>
}
