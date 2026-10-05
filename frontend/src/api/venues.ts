import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import type { VenueCapabilities, VenueInfo } from './system'

const instrumentPattern = /^[A-Za-z0-9_-]{1,32}$/

/** Lookups over the venues the API reported. Unknown venue IDs fall back to the ID and no capabilities. */
export class Venues {
  constructor(readonly list: readonly VenueInfo[]) {}

  find(id: string) { return this.list.find(venue => venue.id === id) }
  name(id: string) { return this.find(id)?.name ?? id }
  can(id: string, capability: keyof VenueCapabilities) { return this.find(id)?.capabilities[capability] === true }
  /** Quote asset of the venue's perpetuals, e.g. USDC. */
  quote(id: string) { return this.find(id)?.quoteAsset ?? null }
  /** Venues an account can be added at: manual, or an adapter that can read an account. */
  creatable() { return this.list.filter(venue => venue.id === 'manual' || venue.capabilities.sync) }

  /** Where the owner places the planned orders. Vessel itself never sends orders. */
  tradeUrl(venueId: string, instrument: string | null, source: 'venue' | 'manual') {
    const template = this.find(venueId)?.tradeUrlTemplate
    if (!template || !instrument || source !== 'venue' || !instrumentPattern.test(instrument)) return null
    return template.replace('{instrument}', encodeURIComponent(instrument))
  }
}

const VenuesContext = createContext(new Venues([]))

export function VenuesProvider({ venues, children }: { venues: readonly VenueInfo[]; children: ReactNode }) {
  const value = useMemo(() => new Venues(venues), [venues])
  return createElement(VenuesContext.Provider, { value }, children)
}

export const useVenues = () => useContext(VenuesContext)
