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
    function Harness({ initial, list = accounts, outside = [] }: { initial: string; list?: BrokerAccount[]; outside?: string[] }) {
      const [scope, setScope] = useState(initial)
      // Changes made elsewhere on the page, such as the scope select, View all or a Summary row.
      return <><output aria-label="scope">{scope}</output>
        {outside.map(o => <button key={o} onClick={() => setScope(o)}>Elsewhere {o}</button>)}
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

    it('returns a selected portfolio, or Unassigned, to all accounts with the back arrow beside the heading', () => {
      const { unmount } = render(<Harness initial="portfolio:p1" />)
      // The heading is plain text again: no button inside it, and the arrow before it carries the destination.
      const heading = screen.getByRole('heading', { name: /^Swing\s*·\s*40\.00% of total$/ })
      expect(within(heading).queryByRole('button')).not.toBeInTheDocument()
      const back = screen.getByRole('button', { name: 'Back to all portfolios' })
      expect(back).toHaveAttribute('title', 'Back to all portfolios')
      expect(back).not.toHaveAttribute('aria-pressed')
      expect(heading.previousElementSibling).toBe(back)
      fireEvent.click(back)
      expect(scopeOf()).toBe('all')
      expect(screen.getByRole('img', { name: /^All accounts balance shares/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Back to/ })).not.toBeInTheDocument()
      unmount()
      render(<Harness initial="unassigned" list={withUnassigned} />)
      expect(within(screen.getByRole('heading', { name: /^Unassigned/ })).queryByRole('button')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Back to all portfolios' }))
      expect(scopeOf()).toBe('all')
    })

    it('returns an account to its portfolio, or to Unassigned, with the back arrow', () => {
      const { unmount } = render(<Harness initial="account:Beta" />)
      expect(within(screen.getByRole('heading', { name: /^Swing/ })).queryByRole('button')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Back to all portfolios' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Back to Swing' })).toHaveAttribute('title', 'Back to Swing')
      fireEvent.click(screen.getByRole('button', { name: 'Back to Swing' }))
      expect(scopeOf()).toBe('portfolio:p1')
      fireEvent.click(screen.getByRole('button', { name: 'Back to all portfolios' }))
      expect(scopeOf()).toBe('all')
      unmount()
      render(<Harness initial="account:Eps" list={withUnassigned} />)
      fireEvent.click(screen.getByRole('button', { name: 'Back to Unassigned' }))
      expect(scopeOf()).toBe('unassigned')
    })

    describe('going back to where the selection was made', () => {
      // Every group has two accounts except Solo's, which is a one-slice donut like the owner's Unassigned group.
      const solo = [...accounts.filter(a => a.id !== 'Delta'), account('Solo', null, '50')]
      const soloSlice = () => screen.getByText('Solo: $50.00 · 100.00%')

      it('returns to all accounts when a single-account group was opened from its small donut, by slice or by arrow', () => {
        render(<Harness initial="all" list={solo} />)
        fireEvent.click(soloSlice())
        expect(scopeOf()).toBe('account:Solo')
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toHaveAttribute('title', 'Back to all portfolios')
        // The same slice again goes back to where the owner came from, not to the account's own group.
        fireEvent.click(soloSlice())
        expect(scopeOf()).toBe('all')
        fireEvent.click(soloSlice())
        expect(scopeOf()).toBe('account:Solo')
        fireEvent.click(screen.getByRole('button', { name: 'Back to all portfolios' }))
        expect(scopeOf()).toBe('all')
        expect(screen.queryByRole('button', { name: /^Back to/ })).not.toBeInTheDocument()
      })

      it('returns to all accounts from an account chosen in a small donut with several accounts', () => {
        render(<Harness initial="all" />)
        const swing = within(screen.getByRole('article', { name: 'Swing' }))
        fireEvent.click(swing.getByText('Alpha: $300.00 · 75.00%'))
        expect(scopeOf()).toBe('account:Alpha')
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Back to Swing' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByText('Alpha: $300.00 · 75.00%'))
        expect(scopeOf()).toBe('all')
      })

      it('returns an account chosen from a selected portfolio to that portfolio, then that portfolio to all accounts', () => {
        render(<Harness initial="all" />)
        fireEvent.click(within(screen.getByRole('list', { name: 'All accounts shares' })).getByRole('button', { name: 'Show allocation for Swing' }))
        fireEvent.click(legendButton('Beta'))
        expect(scopeOf()).toBe('account:Beta')
        expect(screen.getByRole('button', { name: 'Back to Swing' })).toHaveAttribute('title', 'Back to Swing')
        fireEvent.click(screen.getByRole('button', { name: 'Back to Swing' }))
        expect(scopeOf()).toBe('portfolio:p1')
        fireEvent.click(screen.getByRole('button', { name: 'Back to all portfolios' }))
        expect(scopeOf()).toBe('all')
      })

      it('returns an account chosen under a portfolio that was itself picked outside the panel to that portfolio', () => {
        render(<Harness initial="portfolio:p1" />)
        fireEvent.click(legendButton('Alpha'))
        expect(scopeOf()).toBe('account:Alpha')
        fireEvent.click(screen.getByText('Alpha: $300.00 · 75.00%'))
        expect(scopeOf()).toBe('portfolio:p1')
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toBeInTheDocument()
      })

      it('keeps the origin while the selection moves from one account to its neighbour', () => {
        render(<Harness initial="all" />)
        fireEvent.click(within(screen.getByRole('article', { name: 'Swing' })).getByText('Alpha: $300.00 · 75.00%'))
        fireEvent.click(legendButton('Beta'))
        expect(scopeOf()).toBe('account:Beta')
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toBeInTheDocument()
        fireEvent.click(screen.getByText('Beta: $100.00 · 25.00%'))
        expect(scopeOf()).toBe('all')
      })

      it('goes one level up when the account was picked outside the panel', () => {
        render(<Harness initial="account:Beta" />)
        expect(screen.getByRole('button', { name: 'Back to Swing' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Back to Swing' }))
        expect(scopeOf()).toBe('portfolio:p1')
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toBeInTheDocument()
      })

      it('forgets the origin as soon as the scope is changed outside the panel, even when it returns to the same account', () => {
        render(<Harness initial="all" list={withUnassigned} outside={['portfolio:p2', 'account:Eps']} />)
        fireEvent.click(within(screen.getByRole('article', { name: 'Unassigned' })).getByText('Eps: $150.00 · 75.00%'))
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Elsewhere portfolio:p2' }))
        fireEvent.click(screen.getByRole('button', { name: 'Elsewhere account:Eps' }))
        expect(scopeOf()).toBe('account:Eps')
        expect(screen.getByRole('button', { name: 'Back to Unassigned' })).toBeInTheDocument()
        fireEvent.click(screen.getByText('Eps: $150.00 · 75.00%'))
        expect(scopeOf()).toBe('unassigned')
      })
    })

    describe('skipping a group that looks exactly like its only account', () => {
      // Unassigned holds only Solo, Core only Gamma (accounts above), so their group and account views are identical.
      const solo = [...accounts.filter(a => a.id !== 'Delta'), account('Solo', null, '50')]
      const soloSlice = () => screen.getByText('Solo: $50.00 · 100.00%')

      it('goes from the account straight back to all when Unassigned was entered from the select', () => {
        render(<Harness initial="unassigned" list={solo} />)
        fireEvent.click(soloSlice())
        expect(scopeOf()).toBe('account:Solo')
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toHaveAttribute('title', 'Back to all portfolios')
        fireEvent.click(soloSlice())
        expect(scopeOf()).toBe('all')
        expect(screen.queryByRole('button', { name: /^Back to/ })).not.toBeInTheDocument()
      })

      it('goes straight back to all by arrow when Unassigned was entered from its card heading', () => {
        render(<Harness initial="all" list={solo} />)
        fireEvent.click(within(screen.getByRole('article', { name: 'Unassigned' })).getByRole('button', { name: 'Show allocation for Unassigned' }))
        expect(scopeOf()).toBe('unassigned')
        fireEvent.click(soloSlice())
        expect(scopeOf()).toBe('account:Solo')
        fireEvent.click(screen.getByRole('button', { name: 'Back to all portfolios' }))
        expect(scopeOf()).toBe('all')
        // Going down again repeats the same path.
        fireEvent.click(within(screen.getByRole('article', { name: 'Unassigned' })).getByRole('button', { name: 'Show allocation for Unassigned' }))
        fireEvent.click(soloSlice())
        fireEvent.click(soloSlice())
        expect(scopeOf()).toBe('all')
      })

      it('does the same through the total legend, and when the account was picked outside the panel', () => {
        render(<Harness initial="all" list={solo} outside={['account:Solo']} />)
        fireEvent.click(within(screen.getByRole('list', { name: 'All accounts shares' })).getByRole('button', { name: 'Show allocation for Unassigned' }))
        fireEvent.click(soloSlice())
        fireEvent.click(soloSlice())
        expect(scopeOf()).toBe('all')
        fireEvent.click(screen.getByRole('button', { name: 'Elsewhere account:Solo' }))
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Back to all portfolios' }))
        expect(scopeOf()).toBe('all')
      })

      it('applies to any portfolio with one drawn account, from every entry point', () => {
        const { unmount } = render(<Harness initial="portfolio:p2" />)
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toBeInTheDocument()
        fireEvent.click(screen.getByText('Gamma: $600.00 · 100.00%'))
        expect(scopeOf()).toBe('account:Gamma')
        fireEvent.click(screen.getByText('Gamma: $600.00 · 100.00%'))
        expect(scopeOf()).toBe('all')
        unmount()
        render(<Harness initial="all" />)
        fireEvent.click(within(screen.getByRole('article', { name: 'Core' })).getByText('Gamma: $600.00 · 100.00%'))
        expect(scopeOf()).toBe('account:Gamma')
        fireEvent.click(screen.getByRole('button', { name: 'Back to all portfolios' }))
        expect(scopeOf()).toBe('all')
      })

      it('also skips a group where the account is the only one drawn, since its view is the same', () => {
        const partly = [account('Alpha', 'p1', '300'), account('Zed', 'p1', null)]
        render(<Harness initial="portfolio:p1" list={partly} />)
        fireEvent.click(screen.getByRole('button', { name: 'Show allocation for Alpha' }))
        expect(scopeOf()).toBe('account:Alpha')
        fireEvent.click(screen.getByRole('button', { name: 'Show allocation for Alpha' }))
        expect(scopeOf()).toBe('all')
      })

      it('keeps the group level for groups with several drawn accounts and for an undrawn selected account', () => {
        const { unmount } = render(<Harness initial="unassigned" list={withUnassigned} />)
        fireEvent.click(screen.getByText('Eps: $150.00 · 75.00%'))
        expect(screen.getByRole('button', { name: 'Back to Unassigned' })).toBeInTheDocument()
        fireEvent.click(screen.getByText('Eps: $150.00 · 75.00%'))
        expect(scopeOf()).toBe('unassigned')
        unmount()
        // Zed has no balance, so its view differs from the group's drawn slice and Back keeps the group.
        const partly = [account('Alpha', 'p1', '300'), account('Zed', 'p1', null)]
        render(<Harness initial="account:Zed" list={partly} />)
        fireEvent.click(screen.getByRole('button', { name: 'Back to Swing' }))
        expect(scopeOf()).toBe('portfolio:p1')
      })

      it('keeps focus on a control that exists in the all view after skipping the group', async () => {
        const user = userEvent.setup()
        render(<Harness initial="unassigned" list={solo} />)
        within(screen.getByRole('list', { name: 'Unassigned shares' })).getByRole('button', { name: 'Show allocation for Solo' }).focus()
        await user.keyboard('{Enter}')
        expect(scopeOf()).toBe('account:Solo')
        await user.keyboard('{Enter}')
        expect(scopeOf()).toBe('all')
        expect(within(screen.getByRole('article', { name: 'Unassigned' })).getByRole('button', { name: 'Show allocation for Solo' })).toHaveFocus()
      })
    })

    it('keeps the back arrow when the group has nothing to draw', () => {
      render(<Harness initial="unassigned" />)
      expect(screen.getByText('No positive balance')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Back to all portfolios' }))
      expect(scopeOf()).toBe('all')
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
      // The donut is rebuilt on every scope change, but focus stays on the entity's own control.
      expect(legendButton('Beta')).toHaveFocus()
      legendButton('Alpha').focus()
      await user.keyboard(' ')
      expect(scopeOf()).toBe('account:Alpha')
      expect(legendButton('Alpha')).toHaveFocus()
      await user.keyboard(' ')
      expect(scopeOf()).toBe('portfolio:p1')
      expect(legendButton('Alpha')).toHaveFocus()
      screen.getByRole('button', { name: 'Back to all portfolios' }).focus()
      await user.keyboard('{Enter}')
      expect(scopeOf()).toBe('all')
    })

    describe('focus after a change made from inside the panel', () => {
      it('moves from a portfolio control to the back arrow, and back to that portfolio\'s control', async () => {
        const user = userEvent.setup()
        render(<Harness initial="all" />)
        const total = screen.getByRole('list', { name: 'All accounts shares' })
        within(total).getByRole('button', { name: 'Show allocation for Swing' }).focus()
        await user.keyboard('{Enter}')
        expect(scopeOf()).toBe('portfolio:p1')
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toHaveFocus()
        await user.keyboard('{Enter}')
        expect(scopeOf()).toBe('all')
        expect(within(screen.getByRole('list', { name: 'All accounts shares' })).getByRole('button', { name: 'Show allocation for Swing' })).toHaveFocus()
      })

      it('uses the portfolio card button when the portfolio was selected from its card', async () => {
        const user = userEvent.setup()
        render(<Harness initial="all" />)
        const card = within(screen.getByRole('article', { name: 'Core' })).getByRole('button', { name: 'Show allocation for Core' })
        card.focus()
        await user.keyboard('{Enter}')
        expect(scopeOf()).toBe('portfolio:p2')
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toHaveFocus()
      })

      it('keeps focus on the arrow while climbing from an account to its portfolio and then to all', async () => {
        const user = userEvent.setup()
        render(<Harness initial="account:Beta" />)
        screen.getByRole('button', { name: 'Back to Swing' }).focus()
        await user.keyboard('{Enter}')
        expect(scopeOf()).toBe('portfolio:p1')
        // The arrow stays in the same place with its new destination, so Enter can be repeated.
        expect(screen.getByRole('button', { name: 'Back to all portfolios' })).toHaveFocus()
        await user.keyboard('{Enter}')
        expect(scopeOf()).toBe('all')
        expect(within(screen.getByRole('list', { name: 'All accounts shares' })).getByRole('button', { name: 'Show allocation for Swing' })).toHaveFocus()
      })

      it('returns focus to the portfolio card when the portfolio has no slice in the total', async () => {
        const user = userEvent.setup()
        // Empty has no positive balance, so it is not a slice of the total and only its card offers a control.
        const none = [account('Solo', 'p3', null), account('Big', 'p1', '10')]
        render(<Harness initial="portfolio:p3" list={none} />)
        screen.getByRole('button', { name: 'Back to all portfolios' }).focus()
        await user.keyboard('{Enter}')
        expect(scopeOf()).toBe('all')
        expect(within(screen.getByRole('article', { name: 'Empty' })).getByRole('button', { name: 'Show allocation for Empty' })).toHaveFocus()
      })

      it('does not take focus when the scope changes from elsewhere, such as the scope select', () => {
        const panel = (scope: string) => <><button>Elsewhere</button><OverviewAllocation accounts={accounts} portfolios={portfolios} scope={scope} onScope={() => {}} /></>
        const { rerender } = render(panel('portfolio:p1'))
        // The parent ignores this activation, leaving a pending restore; focus then moves to another control.
        fireEvent.click(screen.getByRole('button', { name: 'Back to all portfolios' }))
        screen.getByRole('button', { name: 'Elsewhere' }).focus()
        rerender(panel('all'))
        expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
      })
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
