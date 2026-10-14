import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { accountFixture, portfolioFixture } from '@/test/workspace-fixture'
import { createWorkspaceApi } from '@/api/workspace'
import { AccountsPanel } from './AccountsPanel'
import { emptyAccountFilters } from './account-filters'

const accounts = [
  { ...accountFixture, name: 'Manual savings' },
  { ...accountFixture, id: 'failed', name: 'Alpha trading', venueId: 'hyperliquid', sourceId: '0xabc123',
    syncStatus: 'error' as const, portfolioId: null },
  { ...accountFixture, id: 'new', name: 'Beta trading', venueId: 'hyperliquid', address: '0xdef456',
    syncStatus: 'not-synced' as const },
  { ...accountFixture, id: 'disabled', name: 'Old account', venueId: 'hyperliquid', isEnabled: false, syncStatus: 'synced' as const },
]
function Harness() {
  const [portfolio, setPortfolio] = useState('')
  const [filters, setFilters] = useState(emptyAccountFilters)
  return <AccountsPanel api={createWorkspaceApi('test-only-token')} onChanged={vi.fn()} onReload={vi.fn()} accounts={accounts} portfolios={[portfolioFixture]} portfolioFilter={portfolio} onPortfolioFilter={setPortfolio}
    filters={filters} onFiltersChange={setFilters}
    refreshing={null} refreshAction={null} onDetail={vi.fn()} onSync={vi.fn()} onManage={vi.fn()} onAdd={vi.fn()} />
}
const names = () => within(screen.getByRole('table')).getAllByRole('button', { name: /^View / }).map(button => button.textContent)
describe('Account filters', () => {
  it('combines case-insensitive name/source search with portfolio, venue and status, and resets them', async () => {
    render(<Harness />)
    expect(screen.getByText('4 of 4 accounts')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search accounts' }), 'ABC123')
    expect(names()).toEqual(['View'])
    expect(screen.getByRole('button', { name: 'View Alpha trading' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by portfolio' }), 'unassigned')
    await userEvent.click(within(screen.getByRole('group', { name: 'Filter by venue' })).getByRole('button', { name: 'Hyperliquid' }))
    expect(within(screen.getByRole('group', { name: 'Filter by venue' })).getByRole('button', { name: 'Hyperliquid' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'error')
    expect(screen.getByText('1 of 4 accounts')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by portfolio' }), portfolioFixture.id)
    expect(screen.getByText('0 of 4 accounts')).toBeInTheDocument()
    expect(screen.getByText('No accounts in this view')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByText('4 of 4 accounts')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled()
  })
  it.each([
    ['enabled', 3], ['disabled', 1], ['error', 1], ['not-synced', 1], ['manual', 1],
  ])('filters status %s', async (status, count) => {
    render(<Harness />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), status as string)
    expect(screen.getByText(`${count} of 4 accounts`)).toBeInTheDocument()
    expect(names()).toHaveLength(count as number)
  })
  it('shows venue logo chips with counts and an accessible venue name, falling back to the generic icon', async () => {
    const mixed = [...accounts, { ...accountFixture, id: 'rh', name: 'Robinhood main', venueId: 'lighter-rh', sourceId: '281474976710655', address: null, portfolioId: null },
      { ...accountFixture, id: 'other', name: 'Other', venueId: 'quantfury' }]
    render(<AccountsPanel api={createWorkspaceApi('test-only-token')} onChanged={vi.fn()} onReload={vi.fn()} accounts={mixed} portfolios={[portfolioFixture]}
      portfolioFilter="" onPortfolioFilter={vi.fn()} filters={emptyAccountFilters} onFiltersChange={vi.fn()}
      refreshing={null} refreshAction={null} onDetail={vi.fn()} onSync={vi.fn()} onManage={vi.fn()} onAdd={vi.fn()} />)
    const chips = within(screen.getByRole('group', { name: 'Filter by venue' }))
    expect(chips.getByRole('button', { name: 'All venues' })).toHaveAttribute('aria-pressed', 'true')
    expect(chips.getByRole('button', { name: 'Lighter · Robinhood' })).toHaveTextContent('1')
    expect(chips.getByRole('button', { name: 'Lighter · Robinhood' }).querySelector('[data-logo="lighter-rh"] img')).not.toBeNull()
    expect(chips.getByRole('button', { name: 'Quantfury' }).querySelector('[data-logo="generic"] svg')).not.toBeNull()
    const row = screen.getByRole('button', { name: 'View Robinhood main' }).closest('tr')!
    expect(row).toHaveTextContent('Lighter · Robinhood')
    expect(within(row).getByTitle('281474976710655')).toHaveTextContent('#2814…0655')
    expect(row).toHaveTextContent('Unassigned')
  })
  it('finds a source address as well as an account name', async () => {
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Search accounts' })
    await userEvent.type(input, 'DEF456')
    expect(screen.getByRole('button', { name: 'View Beta trading' })).toBeInTheDocument()
    expect(names()).toHaveLength(1)
    await userEvent.clear(input); await userEvent.type(input, 'SAVINGS')
    expect(screen.getByRole('button', { name: 'View Manual savings' })).toBeInTheDocument()
    expect(names()).toHaveLength(1)
  })
})
