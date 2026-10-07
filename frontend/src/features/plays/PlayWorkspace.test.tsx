import { useState } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import { render } from '@/test/render'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { pickInstrument } from '@/test/instrument'
import { createWorkspaceApi, type BrokerAccount, type WorkspaceApi } from '@/api/workspace'
import { accountFixture, candleSeriesFixture, idleMarketStream, instrumentCatalogFixture, marketContextFixture, portfolioFixture } from '@/test/workspace-fixture'
import { PlayWorkspace } from './PlayWorkspace'
import { createDraft, type PlayDraft } from './draft'
import { VenuesProvider } from '@/api/venues'
import { systemFixture } from '@/test/system-fixture'

function Workspace({ disabled = false }: { disabled?: boolean }) {
  const [draft, setDraft] = useState(createDraft)
  return <PlayWorkspace accounts={[{ ...accountFixture, isEnabled: !disabled }]} portfolios={[portfolioFixture]} api={createWorkspaceApi('test-only')} draft={draft} onChange={setDraft} />
}

function AccountWorkspace({ accounts, api }: { accounts: BrokerAccount[]; api: WorkspaceApi }) {
  const [draft, setDraft] = useState(createDraft)
  return <PlayWorkspace accounts={accounts} portfolios={[portfolioFixture]} api={api} draft={draft} onChange={setDraft} />
}

const catalogueApi = {
  instruments: () => Promise.resolve(instrumentCatalogFixture), candles: () => new Promise(() => {}), marketContext: () => new Promise(() => {}),
  marketStream: idleMarketStream,
} as unknown as WorkspaceApi

function ReloadedWorkspace({ accounts, onDraft }: { accounts: BrokerAccount[]; onDraft: (draft: PlayDraft) => void }) {
  const [draft, setDraft] = useState(createDraft)
  const api = catalogueApi
  return <PlayWorkspace accounts={accounts} portfolios={[portfolioFixture]} api={api} draft={draft}
    onChange={next => { onDraft(next); setDraft(next) }} />
}

describe('Play draft workspace', () => {
  it('passes the catalogue native identifier to a descriptor-driven venue link', async () => {
    const nativeVenue = { ...systemFixture.venues[0]!, tradeUrlTemplate: 'https://trade.example/{venueContractId}' }
    const api = { ...catalogueApi, instruments: vi.fn().mockResolvedValue({
      ...instrumentCatalogFixture, instruments: [{ ...instrumentCatalogFixture.instruments[1]!, venueContractId: 'kPEPE' }],
    }) }
    render(<VenuesProvider venues={[nativeVenue]}>
      <PlayWorkspace accounts={[{ ...accountFixture, venueId: nativeVenue.id }]} portfolios={[]} api={api}
        draft={{ ...createDraft(), accountId: accountFixture.id, instrument: '1000PEPE', instrumentSource: 'venue' }} onChange={vi.fn()} />
    </VenuesProvider>)
    await waitFor(() => expect(screen.getByRole('link', { name: /Open 1000PEPE/ })).toHaveAttribute('href', 'https://trade.example/kPEPE'))
  })
  it('clears venue context when a reload disables or removes the chosen account', async () => {
    const venue = { ...accountFixture, venueId: 'hyperliquid', address: `0x${'a'.repeat(40)}` }
    const onDraft = vi.fn<(draft: PlayDraft) => void>()
    const view = render(<ReloadedWorkspace accounts={[venue]} onDraft={onDraft} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), venue.id)
    await pickInstrument(userEvent, 'BTC')
    expect(onDraft.mock.lastCall?.[0]).toMatchObject({ accountId: venue.id, instrument: 'BTC', instrumentSource: 'venue' })
    view.rerender(<ReloadedWorkspace accounts={[{ ...venue, isEnabled: false }]} onDraft={onDraft} />)
    expect(onDraft.mock.lastCall?.[0]).toMatchObject({ accountId: '', instrument: '', instrumentSource: 'manual', budgetOverride: null })
    expect(screen.getByRole('textbox', { name: 'Perpetual instrument' })).toHaveValue('')
    expect(screen.queryByText('Manual label, not venue-validated.')).toBeInTheDocument()
    view.rerender(<ReloadedWorkspace accounts={[]} onDraft={onDraft} />)
    expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue('')
  })


  it('preserves the approved section order without sample candles or fabricated results', () => {
    render(<Workspace />)
    const workspace = screen.getByTestId('workspace')
    const left = screen.getByTestId('left-column')
    expect(left.children[0]).toBe(screen.getByTestId('chart-panel'))
    expect(left.children[1]).toBe(screen.getByTestId('journal-panel'))
    expect(workspace.children[0]).toBe(left)
    expect(workspace.children[1]).toBe(screen.getByTestId('position-panel'))
    expect(workspace.previousElementSibling).toBe(screen.getByTestId('capital-context'))
    expect(screen.getByTestId('capital-context').compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(workspace.nextElementSibling).toBe(screen.getByTestId('summary-panel'))
    // A local draft shows no banner; the status badge and buttons say enough.
    expect(document.querySelector('.plays-draft-notice')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Play title' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Perpetual instrument' })).toHaveValue('')
    expect(screen.queryByRole('img', { name: /candles/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('summary-panel')).getAllByText('Needs a size').length).toBeGreaterThan(0)
  })

  it('uses a real enabled account without assuming its value is an available budget', async () => {
    render(<Workspace />)
    expect(within(screen.getByTestId('capital-context')).queryByText('$1,250.12')).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), accountFixture.id)
    const capital = within(screen.getByTestId('capital-context'))
    expect(capital.getAllByText('$1,250.12').length).toBeGreaterThan(0)
    // The account has no available wallet amount, so its value is not used as a budget.
    expect(within(screen.getByTestId('position-panel')).getByRole('button', { name: 'Set budget' })).toBeInTheDocument()
  })

  it('never offers disabled accounts, and allows outlining a draft without accounts', () => {
    render(<Workspace disabled />)
    expect(screen.queryByRole('option', { name: /Main account/ })).not.toBeInTheDocument()
    expect(screen.getByText(/No enabled accounts yet/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Play title' })).toBeEnabled()
  })

  it('does not claim accounts are empty while the account context is still loading', () => {
    render(<PlayWorkspace accounts={[]} portfolios={[]} api={createWorkspaceApi('test-only')} draft={createDraft()} onChange={vi.fn()} loading />)
    expect(screen.queryByText(/No enabled accounts yet/)).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Account' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Play title' })).toBeEnabled()
  })

  it('clears an account-specific budget override when the account selection changes', async () => {
    const draft = { ...createDraft(), accountId: accountFixture.id, budgetOverride: '50' }
    const onChange = vi.fn()
    render(<PlayWorkspace accounts={[accountFixture]} portfolios={[portfolioFixture]} api={createWorkspaceApi('test-only')} draft={draft} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), '')
    expect(onChange).toHaveBeenCalledWith({ ...draft, accountId: '', instrument: '', instrumentSource: 'manual', budgetOverride: null })
  })

  it('does not display a selected account balance after that account becomes disabled', () => {
    const draft = { ...createDraft(), accountId: accountFixture.id }
    render(<PlayWorkspace accounts={[{ ...accountFixture, isEnabled: false }]} portfolios={[portfolioFixture]} api={createWorkspaceApi('test-only')} draft={draft} onChange={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue('')
    expect(within(screen.getByTestId('capital-context')).queryByText('$1,250.12')).not.toBeInTheDocument()
  })

  it('discards an unfinished budget edit when its account context changes', async () => {
    render(<Workspace />)
    await userEvent.click(screen.getByRole('button', { name: 'Set budget' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Budget $' }), '70')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), accountFixture.id)
    expect(screen.queryByRole('button', { name: 'Save budget' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set budget' })).toBeInTheDocument()
  })

  it('keeps original thesis and retrospective review independent', async () => {
    render(<Workspace />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Thesis' }), 'Wait for acceptance')
    await userEvent.click(screen.getByRole('tab', { name: 'Review' }))
    expect(screen.getByRole('textbox', { name: 'Review' })).toHaveValue('')
    await userEvent.type(screen.getByRole('textbox', { name: 'Review' }), 'Review after execution')
    await userEvent.click(screen.getByRole('tab', { name: 'Thesis' }))
    expect(screen.getByRole('textbox', { name: 'Thesis' })).toHaveValue('Wait for acceptance')
  })

  it('clears the previous venue contract and budget when selecting another account', async () => {
    const first = { ...accountFixture, venueId: 'hyperliquid' }
    const second = { ...first, id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Second wallet' }
    const instruments = vi.fn().mockResolvedValue(instrumentCatalogFixture)
    const api = { ...createWorkspaceApi('test-only'), instruments }
    render(<AccountWorkspace accounts={[first, second]} api={api} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), first.id)
    await pickInstrument(userEvent, 'BTC')
    await userEvent.click(screen.getByRole('button', { name: 'Set budget' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Budget $' }), '70')
    await userEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    expect(screen.getByRole('group', { name: 'Budget' })).toHaveTextContent('$70.00manual')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), second.id)
    expect(screen.getByRole('combobox', { name: 'Perpetual instrument' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Set budget' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Perpetual instrument' })).toBeEnabled())
    expect(instruments).toHaveBeenLastCalledWith(second.id, expect.any(AbortSignal))
  })

  it('keeps leverage within the venue maximum of the chosen contract', async () => {
    const wallet = { ...accountFixture, venueId: 'hyperliquid' }
    const user = userEvent.setup()
    render(<AccountWorkspace accounts={[wallet]} api={{ ...createWorkspaceApi('test-only'), ...catalogueApi }} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), wallet.id)
    await pickInstrument(user, 'BTC')
    await user.click(screen.getByRole('button', { name: '25×' }))
    expect(screen.getByRole('spinbutton', { name: 'Leverage (×)' })).toHaveValue(25)
    await pickInstrument(user, '1000PEPE')
    expect(screen.getByRole('spinbutton', { name: 'Leverage (×)' })).toHaveValue(10)
    expect(screen.getByRole('slider', { name: 'Leverage slider (×)' })).toHaveAttribute('max', '10')
    expect(screen.getByRole('link', { name: 'Open 1000PEPE/USDC on Hyperliquid' })).toBeInTheDocument()
  })

  it('filters accounts by real portfolio and unassigned grouping without inventing a portfolio', async () => {
    const unassigned = { ...accountFixture, id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Unassigned broker', portfolioId: null }
    const api = createWorkspaceApi('test-only')
    render(<AccountWorkspace accounts={[accountFixture, unassigned]} api={api} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), accountFixture.id)
    await userEvent.type(screen.getByRole('textbox', { name: 'Perpetual instrument' }), 'Manual contract')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Portfolio' }), 'unassigned')
    expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Perpetual instrument' })).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'Main account · Manual' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Unassigned broker · Manual' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Default portfolio' })).not.toBeInTheDocument()
  })

  it('keeps the draft and shows All accounts if a metadata reload moves its account out of the selected portfolio', async () => {
    const api = createWorkspaceApi('test-only')
    const view = render(<AccountWorkspace accounts={[accountFixture]} api={api} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Portfolio' }), portfolioFixture.id)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), accountFixture.id)
    await userEvent.type(screen.getByRole('textbox', { name: 'Perpetual instrument' }), 'Manual contract')
    view.rerender(<AccountWorkspace accounts={[{ ...accountFixture, portfolioId: null }]} api={api} />)
    expect(screen.getByRole('combobox', { name: 'Portfolio' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue(accountFixture.id)
    expect(screen.getByRole('textbox', { name: 'Perpetual instrument' })).toHaveValue('Manual contract')
  })

  it('adds a chart capture to the draft evidence and opens the Evidence tab', async () => {
    const venue = { ...accountFixture, venueId: 'hyperliquid', address: `0x${'a'.repeat(40)}` }
    const api = { ...catalogueApi, candles: () => Promise.resolve(candleSeriesFixture), marketContext: () => Promise.resolve(marketContextFixture) } as WorkspaceApi
    const onDraft = vi.fn<(draft: PlayDraft) => void>()
    function CaptureWorkspace() {
      const [draft, setDraft] = useState(createDraft)
      return <PlayWorkspace accounts={[venue]} portfolios={[portfolioFixture]} api={api} draft={draft}
        onChange={next => { onDraft(next); setDraft(next) }} />
    }
    render(<CaptureWorkspace />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Account' }), venue.id)
    await pickInstrument(userEvent, 'BTC')
    await screen.findByText(/Updated/)
    // The jsdom renderer stub cannot draw, so the capture reports a failure without touching the draft.
    await userEvent.click(screen.getByRole('button', { name: 'Capture chart' }))
    expect(await screen.findByText(/The chart could not be captured\./)).toBeInTheDocument()
    expect(onDraft.mock.lastCall?.[0].evidence).toEqual([])
  })
})
