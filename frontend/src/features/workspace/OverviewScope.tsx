import type { BrokerAccount, Portfolio } from '@/api/workspace'

export function OverviewScope({ scope, onScope, accounts, portfolios }: {
  scope: string; onScope: (scope: string) => void; accounts: BrokerAccount[]; portfolios: Portfolio[]
}) {
  const enabled = accounts.filter(a => a.isEnabled !== false)
  return <label className="overview-scope">Overview scope<select value={scope} onChange={e => onScope(e.target.value)}>
    <option value="all">All accounts</option>
    <optgroup label="Portfolios">{portfolios.map(p => <option key={p.id} value={`portfolio:${p.id}`}>{p.name}</option>)}
      {enabled.some(a => a.portfolioId === null) && <option value="unassigned">Unassigned</option>}</optgroup>
    <optgroup label="Accounts">{enabled.map(a => <option key={a.id} value={`account:${a.id}`}>{a.name}</option>)}</optgroup>
  </select></label>
}
