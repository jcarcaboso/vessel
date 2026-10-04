import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { accountFixture, portfolioFixture } from '@/test/workspace-fixture'
import { AvailableBudget, CapitalContext, PlayJournal, PositionSummary } from './WorkspacePanels'
import { createDraft, type PlayDraft } from './draft'

function BudgetHarness({ initial = createDraft(), accounts = [], portfolios = [], onChange = vi.fn() }: {
  initial?: PlayDraft
  accounts?: BrokerAccount[]
  portfolios?: Portfolio[]
  onChange?: (draft: PlayDraft) => void
}) {
  const [draft, setDraft] = useState(initial)
  return <><CapitalContext accounts={accounts} portfolios={portfolios} draft={draft} />
    <AvailableBudget key={draft.accountId} draft={draft} onChange={next => { setDraft(next); onChange(next) }} /></>
}

describe('Capital context', () => {
  const metric = (label: string) => within(screen.getByTestId('capital-context')).getByText(label).closest('div')!

  it('leaves unknown values and budget unavailable without seeding accounts', () => {
    render(<BudgetHarness />)
    const capital = screen.getByTestId('capital-context')
    expect(metric('Account balance')).toHaveTextContent('Unavailable')
    expect(within(capital).queryByText('Wallet total')).toBeNull()
    expect(metric('Margin / balance')).toHaveTextContent('—')
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('Unavailable')
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveAttribute('readonly')
    expect(within(capital).queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('shows the portfolio balance, wallet total and available amount of a unified account without perps equity', () => {
    const account: BrokerAccount = { ...accountFixture, venueId: 'hyperliquid', accountValueUsd: '0',
      availableStablecoinNominalUsd: '150', totalStablecoinNominalUsd: '151.77', balanceUsd: '151.77',
      stablecoinScope: 'hypercore-spot-stablecoins', accountMode: 'unifiedAccount' }
    const portfolio: Portfolio = { ...portfolioFixture, totalValueUsd: '0', balanceUsd: '1151.77', balanceCoverage: 'complete' }
    render(<BudgetHarness initial={{ ...createDraft(), accountId: account.id }} accounts={[account]} portfolios={[portfolio]} />)
    expect(metric(`${portfolio.name} balance`)).toHaveTextContent('$1,151.77')
    expect(metric(`${portfolio.name} balance`)).toHaveAttribute('title', expect.stringContaining('coverage complete'))
    expect(metric('Wallet total')).toHaveTextContent('$151.77')
    expect(metric('Wallet total')).toHaveAttribute('title', 'hypercore-spot-stablecoins · unifiedAccount. Nominal 1 token = 1 USD.')
    expect(metric('Available')).toHaveTextContent('$150.00')
    expect(within(screen.getByTestId('capital-context')).queryByText('Perps equity')).toBeNull()
  })

  it('shows perps equity beside the wallet for a standard account', () => {
    const account: BrokerAccount = { ...accountFixture, venueId: 'hyperliquid', portfolioId: null, accountValueUsd: '1000',
      availableStablecoinNominalUsd: '10', totalStablecoinNominalUsd: '10', balanceUsd: '1010', accountMode: 'default' }
    render(<BudgetHarness initial={{ ...createDraft(), accountId: account.id }} accounts={[account]} portfolios={[portfolioFixture]} />)
    expect(metric('Account balance')).toHaveTextContent('$1,010.00')
    expect(metric('Perps equity')).toHaveTextContent('$1,000.00')
  })

  it('shows margin and exposure as shares of the balance once the position is sized', () => {
    const portfolio: Portfolio = { ...portfolioFixture, totalValueUsd: '10000', balanceUsd: '10000' }
    const draft = { ...createDraft(), accountId: accountFixture.id, size: '500', leverage: '4' }
    draft.entries[0]!.price = '100'
    render(<BudgetHarness initial={draft} accounts={[accountFixture]} portfolios={[portfolio]} />)
    expect(metric('Margin / balance')).toHaveTextContent('5.0%')
    expect(metric('Exposure / balance')).toHaveTextContent('20.0%')
  })

  it('keeps a reported zero distinct from missing values and does not create a default portfolio', () => {
    const account = { ...accountFixture, portfolioId: null, accountValueUsd: '0' }
    render(<BudgetHarness initial={{ ...createDraft(), accountId: account.id }} accounts={[account]} portfolios={[portfolioFixture]} />)
    expect(metric('Account balance')).toHaveTextContent('$0.00')
    expect(screen.queryByText(/Swing trading/)).not.toBeInTheDocument()
  })

  it('does not reveal a disabled account value or its portfolio', () => {
    render(<BudgetHarness initial={{ ...createDraft(), accountId: accountFixture.id }}
      accounts={[{ ...accountFixture, isEnabled: false }]} portfolios={[portfolioFixture]} />)
    expect(screen.queryByText('$1,250.12')).not.toBeInTheDocument()
    expect(metric('Account balance')).toHaveTextContent('Unavailable')
  })

  it('saves an explicit local override without changing real account values or rounding its stored amount', async () => {
    const initial = { ...createDraft(), accountId: accountFixture.id }
    const onChange = vi.fn()
    render(<BudgetHarness initial={initial} accounts={[accountFixture]} portfolios={[portfolioFixture]} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit available budget' }))
    const input = screen.getByRole('textbox', { name: 'Available budget Nominal USD' })
    expect(input).not.toHaveAttribute('readonly')
    await userEvent.type(input, '9007199254740990.99')
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...initial, budgetOverride: '9007199254740990.99' })
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('$9,007,199,254,740,990.99')
    expect(screen.getAllByText('$1,250.12')).toHaveLength(2)
    expect(accountFixture.accountValueUsd).toBe('1250.123456')
  })

  it('cancels without applying an override and restores the saved value on reopening', async () => {
    const onChange = vi.fn()
    render(<BudgetHarness initial={{ ...createDraft(), budgetOverride: '250' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit available budget' }))
    const input = screen.getByRole('textbox', { name: 'Available budget Nominal USD' })
    await userEvent.clear(input)
    await userEvent.type(input, '500')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('$250.00')
    await userEvent.click(screen.getByRole('button', { name: 'Edit available budget' }))
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('250')
  })

  it('cancels a first edit back to unavailable and accepts an explicitly saved zero', async () => {
    const onChange = vi.fn()
    render(<BudgetHarness onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit available budget' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Available budget Nominal USD' }), '100')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('Unavailable')
    await userEvent.click(screen.getByRole('button', { name: 'Edit available budget' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Available budget Nominal USD' }), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    expect(onChange.mock.calls[0]![0].budgetOverride).toBe('0')
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('$0.00')
  })

  it.each(['-10', 'NaN', '1e6', '1,000', '1.2.3'])('rejects invalid budget %s without applying it', async (value) => {
    const onChange = vi.fn()
    render(<BudgetHarness onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit available budget' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Available budget Nominal USD' }), value)
    await userEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a non-negative USD amount')
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('removes a local override only after saving an empty field', async () => {
    const onChange = vi.fn()
    render(<BudgetHarness initial={{ ...createDraft(), budgetOverride: '250' }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit available budget' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Available budget Nominal USD' }))
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    expect(onChange.mock.calls[0]![0].budgetOverride).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('Unavailable')
  })

  it('discards an open unsaved override when the selected account changes', async () => {
    const onChange = vi.fn()
    const initial = { ...createDraft(), accountId: accountFixture.id }
    const { rerender } = render(<AvailableBudget key={initial.accountId} draft={initial} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit available budget' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Available budget Nominal USD' }), '100')
    rerender(<AvailableBudget key="" draft={{ ...initial, accountId: '' }} onChange={onChange} />)
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('Unavailable')
    expect(screen.queryByRole('button', { name: 'Save budget' })).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Play journal', () => {
  it('keeps thesis, invalidation, strategy, evidence and review separate when switching tabs', async () => {
    const onChange = vi.fn()
    function JournalHarness() {
      const [notes, setNotes] = useState(createDraft().notes)
      return <PlayJournal notes={notes} onChange={(next) => { setNotes(next); onChange(next) }} />
    }
    render(<JournalHarness />)
    // Tabs share the heading row so the note field keeps most of the journal height.
    expect(screen.getByRole('heading', { name: 'Play journal' }).closest('header'))
      .toContainElement(screen.getByRole('tablist', { name: 'Journal sections' }))
    const sections = ['Thesis', 'Invalidation', 'Strategy', 'Evidence', 'Review']
    for (const label of sections) {
      await userEvent.click(screen.getByRole('tab', { name: label }))
      await userEvent.type(screen.getByRole('textbox', { name: label }), `${label} text`)
    }
    expect(onChange.mock.lastCall![0]).toEqual({
      thesis: 'Thesis text', invalidation: 'Invalidation text', strategy: 'Strategy text',
      evidence: 'Evidence text', review: 'Review text',
    })
    for (const label of sections) {
      await userEvent.click(screen.getByRole('tab', { name: label }))
      expect(screen.getByRole('textbox', { name: label })).toHaveValue(`${label} text`)
      expect(screen.getAllByRole('textbox')).toHaveLength(1)
    }
    await userEvent.click(screen.getByRole('tab', { name: 'Evidence' }))
    expect(screen.getByRole('textbox', { name: 'Evidence' })).toHaveAttribute('placeholder', 'Notes on the evidence')
    expect(screen.getByTestId('journal-panel').querySelector('input[type="file"]')).toBeNull()
  })
})

describe('Position summary', () => {
  it('derives margin, position size and quantity from the margin and leverage, but no payoff', () => {
    const draft = { ...createDraft(), size: '1000', leverage: '5' }
    draft.entries[0]!.price = '2000'
    draft.entries[0]!.stops[0]!.value = '1900'
    draft.entries[0]!.targets[0]!.value = '2200'
    render(<PositionSummary draft={draft} units={{ quote: 'USDC', base: 'ETH', quantityDecimals: 4 }} instrumentName="ETH/USDC" />)
    const summary = screen.getByTestId('summary-panel')
    const value = (label: string) => within(summary).getByText(label).nextElementSibling
    expect(value('Margin')).toHaveTextContent('1,000 USDC')
    expect(value('Position size')).toHaveTextContent('5,000 USDC')
    expect(value('Quantity')).toHaveTextContent('2.5 ETH')
    expect(value('Average entry')).toHaveTextContent('2000')
    expect(within(summary).queryByText(/Not calculated|1900|2200/)).not.toBeInTheDocument()
    expect(within(summary).getByText('Long')).toHaveAttribute('data-direction', 'long')
    expect(within(summary).getByText('ETH/USDC · Leverage 5×')).toBeInTheDocument()
    expect(value('Position size')).toHaveAttribute('data-placeholder', 'false')
  })

  it('derives margin from a quantity once an entry is priced', () => {
    const draft = { ...createDraft(), sizingMode: 'quantity' as const, size: '0.125', leverage: '4' }
    const view = render(<PositionSummary draft={draft} />)
    expect(screen.getByText('Margin').nextElementSibling).toHaveTextContent('Needs an entry price')
    expect(screen.getByText('Quantity').nextElementSibling).toHaveTextContent('0.125 units')
    draft.entries[0]!.price = '80000'
    view.rerender(<PositionSummary draft={{ ...draft }} />)
    expect(screen.getByText('Position size').nextElementSibling).toHaveTextContent('10,000 quote units')
    expect(screen.getByText('Margin').nextElementSibling).toHaveTextContent('2,500 quote units')
  })

  it('does not insert a sample size for an empty draft', () => {
    render(<PositionSummary draft={createDraft()} />)
    expect(screen.getByText('Not set')).toHaveAttribute('data-placeholder', 'true')
    expect(screen.getByText('No instrument · Leverage 1×')).toBeInTheDocument()
    expect(screen.getAllByText('Needs a size')).toHaveLength(3)
  })
})
