import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PortfolioReview } from './PortfolioReview'

describe('portfolio review design preview', () => {
  it('marks the data as synthetic and supports period and chart switches', async () => {
    const user = userEvent.setup()
    render(<PortfolioReview />)
    expect(screen.getByText('Mock data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Month: Last 30 days' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '7D: Last 7 days' }))
    expect(screen.getByRole('button', { name: '7D: Last 7 days' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Daily' }))
    expect(screen.getByRole('img', { name: /daily closed-play/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Drawdown' }))
    expect(screen.getByRole('img', { name: /drawdown closed-play/ })).toBeInTheDocument()
  })

  it('resets an incompatible account when changing portfolio and permits a clean reset', async () => {
    const user = userEvent.setup()
    render(<PortfolioReview />)
    await user.selectOptions(screen.getByLabelText('Account'), 'core')
    await user.selectOptions(screen.getByLabelText('Portfolio'), 'intraday')
    expect(screen.getByLabelText('Account')).toHaveValue('all')
    expect(within(screen.getByLabelText('Account')).queryByRole('option', { name: 'Main account' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByLabelText('Portfolio')).toHaveValue('all')
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('supports asset and account breakdowns and contributing Play inspection', async () => {
    const user = userEvent.setup()
    render(<PortfolioReview />)
    await user.click(screen.getByRole('button', { name: 'Assets' }))
    await user.click(screen.getByRole('button', { name: 'Inspect BTC' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'BTC' })).toBeInTheDocument()
    expect(within(dialog).getByText(/closed Plays · mock data/)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inspect BTC' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Accounts' }))
    expect(screen.getByRole('button', { name: 'Inspect Main account' })).toBeInTheDocument()
  })

  it('explains missing risk for imports and keeps the methodology available', async () => {
    const user = userEvent.setup()
    render(<PortfolioReview />)
    await user.selectOptions(screen.getByLabelText('Play origin'), 'imported')
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Definitions' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Missing risk stays unknown/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Scratches are shown separately/)).toBeInTheDocument()
  })

  it('renders an empty sample with N/A, not invented performance', () => {
    render(<PortfolioReview />)
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'satellite' } })
    fireEvent.change(screen.getByLabelText('Asset'), { target: { value: 'HYPE' } })
    expect(screen.getByText('No closed Plays in this selection')).toBeInTheDocument()
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(4)
  })

  it('keeps coverage details on demand without repeated helper text', async () => {
    const user = userEvent.setup()
    render(<PortfolioReview />)
    expect(screen.queryByText('Know what works. See where the losses come from.')).not.toBeInTheDocument()
    expect(screen.queryByText('Total winning P&L / losing P&L')).not.toBeInTheDocument()
    expect(screen.queryByText('A result is only as good as its record.')).not.toBeInTheDocument()
    const details = screen.getByLabelText('Data coverage').querySelector('details')!
    expect(details.open).toBe(false)
    await user.click(within(details).getByText(/scored ·.*excluded ·.*reviewed/))
    expect(details.open).toBe(true)
    expect(within(details).getByText(/unresolved imports.*incomplete fees/)).toBeVisible()
  })
})
