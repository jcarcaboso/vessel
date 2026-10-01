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
})
