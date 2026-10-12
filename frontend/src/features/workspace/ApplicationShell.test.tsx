import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrokerAccount, Overview, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { systemFixture } from '@/test/system-fixture'
import { reviewFixture } from '@/test/review-fixture'
import { accountFixture, emptyOverview, candleSeriesFixture, idleMarketStream, instrumentCatalogFixture, marketContextFixture, overviewFixture, playApiStubs, portfolioFixture, savedPlayFixture } from '@/test/workspace-fixture'
import { ApplicationShell } from './ApplicationShell'
import { activityFixture, operationFixture } from '@/test/activity-fixture'

function api(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    discoverAccounts: vi.fn().mockRejectedValue(new Error('Unexpected discovery')),
    accountCredential: vi.fn().mockResolvedValue({ storageConfigured: true, credential: null }),
    saveAccountCredential: vi.fn().mockRejectedValue(new Error('Unexpected credential write')),
    deleteAccountCredential: vi.fn().mockResolvedValue(undefined),
    activity: vi.fn().mockResolvedValue({ operations: [], totalOperationCount: 0, retainedFillCount: 0, omittedOperationCount: 0, coverage: [], scopeNote: 'Fixture history' }),
    overview: vi.fn().mockResolvedValue(emptyOverview),
    portfolios: vi.fn().mockResolvedValue([]), accounts: vi.fn().mockResolvedValue([]),
    account: vi.fn().mockResolvedValue(accountFixture),
    createPortfolio: vi.fn().mockResolvedValue(portfolioFixture), createAccount: vi.fn().mockResolvedValue(accountFixture),
    updatePortfolio: vi.fn().mockResolvedValue(portfolioFixture), deletePortfolio: vi.fn().mockResolvedValue(undefined),
    updateAccount: vi.fn().mockResolvedValue(accountFixture), deleteAccount: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue(null), fills: vi.fn().mockResolvedValue([]),
    sync: vi.fn().mockResolvedValue(accountFixture), instruments: vi.fn().mockResolvedValue(instrumentCatalogFixture),
    candles: vi.fn().mockResolvedValue(candleSeriesFixture), marketContext: vi.fn().mockResolvedValue(marketContextFixture),
    marketStream: vi.fn(idleMarketStream), ...playApiStubs(), ...overrides,
  }
}
beforeEach(() => { window.history.replaceState(null, '', '/') })
describe('Main application shell', () => {
  it.each(['disconnect', 'unmount', 'API replacement'])('cancels Refresh all on %s while the first sync is pending', async action => {
    const first = { ...accountFixture, venueId: 'hyperliquid' }
    const second = { ...first, id: 'second', name: 'Second' }
    let finish!: (account: BrokerAccount) => void
    const sync = vi.fn().mockImplementationOnce(() => new Promise<BrokerAccount>(resolve => { finish = resolve })).mockResolvedValue(second)
    const client = api({ overview: vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [first, second] }), sync })
    const disconnect = vi.fn()
    const view = render(<ApplicationShell system={systemFixture} disconnect={disconnect} api={client} />)
    await screen.findByRole('button', { name: 'View Main account' })
    await userEvent.click(screen.getByRole('button', { name: 'Refresh all' }))
    if (action === 'disconnect') await userEvent.click(screen.getByRole('button', { name: /^Disconnect .*session$/ }))
    else if (action === 'unmount') view.unmount()
    else view.rerender(<ApplicationShell system={systemFixture} disconnect={disconnect} api={api()} />)
    await act(async () => finish(first))
    expect(sync).toHaveBeenCalledTimes(1)
    expect((sync.mock.calls[0]?.[1] as AbortSignal)?.aborted).toBe(true)
    expect(client.overview).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/accounts refreshed/)).not.toBeInTheDocument()
  })
  it('disables account detail refresh during another account refresh without showing its spinner', async () => {
    const first = { ...accountFixture, venueId: 'hyperliquid' }
    const second = { ...first, id: 'second', name: 'Second' }
    let finish!: (account: BrokerAccount) => void
    const client = api({ overview: vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [first, second] }),
      sync: vi.fn().mockImplementation(() => new Promise<BrokerAccount>(resolve => { finish = resolve })) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByRole('button', { name: 'View Main account' })
    await userEvent.click(screen.getByRole('button', { name: 'Refresh Main account' }))
    await userEvent.click(screen.getByRole('button', { name: 'View Second' }))
    const refresh = screen.getByRole('button', { name: 'Refresh account' })
    expect(refresh).toBeDisabled()
    expect(refresh.querySelector('.is-spinning')).toBeNull()
    await act(async () => finish(first))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh account' })).toBeEnabled())
  })
  it('retains account search, venue and status filters across detail and page navigation', async () => {
    const account = { ...accountFixture, venueId: 'hyperliquid', syncStatus: 'error' as const }
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api({
      overview: vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [account] }),
    })} />)
    await screen.findByRole('button', { name: 'View Main account' })
    await userEvent.click(screen.getByRole('link', { name: 'Accounts' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search accounts' }), 'Main')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by venue' }), 'hyperliquid')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'error')
    await userEvent.click(screen.getByRole('button', { name: 'View Main account' }))
    await userEvent.click(screen.getByRole('button', { name: 'All accounts' }))
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue('Main')
    await userEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await userEvent.click(screen.getByRole('link', { name: 'Accounts' }))
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue('Main')
    expect(screen.getByRole('combobox', { name: 'Filter by venue' })).toHaveValue('hyperliquid')
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('error')
  })
  it('retains Activity filters across page navigation', async () => {
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api({
      overview: vi.fn().mockResolvedValue(overviewFixture),
      activity: vi.fn().mockResolvedValue({ ...activityFixture, operations: [operationFixture] }),
    })} />)
    await screen.findByRole('button', { name: 'View Main account' })
    await userEvent.click(screen.getByRole('link', { name: 'Activity' }))
    await screen.findByRole('combobox', { name: 'Instrument' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Instrument' }), 'BTC')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Direction' }), 'long')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '30')
    await userEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await userEvent.click(screen.getByRole('link', { name: 'Activity' }))
    expect(await screen.findByRole('combobox', { name: 'Instrument' })).toHaveValue('BTC')
    expect(screen.getByRole('combobox', { name: 'Direction' })).toHaveValue('long')
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('30')
  })
  it.each([
    ['lighter', 'margin', '131.89123456789012345678901234', '$131.89', 'Venue-reported available margin · not guaranteed withdrawable'],
    ['risex', 'margin', '0', '$0.00', 'Venue-reported available margin · not guaranteed withdrawable'],
    ['hyperliquid', 'withdrawable', '35', '$35.00', 'Venue-reported perps withdrawable'],
    ['risex', null, null, '—', 'Not reported by this venue'],
  ] as const)('shows the selected available source in %s account rows and detail', async (venueId, source, value, display, note) => {
    const account = { ...accountFixture, venueId, availableBalanceUsd: value, availableBalanceSource: source }
    const client = api({
      overview: vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [account] }),
      snapshot: vi.fn().mockResolvedValue({ observedAtUtc: '2026-10-12T10:00:00Z', valueScope: 'fixture',
        accountValueUsd: '1000', withdrawableUsd: source === 'withdrawable' ? value : null,
        availableMarginUsd: source === 'margin' ? value : null, marginUsedUsd: '20', positions: [] }),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    const row = (await screen.findByRole('button', { name: 'View Main account' })).closest('tr')!
    expect(row).toHaveTextContent(`Available balance ${display}`)
    await userEvent.click(screen.getByRole('button', { name: 'View Main account' }))
    await screen.findByText('Latest snapshot')
    const available = screen.getByText('Available balance').closest('.metric')!
    expect(available).toHaveTextContent(display)
    expect(available).toHaveTextContent(note)
    if (source === 'margin') expect(available).toHaveTextContent('Perps withdrawable — · separate field')
  })
  it('shows portfolio available balance with enabled-account coverage, not the equity subtotal', async () => {
    const portfolio = { ...portfolioFixture, availableBalanceUsd: '131.89', availableBalanceAccountCount: 1,
      enabledAccountCount: 2, availableBalanceCoverage: 'partial' as const }
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api({ overview: vi.fn().mockResolvedValue({ ...overviewFixture, portfolios: [portfolio] }) })} />)
    await screen.findByRole('button', { name: 'View Main account' })
    await userEvent.click(screen.getByRole('link', { name: 'Portfolios' }))
    expect(await screen.findByRole('button', { name: 'Open Swing trading' })).toHaveTextContent('Available balance $131.89 · 1 of 2 enabled · partial')
  })
  it('shows combined total and available balances with coverage, and rereads after refresh', async () => {
    const refreshed = { ...overviewFixture, totals: { ...overviewFixture.totals, totalBalanceUsd: '240', availableBalanceUsd: '95',
      balanceAccountCount: 3, availableBalanceAccountCount: 2, balanceCoverage: 'complete' as const, availableBalanceCoverage: 'partial' as const } }
    const client = api({
      overview: vi.fn().mockResolvedValueOnce({ ...refreshed, totals: { ...refreshed.totals, totalBalanceUsd: '210', availableBalanceUsd: '80' },
        accounts: [{ ...accountFixture, venueId: 'hyperliquid' }, { ...accountFixture, id: 'second', name: 'Other portfolio' }, { ...accountFixture, id: 'third', name: 'Unassigned', portfolioId: null }] })
        .mockResolvedValue({ ...refreshed, accounts: [{ ...accountFixture, venueId: 'hyperliquid' }, { ...accountFixture, id: 'second', name: 'Other portfolio' }, { ...accountFixture, id: 'third', name: 'Unassigned', portfolioId: null }] }),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    const total = (await screen.findByText('Total balance')).closest('.metric')!
    const available = screen.getByText('Available balance').closest('.metric')!
    expect(total).toHaveTextContent('$210.00')
    expect(total).toHaveTextContent('3 of 3 enabled accounts · complete')
    expect(available).toHaveTextContent('$80.00')
    expect(available).toHaveTextContent('2 of 3 enabled accounts · partial')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh Main account' }))
    await waitFor(() => expect(total).toHaveTextContent('$240.00'))
    expect(available).toHaveTextContent('$95.00')
    expect(client.overview).toHaveBeenCalledTimes(2)
  })
  it('refreshes all eligible accounts sequentially, even outside the filters, and reloads once after failures', async () => {
    const first = { ...accountFixture, venueId: 'hyperliquid', name: 'First' }
    const second = { ...first, id: 'second', name: 'Failed account', portfolioId: null }
    const third = { ...first, id: 'third', name: 'Last', venueId: 'another-sync-venue' }
    let completeFirst!: (account: BrokerAccount) => void
    let completeThird!: (account: BrokerAccount) => void
    const sync = vi.fn().mockImplementationOnce(() => new Promise<BrokerAccount>(resolve => { completeFirst = resolve }))
      .mockRejectedValueOnce(new ApiError('http', 'Fixture failure', 502))
      .mockImplementationOnce(() => new Promise<BrokerAccount>(resolve => { completeThird = resolve }))
    const client = api({ sync, overview: vi.fn().mockResolvedValue({ ...overviewFixture,
      accounts: [first, second, third, accountFixture, { ...first, id: 'disabled', name: 'Disabled', isEnabled: false },
        { ...first, id: 'unsupported', name: 'Unsupported', venueId: 'lighter' }] }) })
    const system = { ...systemFixture, venues: [...systemFixture.venues,
      { ...systemFixture.venues[0]!, id: third.venueId, name: 'Another sync venue' }] }
    render(<ApplicationShell system={system} disconnect={vi.fn()} api={client} />)
    await userEvent.click(screen.getByRole('link', { name: 'Accounts' }))
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Filter by portfolio' }), portfolioFixture.id)
    await userEvent.click(screen.getByRole('button', { name: 'Refresh all' }))
    expect(screen.getByText('Refreshing 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh First' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Refresh Last' })).toBeDisabled()
    expect(sync).toHaveBeenCalledTimes(1)
    expect(client.overview).toHaveBeenCalledTimes(1)
    await act(async () => completeFirst(first))
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(3))
    expect(sync.mock.calls.map(call => call[0])).toEqual([first.id, second.id, third.id])
    expect(screen.getByText('Refreshing 3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh Last' })).toHaveAttribute('aria-busy', 'true')
    expect(client.overview).toHaveBeenCalledTimes(1)
    await act(async () => completeThird(third))
    await waitFor(() => expect(client.overview).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('alert')).toHaveTextContent('2 of 3 accounts refreshed. Failed: Failed account.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(await screen.findByRole('button', { name: 'Refresh all' })).toBeEnabled()
  })
  it('disables Refresh all when no account is refreshable or an individual refresh is running', async () => {
    const client = api({ overview: vi.fn().mockResolvedValue(overviewFixture) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    expect(await screen.findByRole('button', { name: 'Refresh all' })).toBeDisabled()
    client.overview = vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [{ ...accountFixture, venueId: 'hyperliquid' }] })
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh all' })).toBeEnabled())
    let finish!: (account: BrokerAccount) => void
    client.sync = vi.fn().mockImplementation(() => new Promise<BrokerAccount>(resolve => { finish = resolve }))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh Main account' }))
    expect(screen.getByRole('button', { name: 'Refresh all' })).toBeDisabled()
    await act(async () => finish(accountFixture))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh all' })).toBeEnabled())
  })
  it('starts a fresh play from Overview but keeps a plan-only unsaved draft', async () => {
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api()} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'New play' }))
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    await userEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await userEvent.click(screen.getByRole('button', { name: 'New play' }))
    expect(screen.getByRole('article', { name: 'Entry 2 editor' })).toBeInTheDocument()
    expect(screen.getByText('Your unsaved changes are still open. Save or discard them before starting a new play.')).toBeInTheDocument()
  })
  it('offers both existing create dialogs in the keyboard-accessible Overview Add menu', async () => {
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api()} />)
    await screen.findByText('Start with your accounts.')
    const trigger = screen.getByRole('button', { name: 'Add' })
    trigger.focus(); await userEvent.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const first = screen.getByRole('menuitem', { name: 'New portfolio' })
    await waitFor(() => expect(first).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toHaveTextContent('New portfolio')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add account' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Add account')
  })
  it('refreshes portfolio grouping, counts and Plays capital context after move, disable and enable', async () => {
    const second = { ...portfolioFixture, id: '22222222-3333-4444-5555-666666666666', name: 'Second', accountCount: 0, balanceUsd: null }
    let current: Overview = { ...overviewFixture, portfolios: [portfolioFixture, second] }
    const client = api({
      overview: vi.fn().mockImplementation(() => Promise.resolve(current)),
      updateAccount: vi.fn().mockImplementation((id, settings) => {
        const account = { ...current.accounts[0]!, ...settings, id, settingsRevision: current.accounts[0]!.settingsRevision! + 1 }
        current = { ...current, accounts: [account], portfolios: current.portfolios.map(p => ({
          ...p, accountCount: p.id === account.portfolioId ? 1 : 0,
          balanceUsd: p.id === account.portfolioId && account.isEnabled ? '1250.123456' : null,
          balanceCoverage: p.id === account.portfolioId && account.isEnabled ? 'complete' : 'unavailable',
        })) }
        return Promise.resolve(account)
      }),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Manage Main account' }))
    await userEvent.selectOptions(screen.getByLabelText('Portfolio'), second.id)
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(client.overview).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('link', { name: 'Portfolios' }))
    expect(await screen.findByRole('button', { name: `Open ${portfolioFixture.name}` })).toHaveTextContent('0 account records')
    expect(screen.getByRole('button', { name: 'Open Second' })).toHaveTextContent('1 account record')
    expect(screen.getByRole('button', { name: 'Open Second' })).toHaveTextContent('$1,250.12')
    await userEvent.click(screen.getByRole('button', { name: 'Open Second' }))
    expect(screen.getByRole('combobox', { name: 'Filter by portfolio' })).toHaveValue(second.id)
    await userEvent.click(screen.getByRole('button', { name: 'Manage Main account' }))
    expect(screen.getByLabelText('Portfolio')).toHaveValue(second.id)
    await userEvent.click(screen.getByLabelText('Account enabled'))
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(client.overview).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('row', { name: /Main account/ })).toHaveTextContent('Disabled')
    await userEvent.click(screen.getByRole('link', { name: 'Portfolios' }))
    expect(screen.getByRole('button', { name: 'Open Second' })).toHaveTextContent('Enabled account balances unavailable')
    await userEvent.click(screen.getByRole('button', { name: 'Open Second' }))
    await userEvent.click(screen.getByRole('button', { name: 'Manage Main account' }))
    await userEvent.click(screen.getByLabelText('Account enabled'))
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(client.overview).toHaveBeenCalledTimes(4))
    expect(client.updateAccount).toHaveBeenLastCalledWith(accountFixture.id, expect.objectContaining({ expectedRevision: 3, isEnabled: true }))
    await userEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await userEvent.click(screen.getByRole('button', { name: 'New play' }))
    await userEvent.selectOptions(screen.getByLabelText('Account'), accountFixture.id)
    expect(screen.getByTestId('capital-context')).toHaveTextContent('Second balance$1,250.12')
  })
  it('resets a portfolio filter whose portfolio disappeared on reload', async () => {
    const client = api({ overview: vi.fn().mockResolvedValueOnce(overviewFixture)
      .mockResolvedValue({ ...overviewFixture, portfolios: [], accounts: [{ ...accountFixture, portfolioId: null }] }) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(screen.getByRole('link', { name: 'Portfolios' }))
    await userEvent.click(await screen.findByRole('button', { name: `Open ${portfolioFixture.name}` }))
    expect(screen.getByRole('combobox', { name: 'Filter by portfolio' })).toHaveValue(portfolioFixture.id)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Filter by portfolio' })).toHaveValue(''))
    expect(screen.getByRole('button', { name: 'View Main account' })).toBeInTheDocument()
  })
  it('shows portfolio balance rather than the perps-only value for a unified wallet', async () => {
    const client = api({ overview: vi.fn().mockResolvedValue({
      ...overviewFixture,
      portfolios: [{ ...portfolioFixture, totalValueUsd: '0', balanceUsd: '750', balanceCoverage: 'complete' }],
    }) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(screen.getByRole('link', { name: 'Portfolios' }))
    const tile = await screen.findByRole('button', { name: `Open ${portfolioFixture.name}` })
    expect(within(tile).getByText('$750.00')).toBeInTheDocument()
    expect(within(tile).getByText('All enabled account balances recorded')).toBeInTheDocument()
    expect(within(tile).getByText('Perps/manual value $0.00')).toBeInTheDocument()
  })
  it('opens contributing Plays from Review through the existing saved editor', async () => {
    const client = api({ review: vi.fn().mockResolvedValue(reviewFixture), play: vi.fn().mockResolvedValue(savedPlayFixture) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(screen.getByRole('link', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect Swing trading' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Play BTC breakout' }))
    expect(await screen.findByRole('textbox', { name: 'Play title' })).toHaveValue(savedPlayFixture.summary.title)
    expect(client.play).toHaveBeenCalledWith(reviewFixture.plays[0]!.id, expect.any(AbortSignal))
  })
  it('protects plan-only draft edits when opening a contributing Play from Review', async () => {
    const client = api({ review: vi.fn().mockResolvedValue(reviewFixture) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('link', { name: 'Plays' }))
    await userEvent.click(screen.getByRole('button', { name: 'New play' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    await userEvent.click(screen.getByRole('link', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect Swing trading' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Play BTC breakout' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continue editing' }))
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('')
    expect(screen.getByRole('article', { name: 'Entry 2 editor' })).toBeInTheDocument()
    expect(client.play).not.toHaveBeenCalled()
  })
  it('opens a saved play from Overview and preserves edits when reopening that same play', async () => {
    const client = api({
      overview: vi.fn().mockResolvedValue(overviewFixture),
      plays: vi.fn().mockResolvedValue([savedPlayFixture.summary]),
      play: vi.fn().mockResolvedValue(savedPlayFixture), evidence: vi.fn().mockResolvedValue([]),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Open Saved idea' }))
    const title = await screen.findByRole('textbox', { name: 'Play title' })
    expect(title).toHaveValue('Saved idea')
    await userEvent.clear(title)
    await userEvent.type(title, 'Unsaved revision')
    await userEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Saved idea' }))
    expect(await screen.findByRole('textbox', { name: 'Play title' })).toHaveValue('Unsaved revision')
    expect(client.play).toHaveBeenCalledOnce()
    expect(client.createPlay).not.toHaveBeenCalled()
    expect(client.updatePlay).not.toHaveBeenCalled()
  })
  it('does not overwrite a local draft when a different saved play is opened from Overview', async () => {
    const client = api({
      overview: vi.fn().mockResolvedValue(overviewFixture),
      plays: vi.fn().mockResolvedValue([savedPlayFixture.summary]),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByRole('button', { name: 'Open Saved idea' })
    await userEvent.click(screen.getByRole('link', { name: 'Plays' }))
    await userEvent.click(screen.getByRole('button', { name: 'New play' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Play title' }), 'Keep this draft')
    await userEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Saved idea' }))
    expect(await screen.findByText('Keep this draft')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Saved idea' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Continue editing' }))
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('Keep this draft')
    expect(client.play).not.toHaveBeenCalled()
  })
  it('reloads the Overview play list independently and keeps the rest of Overview visible on failure', async () => {
    const client = api({
      overview: vi.fn().mockResolvedValue(overviewFixture),
      plays: vi.fn().mockRejectedValueOnce(new ApiError('unavailable', 'Plays temporarily unavailable.'))
        .mockResolvedValue([savedPlayFixture.summary]),
    })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Plays temporarily unavailable.')
    expect(screen.getByRole('button', { name: 'View Main account' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(await screen.findByRole('button', { name: 'Open Saved idea' })).toBeInTheDocument()
    expect(client.plays).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('opens Overview, not the sample Play page, and has honest empty states', async () => {
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api()} />)
    await screen.findByText('Start with your accounts.')
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.queryByText('BTC reclaim at support')).not.toBeInTheDocument()
    expect(await screen.findByText('No operations in this view')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plays' })).toHaveAttribute('href', '#plays')
    expect(screen.queryByRole('region', { name: 'Play draft workspace' })).not.toBeInTheDocument()
    expect(screen.queryByText('Read-only by design')).not.toBeInTheDocument()
    expect(screen.queryByText('Private session')).not.toBeInTheDocument()
    expect(screen.queryByText('Perpetuals', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-controls', 'workspace-nav')
  })
  it('collapses and expands navigation with an accessible native control', async () => {
    const client = api()
    const { container } = render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    const collapse = screen.getByRole('button', { name: 'Collapse navigation' })
    expect(collapse.tagName).toBe('BUTTON')
    expect(collapse).toHaveAttribute('type', 'button')
    expect(collapse).toHaveAttribute('title', 'Collapse navigation')
    expect(collapse).toHaveAttribute('aria-controls', 'workspace-nav')
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(container.firstElementChild).not.toHaveClass('navigation-collapsed')
    await userEvent.click(collapse)
    const expand = screen.getByRole('button', { name: 'Expand navigation' })
    expect(expand).toHaveAttribute('title', 'Expand navigation')
    expect(expand).toHaveAttribute('aria-controls', 'workspace-nav')
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(container.firstElementChild).toHaveClass('navigation-collapsed')
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    await userEvent.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveFocus()
    expect(container.firstElementChild).not.toHaveClass('navigation-collapsed')
    expect(client.overview).toHaveBeenCalledOnce()
    expect(client.sync).not.toHaveBeenCalled()
  })
  it('keeps named rail links, tooltips, active markers and owner disconnect across pages', async () => {
    const disconnect = vi.fn()
    render(<ApplicationShell system={systemFixture} disconnect={disconnect} api={api({ overview: vi.fn().mockResolvedValue(overviewFixture) })} />)
    await screen.findByRole('button', { name: 'View Main account' })
    await userEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    expect(screen.getByRole('link', { name: 'Vessel overview' })).toHaveAttribute('title', 'Vessel overview')
    let previous = screen.getByRole('link', { name: 'Overview' })
    for (const name of ['Plays', 'Portfolios', 'Accounts', 'Activity', 'Settings', 'Overview']) {
      const link = screen.getByRole('link', { name })
      expect(link).toHaveAttribute('aria-label', name)
      expect(link).toHaveAttribute('title', name)
      expect(link).toHaveAttribute('href', `#${name.toLowerCase()}`)
      await userEvent.click(link)
      expect(link).toHaveAttribute('aria-current', 'page')
      expect(link).toHaveClass('active')
      expect(previous).not.toHaveAttribute('aria-current')
      expect(previous).not.toHaveClass('active')
      expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false')
      previous = link
    }
    const strategies = screen.getByRole('link', { name: 'Strategies' })
    expect(strategies).toHaveAttribute('aria-disabled', 'true')
    expect(strategies).toHaveAttribute('title', 'Strategies are not available yet')
    expect(strategies).not.toHaveAttribute('href')
    expect(strategies).not.toHaveAttribute('tabindex')
    await userEvent.click(strategies)
    expect(previous).toHaveAttribute('aria-current', 'page')
    const owner = screen.getByRole('button', { name: "Disconnect Owner's session" })
    expect(owner).toHaveAttribute('title', "Disconnect Owner's browser session")
    await userEvent.click(owner)
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it('starts expanded in a new shell session rather than persisting the rail preference', async () => {
    const client = api()
    const session = render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    session.unmount()
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: 'Expand navigation' })).not.toBeInTheDocument()
  })
  it('opens Plays from navigation and retains its local draft through collapse and navigation', async () => {
    const client = api({ overview: vi.fn().mockResolvedValue(overviewFixture) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    await userEvent.click(screen.getByRole('link', { name: 'Plays' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Plays' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plays' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Add account' })).not.toBeInTheDocument()
    await screen.findByText(/No saved plays yet/)
    await userEvent.click(screen.getByRole('button', { name: 'New play' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Play title' }), 'Local idea')
    await userEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('Local idea')
    await userEvent.click(screen.getByRole('link', { name: 'Overview' }))
    expect(screen.queryByRole('textbox', { name: 'Play title' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Plays' }))
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('Local idea')
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Expand navigation' }))
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('Local idea')
    await userEvent.click(screen.getByRole('button', { name: 'Reload accounts' }))
    await waitFor(() => expect(client.overview).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('Local idea')
    expect(client.sync).not.toHaveBeenCalled()
    expect(client.createAccount).not.toHaveBeenCalled()
    expect(client.updateAccount).not.toHaveBeenCalled()
  })
  it('supports a direct Plays hash without a sample record or saved-play claim', async () => {
    window.history.replaceState(null, '', '/#plays')
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api()} />)
    await screen.findByText(/No saved plays yet/)
    expect(screen.queryByText('BTC reclaim at support')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New play' }))
    await screen.findByText(/No enabled accounts yet/)
    expect(screen.getByRole('heading', { level: 1, name: 'Plays' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('')
    expect(within(screen.getByRole('region', { name: 'Play draft workspace' })).getByText('Draft', { selector: '.badge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled()
  })
  it('creates an owner-scoped portfolio and reloads the workspace', async () => {
    const client = api()
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Create your first portfolio' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Portfolio name'), 'Long-term perps')
    expect(within(dialog).getByRole('radio', { name: 'Folder' })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Mountain' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create portfolio' }))
    await waitFor(() => expect(client.createPortfolio).toHaveBeenCalledWith('Long-term perps', 'mountain'))
    await waitFor(() => expect(client.overview).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('allows an unassigned account before any portfolio exists', async () => {
    const client = api()
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add account' }))
    await userEvent.type(screen.getByLabelText('Account name'), 'Unassigned manual')
    await userEvent.selectOptions(screen.getByLabelText(/Venue/), 'manual')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(client.createAccount).toHaveBeenCalledWith({ portfolioId: null, name: 'Unassigned manual', venueId: 'manual' }))
  })
  it('creates a manual account without fabricating an unavailable balance', async () => {
    const client = api({ overview: vi.fn().mockResolvedValue({ ...emptyOverview, portfolios: [portfolioFixture] }) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add account' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add account' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add account' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add account' }))
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
    expect(client.activity).toHaveBeenCalledWith(accountFixture.id, expect.any(AbortSignal))
  })
  it('retains previous data when a refresh fails and does not invent fills', async () => {
    const wallet = { ...accountFixture, venueId: 'hyperliquid', syncStatus: 'synced' as const, address: '0x' + '1'.repeat(40) }
    const client = api({ overview: vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [wallet] }), sync: vi.fn().mockRejectedValue(new ApiError('http', 'Previous account data is still available.', 502)) })
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh Main account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Previous account data')
    expect(screen.getByRole('button', { name: 'View Main account' })).toBeInTheDocument()
    expect(client.sync).toHaveBeenCalledWith(wallet.id, expect.any(AbortSignal))
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
  it.each([false, true])('traps mobile navigation focus and restores it on Escape with desktop collapsed=%s', async collapsed => {
    vi.stubGlobal('innerWidth', 800)
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api()} />)
    await screen.findByText('Start with your accounts.')
    if (collapsed) await userEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Main navigation' })).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('.shell-main')).toHaveAttribute('inert')
    expect(screen.getByRole('link', { name: 'Vessel overview' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: "Disconnect Owner's session" })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Vessel overview' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
    expect(document.querySelector('.shell-main')).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: collapsed ? 'Expand navigation' : 'Collapse navigation' })).toHaveAttribute('aria-expanded', String(!collapsed))
  })
  it('closes the full-screen mobile drawer with its own button and restores scrolling and focus', async () => {
    vi.stubGlobal('innerWidth', 390)
    const previousOverflow = document.body.style.overflow
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api()} />)
    await screen.findByText('Start with your accounts.')
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await userEvent.click(trigger)
    const drawer = screen.getByRole('dialog', { name: 'Main navigation' })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close navigation' }))
    expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe(previousOverflow)
    expect(document.querySelector('.shell-main')).not.toHaveAttribute('inert')
    expect(trigger).toHaveFocus()
  })
  it('closes the mobile drawer on navigation and desktop resize without resetting the rail preference', async () => {
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api()} />)
    await screen.findByText('Start with your accounts.')
    await userEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    vi.stubGlobal('innerWidth', 800)
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }))
    expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelector('.shell-main')).not.toHaveAttribute('inert')
    await userEvent.click(trigger)
    vi.stubGlobal('innerWidth', 801)
    fireEvent(window, new Event('resize'))
    expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(document.querySelector('.shell-main')).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false')
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
    expect(screen.getByRole('row', { name: /Main account/ })).toHaveTextContent('Disabled')
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
      availableBalanceUsd: '10.123456', availableBalanceSource: 'wallet' as const,
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
    expect(await screen.findByText('Available balance')).toBeInTheDocument()
    expect(screen.getByText('Perps equity $0.00')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'View Main account' }))
    expect(await screen.findByRole('heading', { name: 'Stablecoin wallet' })).toBeInTheDocument()
    expect(await screen.findByText('USDC')).toBeInTheDocument()
    expect(screen.getByText('Available token units')).toBeInTheDocument()
    expect(screen.getByText('10.123456')).toBeInTheDocument()
    expect(screen.getByText('Wallet funds, not guaranteed trading margin.')).toBeInTheDocument()
    expect(screen.getByText(/^Separate Hyperliquid perpetuals equity: \$0\.00\./)).toBeInTheDocument()
    expect(screen.getByText('Wallet total minus held · nominal')).toBeInTheDocument()
    expect(screen.getByText('Perps withdrawable $0.00 · separate field')).toBeInTheDocument()
  })
  it('names an unreported withdrawable amount and shows no wallet note for a venue without a wallet', async () => {
    const venue = { ...systemFixture.venues[0]!, id: 'risex', name: 'RISEx', tradeUrlTemplate: 'https://www.rise.trade/trade/{instrument}',
      priceRule: 'tick-size' as const, capabilities: { ...systemFixture.venues[0]!.capabilities, stream: false, stablecoinWallet: false } }
    const system = { ...systemFixture, venues: [venue, ...systemFixture.venues] }
    const risex = { ...accountFixture, venueId: 'risex', address: '0x1111111111111111111111111111111111111111', accountValueUsd: '12480.55',
      syncStatus: 'synced' as const, lastSyncedAtUtc: '2026-10-06T09:12:00Z' }
    const client = api({
      overview: vi.fn().mockResolvedValue({ ...overviewFixture, accounts: [risex] }),
      snapshot: vi.fn().mockResolvedValue({ observedAtUtc: '2026-10-06T09:12:00Z', valueScope: 'risex-perps-account',
        accountValueUsd: '12480.55', withdrawableUsd: null, marginUsedUsd: '1830.2', positions: [] }),
      fills: vi.fn().mockResolvedValue([]),
    })
    render(<ApplicationShell system={system} disconnect={vi.fn()} api={client} />)
    await userEvent.click(await screen.findByRole('button', { name: 'View Main account' }))
    expect(await screen.findByText('Not reported by this venue')).toBeInTheDocument()
    expect(screen.getByText('Account value · reported')).toBeInTheDocument()
    expect(screen.queryByText(/perpetuals equity:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/risex-perps-account/)).not.toBeInTheDocument()
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
    await waitFor(() => expect(client.activity).toHaveBeenCalledTimes(3))
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
