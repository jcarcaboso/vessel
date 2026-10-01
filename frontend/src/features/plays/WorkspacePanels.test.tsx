import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { accountFixture, portfolioFixture } from '@/test/workspace-fixture'
import { AvailableBudget, CapitalContext, ChartPlaceholder, PlayJournal, PositionSummary } from './WorkspacePanels'
import { createDraft, createEntry, type PlayDraft } from './draft'

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
  it('leaves unknown values and budget unavailable without seeding accounts', () => {
    render(<BudgetHarness />)
    const capital = screen.getByTestId('capital-context')
    expect(within(capital).getByText(/Select an enabled account above/)).toBeInTheDocument()
    expect(within(capital).getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('Unavailable')
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveAttribute('readonly')
    expect(within(capital).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(capital).getByText(/Coverage: unavailable/)).toBeInTheDocument()
  })

  it('displays exact API values with separate primary perps and nominal wallet coverage', () => {
    const account: BrokerAccount = { ...accountFixture, venueId: 'hyperliquid',
      accountValueUsd: '9007199254740990.99', availableStablecoinNominalUsd: '123.45',
      stablecoinScope: 'HyperCore supported stablecoins', accountMode: 'unified' }
    const portfolio: Portfolio = { ...portfolioFixture, totalValueUsd: '9007199254740990.99', valueCoverage: 'partial' }
    render(<BudgetHarness initial={{ ...createDraft(), accountId: account.id }} accounts={[account]} portfolios={[portfolio]} />)
    expect(screen.getAllByText('$9,007,199,254,740,990.99')).toHaveLength(2)
    expect(screen.getByText('$123.45')).toHaveAttribute('title', '123.45')
    expect(screen.getByText('Primary perps equity · USD')).toBeInTheDocument()
    expect(screen.getByText('Supported-wallet available · nominal USD')).toBeInTheDocument()
    expect(screen.getByText(/Coverage: partial/)).toBeInTheDocument()
    expect(screen.getByText(/HyperCore supported stablecoins · unified/)).toBeInTheDocument()
    expect(screen.getByText(/not market valuation, verified trading collateral or withdrawal capacity/)).toBeInTheDocument()
    expect(screen.getByText(/Wallet funds are not added to primary perps equity or portfolio value/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Available budget Nominal USD' })).toHaveValue('Unavailable')
  })

  it('keeps a reported zero distinct from missing values and does not create a default portfolio', () => {
    const account = { ...accountFixture, portfolioId: null, accountValueUsd: '0' }
    render(<BudgetHarness initial={{ ...createDraft(), accountId: account.id }} accounts={[account]} portfolios={[portfolioFixture]} />)
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.getByText(/Unassigned account/)).toBeInTheDocument()
    expect(screen.queryByText(/Swing trading/)).not.toBeInTheDocument()
    expect(screen.getByText(/Coverage: unavailable/)).toBeInTheDocument()
  })

  it('does not reveal a disabled account value or its portfolio', () => {
    render(<BudgetHarness initial={{ ...createDraft(), accountId: accountFixture.id }}
      accounts={[{ ...accountFixture, isEnabled: false }]} portfolios={[portfolioFixture]} />)
    expect(screen.queryByText('$1,250.12')).not.toBeInTheDocument()
    expect(screen.queryByText(/Main account/)).not.toBeInTheDocument()
    expect(screen.getByText(/Select an enabled account above/)).toBeInTheDocument()
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

  it('keeps the optional sizing assistant collapsed and offers no suggestions or Apply action', async () => {
    render(<BudgetHarness />)
    const assistant = screen.getByText('Sizing assistant').closest('details')!
    expect(assistant).not.toHaveAttribute('open')
    expect(screen.getByTestId('capital-context')).toContainElement(assistant)
    await userEvent.click(screen.getByText('Sizing assistant'))
    expect(assistant).toHaveAttribute('open')
    expect(within(assistant).getByText(/Position suggestions and financial calculations are not available/)).toBeInTheDocument()
    expect(within(assistant).queryByRole('button')).not.toBeInTheDocument()
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
    expect(screen.getByText('Evidence notes only. Uploads and chart captures are not available.')).toBeInTheDocument()
    expect(screen.getByTestId('journal-panel').querySelector('input[type="file"]')).toBeNull()
  })
})

describe('Chart placeholder', () => {
  it('selects an editor through the planned-entry legend while keeping every entry visible', async () => {
    const entries = [createEntry(0), createEntry(1)]
    const onSelect = vi.fn()
    const { rerender } = render(<ChartPlaceholder entries={entries} selectedId={entries[0]!.id} instrument="ETH-PERP" onSelect={onSelect} />)
    const legend = screen.getByRole('group', { name: 'Planned entries' })
    await userEvent.click(within(legend).getByRole('button', { name: /Entry 2/ }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(entries[1]!.id)
    rerender(<ChartPlaceholder entries={entries} selectedId={entries[1]!.id} instrument="ETH-PERP" onSelect={onSelect} />)
    expect(within(legend).getAllByRole('button')).toHaveLength(2)
    expect(within(legend).getByRole('button', { name: /Entry 1/ })).toHaveAttribute('aria-pressed', 'false')
    expect(within(legend).getByRole('button', { name: /Entry 2/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('ETH-PERP')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand chart' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Capture chart' })).toBeDisabled()
    expect(screen.getByText(/No candles, live prices or execution observations/)).toBeInTheDocument()
    expect(screen.getByTestId('chart-panel').querySelector('canvas')).toBeNull()
  })

  it('does not invent an instrument or entries for an empty draft', () => {
    render(<ChartPlaceholder entries={[]} selectedId="" instrument="" onSelect={vi.fn()} />)
    expect(screen.getByText('No perpetual instrument selected')).toBeInTheDocument()
    expect(screen.getByText('No planned entries.')).toBeInTheDocument()
  })
})

describe('Position summary', () => {
  it('echoes chosen margin and leverage but never calculates exposure, prices or payoff', () => {
    const draft = { ...createDraft(), size: '1000', leverage: '5' }
    draft.entries[0]!.price = '2000'
    draft.entries[0]!.stop.value = '1900'
    draft.entries[0]!.targets[0]!.value = '2200'
    render(<PositionSummary draft={draft} />)
    const summary = screen.getByTestId('summary-panel')
    expect(within(summary).getByText('Chosen margin')).toBeInTheDocument()
    expect(within(summary).getByText('1000 currency units')).toBeInTheDocument()
    expect(within(summary).getByText('5×')).toBeInTheDocument()
    expect(within(summary).getAllByText('Not calculated')).toHaveLength(6)
    expect(within(summary).queryByText(/\$|5000|2000|1900|2200/)).not.toBeInTheDocument()
    expect(within(summary).getByText(/no execution or realized return is implied/)).toBeInTheDocument()
  })

  it('echoes quantity with units without converting it to USD', () => {
    render(<PositionSummary draft={{ ...createDraft(), sizingMode: 'quantity', size: '0.125', leverage: '3' }} />)
    expect(screen.getByText('Chosen quantity')).toBeInTheDocument()
    expect(screen.getByText('0.125 instrument units')).toBeInTheDocument()
    expect(screen.getAllByText('Not calculated')).toHaveLength(6)
  })

  it('does not insert a sample size for an empty draft', () => {
    render(<PositionSummary draft={createDraft()} />)
    expect(screen.getByText('Not chosen')).toBeInTheDocument()
    expect(screen.getByText('1×')).toBeInTheDocument()
    expect(screen.getAllByText('Not calculated')).toHaveLength(6)
  })
})
