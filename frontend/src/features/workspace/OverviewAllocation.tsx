import { useState } from 'react'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { useVenues } from '@/api/venues'
import { VenueLogo } from '@/components/venues/VenueBadge'
import { money } from '@/lib/format'
import { PortfolioIcon } from './PortfolioIcon'
import { portfolioAllocations, totalAllocation, type Allocation, type AllocationSlice } from './overview-allocation'
import './overview-allocation.css'

const tau = Math.PI * 2
const point = (r: number, angle: number) => `${(r * Math.sin(angle)).toFixed(3)} ${(-r * Math.cos(angle)).toFixed(3)}`
function arc(outer: number, inner: number, start: number, end: number) {
  // A whole ring cannot be one SVG arc; split it into two halves.
  if (end - start >= tau - 1e-6) return `M ${point(outer, 0)} A ${outer} ${outer} 0 1 1 ${point(outer, Math.PI)} A ${outer} ${outer} 0 1 1 ${point(outer, 0)} M ${point(inner, 0)} A ${inner} ${inner} 0 1 0 ${point(inner, Math.PI)} A ${inner} ${inner} 0 1 0 ${point(inner, 0)} Z`
  const large = end - start > Math.PI ? 1 : 0
  return `M ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`
}
// Display only, inside the small rings; the exact total stays in the portfolio's own legend and tooltip.
const compactMoney = (value: string | null) => value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value as Intl.StringNumericLiteral)
const fill = (slice: AllocationSlice) => slice.slot === null ? 'var(--series-other)' : `var(--series-${slice.slot})`

/** A donut of part-to-whole balance shares. Hovering or focusing a slice or legend row emphasizes it. */
function Donut({ allocation, size, focus, emphasis, onScope }: {
  allocation: Allocation; size: 'lg' | 'sm'; focus: string | null; emphasis?: string | undefined; onScope: (scope: string) => void
}) {
  const venues = useVenues()
  const [hover, setHover] = useState<string | null>(null)
  // An emphasized account folded into Other highlights Other.
  const emphasized = emphasis && (allocation.slices.find(s => s.id === emphasis || s.members?.includes(emphasis))?.id ?? null)
  const active = hover ?? emphasized ?? null
  const radius = size === 'lg' ? 84 : 52, inner = radius * 0.64
  const current = allocation.slices.find(s => s.id === active)
  const withVenue = size === 'lg' && allocation.slices.some(s => s.venueId)
  const ends = allocation.slices.reduce<number[]>((list, s) => [...list, (list.at(-1) ?? 0) + s.fraction * tau], [])
  const label = allocation.slices.map(s => `${s.name} ${s.share}`).join(', ')
  return <div className={`allocation-donut allocation-${size}`}>
    <div className="allocation-figure">
      <svg viewBox={`${-radius - 4} ${-radius - 4} ${radius * 2 + 8} ${radius * 2 + 8}`} role="img" aria-label={`${allocation.name} balance shares: ${label}`}>
        {allocation.slices.map((s, i) => {
          const start = ends[i - 1] ?? 0, angle = ends[i]!
          const dimmed = active !== null && active !== s.id
          return <path key={s.id} d={arc(active === s.id ? radius + 3 : radius, inner, start, angle)} fill={fill(s)}
            className={dimmed ? 'allocation-dim' : undefined} data-scope={s.scope ?? undefined}
            onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}
            onClick={s.scope && s.scope !== focus ? () => onScope(s.scope!) : undefined}>
            <title>{`${s.name}: ${money(s.balanceUsd)} · ${s.share}`}</title>
          </path>
        })}
      </svg>
      <div className="allocation-center" aria-hidden="true">
        {current ? <><strong>{current.share}</strong><small>{current.name}</small></> :
          <><strong>{size === 'sm' ? compactMoney(allocation.totalUsd) : money(allocation.totalUsd)}</strong><small>{allocation.accountCount} {allocation.accountCount === 1 ? 'account' : 'accounts'}</small></>}
      </div>
    </div>
    <ul className={`allocation-legend${withVenue ? ' with-venue' : ''}`} aria-label={`${allocation.name} shares`}>
      {allocation.slices.map(s => <li key={s.id} className={active === s.id ? 'allocation-active' : active !== null ? 'allocation-dim' : undefined}
        onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
        <span className="allocation-swatch" style={{ background: fill(s) }} aria-hidden="true" />
        {s.scope && s.scope !== focus ? <button className="allocation-name" onFocus={() => setHover(s.id)} onBlur={() => setHover(null)}
          onClick={() => onScope(s.scope!)} aria-label={`Show allocation for ${s.name}`} title={s.name}>{s.name}</button> : <span className="allocation-name" title={s.name}>{s.name}</span>}
        {withVenue && <span className="allocation-venue">{s.venueId && <><VenueLogo venueId={s.venueId} size="sm" />{venues.name(s.venueId)}</>}</span>}
        <span className="allocation-money">{money(s.balanceUsd)}</span>
        <strong className="allocation-share">{s.share}</strong>
      </li>)}
    </ul>
    <AllocationNotes allocation={allocation} />
  </div>
}

function AllocationNotes({ allocation }: { allocation: Allocation }) {
  const notes = [
    allocation.missingCount > 0 && `${allocation.missingCount} ${allocation.missingCount === 1 ? 'account' : 'accounts'} without a reported balance`,
    allocation.notDrawn.length > 0 && `Not drawn: ${allocation.notDrawn.map(n => `${n.name} ${money(n.balanceUsd)}`).join(', ')}`,
  ].filter(Boolean) as string[]
  return notes.length ? <div className="allocation-notes">{notes.map(n => <p key={n}>{n}</p>)}</div> : null
}

/** Balance allocation of portfolios across the owner's enabled accounts, and of accounts within each portfolio. */
export function OverviewAllocation({ accounts, portfolios, scope, onScope }: {
  accounts: BrokerAccount[]; portfolios: Portfolio[]; scope: string; onScope: (scope: string) => void
}) {
  // Donuts are keyed by scope so transient hover or focus emphasis never outlives a scope change.
  const groups = portfolioAllocations(accounts, portfolios)
  if (!groups.length) return null
  const empty = (a: Allocation) => !a.slices.length
  const account = scope.startsWith('account:') ? accounts.find(a => `account:${a.id}` === scope) : undefined
  const group = account ? groups.find(g => g.id === (account.portfolioId ?? 'unassigned')) : groups.find(g => g.scope === scope)
  const total = totalAllocation(groups)
  let body
  if (scope === 'all') {
    body = <div className="allocation-overview">
      <section aria-labelledby="allocation-portfolios"><h3 id="allocation-portfolios">Portfolios</h3>
        {empty(total) ? <EmptyPie allocation={total} /> : <Donut key={scope} allocation={total} size="lg" focus={scope} onScope={onScope} />}</section>
      <section aria-labelledby="allocation-accounts"><h3 id="allocation-accounts">Accounts by portfolio</h3>
        <div className="allocation-multiples">{groups.map(g => <article key={g.id} className="allocation-card" aria-label={g.name}>
          <header><button className="allocation-card-name" onClick={() => onScope(g.scope)} aria-label={`Show allocation for ${g.name}`}>
            <PortfolioIcon icon={g.icon} size={15} /><span title={g.name}>{g.name}</span></button>
            <span>{total.shares[g.id] ?? '—'} of total</span></header>
          {empty(g) ? <EmptyPie allocation={g} /> : <Donut key={scope} allocation={g} size="sm" focus={scope} onScope={onScope} />}
        </article>)}</div>
      </section>
    </div>
  } else if (group) {
    const share = total.shares[group.id]
    body = <section aria-labelledby="allocation-single">
      <h3 id="allocation-single">{group.name}{share && <small> · {share} of total</small>}</h3>
      {empty(group) ? <EmptyPie allocation={group} /> : <Donut key={scope} allocation={group} size="lg" focus={scope} emphasis={account?.id} onScope={onScope} />}
    </section>
  } else return null
  return <section className="shell-panel overview-allocation" aria-label="Balance allocation">
    <header className="shell-panel-heading"><div><h2>Allocation</h2></div></header>
    <div className="allocation-body">{body}</div>
  </section>
}

function EmptyPie({ allocation }: { allocation: Allocation }) {
  return <div className="allocation-empty"><p>No positive balance</p><AllocationNotes allocation={allocation} /></div>
}
