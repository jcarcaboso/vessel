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
    const settings = { name: 'Renamed wallet', portfolioId: null, isEnabled: false }
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
