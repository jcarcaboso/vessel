import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverviewQuery, OverviewSummaryDocument } from '@/api/overview-summary'
import { createWorkspaceApi, type Overview } from '@/api/workspace'
import { accountFixture, overviewFixture, portfolioFixture, savedPlayFixture } from '@/test/workspace-fixture'
import { overviewSummaryFixture, summaryTotals } from '@/test/overview-summary-fixture'
import { activityFixture, operationFixture } from '@/test/activity-fixture'
import { systemFixture } from '@/test/system-fixture'
import { ApplicationShell } from './ApplicationShell'
import { overviewAccounts, resolveOverviewScope } from './overview-scope'
import { OverviewScope } from './OverviewScope'

const other = { ...accountFixture, id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', name: 'Other account', portfolioId: null, balanceUsd: '20' }
const main = { ...accountFixture, balanceUsd: '10' }
const overview: Overview = { ...overviewFixture, accounts: [main, other] }
function scopedSummary(query: OverviewQuery): OverviewSummaryDocument {
  const selected = overviewAccounts(query.scope, overview.accounts)
  const balance = selected.length === 2 ? '30' : selected[0]?.id === main.id ? '10' : '20'
  const document = overviewSummaryFixture(query); document.totals = summaryTotals(balance, selected.length)
  document.rows = selected.map(a => ({ id: query.groupBy === 'account' ? `account:${a.id}` : a.portfolioId ? `portfolio:${a.portfolioId}` : 'unassigned',
    name: query.groupBy === 'account' ? a.name : a.portfolioId ? portfolioFixture.name : 'Unassigned', icon: query.groupBy === 'portfolio' ? 'folder' : null,
    venueId: query.groupBy === 'account' ? a.venueId : null, totals: summaryTotals(a.balanceUsd!), shareOfBalance: { numerator: a.balanceUsd!, denominator: balance } }))
  document.totalGroupCount = document.rows.length
  return document
}
function client() {
  return { ...createWorkspaceApi('test'), overview: vi.fn().mockResolvedValue(overview), overviewSummary: vi.fn(async (q: OverviewQuery) => scopedSummary(q)),
    activity: vi.fn().mockResolvedValue({ ...activityFixture, operations: [operationFixture, { ...operationFixture, id: 'other-op', accountId: other.id, contractId: 'ETH' }], totalOperationCount: 2 }),
    plays: vi.fn().mockResolvedValue([ { ...savedPlayFixture.summary, title: 'Main play' }, { ...savedPlayFixture.summary, id: 'other-play', title: 'Other play', accountId: other.id } ]) }
}
beforeEach(() => { window.history.replaceState(null, '', '/') })
describe('Overview scope', () => {
  it('selects portfolio, unassigned and individual-account scope for totals, activity and Plays', async () => {
    const api = client()
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api} />)
    await screen.findByRole('table', { name: 'Overview summary by portfolio' })
    const metrics = screen.getByRole('region', { name: 'Scoped overview totals' })
    expect(within(metrics).getByText('$30.00')).toBeInTheDocument()
    const plays = screen.getByRole('region', { name: 'Plays overview' })
    await within(plays).findByRole('button', { name: 'Open Other play' })
    const recent = screen.getByRole('heading', { name: 'Recent activity' }).closest('section')!
    await within(recent).findByText('ETH')
    const scope = screen.getByLabelText('Overview scope')
    fireEvent.change(scope, { target: { value: `portfolio:${portfolioFixture.id}` } })
    await waitFor(() => expect(within(metrics).getByText('$10.00')).toBeInTheDocument())
    expect(within(recent).queryByText('ETH')).not.toBeInTheDocument()
    expect(within(plays).queryByRole('button', { name: 'Open Other play' })).not.toBeInTheDocument()
    fireEvent.change(scope, { target: { value: 'unassigned' } })
    await waitFor(() => expect(within(metrics).getByText('$20.00')).toBeInTheDocument())
    expect(within(recent).queryByText('BTC')).not.toBeInTheDocument()
    expect(within(plays).queryByRole('button', { name: 'Open Main play' })).not.toBeInTheDocument()
    fireEvent.change(scope, { target: { value: `account:${main.id}` } })
    await waitFor(() => expect(api.activity).toHaveBeenCalledWith(main.id, expect.any(AbortSignal)))
    await waitFor(() => expect(within(metrics).getByText('$10.00')).toBeInTheDocument())
    expect(within(recent).queryByText('ETH')).not.toBeInTheDocument()
  })
  it('reloads the summary once per common generation when scope remains valid', async () => {
    const api = client()
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api} />)
    await screen.findByRole('table', { name: 'Overview summary by portfolio' })
    expect(api.overviewSummary).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled())
    await screen.findByRole('table', { name: 'Overview summary by portfolio' })
    expect(api.overviewSummary).toHaveBeenCalledTimes(2)
  })
  it('keeps grouping, period and row-selected scope in shell memory across navigation', async () => {
    const api = client()
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Scope overview to Unassigned' }))
    fireEvent.click(screen.getByRole('button', { name: 'By account' }))
    fireEvent.change(screen.getByLabelText('Result period'), { target: { value: '7' } })
    await waitFor(() => expect(api.overviewSummary).toHaveBeenLastCalledWith({ groupBy: 'account', period: '7', scope: 'unassigned' }, expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }))
    await screen.findByRole('heading', { name: 'Settings', level: 1 })
    fireEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await screen.findByRole('table', { name: 'Overview summary by account' })
    expect(screen.getByLabelText('Overview scope')).toHaveValue('unassigned')
    expect(screen.getByLabelText('Result period')).toHaveValue('7')
    expect(screen.getByRole('button', { name: 'By account' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Scope overview to Other account' }))
    await waitFor(() => expect(screen.getByLabelText('Overview scope')).toHaveValue(`account:${other.id}`))
  })
  it.each(['account', 'portfolio', 'unassigned'])('falls back permanently to All when %s scope disappears after reload', async kind => {
    const api = client()
    render(<ApplicationShell system={systemFixture} disconnect={vi.fn()} api={api} />)
    const control = await screen.findByLabelText('Overview scope')
    const scope = kind === 'account' ? `account:${main.id}` : kind === 'portfolio' ? `portfolio:${portfolioFixture.id}` : 'unassigned'
    fireEvent.change(control, { target: { value: scope } })
    await waitFor(() => expect(api.overviewSummary).toHaveBeenLastCalledWith(expect.objectContaining({ scope }), expect.any(AbortSignal)))
    api.overview.mockResolvedValue(kind === 'account' ? { ...overview, accounts: [{ ...main, isEnabled: false }, other] } :
      kind === 'portfolio' ? { ...overview, portfolios: [], accounts: [other] } : { ...overview, accounts: [main] })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(control).toHaveValue('all'))
    api.overview.mockResolvedValue(overview)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(3))
    expect(control).toHaveValue('all')
  })
  it('labels the select, excludes disabled accounts and only shows Unassigned when enabled members exist', () => {
    const disabled = { ...other, isEnabled: false }
    render(<OverviewScope scope="all" onScope={vi.fn()} accounts={[main, disabled]} portfolios={[portfolioFixture]} />)
    expect(screen.getByRole('combobox', { name: 'Overview scope' })).toHaveValue('all')
    expect(screen.queryByRole('option', { name: 'Unassigned' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Other account' })).not.toBeInTheDocument()
    expect(resolveOverviewScope(`account:${other.id}`, [main, disabled], [portfolioFixture])).toBe('all')
    expect(resolveOverviewScope(`portfolio:${portfolioFixture.id}`, [], [portfolioFixture])).toBe(`portfolio:${portfolioFixture.id}`)
    expect(overviewAccounts('unassigned', [main, other, disabled])).toEqual([other])
  })
})
