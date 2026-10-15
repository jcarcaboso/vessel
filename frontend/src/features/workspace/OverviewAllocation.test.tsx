import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { render } from '@/test/render'
import { OverviewAllocation } from './OverviewAllocation'

const portfolio = (id: string, name: string): Portfolio => ({ id, name, accountCount: 0, totalValueUsd: null, valueCoverage: 'unavailable', icon: 'folder' })
const account = (id: string, portfolioId: string | null, balanceUsd: string | null, isEnabled = true): BrokerAccount => ({
  id, portfolioId, name: id, venueId: 'manual', address: null, accountValueUsd: balanceUsd, lastSyncedAtUtc: null,
  syncStatus: 'manual', lastSyncError: null, positionCount: 0, historyNotice: null, isEnabled, balanceUsd,
})
const portfolios = [portfolio('p1', 'Swing'), portfolio('p2', 'Core'), portfolio('p3', 'Empty')]
const accounts = [account('Alpha', 'p1', '300'), account('Beta', 'p1', '100'), account('Gamma', 'p2', '600'),
  account('Delta', null, null), account('Hidden', 'p1', '5000', false)]

describe('Overview allocation', () => {
  it('shows portfolio shares of the total and account shares within each portfolio, excluding disabled accounts', () => {
    const onScope = vi.fn()
    render(<OverviewAllocation accounts={accounts} portfolios={portfolios} scope="all" onScope={onScope} />)
    const panel = screen.getByRole('region', { name: 'Balance allocation' })
    expect(within(panel).getByRole('img', { name: 'All accounts balance shares: Core 60.00%, Swing 40.00%' })).toBeInTheDocument()
    const swing = within(panel).getByRole('article', { name: 'Swing' })
    expect(within(swing).getByText('40.00% of total')).toBeInTheDocument()
    expect(within(swing).getByRole('img', { name: 'Swing balance shares: Alpha 75.00%, Beta 25.00%' })).toBeInTheDocument()
    // Empty portfolios have no card; Unassigned keeps its account without a balance visible.
    expect(within(panel).queryByRole('article', { name: 'Empty' })).not.toBeInTheDocument()
    expect(within(within(panel).getByRole('article', { name: 'Unassigned' })).getByText('No positive balance')).toBeInTheDocument()
    expect(within(panel).getAllByText('1 account without a reported balance')).toHaveLength(2)
    expect(within(panel).queryByText('Hidden')).not.toBeInTheDocument()
    fireEvent.click(within(swing).getByRole('button', { name: 'Show allocation for Alpha' }))
    expect(onScope).toHaveBeenLastCalledWith('account:Alpha')
    fireEvent.click(within(swing).getByRole('button', { name: 'Show allocation for Swing' }))
    expect(onScope).toHaveBeenLastCalledWith('portfolio:p1')
  })

  it('narrows to a portfolio and emphasizes a selected account within it', () => {
    const { rerender } = render(<OverviewAllocation accounts={accounts} portfolios={portfolios} scope="portfolio:p1" onScope={() => {}} />)
    expect(screen.getByRole('heading', { name: /^Swing\s*·\s*40\.00% of total$/ })).toBeInTheDocument()
    expect(screen.getByText('$400.00')).toBeInTheDocument()
    rerender(<OverviewAllocation accounts={accounts} portfolios={portfolios} scope="account:Beta" onScope={() => {}} />)
    const legend = screen.getByRole('list', { name: 'Swing shares' })
    // The selected account is plain text, not a link back to itself; the other account stays selectable but dimmed.
    expect(within(legend).getByText('Beta').tagName).toBe('SPAN')
    expect(within(legend).getByRole('button', { name: 'Show allocation for Alpha' }).closest('li')).toHaveClass('allocation-dim')
    expect(within(legend).getByText('Beta').closest('li')).not.toHaveClass('allocation-dim')
  })

  it('drops focus emphasis when the scope changes, so the newly selected account is emphasized', () => {
    const { rerender } = render(<OverviewAllocation accounts={accounts} portfolios={portfolios} scope="portfolio:p1" onScope={() => {}} />)
    fireEvent.focus(screen.getByRole('button', { name: 'Show allocation for Alpha' }))
    rerender(<OverviewAllocation accounts={accounts} portfolios={portfolios} scope="account:Alpha" onScope={() => {}} />)
    rerender(<OverviewAllocation accounts={accounts} portfolios={portfolios} scope="account:Beta" onScope={() => {}} />)
    const legend = screen.getByRole('list', { name: 'Swing shares' })
    expect(within(legend).getByText('Beta').closest('li')).toHaveClass('allocation-active')
    expect(within(legend).getByRole('button', { name: 'Show allocation for Alpha' }).closest('li')).toHaveClass('allocation-dim')
  })

  it('folds a seventh account into Other and highlights Other for an account inside it', () => {
    const many = ['70', '60', '50', '40', '30', '20', '10'].map((v, i) => account(`a${i}`, 'p1', v))
    render(<OverviewAllocation accounts={many} portfolios={portfolios} scope="account:a6" onScope={() => {}} />)
    const legend = screen.getByRole('list', { name: 'Swing shares' })
    expect(within(legend).getAllByRole('listitem')).toHaveLength(6)
    expect(within(legend).getByText('Other (2)').closest('li')).not.toHaveClass('allocation-dim')
    expect(within(legend).getByText('a0').closest('li')).toHaveClass('allocation-dim')
  })

  it('gives every portfolio its share of the total even when the total chart folds it into Other', () => {
    const many = Array.from({ length: 7 }, (_, i) => portfolio(`q${i}`, `P${i}`))
    const list = many.map((p, i) => account(`acc${i}`, p.id, String((i + 1) * 10)))
    const { rerender } = render(<OverviewAllocation accounts={list} portfolios={many} scope="all" onScope={() => {}} />)
    expect(within(screen.getByRole('article', { name: 'P0' })).getByText('3.57% of total')).toBeInTheDocument()
    expect(screen.getByText('Other (2)')).toBeInTheDocument()
    rerender(<OverviewAllocation accounts={list} portfolios={many} scope="portfolio:q0" onScope={() => {}} />)
    expect(screen.getByRole('heading', { name: /^P0\s*·\s*3\.57% of total$/ })).toBeInTheDocument()
  })

  it('renders nothing without enabled accounts', () => {
    const { container } = render(<OverviewAllocation accounts={[account('Off', 'p1', '1', false)]} portfolios={portfolios} scope="all" onScope={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
