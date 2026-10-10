import type { BrokerAccount, ImportedFill } from '@/api/workspace'
import { amount, money, time } from './format'
import { ArrowDownLeft, ArrowUpRight, Inbox } from 'lucide-react'

export function ActivityTable({ fills, accounts, compact = false }: { fills: ImportedFill[]; accounts: BrokerAccount[]; compact?: boolean }) {
  if (!fills.length) return <div className="workspace-empty small-empty"><Inbox size={27} /><strong>No imported executions yet</strong><p>Refresh an exchange account to retrieve recent perpetual fills. Original intent is never inferred from imported history.</p></div>
  return <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Execution</th><th>Account / time</th><th>Quantity</th><th>Price</th>{!compact && <><th>Reported closed P&amp;L</th><th>Association</th></>}</tr></thead>
    <tbody>{fills.map(fill => <tr key={fill.id}>
      <td><div className="execution-name">{fill.side === 'buy' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}<div><strong>{fill.contractId}</strong><small>{fill.direction || fill.side}</small></div></div></td>
      <td><strong>{accounts.find(a => a.id === fill.accountId)?.name ?? 'Account'}</strong><small>{time(fill.occurredAtUtc)}</small></td>
      <td className="numeric">{amount(fill.quantity)}</td><td className="numeric">{money(fill.price)}</td>
      {!compact && <><td className="numeric">{money(fill.closedPnlUsd)}<small>Fee {amount(fill.fee)} {fill.feeToken}{fill.pnlBasis === 'net-of-fee' ? ' · P&L after fees' : ''}{fill.feeBasis === 'standard-account-free' ? ' · fee-free account' : ''}</small></td><td><span className="workspace-badge">Unassigned</span></td></>}
    </tr>)}</tbody></table></div>
}
