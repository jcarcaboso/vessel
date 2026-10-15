import { Wallet } from 'lucide-react'
import { useVenues } from '@/api/venues'
import { VenueBadge } from '@/components/venues/VenueBadge'
import { instrumentParts } from './instruments'
import './play-identity.css'

/**
 * Where a saved Play lives, with one visual encoding per fact so the three never read as one line of text:
 * the asset is a ticker chip (base in bold, quote dimmed), the venue is its logo (named for tooltips and screen
 * readers from the venue registry, never repeated as text), and the account is a wallet icon with its name.
 * Without a source the instrument stays whole, as reports only carry the contract name. A missing venue shows no logo.
 */
export function PlayIdentity({ instrument, source, venueId, accountName, id, className = '' }: {
  instrument: string | null | undefined
  source?: 'venue' | 'manual'
  venueId?: string
  accountName: string
  /** Lets the row that contains it expose the identity as the row's accessible description. */
  id?: string
  className?: string
}) {
  const venues = useVenues()
  const asset = instrument ? instrumentParts(venueId ? venues.quote(venueId) : null, instrument, source ?? 'manual') : null
  return <span className={`play-identity ${className}`.trim()} id={id}>
    {asset ? <span className="play-asset" title={asset.quote ? `${asset.base}/${asset.quote}` : asset.base}>
      <span className="play-asset-base">{asset.base}</span>{asset.quote && <span className="play-asset-quote">/{asset.quote}</span>}
    </span> : <span className="play-asset is-empty">No instrument</span>}
    <span className="play-account">
      {venueId && <VenueBadge venueId={venueId} compact size="sm" className="play-venue" />}
      <Wallet className="play-account-icon" size={14} aria-hidden="true" />
      <span className="play-account-name" title={accountName}>{accountName}</span>
    </span>
  </span>
}
