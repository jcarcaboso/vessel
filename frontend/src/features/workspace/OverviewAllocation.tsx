import { ArrowLeft, Layers } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { AccountAvatar, AccountName, IdentityTile, SourceChip, VenueTag } from '@/components/accounts/AccountIdentity'
import { accountLabel, accountTitle, useVenueAccent } from '@/components/accounts/identity'
import { useVenues } from '@/api/venues'
import { money } from '@/lib/format'
import { PortfolioIcon } from './PortfolioIcon'
import { portfolioAllocations, totalAllocation, type Allocation, type AllocationSlice } from './overview-allocation'
import './overview-allocation.css'

const tau = Math.PI * 2
const backLabel = 'Back to all accounts'
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
const sliceAccount = (s: AllocationSlice & { venueId: string }) => ({ id: s.id, name: s.name, venueId: s.venueId, source: s.source })
/** The slice's name; an unnamed account reads as its short source. */
const sliceName = (s: AllocationSlice) => s.venueId ? accountLabel(sliceAccount({ ...s, venueId: s.venueId })) : s.name

/**
 * A donut of part-to-whole balance shares. Hovering or focusing a slice or legend row emphasizes it. `selectedId` is the
 * account the Overview is scoped to: activating that part again deselects it, going back to all accounts, and any other
 * part with a scope selects it.
 */
function Donut({ allocation, size, selectedId, onScope }: {
  allocation: Allocation; size: 'lg' | 'sm'; selectedId?: string | undefined; onScope: (scope: string) => void
}) {
  const venues = useVenues()
  const [hover, setHover] = useState<string | null>(null)
  // A selected account folded into Other selects Other.
  const emphasized = selectedId ? allocation.slices.find(s => s.id === selectedId || s.members?.includes(selectedId))?.id ?? null : null
  const target = (s: AllocationSlice) => s.id === emphasized ? 'all' : s.scope
  const active = hover ?? emphasized
  const radius = size === 'lg' ? 84 : 52, inner = radius * 0.64
  const current = allocation.slices.find(s => s.id === active)
  const ends = allocation.slices.reduce<number[]>((list, s) => [...list, (list.at(-1) ?? 0) + s.fraction * tau], [])
  const label = allocation.slices.map(s => `${sliceName(s)} ${s.share}`).join(', ')
  return <div className={`allocation-donut allocation-${size}`}>
    <div className="allocation-figure">
      <svg viewBox={`${-radius - 4} ${-radius - 4} ${radius * 2 + 8} ${radius * 2 + 8}`} role="img" aria-label={`${allocation.name} balance shares: ${label}`}>
        {allocation.slices.map((s, i) => {
          const start = ends[i - 1] ?? 0, angle = ends[i]!
          const dimmed = active !== null && active !== s.id, to = target(s)
          return <path key={s.id} d={arc(active === s.id ? radius + 3 : radius, inner, start, angle)} fill={fill(s)}
            className={dimmed ? 'allocation-dim' : undefined} data-scope={to ?? undefined}
            onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}
            onClick={to ? () => onScope(to) : undefined}>
            <title>{`${sliceName(s)}: ${money(s.balanceUsd)} · ${s.share}`}</title>
          </path>
        })}
      </svg>
      <div className="allocation-center" aria-hidden="true">
        {current ? <><strong>{current.share}</strong><small>{sliceName(current)}</small></> :
          <><strong>{size === 'sm' ? compactMoney(allocation.totalUsd) : money(allocation.totalUsd)}</strong><small>{allocation.accountCount} {allocation.accountCount === 1 ? 'account' : 'accounts'}</small></>}
      </div>
    </div>
    <ul className="allocation-legend" aria-label={`${allocation.name} shares`}>
      {allocation.slices.map(s => {
        const to = target(s), name = sliceName(s)
        const title = s.venueId ? accountTitle(sliceAccount({ ...s, venueId: s.venueId }), venues.name(s.venueId)) : name
        const identity = <SliceIdentity slice={s} />
        return <LegendRow key={s.id} slice={s} className={active === s.id ? 'allocation-active' : active !== null ? 'allocation-dim' : undefined}
          onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
          {to ? <button className="allocation-identity" onFocus={() => setHover(s.id)} onBlur={() => setHover(null)} aria-pressed={s.id === emphasized}
            data-focus={s.scope ?? s.id} onClick={() => onScope(to)} aria-label={`Show allocation for ${name}`} title={title}>{identity}</button>
            : <span className="allocation-identity" title={title}>{identity}</span>}
          {size === 'lg' && <span className="allocation-money">{money(s.balanceUsd)}</span>}
          <span className="allocation-share-block"><strong className="allocation-share">{s.share}</strong>
            <span className="allocation-bar" aria-hidden="true"><i style={{ width: `${Math.min(s.fraction, 1) * 100}%` }} /></span></span>
        </LegendRow>
      })}
    </ul>
    <AllocationNotes allocation={allocation} />
  </div>
}

/** A legend row: a capsule tinted with the account's venue accent, its slice colour on the avatar ring and share bar. */
function LegendRow({ slice, className, children, onMouseEnter, onMouseLeave }: {
  slice: AllocationSlice; className: string | undefined; children: ReactNode; onMouseEnter: () => void; onMouseLeave: () => void
}) {
  const accent = useVenueAccent(slice.venueId ?? '')
  return <li className={className} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
    style={{ '--slice': fill(slice), ...(slice.venueId && accent ? { '--venue-accent': accent } : {}) } as CSSProperties}>{children}</li>
}

const accountsText = (n: number) => `${n} ${n === 1 ? 'account' : 'accounts'}`
/** Who a slice is: an account (venue logo, name, venue tag and source), a portfolio (its icon and size) or Other. */
function SliceIdentity({ slice }: { slice: AllocationSlice }) {
  if (slice.venueId) return <>
    <AccountAvatar venueId={slice.venueId} ring={fill(slice)} />
    <span className="allocation-text"><span className="allocation-line"><AccountName account={sliceAccount({ ...slice, venueId: slice.venueId })} /></span>
      <span className="allocation-line allocation-tags"><VenueTag venueId={slice.venueId} />{slice.source !== undefined && <SourceChip source={slice.source} />}</span></span>
  </>
  return <>
    <IdentityTile ring={fill(slice)}>{slice.slot === null ? <Layers size={14} /> : <PortfolioIcon icon={slice.icon} size={14} />}</IdentityTile>
    <span className="allocation-text"><span className="allocation-line"><span className="account-name">{slice.name}</span></span>
      <span className="allocation-line"><small className="allocation-meta">{accountsText(slice.accountCount)}</small></span></span>
  </>
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
  // The panel body is replaced on every scope change, so a focused control would vanish with it and focus would fall back to
  // the page. Controls tagged `data-focus` name the entity they stand for; after a change made from inside the panel, focus
  // returns to the control for the same entity in the new view, or to the back arrow, so keyboard use continues where it was.
  const panel = useRef<HTMLElement>(null)
  const restore = useRef<string[] | null>(null)
  const go = (to: string, leaving?: string) => {
    const key = leaving ?? (document.activeElement as HTMLElement | null)?.dataset.focus
    restore.current = key && panel.current?.contains(document.activeElement) ? [key, 'back'] : null
    onScope(to)
  }
  useLayoutEffect(() => {
    const keys = restore.current
    restore.current = null
    if (!keys || (document.activeElement && document.activeElement !== document.body)) return
    const controls = [...(panel.current?.querySelectorAll<HTMLElement>('[data-focus]') ?? [])]
    for (const key of keys) { const control = controls.find(c => c.dataset.focus === key); if (control) { control.focus(); return } }
  }, [scope])
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
        {empty(total) ? <EmptyPie allocation={total} /> : <Donut key={scope} allocation={total} size="lg" onScope={go} />}</section>
      <section aria-labelledby="allocation-accounts"><h3 id="allocation-accounts">Accounts by portfolio</h3>
        <div className="allocation-multiples">{groups.map(g => <article key={g.id} className="allocation-card" aria-label={g.name}>
          <header><button className="allocation-card-name" data-focus={g.scope} onClick={() => go(g.scope)} aria-label={`Show allocation for ${g.name}`}>
            <PortfolioIcon icon={g.icon} size={15} /><span title={g.name}>{g.name}</span></button>
            <span>{total.shares[g.id] ?? '—'} of total</span></header>
          {empty(g) ? <EmptyPie allocation={g} /> : <Donut key={scope} allocation={g} size="sm" onScope={go} />}
        </article>)}</div>
      </section>
    </div>
  } else if (group) {
    const share = total.shares[group.id]
    body = <section aria-labelledby="allocation-single">
      <div className="allocation-heading">
        <button type="button" className="icon-button allocation-back" data-focus="back" aria-label={backLabel} title={backLabel} onClick={() => go('all', scope)}>
          <ArrowLeft size={14} aria-hidden="true" /></button>
        <h3 id="allocation-single">{group.name}{share && <small> · {share} of total</small>}</h3>
      </div>
      {empty(group) ? <EmptyPie allocation={group} /> : <Donut key={scope} allocation={group} size="lg" selectedId={account?.id} onScope={go} />}
    </section>
  } else return null
  return <section ref={panel} className="shell-panel overview-allocation" aria-label="Balance allocation">
    <header className="shell-panel-heading"><div><h2>Allocation</h2></div></header>
    <div className="allocation-body">{body}</div>
  </section>
}

function EmptyPie({ allocation }: { allocation: Allocation }) {
  return <div className="allocation-empty"><p>No positive balance</p><AllocationNotes allocation={allocation} /></div>
}
