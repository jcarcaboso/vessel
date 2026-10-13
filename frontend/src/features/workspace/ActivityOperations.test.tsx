import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityDocument, ActivityOperation } from '@/api/activity'
import type { WorkspaceApi } from '@/api/workspace'
import { activityFixture, activityFillFixture, operationFixture } from '@/test/activity-fixture'
import { accountFixture, portfolioFixture } from '@/test/workspace-fixture'
import { ActivityOperations } from './ActivityOperations'
import { OperationsTable } from './OperationsTable'
import { ActivityTable } from './ActivityTable'
import { sideDirection, resultSign } from './activity-format'
import { emptyFilters, filterOperations } from './activity-filters'

const client = (activity = vi.fn().mockResolvedValue(activityFixture)) => ({ activity }) as unknown as WorkspaceApi
const closed: ActivityOperation = { ...operationFixture, id: '22345678-1234-1234-1234-123456789abc:short', direction: 'short', status: 'closed',
  closedAtUtc: '2026-10-12T12:00:00Z', lastOccurredAtUtc: '2026-10-12T12:00:00Z', openQuantity: '0', totalExitedQuantity: '2',
  averageExitPrice: '99', netResultUsd: '2', exitOrderCount: 1 }

describe('operation table', () => {
  it('renders a round trip as one row, colours Long and expands its constituent fills accessibly', async () => {
    render(<OperationsTable operations={[operationFixture]} accounts={[accountFixture]} />)
    expect(screen.getByText('Long')).toHaveClass('long')
    expect(screen.getByText('-$0.01')).toHaveClass('negative')
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByTitle('100.123456789123456789')).toHaveTextContent('$100.12')
    const button = screen.getByRole('button', { name: 'Expand BTC operation' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(button)
    expect(screen.getByRole('button', { name: 'Collapse BTC operation' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('columnheader', { name: 'Side' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Orders/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/constituent fills/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse BTC operation' }))
    expect(screen.queryByRole('columnheader', { name: 'Side' })).not.toBeInTheDocument()
  })
  it('shows Short, positive results, elapsed duration and coverage when expanded', async () => {
    render(<OperationsTable operations={[{ ...closed, coverage: ['Snapshot disagrees.'], omittedFillCount: 10 }]} accounts={[accountFixture]} />)
    expect(screen.getByText('Short')).toHaveClass('short')
    expect(screen.getByText('$2.00')).toHaveClass('positive')
    expect(screen.getByText('2h')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand BTC operation' }))
    expect(screen.getByText('Snapshot disagrees.')).toBeInTheDocument()
    expect(screen.getByText(/Some execution rows are not shown/)).toBeInTheDocument()
  })
  it('shows direction and known exits when snapshot anchoring finds missing entries', async () => {
    const missing: ActivityOperation = { ...closed, status: 'incomplete', openedAtUtc: null, quantity: null,
      totalEnteredQuantity: null, averageEntryPrice: null, coverage: ['Opening entries are missing.'] }
    render(<OperationsTable operations={[missing]} accounts={[accountFixture]} />)
    expect(screen.getByText('Short')).toHaveClass('short')
    expect(screen.getByText('Opened unknown')).toBeInTheDocument()
    expect(screen.getByText('Exited 2')).toBeInTheDocument()
    expect(screen.getByTitle('99')).toHaveTextContent('$99.00')
    expect(screen.getByText('incomplete')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand BTC operation' }))
    expect(screen.getByText('Opening entries are missing.')).toBeInTheDocument()
  })
  it('hides disabled account operations even if an earlier response includes them', () => {
    render(<OperationsTable operations={[operationFixture]} accounts={[{ ...accountFixture, isEnabled: false }]} />)
    expect(screen.getByText('No operations in this view')).toBeInTheDocument()
    expect(screen.queryByText('BTC')).not.toBeInTheDocument()
  })
  it('also hides stale fill-level facts for disabled accounts', () => {
    render(<ActivityTable fills={[activityFillFixture]} accounts={[{ ...accountFixture, isEnabled: false }]} />)
    expect(screen.queryByText('BTC')).not.toBeInTheDocument()
    expect(screen.getByText('No imported executions yet')).toBeInTheDocument()
  })
  it('shows original flip facts separately from their operation allocation', async () => {
    const fill = { ...activityFillFixture, positionEffect: 'flip', side: 'sell', quantity: '5', fee: '0.5', closedPnlUsd: '10' }
    render(<OperationsTable operations={[{ ...operationFixture, fills: [{ fill, role: 'exit', quantity: '2', fee: '0.5', closedPnlUsd: '10' }] }]} accounts={[accountFixture]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Expand BTC operation' }))
    expect(screen.getByText('Original flip facts')).toBeInTheDocument()
    expect(screen.getByText(/Flip rows show this operation's allocated quantity/)).toBeInTheDocument()
    expect(screen.getAllByText('Short')).toHaveLength(2)
    for (const badge of screen.getAllByText('Short')) expect(badge).toHaveClass('short')
  })
  it('labels each execution by its own side, without repeating instrument, account or venue wording', () => {
    render(<ActivityTable fills={[{ ...activityFillFixture, id: 'open', side: 'buy', positionEffect: 'open' },
      { ...activityFillFixture, id: 'close', side: 'sell', positionEffect: 'close', direction: 'Close Long' }]} accounts={[accountFixture]} />)
    expect(screen.getByText('Long')).toHaveClass('long')
    expect(screen.getByText('Short')).toHaveClass('short')
    expect(screen.queryByText('Close Long')).not.toBeInTheDocument()
    expect(screen.queryByText('BTC')).not.toBeInTheDocument()
    expect(screen.queryByText(accountFixture.name)).not.toBeInTheDocument()
    expect(sideDirection({ ...activityFillFixture, side: 'buy', positionEffect: 'close' })).toBe('long')
    expect(sideDirection({ ...activityFillFixture, side: 'sell', positionEffect: 'unknown' })).toBe('short')
  })
  it('never claims there are no executions when the response omits all constituent rows', async () => {
    render(<OperationsTable operations={[{ ...operationFixture, fills: [], omittedFillCount: 1 }]} accounts={[accountFixture]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Expand BTC operation' }))
    expect(screen.getByText('Execution rows were omitted by the response limit.')).toBeInTheDocument()
    expect(screen.queryByText('No imported executions yet')).not.toBeInTheDocument()
  })
  it('classifies tiny and huge result signs without binary floating point', () => {
    expect(resultSign('-0.0000000000000000000000000001')).toBe('negative')
    expect(resultSign('999999999999999999999999999999.1')).toBe('positive')
    expect(resultSign('-0.0000')).toBe('neutral')
    expect(resultSign(null)).toBe('neutral')
  })
})

describe('activity loading and filters', () => {
  it.each(['portfolio', 'disabled account', 'deleted account', 'instrument'])('validates a disappeared %s selection against the displayed options', async kind => {
    const other = { ...accountFixture, id: 'other', name: 'Other', portfolioId: null }
    const eth = { ...closed, id: 'eth', contractId: 'ETH', accountId: other.id }
    const activity = vi.fn().mockResolvedValue({ ...activityFixture, operations: [operationFixture, eth] })
    const api = client(activity)
    const view = render(<ActivityOperations api={api} accounts={[accountFixture, other]} portfolios={[portfolioFixture]} filters />)
    await screen.findByText(/Showing 2 of 2/)
    const label = kind === 'portfolio' ? 'Portfolio' : kind === 'instrument' ? 'Instrument' : 'Account'
    await userEvent.selectOptions(screen.getByRole('combobox', { name: label }),
      kind === 'portfolio' ? portfolioFixture.id : kind === 'instrument' ? 'ETH' : other.id)
    activity.mockResolvedValue({ ...activityFixture, operations: [operationFixture] })
    view.rerender(<ActivityOperations api={api}
      accounts={kind === 'disabled account' ? [accountFixture, { ...other, isEnabled: false }] : kind === 'deleted account' ? [accountFixture] :
        kind === 'portfolio' ? [{ ...accountFixture, portfolioId: null }, other] : [accountFixture, other]}
      portfolios={kind === 'portfolio' ? [] : [portfolioFixture]} filters reloadGeneration={1} />)
    await screen.findByText(/Showing 1 of 1/)
    expect(screen.getByRole('combobox', { name: label })).toHaveValue('')
    expect(within(screen.getByRole('table')).getByText('BTC')).toBeInTheDocument()
  })
  it('advances the rolling date window when Reload accepts fresh activity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
      const api = client(vi.fn().mockResolvedValue({ ...activityFixture, operations: [closed] }))
      const view = render(<ActivityOperations api={api} accounts={[accountFixture]} filters />)
      await screen.findByText(/Showing 1 of 1/)
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period' }), '7')
      vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
      view.rerender(<ActivityOperations api={api} accounts={[accountFixture]} filters reloadGeneration={1} />)
      await screen.findByText(/Showing 0 of 1/)
      expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('7')
    } finally { vi.useRealTimers() }
  })
  it('filters account, portfolio, instrument, direction and status with labelled controls and reset', async () => {
    const otherAccount = { ...accountFixture, id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Other account', portfolioId: null }
    const eth = { ...closed, contractId: 'ETH', accountId: otherAccount.id }
    const document = { ...activityFixture, operations: [operationFixture, eth], totalOperationCount: 2 }
    render(<ActivityOperations api={client(vi.fn().mockResolvedValue(document))} accounts={[accountFixture, otherAccount]} portfolios={[portfolioFixture]} filters />)
    await screen.findByText(/Showing 2 of 2/)
    const cases: [string, string][] = [['Account', otherAccount.id], ['Portfolio', 'unassigned'], ['Instrument', 'ETH'], ['Direction', 'short'], ['Status', 'closed']]
    for (const [label, value] of cases) {
      await userEvent.selectOptions(screen.getByRole('combobox', { name: label }), value!)
      expect(screen.getByText(/Showing 1 of 2/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
      expect(screen.getByText(/Showing 2 of 2/)).toBeInTheDocument()
    }
  })
  it('filters inclusive UTC date ranges using latest activity, not only opening date', async () => {
    const from = '2026-10-12', to = '2026-10-12', op = { ...closed, openedAtUtc: '2026-09-01T00:00:00Z' }
    expect(filterOperations([op], [accountFixture], { ...emptyFilters, period: 'custom', from, to }, 0)).toHaveLength(1)
    expect(filterOperations([op], [accountFixture], { ...emptyFilters, period: 'custom', from: '2026-10-13', to }, 0)).toHaveLength(0)
    expect(filterOperations([op], [accountFixture], { ...emptyFilters, period: '7' }, Date.parse('2026-10-20T12:00:00Z'))).toHaveLength(0)
    render(<ActivityOperations api={client()} accounts={[accountFixture]} filters />)
    await screen.findByText(/Showing 1 of 1/)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'custom')
    expect(screen.getByLabelText('From date')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('Through date')).toBeInTheDocument()
  })
  it('shows only the latest five operations in compact Overview mode', async () => {
    const operations = Array.from({ length: 6 }, (_, n) => ({ ...operationFixture, id: `${n}:long`, contractId: `CONTRACT-${n}` }))
    render(<ActivityOperations api={client(vi.fn().mockResolvedValue({ ...activityFixture, operations, totalOperationCount: 6 }))} accounts={[accountFixture]} compact />)
    expect(await screen.findByText('CONTRACT-4')).toBeInTheDocument()
    expect(screen.queryByText('CONTRACT-5')).not.toBeInTheDocument()
    expect(screen.getByText(/Showing 5 of 6/)).toBeInTheDocument()
  })
  it('reports loading, failure and retry without falling back to overview fills', async () => {
    const activity = vi.fn().mockRejectedValueOnce(new Error('outage')).mockResolvedValue(activityFixture)
    render(<ActivityOperations api={client(activity)} accounts={[accountFixture]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading operations')
    expect(await screen.findByRole('alert')).toHaveTextContent('Operations could not be loaded')
    await userEvent.click(screen.getByRole('button', { name: 'Retry operations' }))
    expect(await screen.findByText('BTC')).toBeInTheDocument()
    expect(activity).toHaveBeenCalledTimes(2)
  })
  it('discards late results from the previous account and aborts its request', async () => {
    let finish!: (document: ActivityDocument) => void
    const activity = vi.fn().mockImplementationOnce(() => new Promise<ActivityDocument>(resolve => { finish = resolve })).mockResolvedValue({ ...activityFixture, operations: [], totalOperationCount: 0 })
    const api = client(activity)
    const view = render(<ActivityOperations api={api} accounts={[accountFixture]} accountId="first" />)
    view.rerender(<ActivityOperations api={api} accounts={[accountFixture]} accountId="second" />)
    await screen.findByText('No operations in this view')
    expect((activity.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
    finish(activityFixture)
    await waitFor(() => expect(screen.queryByText('BTC')).not.toBeInTheDocument())
  })
  it('shows operation omissions and account coverage explicitly', async () => {
    const document = { ...activityFixture, omittedOperationCount: 20, totalOperationCount: 21, coverage: [{ accountId: accountFixture.id, contractId: 'BTC', notice: 'Snapshot mismatch.' }] }
    render(<ActivityOperations api={client(vi.fn().mockResolvedValue(document))} accounts={[accountFixture]} />)
    expect(await screen.findByText(/20 older operations omitted/)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Scope and coverage'))
    expect(screen.getByText(/Snapshot mismatch/)).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2)
  })
})
