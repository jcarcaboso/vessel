/** Keep this bundled-logo allowlist in step with the backend venue logo keys. */
export const venueLogoKeys = ['hyperliquid', 'lighter', 'lighter-rh', 'risex', 'manual'] as const
export type VenueLogoKey = typeof venueLogoKeys[number]

export const isVenueLogoKey = (key: unknown): key is VenueLogoKey =>
  typeof key === 'string' && venueLogoKeys.includes(key as VenueLogoKey)
