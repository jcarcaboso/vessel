import { Wallet } from 'lucide-react'
import { useVenues } from '@/api/venues'
import { venueLogos } from './venue-logos'
import './venue-badge.css'

type Size = 'xs' | 'sm' | 'md' | 'lg'

/** The venue's bundled logo on a neutral theme tile; an unknown or missing logo shows the generic wallet icon. Decorative: pair it with the name. */
export function VenueLogo({ venueId, size = 'sm' }: { venueId: string; size?: Size }) {
  const key = useVenues().logo(venueId)
  const logo = key ? venueLogos[key] : null
  return <span className={`venue-logo venue-logo-${size}`} data-logo={key ?? 'generic'} aria-hidden="true">
    {logo && 'src' in logo ? <img src={logo.src} alt="" draggable={false} /> :
      logo ? <logo.icon aria-hidden="true" /> : <Wallet aria-hidden="true" />}
  </span>
}

/**
 * A venue's logo and name. The compact variant shows the logo only and keeps the name as its accessible name and tooltip.
 * The name comes from the venue descriptor, falling back to the venue ID.
 */
export function VenueBadge({ venueId, compact = false, size = 'sm', className = '' }: {
  venueId: string; compact?: boolean; size?: Size; className?: string
}) {
  const name = useVenues().name(venueId)
  if (compact) return <span className={`venue-badge is-compact ${className}`.trim()} role="img" aria-label={name} title={name}>
    <VenueLogo venueId={venueId} size={size} />
  </span>
  return <span className={`venue-badge ${className}`.trim()}><VenueLogo venueId={venueId} size={size} /><span className="venue-badge-name">{name}</span></span>
}
