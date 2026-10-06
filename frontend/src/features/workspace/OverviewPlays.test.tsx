import { StrictMode } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import { render } from '@/test/render'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { isPlaySummary, type PlaySummary } from '@/api/plays'
import { createWorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { accountFixture, savedPlayFixture } from '@/test/workspace-fixture'
import { OverviewPlays } from './OverviewPlays'

const summary = (status: PlaySummary['status'], hasReview = false): PlaySummary => ({
  ...savedPlayFixture.summary, id: status, title: `${status} idea`, status, hasReview,
})
const plays = ['draft', 'planned', 'paused', 'open', 'closed', 'cancelled'].map(status => summary(status as PlaySummary['status']))
const api = (read = vi.fn().mockResolvedValue(plays)) => ({ ...createWorkspaceApi('test-only'), plays: read })
const props = { accounts: [accountFixture], reloadGeneration: 0, onBrowse: vi.fn(), onOpen: vi.fn().mockResolvedValue(undefined) }

describe('Overview plays', () => {
  it('filters lifecycle independently from saved review presence and shows counts', async () => {
    const reviewed = { ...summary('closed', true), id: 'reviewed', title: 'Reviewed idea' }
    render(<OverviewPlays {...props} api={api(vi.fn().mockResolvedValue([...plays, reviewed]))} />)
    await screen.findByRole('button', { name: 'Open open idea' })
    expect(screen.getByRole('tab', { name: 'In progress 4' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Needs review 2' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All 7' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Open .* idea$/ })).toHaveLength(4)
    await userEvent.click(screen.getByRole('tab', { name: 'Needs review 2' }))
    expect(screen.getAllByRole('button', { name: /^Open .* idea$/ })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Open cancelled idea' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Reviewed idea' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'All 7' }))
    expect(screen.getByRole('button', { name: 'Open Reviewed idea' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })
  it('labels venue instruments with the venue quote asset and keeps manual labels', async () => {
    const venue = { ...summary('open'), venueId: 'hyperliquid', instrumentSource: 'venue' as const }
    render(<OverviewPlays {...props} api={api(vi.fn().mockResolvedValue([venue, summary('draft')]))} />)
    expect(within(await screen.findByRole('button', { name: 'Open open idea' })).getByText(/^BTC\/USDC · /)).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Open draft idea' })).getByText(/^BTC · /)).toBeInTheDocument()
  })
  it('orders by actual update time and supports keyboard tab navigation', async () => {
    const newer = { ...summary('open'), updatedAtUtc: '2026-10-05T12:00:00Z' }
    const older = { ...summary('draft'), updatedAtUtc: '2026-10-05T13:00:00+02:00' }
    render(<OverviewPlays {...props} api={api(vi.fn().mockResolvedValue([older, newer]))} />)
    await screen.findByRole('button', { name: 'Open open idea' })
    expect(within(screen.getAllByRole('listitem')[0]!).getByText('open idea')).toBeInTheDocument()
    screen.getByRole('tab', { name: 'In progress 2' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Needs review 0' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('No plays waiting for review')).toBeInTheDocument()
  })
  it('uses honest loading, failure, retry and empty states without affecting accounts', async () => {
    let reject!: (error: Error) => void
    const read = vi.fn().mockImplementationOnce(() => new Promise((_, no) => { reject = no })).mockResolvedValue([])
    const browse = vi.fn()
    render(<OverviewPlays {...props} onBrowse={browse} api={api(read)} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading plays')
    expect(screen.queryByText('No plays in progress')).not.toBeInTheDocument()
    reject(new ApiError('unavailable', 'Play list unavailable.'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Play list unavailable.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No plays in progress')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open Plays' }))
    expect(browse).toHaveBeenCalledOnce()
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('refreshes on Reload and ignores stale or aborted reads', async () => {
    let resolve!: (value: PlaySummary[]) => void
    const read = vi.fn().mockImplementationOnce(() => new Promise(yes => { resolve = yes })).mockResolvedValue([summary('open')])
    const client = api(read)
    const { rerender, unmount } = render(<OverviewPlays {...props} api={client} />)
    const oldSignal = read.mock.calls[0]![0] as AbortSignal
    rerender(<OverviewPlays {...props} reloadGeneration={1} api={client} />)
    expect(oldSignal.aborted).toBe(true)
    await screen.findByRole('button', { name: 'Open open idea' })
    resolve([summary('draft')])
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open draft idea' })).not.toBeInTheDocument())
    unmount()
    expect((read.mock.calls[1]![0] as AbortSignal).aborted).toBe(true)
  })
  it('opens a play safely under StrictMode and reports opening failures', async () => {
    const open = vi.fn().mockRejectedValueOnce(new ApiError('http', 'Play is no longer available.', 404)).mockResolvedValue(undefined)
    render(<StrictMode><OverviewPlays {...props} onOpen={open} api={api()} /></StrictMode>)
    await userEvent.click(await screen.findByRole('button', { name: 'Open open idea' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Play is no longer available.')
    expect(open.mock.calls[0]![1].aborted).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Open open idea' }))
    expect(open).toHaveBeenLastCalledWith('open', expect.any(AbortSignal))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('cancels an in-flight opening when the panel is unmounted', async () => {
    const open = vi.fn<(id: string, signal: AbortSignal) => Promise<void>>(() => new Promise(() => {}))
    const { unmount } = render(<OverviewPlays {...props} onOpen={open} api={api()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Open open idea' }))
    const signal = open.mock.calls[0]![1] as AbortSignal
    expect(signal.aborted).toBe(false)
    expect(screen.getByRole('button', { name: 'Open draft idea' })).toBeDisabled()
    unmount()
    expect(signal.aborted).toBe(true)
  })
  it('requires a boolean review-presence field at the API boundary', () => {
    const valid = savedPlayFixture.summary
    expect(isPlaySummary(valid)).toBe(true)
    expect(isPlaySummary({ ...valid, hasReview: undefined })).toBe(false)
    expect(isPlaySummary({ ...valid, hasReview: 'false' })).toBe(false)
  })
})
