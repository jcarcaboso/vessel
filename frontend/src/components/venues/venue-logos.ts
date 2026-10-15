import { NotebookPen, type LucideIcon } from 'lucide-react'
import type { VenueLogoKey } from '@/api/venue-logos'
import hyperliquidLogo from '@/assets/venues/hyperliquid.svg'
import lighterLogo from '@/assets/venues/lighter.svg'
import lighterRobinhoodLogo from '@/assets/venues/lighter-rh.svg'
import risexLogo from '@/assets/venues/risex.svg'

export type VenueLogo = { label: string; src: string } | { label: string; icon: LucideIcon }

/**
 * The venue logos this browser bundles. The API reports one of these keys per venue; keep them in step with the
 * backend venue logo list. Assets are same-origin files served with the app; the browser never fetches venue sites.
 * Trademarks only identify the venue an owner's own account lives on.
 */
export const venueLogos = {
  hyperliquid: { label: 'Hyperliquid', src: hyperliquidLogo },
  lighter: { label: 'Lighter', src: lighterLogo },
  'lighter-rh': { label: 'Lighter on Robinhood Chain', src: lighterRobinhoodLogo },
  risex: { label: 'RISEx', src: risexLogo },
  manual: { label: 'Manual', icon: NotebookPen },
} as const satisfies Record<VenueLogoKey, VenueLogo>
