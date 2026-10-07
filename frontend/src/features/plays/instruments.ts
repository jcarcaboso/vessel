import { useEffect, useState } from 'react'
import type { BrokerAccount, InstrumentCatalog, VenueInstrument, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { useVenues } from '@/api/venues'

/** Trading pair label, e.g. BTC/USDC. */
export const pairLabel = (instrument: Pick<VenueInstrument, 'contractId' | 'quoteAsset'>) => `${instrument.contractId}/${instrument.quoteAsset}`

/** BTC/USDC for a venue contract, given the venue's quote asset; manual labels stay as entered. */
export function instrumentLabel(quote: string | null, instrument: string, source: 'venue' | 'manual') {
  return source === 'venue' && quote && instrument ? pairLabel({ contractId: instrument, quoteAsset: quote }) : instrument
}

export interface InstrumentCatalogState {
  /** Null for manual or disabled accounts, which have no venue catalogue. */
  accountId: string | null
  catalog: InstrumentCatalog | null
  error: string | null
  loading: boolean
  retry: () => void
}

/** Venue catalogue of the account's perpetuals, read once per account and on retry. */
export function useInstrumentCatalog(api: WorkspaceApi, account: BrokerAccount | undefined): InstrumentCatalogState {
  const venues = useVenues()
  const [generation, setGeneration] = useState(0)
  const [result, setResult] = useState<{
    api: WorkspaceApi; accountId: string; generation: number
    catalog: InstrumentCatalog | null; error: string | null
  } | null>(null)
  const venueId = account?.venueId ?? ''
  const hasCatalogue = venues.can(venueId, 'instruments')
  const accountId = account?.isEnabled !== false && hasCatalogue ? account!.id : null
  const current = result?.api === api && result.accountId === accountId && result.generation === generation ? result : null

  useEffect(() => {
    if (accountId === null) return
    const controller = new AbortController()
    let active = true
    api.instruments(accountId, controller.signal).then(catalog => {
      if (!active) return
      const matches = catalog.venueId === venueId && catalog.scope === 'venue-perpetuals'
      setResult({ api, accountId, generation, catalog: matches ? catalog : null,
        error: matches ? null : 'The catalogue does not match the selected venue.' })
    }).catch(cause => {
      if (active) setResult({ api, accountId, generation, catalog: null,
        error: cause instanceof ApiError ? cause.message : 'The venue catalogue could not be loaded.' })
    })
    return () => { active = false; controller.abort() }
  }, [api, accountId, generation, venueId])

  return {
    accountId, catalog: current?.catalog ?? null, error: current?.error ?? null,
    loading: accountId !== null && current === null, retry: () => setGeneration(value => value + 1),
  }
}

const maxSuggestions = 60

/**
 * Contracts whose name or pair contains the query: exact matches, then names that start with it, then
 * the rest. Ties keep the venue's catalogue order, which lists the major contracts first.
 */
export function searchInstruments(instruments: readonly VenueInstrument[], query: string) {
  const text = query.trim().toUpperCase().replace(/\s+/g, '')
  if (!text) return instruments.slice(0, maxSuggestions)
  const scored = instruments.flatMap(instrument => {
    const name = instrument.contractId.toUpperCase()
    const pair = pairLabel(instrument).toUpperCase()
    const score = name === text || pair === text ? 0 : name.startsWith(text) || pair.startsWith(text) ? 1 : pair.includes(text) ? 2 : -1
    return score < 0 ? [] : [{ instrument, score }]
  })
  return scored.sort((a, b) => a.score - b.score)
    .slice(0, maxSuggestions).map(item => item.instrument)
}
