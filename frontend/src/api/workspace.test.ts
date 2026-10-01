import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApi } from './workspace'
import { accountFixture, emptyOverview, portfolioFixture } from '@/test/workspace-fixture'

function response(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
describe('Core workspace API', () => {
  it('keeps bearer in a header, not storage, URL, cookies or owner body fields', async () => {
    const fetch = response(emptyOverview)
    await expect(createWorkspaceApi(' session-token ').overview()).resolves.toEqual(emptyOverview)
    expect(fetch).toHaveBeenCalledWith('/api/overview', expect.objectContaining({
      headers: { Authorization: 'Bearer session-token', Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error',
    }))
    expect(localStorage.getItem('token')).toBeNull()
  })
  it('keeps exact decimal strings in manual account create and response', async () => {
    const fetch = response(accountFixture, 201)
    const payload = { portfolioId: portfolioFixture.id, name: 'Main account', venueId: 'manual' as const, manualAccountValueUsd: '1250.123456' }
    await expect(createWorkspaceApi('token').createAccount(payload)).resolves.toEqual(accountFixture)
    expect(fetch).toHaveBeenCalledWith('/api/accounts', expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) }))
  })
  it('creates a portfolio through the real endpoint contract', async () => {
    const fetch = response(portfolioFixture, 201)
    await createWorkspaceApi('token').createPortfolio('Swing trading')
    expect(fetch).toHaveBeenCalledWith('/api/portfolios', expect.objectContaining({ method: 'POST', body: '{"name":"Swing trading"}' }))
  })
  it('accepts an unavailable snapshot as null, not a zero balance', async () => {
    response(null)
    await expect(createWorkspaceApi('token').snapshot(accountFixture.id)).resolves.toBeNull()
  })
  it.each([401, 403])('reports revoked auth %s without returning sensitive response data', async status => {
    response({ detail: 'secret-token in server output' }, status)
    await expect(createWorkspaceApi('token').accounts()).rejects.toMatchObject({ kind: 'unauthorized' })
  })
  it('validates a GUID before composing an account fetch path', () => {
    const fetch = response(null)
    expect(() => createWorkspaceApi('token').snapshot('../../private')).toThrow('identifier')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('shows a safe provider failure message without raw provider bodies', async () => {
    response({ detail: 'raw wallet and secret provider detail' }, 502)
    await expect(createWorkspaceApi('token').sync(accountFixture.id)).rejects.toThrow('Previous account data')
  })
  it('keeps the venue refresh message specific to account refresh', async () => {
    response({ detail: 'proxy detail' }, 502)
    await expect(createWorkspaceApi('token').overview()).rejects.toThrow('The request could not be completed.')
  })
  it.each([500, 503])('shows only a server-generated trace reference for %s', async status => {
    const trace = '0123456789abcdef0123456789abcdef'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'internal stack detail', traceId: trace }),
      { status, headers: { 'X-Correlation-ID': trace } })))
    const error = await createWorkspaceApi('token').overview().catch((cause: unknown) => cause)
    expect(error).toMatchObject({ kind: 'http', status })
    expect(String((error as Error).message)).toContain(`Reference: ${trace}`)
    expect(String((error as Error).message)).not.toContain('internal')
  })
  it('ignores a malformed correlation header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500, headers: { 'X-Correlation-ID': 'call support <script>' } })))
    await expect(createWorkspaceApi('token').overview()).rejects.toThrow(/^The request could not be completed\.$/)
  })
  it('reads one account, including its settings revision', async () => {
    const fetch = response({ ...accountFixture, settingsRevision: 4 })
    await expect(createWorkspaceApi('token').account(accountFixture.id)).resolves.toMatchObject({ settingsRevision: 4 })
    expect(fetch).toHaveBeenCalledWith(`/api/accounts/${accountFixture.id}`, expect.anything())
  })
  it('accepts imported fills that a later Play links to', async () => {
    const linked = { id: accountFixture.id, accountId: accountFixture.id, contractId: 'BTC', side: 'buy', direction: 'Open Long', price: '1',
      quantity: '1', fee: '0', feeToken: 'USDC', closedPnlUsd: '0', occurredAtUtc: '2026-10-01T10:00:00Z', orderId: '1', sourceFillId: '1',
      transactionHash: '0x1', playId: portfolioFixture.id }
    response([linked])
    await expect(createWorkspaceApi('token').fills(accountFixture.id)).resolves.toEqual([linked])
  })
  it('accepts bounded safe validation detail for input correction', async () => {
    response({ detail: 'The public address is invalid.' }, 400)
    await expect(createWorkspaceApi('token').createAccount({ portfolioId: portfolioFixture.id, name: 'Wallet', venueId: 'hyperliquid', address: 'bad' })).rejects.toThrow('public address')
  })
  it.each([
    { ...accountFixture, accountValueUsd: 1250.123456 },
    { ...accountFixture, accountValueUsd: 'NaN' },
    { ...accountFixture, positionCount: -1 },
    { ...emptyOverview, totals: { ...emptyOverview.totals, totalAccountValueUsd: 0 } },
  ])('rejects incompatible response numeric semantics %#', async body => {
    response('totals' in body ? body : [body])
    const api = createWorkspaceApi('token')
    const run = 'totals' in body ? api.overview() : api.accounts()
    await expect(run).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it('does not expose network errors containing the bearer value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('token in failed transport')))
    await expect(createWorkspaceApi('token').overview()).rejects.toThrow('did not complete')
  })
  it('sends a complete account settings replacement including explicit unlink and enabled state', async () => {
    const fetch = response({ ...accountFixture, portfolioId: null, isEnabled: false })
    const settings = { name: 'Renamed wallet', portfolioId: null, isEnabled: false, expectedRevision: 1 }
    await createWorkspaceApi('token').updateAccount(accountFixture.id, settings)
    expect(fetch).toHaveBeenCalledWith(`/api/accounts/${accountFixture.id}`, expect.objectContaining({
      method: 'PUT', body: JSON.stringify(settings),
    }))
  })
  it('creates an account without a stored default portfolio', async () => {
    const fetch = response({ ...accountFixture, portfolioId: null }, 201)
    await createWorkspaceApi('token').createAccount({ portfolioId: null, name: 'Unassigned', venueId: 'manual' })
    expect(fetch).toHaveBeenCalledWith('/api/accounts', expect.objectContaining({
      body: '{"portfolioId":null,"name":"Unassigned","venueId":"manual"}',
    }))
  })
  it('handles delete no-content responses without trying to parse JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await expect(createWorkspaceApi('token').deleteAccount(accountFixture.id)).resolves.toBeUndefined()
    await expect(createWorkspaceApi('token').deletePortfolio(portfolioFixture.id)).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(`/api/accounts/${accountFixture.id}`, expect.objectContaining({ method: 'DELETE' }))
    expect(fetch).toHaveBeenCalledWith(`/api/portfolios/${portfolioFixture.id}`, expect.objectContaining({ method: 'DELETE' }))
  })
  it('shows the safe linked-play conflict instead of treating deletion as successful', async () => {
    response({ detail: 'This account has linked plays. Disable it instead.' }, 409)
    await expect(createWorkspaceApi('token').deleteAccount(accountFixture.id)).rejects.toMatchObject({
      kind: 'http', status: 409, message: 'This account has linked plays. Disable it instead.',
    })
  })
  it('retains enable/disable state in account response validation', async () => {
    response([{ ...accountFixture, isEnabled: false }])
    await expect(createWorkspaceApi('token').accounts()).resolves.toEqual([{ ...accountFixture, isEnabled: false }])
  })
  it('rejects non-boolean enabled flags', async () => {
    response([{ ...accountFixture, isEnabled: 'false' }])
    await expect(createWorkspaceApi('token').accounts()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it('accepts stablecoin wallet observations as decimal strings without merging perp equity', async () => {
    const body = {
      observedAtUtc: '2026-10-01T12:00:00Z', valueScope: 'primary-perpetual-dex',
      accountValueUsd: '0', withdrawableUsd: '0', marginUsedUsd: '0', positions: [],
      stablecoinWallet: {
        observedAtUtc: '2026-10-01T12:00:02Z', accountMode: 'unifiedAccount', scope: 'hypercore-spot-stablecoins',
        totalNominalUsd: '12.12345678901234567890123456', availableNominalUsd: '10.12345678901234567890123456',
        balances: [{ symbol: 'USDC', tokenIndex: 0, tokenId: 'known-token',
          total: '12.12345678901234567890123456', held: '2', available: '10.12345678901234567890123456' }],
        notice: 'Wallet only, not free margin.',
      },
    }
    response(body)
    await expect(createWorkspaceApi('token').snapshot(accountFixture.id)).resolves.toEqual(body)
  })
  it('rejects stablecoin balance numbers that would lose exact string semantics', async () => {
    response({
      observedAtUtc: '2026-10-01T12:00:00Z', valueScope: 'primary-perpetual-dex',
      accountValueUsd: '0', withdrawableUsd: '0', marginUsedUsd: '0', positions: [],
      stablecoinWallet: {
        observedAtUtc: '2026-10-01T12:00:02Z', accountMode: 'unifiedAccount', scope: 'hypercore-spot-stablecoins',
        totalNominalUsd: '12', availableNominalUsd: '10',
        balances: [{ symbol: 'USDC', tokenIndex: 0, tokenId: 'known-token', total: 12, held: '2', available: '10' }],
        notice: 'Wallet only.',
      },
    })
    await expect(createWorkspaceApi('token').snapshot(accountFixture.id)).rejects.toMatchObject({ kind: 'invalid-response' })
  })
})

describe('Instrument catalogue requests', () => {
  const catalogue = {
    venueId: 'hyperliquid', marketScope: 'perpetuals', scope: 'primary-perpetual-dex',
    instruments: [{ contractId: '1000PEPE', quantityDecimals: 0, maxLeverage: 10 }], notice: 'Primary perpetual DEX only.',
  }
  it('uses the authenticated metadata route with cancellation and preserves exact contract IDs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(catalogue))))
    const controller = new AbortController()
    await expect(createWorkspaceApi(' session-token ').instruments(accountFixture.id, controller.signal)).resolves.toEqual(catalogue)
    expect(fetch).toHaveBeenCalledWith(`/api/accounts/${accountFixture.id}/instruments`, expect.objectContaining({
      credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Authorization: 'Bearer session-token', Accept: 'application/json' }, signal: expect.any(AbortSignal),
    }))
  })
  it.each([
    { ...catalogue, marketScope: 'spot' },
    { ...catalogue, instruments: [{ contractId: 'BTC', quantityDecimals: -1, maxLeverage: 10 }] },
    { ...catalogue, instruments: [{ contractId: 'BTC', quantityDecimals: 2, maxLeverage: 1.5 }] },
    { ...catalogue, instruments: [catalogue.instruments[0], catalogue.instruments[0]] },
    { ...catalogue, instruments: [{ contractId: ' BTC ', quantityDecimals: 2, maxLeverage: 10 }] },
    { ...catalogue, scope: 'manual' },
  ])('rejects malformed or unsupported catalogue data', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))
    await expect(createWorkspaceApi('token').instruments(accountFixture.id)).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it('uses a catalogue-specific safe 502 error instead of account refresh wording', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private provider details', { status: 502 })))
    await expect(createWorkspaceApi('token').instruments(accountFixture.id)).rejects.toThrow('venue instrument catalogue')
  })
})
