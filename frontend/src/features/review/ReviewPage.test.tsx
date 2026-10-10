import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApi } from '@/api/workspace'
import { defaultReviewQuery, type ReviewDocument } from '@/api/review'
import { emptyReview, reviewFixture } from '@/test/review-fixture'
import { ReviewPage } from './ReviewPage'

function setup(review = vi.fn().mockResolvedValue(reviewFixture)) {
  const api = { ...createWorkspaceApi('test'), review }
  const open = vi.fn().mockResolvedValue(undefined)
  const view = render(<ReviewPage api={api} reloadGeneration={0} onOpenPlay={open} />)
  return { review, open, user: userEvent.setup(), ...view }
}

describe('Production portfolio review', () => {
  it('renders server statistics and discloses coverage without proposal-only labels', async () => {
    const { user } = setup()
    expect(await screen.findByRole('region', { name: 'Performance scorecard' })).toBeVisible()
    expect(screen.getByText('Batting average')).toBeVisible()
    expect(screen.queryByLabelText('Play origin')).not.toBeInTheDocument()
    await user.click(screen.getByText('3 scored · 2 excluded · 1 reviewed'))
    expect(screen.getByText(/12 unassigned fills/)).toBeVisible()
    expect(screen.getByText('Recent history only.')).toBeVisible()
    await user.click(screen.getByText('Chart data'))
    expect(screen.getByRole('table', { name: /Chart values/ })).toBeVisible()
  })
  it('shows honest empty results without falling back to demo performance', async () => {
    setup(vi.fn().mockResolvedValue(emptyReview))
    expect(await screen.findByText('No scored closed Plays')).toBeVisible()
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(5)
    expect(screen.queryByText('BTC')).not.toBeInTheDocument()
  })
  it('supports filters, clears account on portfolio change and keeps period on reset', async () => {
    const { review, user } = setup()
    await screen.findByRole('button', { name: 'Last 7 days' })
    await user.selectOptions(screen.getByLabelText('Account'), reviewFixture.options.accounts[0]!.id)
    await waitFor(() => expect(review).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: reviewFixture.options.accounts[0]!.id }), expect.any(AbortSignal)))
    await user.selectOptions(screen.getByLabelText('Portfolio'), 'unassigned')
    await waitFor(() => expect(review).toHaveBeenLastCalledWith({ period: 'month', portfolio: 'unassigned' }, expect.any(AbortSignal)))
    await user.click(await screen.findByRole('button', { name: 'Last 7 days' }))
    await waitFor(() => expect(review).toHaveBeenLastCalledWith({ period: 'week', portfolio: 'unassigned' }, expect.any(AbortSignal)))
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(review).toHaveBeenLastCalledWith({ period: 'week', portfolio: 'all' }, expect.any(AbortSignal)))
  })
  it('aborts superseded requests and never displays a late old report as current', async () => {
    let oldResolve!: (report: ReviewDocument) => void
    const review = vi.fn().mockImplementationOnce(() => new Promise<ReviewDocument>(resolve => { oldResolve = resolve }))
      .mockResolvedValue(emptyReview)
    const { user } = setup(review)
    expect(screen.getByRole('status')).toHaveTextContent('Loading review')
    await user.selectOptions(screen.getByLabelText('Portfolio'), 'unassigned')
    expect(await screen.findByText('No scored closed Plays')).toBeVisible()
    expect((review.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
    await act(async () => { oldResolve(reviewFixture) })
    expect(screen.queryByText('BTC')).not.toBeInTheDocument()
  })
  it('retains the displayed asset scope when its option disappears on reload', async () => {
    const { user, review } = setup()
    await screen.findByRole('button', { name: 'Last 30 days' })
    await user.selectOptions(screen.getByLabelText('Asset'), 'BTC')
    await screen.findByRole('button', { name: 'Last 30 days' })
    review.mockResolvedValue({ ...emptyReview, options: { ...reviewFixture.options, instruments: [] } })
    await user.click(screen.getByRole('button', { name: 'Reload review' }))
    expect(await screen.findByRole('option', { name: 'BTC · unavailable' })).toBeInTheDocument()
    expect(screen.getByLabelText('Asset')).toHaveValue('BTC')
    expect(review).toHaveBeenLastCalledWith(expect.objectContaining({ instrument: 'BTC' }), expect.any(AbortSignal))
  })
  it('retries errors and restores focus after definitions', async () => {
    const review = vi.fn().mockRejectedValueOnce(new Error('private transport detail')).mockResolvedValue(reviewFixture)
    const { user } = setup(review)
    expect(await screen.findByRole('alert')).toHaveTextContent('The review could not be loaded.')
    expect(screen.queryByText('private transport detail')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry review' }))
    await screen.findByRole('button', { name: 'Last 30 days' })
    const trigger = screen.getByRole('button', { name: 'Definitions' })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toHaveTextContent('Unassigned fills are not scored Plays')
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })
  it('narrows drill-downs, paginates from server offsets and opens a saved Play', async () => {
    const review = vi.fn().mockResolvedValue({ ...reviewFixture, nextOffset: 50 })
    const { user, open } = setup(review)
    await screen.findByRole('button', { name: 'Inspect Swing trading' })
    await user.click(screen.getByRole('button', { name: 'Inspect Swing trading' }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByRole('button', { name: 'Open Play BTC breakout' })
    expect(review).toHaveBeenLastCalledWith({ ...defaultReviewQuery, portfolio: reviewFixture.options.portfolios[0]!.id, offset: 0 }, expect.any(AbortSignal))
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(review).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }), expect.any(AbortSignal)))
    await user.click(await within(dialog).findByRole('button', { name: 'Open Play BTC breakout' }))
    expect(open).toHaveBeenCalledWith(reviewFixture.plays[0]!.id, expect.any(AbortSignal))
  })
})
