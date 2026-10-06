import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VenuesProvider, Venues, useVenues } from './venues'
import { systemFixture } from '@/test/system-fixture'

const venues = new Venues(systemFixture.venues)

describe('Venues', () => {
  it('names venues and falls back to the ID for unknown ones', () => {
    expect(venues.name('hyperliquid')).toBe('Hyperliquid')
    expect(venues.name('manual')).toBe('Manual')
    expect(venues.name('unknown-venue')).toBe('unknown-venue')
  })

  it('answers capabilities from the API, with none for an unknown venue', () => {
    expect(venues.can('hyperliquid', 'sync')).toBe(true)
    expect(venues.can('hyperliquid', 'stablecoinWallet')).toBe(true)
    expect(venues.can('lighter', 'sync')).toBe(false)
    expect(venues.can('manual', 'candles')).toBe(false)
    expect(venues.can('unknown-venue', 'sync')).toBe(false)
  })

  it('offers manual and venues that can read an account, not planned ones', () => {
    expect(venues.creatable().map(v => v.id)).toEqual(['hyperliquid', 'manual'])
  })

  it('reports the quote asset of a venue', () => {
    expect(venues.quote('hyperliquid')).toBe('USDC')
    expect(venues.quote('manual')).toBeNull()
  })

  it('builds a trade link only for venue instruments with a safe contract ID', () => {
    expect(venues.tradeUrl('hyperliquid', 'BTC', 'venue')).toBe('https://app.hyperliquid.xyz/trade/BTC')
    expect(venues.tradeUrl('hyperliquid', 'BTC', 'manual')).toBeNull()
    expect(venues.tradeUrl('hyperliquid', null, 'venue')).toBeNull()
    expect(venues.tradeUrl('hyperliquid', '../x?y=1', 'venue')).toBeNull()
    expect(venues.tradeUrl('manual', 'BTC', 'venue')).toBeNull()
    expect(venues.tradeUrl('lighter', 'BTC', 'venue')).toBeNull()
  })

  it('is provided by the application and empty without a provider', () => {
    function Probe() { return <p>{useVenues().name('hyperliquid')}</p> }
    const { unmount } = render(<Probe />)
    expect(screen.getByText('hyperliquid')).toBeInTheDocument()
    unmount()
    render(<VenuesProvider venues={systemFixture.venues}><Probe /></VenuesProvider>)
    expect(screen.getByText('Hyperliquid')).toBeInTheDocument()
  })
})
