import type { CSSProperties, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useVenues } from '@/api/venues'
import { VenueLogo } from '@/components/venues/VenueBadge'
import { shortSource } from '@/lib/format'
import { accountLabel, isUnnamed, sourceHue, useVenueAccent, type IdentityAccount } from './identity'
import './account-identity.css'

const accentStyle = (accent: string | undefined, extra?: CSSProperties) => ({ ...(accent ? { '--venue-accent': accent } : {}), ...extra }) as CSSProperties

/**
 * The venue logo as the account's avatar. `ring` draws a chart series colour around it (allocation slices); `selected`
 * adds a check badge. Decorative: pair it with the account's name.
 */
export function AccountAvatar({ venueId, size = 'md', ring, selected = false, halo = false }: {
  venueId: string; size?: 'sm' | 'md' | 'lg'; ring?: string | undefined; selected?: boolean; halo?: boolean
}) {
  const accent = useVenueAccent(venueId)
  return <span className={`account-avatar is-${size}${ring ? ' has-ring' : ''}${halo && accent ? ' has-halo' : ''}`} aria-hidden="true"
    style={accentStyle(accent, ring ? { '--avatar-ring': ring } as CSSProperties : undefined)}>
    <VenueLogo venueId={venueId} size={size === 'sm' ? 'sm' : 'md'} />
    {selected && <span className="account-avatar-check"><Check size={10} strokeWidth={3} /></span>}
  </span>
}

/** A tile in the avatar's place for things that are not one venue account, e.g. a portfolio icon or Other. */
export function IdentityTile({ children, ring, size = 'md' }: { children: ReactNode; ring?: string | undefined; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`account-avatar is-${size} is-tile${ring ? ' has-ring' : ''}`} aria-hidden="true"
    style={ring ? { '--avatar-ring': ring } as CSSProperties : undefined}>{children}</span>
}

/** The venue's name as a small tag tinted with its brand colour; long names truncate and keep a tooltip. */
export function VenueTag({ venueId }: { venueId: string }) {
  const name = useVenues().name(venueId)
  return <span className="venue-tag" title={name} style={accentStyle(useVenueAccent(venueId))}><span>{name}</span></span>
}

/** The short source in a chip coloured from the source itself; the full value is in the tooltip. */
export function SourceChip({ source }: { source: string | null | undefined }) {
  const short = shortSource(source)
  if (!short) return <span className="source-chip is-manual">Manual record</span>
  return <span className="source-chip" title={source!} style={{ '--source-hue': sourceHue(source!) } as CSSProperties}>{short}</span>
}

/** The account's name; an unnamed account shows its short source in figures with an Unnamed tag. */
export function AccountName({ account, children }: { account: IdentityAccount; children?: ReactNode }) {
  if (!isUnnamed(account)) return <span className="account-name">{children ?? account.name}</span>
  return <><span className="account-name is-unnamed">{accountLabel(account)}</span><span className="unnamed-tag">Unnamed</span></>
}
