import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { accountFixture, portfolioFixture } from '@/test/workspace-fixture'
import { AccountsPanel } from './AccountsPanel'

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
  return <AccountsPanel accounts={accounts} portfolios={[portfolioFixture]} portfolioFilter={portfolio} onPortfolioFilter={setPortfolio}
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
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by venue' }), 'hyperliquid')
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
