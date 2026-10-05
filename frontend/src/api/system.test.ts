import { describe, expect, it, vi } from 'vitest'
import { ApiError, getSystem } from './system'
import { systemFixture } from '@/test/system-fixture'

function mockResponse(body: unknown, status = 200) {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', request)
  return request
}

describe('GET /api/system', () => {
  it('uses the exact path and a plain Bearer header, without cookies or token URLs', async () => {
    const request = mockResponse(systemFixture)
    await expect(getSystem(' runtime-token ')).resolves.toEqual(systemFixture)
    expect(request).toHaveBeenCalledWith('/api/system', expect.objectContaining({
      method: 'GET', headers: { Authorization: 'Bearer runtime-token', Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
    }))
  })

  it('rejects a missing token without making a request', async () => {
    const request = mockResponse(systemFixture)
    await expect(getSystem('  ')).rejects.toMatchObject({ kind: 'missing-token' })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([401, 403])('reports HTTP %s as a wrong token without exposing response content', async (status) => {
    mockResponse({ detail: 'Sensitive server details' }, status)
    await expect(getSystem('wrong')).rejects.toMatchObject({ kind: 'unauthorized', status })
  })

  it.each([500, 502, 503])('reports HTTP %s as API unavailable', async (status) => {
    mockResponse({}, status)
    await expect(getSystem('token')).rejects.toMatchObject({ kind: 'unavailable', status })
  })

  it.each(['network', 'timeout'])('reports %s failures without leaking token or internal errors', async (kind) => {
    const error = kind === 'timeout' ? new DOMException('Timed out', 'TimeoutError') : new Error('runtime-token in transport error')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
    await expect(getSystem('runtime-token')).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(getSystem('runtime-token')).rejects.not.toThrow('runtime-token')
  })

  it('reports other HTTP errors separately', async () => {
    mockResponse({}, 404)
    await expect(getSystem('token')).rejects.toMatchObject({ kind: 'http', status: 404 })
  })

  it('rejects non-JSON success responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>proxy page</html>')))
    await expect(getSystem('token')).rejects.toBeInstanceOf(ApiError)
    await expect(getSystem('token')).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it.each([
    null,
    {},
    { ...systemFixture, owner: { id: 'not-an-owner-id', displayName: 'Owner' } },
    { ...systemFixture, allowsConcurrentPlays: false },
    { ...systemFixture, marketScope: 'spot' },
    { ...systemFixture, venues: [{ id: 'hyperliquid', name: 'Hyperliquid', status: 'connected' }] },
    { ...systemFixture, venues: [{ id: 'hyperliquid', name: 'Hyperliquid', status: 'connected' }] },
    // Every venue states what it can do, and manual accounts must remain possible.
    { ...systemFixture, venues: systemFixture.venues.map(venue => venue.id === 'hyperliquid' ? { ...venue, capabilities: { sync: true } } : venue) },
    { ...systemFixture, venues: systemFixture.venues.filter(venue => venue.id !== 'manual') },
    { ...systemFixture, venues: [...systemFixture.venues, systemFixture.venues[0]] },
    { ...systemFixture, venues: systemFixture.venues.map(venue => venue.id === 'hyperliquid' ? { ...venue, tradeUrlTemplate: 'http://example.test/{instrument}' } : venue) },
    { ...systemFixture, venues: systemFixture.venues.map(venue => venue.id === 'hyperliquid' ? { ...venue, tradeUrlTemplate: 'https://example.test/trade' } : venue) },
    { ...systemFixture, venues: systemFixture.venues.map(venue => venue.id === 'hyperliquid' ? { ...venue, intervals: ['2M'] } : venue) },
    { ...systemFixture, venues: systemFixture.venues.map(venue => venue.id === 'hyperliquid' ? { ...venue, priceRule: 'rounded' } : venue) },
  ])('rejects incompatible system data %#', async (body) => {
    mockResponse(body)
    await expect(getSystem('token')).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('accepts a configured owner rather than requiring the example UUID', async () => {
    const custom = { ...systemFixture, owner: { id: '22222222-2222-2222-2222-222222222222', displayName: 'Configured owner' } }
    mockResponse(custom)
    await expect(getSystem('token')).resolves.toEqual(custom)
  })
  it('accepts any number of venues with their own capabilities', async () => {
    const other = { id: 'other-venue', name: 'Other', status: 'read-only', source: 'evm-address', quoteAsset: 'USDC', tradeUrlTemplate: null,
      intervals: ['1m', '1h', '1d'], priceRule: 'tick-size',
      capabilities: { sync: true, instruments: true, orders: false, candles: false, marketContext: false, stream: false, stablecoinWallet: false } }
    const body = { ...systemFixture, venues: [...systemFixture.venues, other] }
    mockResponse(body)
    await expect(getSystem('token')).resolves.toEqual(body)
  })
  it('accepts the current core stage with a read-only Hyperliquid capability', async () => {
    const core = { ...systemFixture, stage: 'core', venues: systemFixture.venues.map(venue => venue.id === 'hyperliquid' ? { ...venue, status: 'read-only' } : venue) }
    mockResponse(core)
    await expect(getSystem('token')).resolves.toEqual(core)
  })
})
