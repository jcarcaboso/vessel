import { useId, useRef } from 'react'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'

export function OverviewScope({ scope, onScope, accounts, portfolios }: {
  scope: string; onScope: (scope: string) => void; accounts: BrokerAccount[]; portfolios: Portfolio[]
}) {
  const enabled = accounts.filter(a => a.isEnabled !== false)
  const id = useId()
  const select = useRef<HTMLSelectElement>(null)
  return <div className="overview-scope">
    <label htmlFor={id}>Overview scope</label>
    <NativeSelect id={id} ref={select} value={scope} onChange={e => onScope(e.target.value)}>
      <option value="all">All accounts</option>
      <optgroup label="Portfolios">{portfolios.map(p => <option key={p.id} value={`portfolio:${p.id}`}>{p.name}</option>)}
        {enabled.some(a => a.portfolioId === null) && <option value="unassigned">Unassigned</option>}</optgroup>
      <optgroup label="Accounts">{enabled.map(a => <option key={a.id} value={`account:${a.id}`}>{a.name}</option>)}</optgroup>
    </NativeSelect>
    {/* Not rendered at all while everything is shown. It leaves the page when used, so focus moves to the select first. */}
    {scope !== 'all' && <Button variant="outline" size="sm" className="text-foreground" aria-label="View all accounts" onClick={() => { onScope('all'); select.current?.focus() }}>View all</Button>}
  </div>
}
