import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
    // The selected account is the pressed toggle; the other account stays selectable but dimmed.
    expect(within(legend).getByRole('button', { name: 'Show allocation for Beta' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(legend).getByRole('button', { name: 'Show allocation for Alpha' })).toHaveAttribute('aria-pressed', 'false')
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

  describe('stepping back by activating the selected part again', () => {
    const withUnassigned = [...accounts.filter(a => a.id !== 'Delta'), account('Delta', null, '50'), account('Eps', null, '150')]
    /** Keeps the scope in state like the Overview page, so a click is followed by the real next render. */
    function Harness({ initial, list = accounts }: { initial: string; list?: BrokerAccount[] }) {
      const [scope, setScope] = useState(initial)
      return <><output aria-label="scope">{scope}</output>
        <OverviewAllocation accounts={list} portfolios={portfolios} scope={scope} onScope={setScope} /></>
    }
    const scopeOf = () => screen.getByLabelText('scope').textContent
    const legendButton = (name: string) => screen.getByRole('button', { name: `Show allocation for ${name}` })

    it('returns an account to its portfolio when its slice is clicked again, and selects another account in one click', () => {
      render(<Harness initial="account:Beta" />)
      const slice = () => screen.getByText('Beta: $100.00 · 25.00%')
      expect(slice().parentElement).toHaveAttribute('data-scope', 'portfolio:p1')
      fireEvent.click(slice())
      expect(scopeOf()).toBe('portfolio:p1')
      expect(screen.getByRole('heading', { name: /^Swing\s*·\s*40\.00% of total$/ })).toBeInTheDocument()
      fireEvent.click(screen.getByText('Alpha: $300.00 · 75.00%'))
      expect(scopeOf()).toBe('account:Alpha')
      fireEvent.click(screen.getByText('Alpha: $300.00 · 75.00%'))
      expect(scopeOf()).toBe('portfolio:p1')
      // Choosing the other account while one is selected moves the selection instead of clearing it.
      fireEvent.click(slice())
      expect(scopeOf()).toBe('account:Beta')
      fireEvent.click(screen.getByText('Alpha: $300.00 · 75.00%'))
      expect(scopeOf()).toBe('account:Alpha')
    })

    it('returns an unassigned account to Unassigned', () => {
      render(<Harness initial="account:Eps" list={withUnassigned} />)
      fireEvent.click(screen.getByText('Eps: $150.00 · 75.00%'))
      expect(scopeOf()).toBe('unassigned')
      expect(screen.getByRole('heading', { name: /^Unassigned\s*·\s*/ })).toBeInTheDocument()
    })

    it('returns a selected portfolio, or Unassigned, to all accounts from its heading', () => {
      const { unmount } = render(<Harness initial="portfolio:p1" />)
      const heading = screen.getByRole('heading', { name: /^Swing\s*·\s*40\.00% of total$/ })
      expect(within(heading).getByRole('button', { name: 'Swing' })).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(within(heading).getByRole('button', { name: 'Swing' }))
      expect(scopeOf()).toBe('all')
      expect(screen.getByRole('img', { name: /^All accounts balance shares/ })).toBeInTheDocument()
      unmount()
      render(<Harness initial="unassigned" list={withUnassigned} />)
      fireEvent.click(within(screen.getByRole('heading', { name: /^Unassigned/ })).getByRole('button', { name: 'Unassigned' }))
      expect(scopeOf()).toBe('all')
    })

    it('does not offer the heading toggle for an account, whose parent group is not the selection', () => {
      render(<Harness initial="account:Beta" />)
      expect(within(screen.getByRole('heading', { name: /^Swing/ })).queryByRole('button')).not.toBeInTheDocument()
    })

    it('toggles through legend buttons that report their state', () => {
      render(<Harness initial="all" />)
      const total = screen.getByRole('list', { name: 'All accounts shares' })
      expect(within(total).getByRole('button', { name: 'Show allocation for Swing' })).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(within(total).getByRole('button', { name: 'Show allocation for Swing' }))
      expect(scopeOf()).toBe('portfolio:p1')
      fireEvent.click(legendButton('Beta'))
      expect(scopeOf()).toBe('account:Beta')
      expect(legendButton('Beta')).toHaveAttribute('aria-pressed', 'true')
      expect(legendButton('Alpha')).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(legendButton('Beta'))
      expect(scopeOf()).toBe('portfolio:p1')
      expect(legendButton('Beta')).toHaveAttribute('aria-pressed', 'false')
      // The same button selects it again, so the toggle can be repeated.
      fireEvent.click(legendButton('Beta'))
      expect(scopeOf()).toBe('account:Beta')
    })

    it('toggles from the keyboard with Enter and Space', async () => {
      const user = userEvent.setup()
      render(<Harness initial="account:Beta" />)
      legendButton('Beta').focus()
      await user.keyboard('{Enter}')
      expect(scopeOf()).toBe('portfolio:p1')
      // The donut is rebuilt on every scope change, so focus is placed on the next button explicitly.
      legendButton('Alpha').focus()
      await user.keyboard(' ')
      expect(scopeOf()).toBe('account:Alpha')
      legendButton('Alpha').focus()
      await user.keyboard(' ')
      expect(scopeOf()).toBe('portfolio:p1')
      await user.click(screen.getByRole('button', { name: 'Swing' }))
      expect(scopeOf()).toBe('all')
    })

    it('lets a selected account folded into Other step back through Other', () => {
      const many = ['70', '60', '50', '40', '30', '20', '10'].map((v, i) => account(`a${i}`, 'p1', v))
      render(<Harness initial="account:a6" list={many} />)
      const other = screen.getByRole('button', { name: 'Show allocation for Other (2)' })
      expect(other).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByText(/^Other \(2\):/))
      expect(scopeOf()).toBe('portfolio:p1')
      // Without a selection Other is not an action: it holds several accounts and has no scope of its own.
      expect(screen.queryByRole('button', { name: 'Show allocation for Other (2)' })).not.toBeInTheDocument()
    })
  })

  it('renders nothing without enabled accounts', () => {
    const { container } = render(<OverviewAllocation accounts={[account('Off', 'p1', '1', false)]} portfolios={portfolios} scope="all" onScope={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
