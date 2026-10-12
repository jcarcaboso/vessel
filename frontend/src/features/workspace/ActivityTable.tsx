import { OperationDirection } from './OperationDirection'
import { fillDirection, resultSign } from './activity-format'
import type { BrokerAccount, ImportedFill } from '@/api/workspace'
import { amount, money, time } from './format'
import { Inbox } from 'lucide-react'

export function ActivityTable({ fills, accounts, compact = false, operationDirection }: { fills: ImportedFill[]; accounts: BrokerAccount[]; compact?: boolean; operationDirection?: 'long' | 'short' | null }) {
  const visible = fills.filter(fill => accounts.some(a => a.id === fill.accountId && a.isEnabled !== false))
  if (!visible.length) return <div className="workspace-empty small-empty"><Inbox size={27} /><strong>No imported executions yet</strong><p>Refresh an exchange account to retrieve recent perpetual fills. Original intent is never inferred from imported history.</p></div>
  return <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Execution</th><th>Account / time</th><th>Quantity</th><th>Price</th>{!compact && <><th>Reported closed P&amp;L</th><th>Association</th></>}</tr></thead>
    <tbody>{visible.map(fill => <tr key={fill.id}>
      <td><div className="execution-name"><div><strong>{fill.contractId}</strong>{operationDirection === undefined && fill.positionEffect === 'flip' ? <span className="execution-flip-directions"><OperationDirection direction={fill.side === 'buy' ? 'short' : 'long'} />→<OperationDirection direction={fill.side === 'buy' ? 'long' : 'short'} /></span> : <OperationDirection direction={operationDirection === undefined ? fillDirection(fill) : operationDirection} />}<small>{fill.direction || fill.side}</small></div></div></td>
      <td><strong>{accounts.find(a => a.id === fill.accountId)?.name ?? 'Account'}</strong><small>{time(fill.occurredAtUtc)}</small></td>
      <td className="numeric">{amount(fill.quantity)}</td><td className="numeric">{money(fill.price)}</td>
      {!compact && <><td className="numeric"><span className={`operation-result ${resultSign(fill.closedPnlUsd)}`}>{money(fill.closedPnlUsd)}</span><small>Fee {amount(fill.fee)} {fill.feeToken}{fill.pnlBasis === 'net-of-fee' ? ' · P&L after fees' : ''}{fill.feeBasis === 'standard-account-free' ? ' · fee-free account' : ''}</small></td><td><span className="workspace-badge" title={fill.playId ?? undefined}>{fill.playId ? `Play ${fill.playId.slice(0, 8)}` : 'Unassigned'}</span></td></>}
    </tr>)}</tbody></table></div>
}
