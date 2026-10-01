import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { systemFixture } from '@/test/system-fixture'
import { accountFixture, emptyOverview, overviewFixture, portfolioFixture } from '@/test/workspace-fixture'
import { ApplicationShell } from './ApplicationShell'

function api(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    overview: vi.fn().mockResolvedValue(emptyOverview),
    portfolios: vi.fn().mockResolvedValue([]), accounts: vi.fn().mockResolvedValue([]),
    account: vi.fn().mockResolvedValue(accountFixture),
    createPortfolio: vi.fn().mockResolvedValue(portfolioFixture), createAccount: vi.fn().mockResolvedValue(accountFixture),
    renamePortfolio: vi.fn().mockResolvedValue(portfolioFixture), deletePortfolio: vi.fn().mockResolvedValue(undefined),
    updateAccount: vi.fn().mockResolvedValue(accountFixture), deleteAccount: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue(null), fills: vi.fn().mockResolvedValue([]),
    sync: vi.fn().mockResolvedValue(accountFixture), ...overrides,
  }
}
beforeEach(() => { window.history.replaceState(null, '', '/') })
describe('Main application shell', () => {
  it('opens Overview, not the sample Play page, and has honest empty states', async () => {
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api()} />)
    await screen.findByText('Start with your accounts.')
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.queryByText('BTC reclaim at support')).not.toBeInTheDocument()
    expect(screen.getByText('No imported executions yet')).toBeInTheDocument()
    expect(screen.getByText('Plays').closest('[aria-disabled]')).toHaveAttribute('aria-disabled', 'true')
  })
  it('creates an owner-scoped portfolio and reloads the workspace', async () => {
    const client = api()
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Create your first portfolio' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Portfolio name'), 'Long-term perps')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create portfolio' }))
    await waitFor(() => expect(client.createPortfolio).toHaveBeenCalledWith('Long-term perps'))
    await waitFor(() => expect(client.overview).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('allows an unassigned account before any portfolio exists', async () => {
    const client = api()
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await userEvent.type(screen.getByLabelText('Account name'), 'Unassigned manual')
    await userEvent.selectOptions(screen.getByLabelText(/Venue/), 'manual')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(client.createAccount).toHaveBeenCalledWith({ portfolioId: null, name: 'Unassigned manual', venueId: 'manual' }))
  })
  it('creates a manual account without fabricating an unavailable balance', async () => {
    const client = api({ overview: vi.fn().mockResolvedValue({ ...emptyOverview, portfolios: [portfolioFixture] }) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Account name'), 'Manual broker')
    await userEvent.selectOptions(within(dialog).getByLabelText('Venue'), 'manual')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(client.createAccount).toHaveBeenCalledWith({
      portfolioId: null, name: 'Manual broker', venueId: 'manual',
    }))
  })
  it('checks public-address syntax before attempting a venue connection record', async () => {
    const client = api({ overview: vi.fn().mockResolvedValue({ ...emptyOverview, portfolios: [portfolioFixture] }) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await userEvent.type(screen.getByLabelText('Account name'), 'Wallet')
    await userEvent.type(screen.getByLabelText('Public wallet address'), 'not-a-private-key')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('valid public wallet address')
    expect(client.createAccount).not.toHaveBeenCalled()
  })
  it('keeps the create dialog open with guidance when the venue address already exists', async () => {
    const duplicate = 'An account for this venue and address already exists. Manage or re-enable that account.'
    const client = api({
      overview: vi.fn().mockResolvedValue({ ...emptyOverview, portfolios: [portfolioFixture] }),
      createAccount: vi.fn().mockRejectedValue(new ApiError('http', duplicate, 409)),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await userEvent.type(screen.getByLabelText('Account name'), 'Wallet copy')
    await userEvent.type(screen.getByLabelText('Public wallet address'), `0x${'ab'.repeat(20)}`)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add account' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Manage or re-enable that account')
    expect(client.overview).toHaveBeenCalledTimes(1)
  })
  it('shows Reload progress and returns a repeated overview failure with its retry action', async () => {
    let fail: (cause: unknown) => void = () => {}
    const client = api({
      overview: vi.fn().mockRejectedValueOnce(new ApiError('unavailable', 'Overview is unavailable.'))
        .mockImplementationOnce(() => new Promise((_, reject) => { fail = reject })),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Overview is unavailable.')
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fail(new ApiError('unavailable', 'Overview is still unavailable.'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Overview is still unavailable.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
  it('does not truncate a private-key-shaped value into a valid public address', async () => {
    const client = api({ overview: vi.fn().mockResolvedValue({ ...emptyOverview, portfolios: [portfolioFixture] }) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await userEvent.type(screen.getByLabelText('Account name'), 'Wallet')
    const longValue = `0x${'1'.repeat(64)}`
    await userEvent.type(screen.getByLabelText('Public wallet address'), longValue)
    expect(screen.getByLabelText('Public wallet address')).toHaveValue(longValue)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('valid public wallet address')
    expect(client.createAccount).not.toHaveBeenCalled()
  })
  it('shows real account data and opens its detail even when the hash changes', async () => {
    const client = api({ overview: vi.fn().mockResolvedValue(overviewFixture) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByRole('button', { name: 'View Main account' })
    await userEvent.click(screen.getByRole('button', { name: 'View Main account' }))
    fireEvent(window, new HashChangeEvent('hashchange'))
    await screen.findByRole('heading', { level: 1, name: 'Main account' })
    expect(await screen.findByText('No positions in the latest snapshot')).toBeInTheDocument()
    expect(client.snapshot).toHaveBeenCalledWith(accountFixture.id, expect.any(AbortSignal))
    expect(client.fills).toHaveBeenCalledWith(accountFixture.id, expect.any(AbortSignal))
  })
  it('retains previous data when a refresh fails and does not invent fills', async () => {
    const wallet = { ...accountFixture, venueId: 'hyperliquid', syncStatus: 'synced' as const, address: '0x' + '1'.repeat(40) }
    const client = api({ overview: vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [wallet] }), sync: vi.fn().mockRejectedValue(new ApiError('http', 'Previous account data is still available.', 502)) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh Main account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Previous account data')
    expect(screen.getByRole('button', { name: 'View Main account' })).toBeInTheDocument()
    expect(client.sync).toHaveBeenCalledWith(wallet.id)
  })
  it('keeps settings and disconnect available while core data is unavailable', async () => {
    const disconnect = vi.fn()
    render(<ApplicationShell system={systemFixture} disconnect={disconnect} api={api({ overview: vi.fn().mockRejectedValue(new ApiError('http', 'Database unavailable.', 503)) })} />)
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Private session' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect session' }))
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it('closes navigation with Escape and restores the trigger focus', async () => {
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api()} />)
    await screen.findByText('Start with your accounts.')
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Main navigation' })).toBeInTheDocument()
    expect(document.querySelector('.shell-main')).toHaveAttribute('inert')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.querySelector('.shell-main')).not.toHaveAttribute('inert')
  })
  it('keeps disabled accounts manageable but out of the enabled overview', async () => {
    const disabled = { ...accountFixture, isEnabled: false, venueId: 'hyperliquid', syncStatus: 'synced' as const }
    const fixture = { ...overviewFixture, accounts: [disabled],
      totals: { ...overviewFixture.totals, totalAccountValueUsd: null, valuedAccountCount: 0 } }
    const client = api({ overview: vi.fn().mockResolvedValue(fixture) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    expect(await screen.findByText('All accounts are disabled')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Manage accounts' }))
    expect(await screen.findByRole('button', { name: 'Manage Main account' })).toBeEnabled()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh Main account' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'View Main account' }))
    expect(await screen.findByText('Imported movements hidden while disabled')).toBeInTheDocument()
    expect(screen.queryByText('No imported executions yet')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Manage account' }))
    expect(screen.getByLabelText('Account enabled')).not.toBeChecked()
  })
  it('does not create an unassigned portfolio tile and filters unassigned accounts out of portfolios', async () => {
    const unassigned = { ...accountFixture, id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', name: 'Unassigned account', portfolioId: null }
    const client = api({ overview: vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [accountFixture, unassigned] }) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByRole('button', { name: 'View Unassigned account' })
    await userEvent.click(screen.getByRole('link', { name: 'Portfolios' }))
    expect(await screen.findByRole('button', { name: 'Open Swing trading' })).toBeInTheDocument()
    expect(document.querySelectorAll('.portfolio-tile')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Open Swing trading' }))
    expect(await screen.findByRole('button', { name: 'View Main account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View Unassigned account' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by portfolio' }), '')
    expect(await screen.findByRole('button', { name: 'View Unassigned account' })).toBeInTheDocument()
  })
  it('opens the portfolio manager and preserves grouping until the owner confirms a change', async () => {
    const client = api({ overview: vi.fn().mockResolvedValue(overviewFixture) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByRole('button', { name: 'View Main account' })
    await userEvent.click(screen.getByRole('link', { name: 'Portfolios' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Manage portfolio Swing trading' }))
    expect(screen.getByLabelText('Portfolio name')).toHaveValue('Swing trading')
    expect(client.deletePortfolio).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('shows available stablecoins rather than misleading zero perp equity for a unified wallet', async () => {
    const wallet = { ...accountFixture, venueId: 'hyperliquid', accountValueUsd: '0',
      availableStablecoinNominalUsd: '10.123456', accountMode: 'unifiedAccount', stablecoinScope: 'hypercore-spot-stablecoins' }
    const client = api({
      overview: vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [wallet],
        totals: { ...overviewFixture.totals, totalAccountValueUsd: '0', availableStablecoinNominalUsd: '10.123456', stablecoinAccountCount: 1 } }),
      snapshot: vi.fn().mockResolvedValue({
        observedAtUtc: '2026-10-01T12:00:00Z', valueScope: 'primary-perpetual-dex',
        accountValueUsd: '0', withdrawableUsd: '0', marginUsedUsd: '0', positions: [],
        stablecoinWallet: { observedAtUtc: '2026-10-01T12:00:01Z', accountMode: 'unifiedAccount',
          scope: 'hypercore-spot-stablecoins', totalNominalUsd: '12.123456', availableNominalUsd: '10.123456',
          balances: [{ symbol: 'USDC', tokenIndex: 0, tokenId: 'known-token', total: '12.123456', held: '2', available: '10.123456' }],
          notice: 'Wallet funds, not guaranteed trading margin.' },
      }),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    expect(await screen.findByText('Available wallet stablecoins')).toBeInTheDocument()
    expect(screen.getByText('Primary perps equity $0.00')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'View Main account' }))
    expect(await screen.findByRole('heading', { name: 'Stablecoin wallet' })).toBeInTheDocument()
    expect(await screen.findByText('USDC')).toBeInTheDocument()
    expect(screen.getByText('Available token units')).toBeInTheDocument()
    expect(screen.getByText('10.123456')).toBeInTheDocument()
    expect(screen.getByText('Wallet funds, not guaranteed trading margin.')).toBeInTheDocument()
  })
  it('Reload retries failed detail reads when Overview metadata remains unchanged', async () => {
    const client = api({
      overview: vi.fn().mockImplementation(() => Promise.resolve(structuredClone(overviewFixture))),
      snapshot: vi.fn().mockRejectedValueOnce(new ApiError('unavailable', 'Temporary detail outage.')).mockResolvedValue(null),
      fills: vi.fn().mockResolvedValue([]),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'View Main account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary detail outage')
    expect(client.snapshot).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(client.snapshot).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(client.fills).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No positions in the latest snapshot')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('Reload refreshes detail content even when account metadata is identical', async () => {
    const observation = {
      observedAtUtc: '2026-10-01T12:00:00Z', valueScope: 'primary-perpetual-dex',
      accountValueUsd: '4', withdrawableUsd: '3', marginUsedUsd: '1',
      positions: [{ contractId: 'Fresh-contract', signedQuantity: '1', entryPrice: '4', unrealizedPnlUsd: '0', marginUsedUsd: '1', leverage: 1 }],
    }
    const client = api({
      overview: vi.fn().mockImplementation(() => Promise.resolve(structuredClone(overviewFixture))),
      snapshot: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(observation),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'View Main account' }))
    await screen.findByText('No positions in the latest snapshot')
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(await screen.findByText('Fresh-contract')).toBeInTheDocument()
    expect(client.snapshot).toHaveBeenCalledTimes(2)
  })
})
