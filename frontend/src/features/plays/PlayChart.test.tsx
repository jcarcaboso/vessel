import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/system'
import { createWorkspaceApi, type CandleSeries, type WorkspaceApi } from '@/api/workspace'
import type { ChartAdapterFactory, ChartCallbacks, ChartCandle, PriceOverlay } from '@/components/chart/types'
import { accountFixture, candleSeriesFixture, marketContextFixture } from '@/test/workspace-fixture'
import { createEntry, type DraftEntry } from './draft'
import { ChartPanel } from './PlayChart'

function fakeAdapter() {
  const state = { candles: [] as readonly ChartCandle[], resets: [] as boolean[], overlays: [] as readonly PriceOverlay[], callbacks: null as ChartCallbacks | null, created: 0, destroyed: 0 }
  const factory: ChartAdapterFactory = (_container, callbacks) => {
    state.created++
    state.callbacks = callbacks
    return {
      setCandles(candles, reset) { state.candles = candles; state.resets.push(reset) },
      setOverlays(overlays) { state.overlays = overlays },
      destroy() { state.destroyed++ },
    }
  }
  return { state, factory }
}

function chartApi(candles: WorkspaceApi['candles'], marketContext: WorkspaceApi['marketContext'] = vi.fn().mockResolvedValue(marketContextFixture)) {
  return { ...createWorkspaceApi('test-only'), candles, marketContext }
}

beforeEach(() => localStorage.clear())

const entries = (): DraftEntry[] => [
  { ...createEntry(0), price: '101', stop: { id: 'stop-1', unit: 'price', value: '99' } },
  { ...createEntry(1), price: '100' },
]

describe('Chart panel', () => {
  it('keeps the placeholder without a market-data source and selects through the legend', async () => {
    const list = entries()
    const onSelect = vi.fn()
    const { rerender } = render(<ChartPanel entries={list} selectedId={list[0]!.id} instrument="ETH-PERP" onSelect={onSelect} />)
    const legend = screen.getByRole('group', { name: 'Planned entries' })
    await userEvent.click(within(legend).getByRole('button', { name: /Entry 2/ }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(list[1]!.id)
    rerender(<ChartPanel entries={list} selectedId={list[1]!.id} instrument="ETH-PERP" onSelect={onSelect} />)
    expect(within(legend).getByRole('button', { name: /Entry 2/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('No market data for this instrument')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand chart' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Capture chart' })).toBeDisabled()
    expect(screen.getByTestId('chart-panel').querySelector('canvas')).toBeNull()
  })

  it('does not invent an instrument or entries for an empty draft', () => {
    render(<ChartPanel entries={[]} selectedId="" instrument="" onSelect={vi.fn()} />)
    expect(screen.getByText('No perpetual instrument selected')).toBeInTheDocument()
    expect(screen.getByText('No planned entries.')).toBeInTheDocument()
  })

  it('loads venue candles, plots planned levels and maps level selection to the entry', async () => {
    const list = entries()
    const candles = vi.fn().mockResolvedValue(candleSeriesFixture)
    const { state, factory } = fakeAdapter()
    const onSelect = vi.fn()
    render(<ChartPanel entries={list} selectedId={list[0]!.id} instrument="BTC" venue="Hyperliquid" onSelect={onSelect}
      source={{ api: chartApi(candles), accountId: accountFixture.id }} createAdapter={factory} />)
    expect(await screen.findByText(/Updated .* UTC/)).toBeInTheDocument()
    expect(candles).toHaveBeenCalledWith(accountFixture.id, { instrument: 'BTC', interval: '1h' }, expect.any(AbortSignal))
    expect(state.candles).toEqual([
      { time: 1_790_000_000_000, open: 100.5, high: 102, low: 99.25, close: 101 },
      { time: 1_790_003_600_000, open: 101, high: 103.75, low: 100, close: 103 },
    ])
    expect(state.resets.at(-1)).toBe(true)
    expect(state.overlays.map(o => [o.label, o.draggable])).toEqual([['E1', true], ['E1 SL', true], ['E2', false]])
    expect(screen.getByText('Hyperliquid · 1 hour trade candles · UTC')).toBeInTheDocument()

    act(() => state.callbacks!.onLevelSelect(state.overlays[2]!.id))
    expect(onSelect).toHaveBeenCalledWith(list[1]!.id)
  })

  it('writes dragged levels back to the draft entries', async () => {
    const list = entries()
    const onEntriesChange = vi.fn()
    const { state, factory } = fakeAdapter()
    render(<ChartPanel entries={list} selectedId={list[0]!.id} instrument="BTC" onSelect={vi.fn()} onEntriesChange={onEntriesChange}
      source={{ api: chartApi(vi.fn().mockResolvedValue(candleSeriesFixture)), accountId: accountFixture.id }} createAdapter={factory} />)
    await screen.findByText(/Updated/)
    act(() => state.callbacks!.onLevelDrag(state.overlays[1]!.id, 97.123456, 'move'))
    expect(onEntriesChange).toHaveBeenLastCalledWith([{ ...list[0], stop: { id: 'stop-1', unit: 'price', value: '97.123' } }, list[1]])
  })

  it('switches between aggregate and selected views from the dropdown', async () => {
    const list = entries()
    const onSelect = vi.fn()
    const { state, factory } = fakeAdapter()
    render(<ChartPanel entries={list} selectedId={list[0]!.id} instrument="BTC" onSelect={onSelect}
      source={{ api: chartApi(vi.fn().mockResolvedValue(candleSeriesFixture)), accountId: accountFixture.id }} createAdapter={factory} />)
    await screen.findByText(/Updated/)
    await userEvent.click(screen.getByRole('button', { name: 'Chart view: Aggregate · All entries' }))
    await userEvent.click(screen.getByRole('button', { name: 'Entry 1' }))
    expect(onSelect).toHaveBeenCalledWith(list[0]!.id)
    expect(state.overlays.map(o => o.label)).toEqual(['E1', 'E1 SL'])
    await userEvent.click(screen.getByRole('button', { name: 'Chart view: Entry 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aggregate · All entries' }))
    expect(state.overlays.map(o => o.label)).toEqual(['E1', 'E1 SL', 'E2'])
  })

  it('reloads on timeframe change and refreshes manually without dropping loaded candles', async () => {
    const newer: CandleSeries = { ...candleSeriesFixture, interval: '4h', candles: [{ ...candleSeriesFixture.candles[1]!, close: '104' }], retrievedAt: '2026-10-01T12:05:00Z' }
    const candles = vi.fn()
      .mockResolvedValueOnce(candleSeriesFixture)
      .mockResolvedValueOnce({ ...candleSeriesFixture, interval: '4h' })
      .mockResolvedValueOnce(newer)
    const { state, factory } = fakeAdapter()
    render(<ChartPanel entries={entries()} selectedId="" instrument="BTC" onSelect={vi.fn()}
      source={{ api: chartApi(candles), accountId: accountFixture.id }} createAdapter={factory} />)
    await screen.findByText(/Updated/)
    await userEvent.click(within(screen.getByRole('group', { name: 'Timeframe' })).getByRole('button', { name: '4 hours' }))
    expect(candles).toHaveBeenLastCalledWith(accountFixture.id, { instrument: 'BTC', interval: '4h' }, expect.any(AbortSignal))
    await screen.findByText('4 hours trade candles · UTC')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await vi.waitFor(() => expect(state.candles.at(-1)!.close).toBe(104))
    expect(state.candles).toHaveLength(2)
    expect(state.resets.at(-1)).toBe(false)
  })

  it('loads older candles until the venue history is exhausted', async () => {
    const older: CandleSeries = { ...candleSeriesFixture, candles: [{ ...candleSeriesFixture.candles[0]!, openTime: 1_789_996_400_000, closeTime: 1_789_999_999_999 }] }
    const candles = vi.fn()
      .mockResolvedValueOnce(candleSeriesFixture)
      .mockResolvedValueOnce(older)
      .mockResolvedValueOnce({ ...candleSeriesFixture, candles: [], historyExhausted: true })
    const { state, factory } = fakeAdapter()
    render(<ChartPanel entries={entries()} selectedId="" instrument="BTC" onSelect={vi.fn()}
      source={{ api: chartApi(candles), accountId: accountFixture.id }} createAdapter={factory} />)
    await screen.findByText(/Updated/)
    act(() => state.callbacks!.onNeedOlder())
    await vi.waitFor(() => expect(state.candles).toHaveLength(3))
    expect(candles).toHaveBeenLastCalledWith(accountFixture.id, { instrument: 'BTC', interval: '1h', endTime: 1_789_999_999_999 }, expect.any(AbortSignal))
    act(() => state.callbacks!.onNeedOlder())
    expect(await screen.findByText(/Start of available venue history/)).toBeInTheDocument()
    act(() => state.callbacks!.onNeedOlder())
    expect(candles).toHaveBeenCalledTimes(3)
  })

  it('shows load failures with a retry and keeps previous candles when a refresh fails', async () => {
    const candles = vi.fn()
      .mockRejectedValueOnce(new ApiError('http', 'Venue candles are unavailable. Try refreshing the chart.', 502))
      .mockResolvedValueOnce(candleSeriesFixture)
      .mockRejectedValueOnce(new ApiError('unavailable', 'The request did not complete. Check the API and try again.'))
    const { state, factory } = fakeAdapter()
    render(<ChartPanel entries={entries()} selectedId="" instrument="BTC" onSelect={vi.fn()}
      source={{ api: chartApi(candles), accountId: accountFixture.id }} createAdapter={factory} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Venue candles are unavailable.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText(/Updated/)
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed: The request did not complete.')
    expect(state.candles).toHaveLength(2)
  })

  it('opens the same chart in an expanded dialog and restores focus on Escape', async () => {
    const { state, factory } = fakeAdapter()
    render(<ChartPanel entries={entries()} selectedId="" instrument="BTC" onSelect={vi.fn()}
      source={{ api: chartApi(vi.fn().mockResolvedValue(candleSeriesFixture)), accountId: accountFixture.id }} createAdapter={factory} />)
    await screen.findByText(/Updated/)
    const expand = screen.getByRole('button', { name: 'Expand chart' })
    await userEvent.click(expand)
    const dialog = screen.getByRole('dialog', { name: 'BTC chart' })
    expect(within(dialog).getByTestId('chart-dialog-body')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-body')).toBeNull()
    expect(state.created).toBe(2)
    expect(state.candles).toHaveLength(2)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand chart' })).toHaveFocus()
    expect(screen.getByTestId('chart-body')).toBeInTheDocument()
  })
})

describe('Chart panel refresh during older loading', () => {
  it('lets a manual refresh replace a pending older read without blocking later paging', async () => {
    let resolveOlder!: (value: CandleSeries) => void
    const candles = vi.fn()
      .mockResolvedValueOnce(candleSeriesFixture)
      .mockImplementationOnce(() => new Promise<CandleSeries>(resolve => { resolveOlder = resolve }))
      .mockResolvedValueOnce(candleSeriesFixture)
      .mockResolvedValueOnce({ ...candleSeriesFixture, candles: [], historyExhausted: true })
    const { state, factory } = fakeAdapter()
    render(<ChartPanel entries={entries()} selectedId="" instrument="BTC" onSelect={vi.fn()}
      source={{ api: chartApi(candles), accountId: accountFixture.id }} createAdapter={factory} />)
    await screen.findByText(/Updated/)
    act(() => state.callbacks!.onNeedOlder())
    expect(await screen.findByText('Loading older candles…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText(/Updated/)
    resolveOlder(candleSeriesFixture)
    act(() => state.callbacks!.onNeedOlder())
    await vi.waitFor(() => expect(candles).toHaveBeenCalledTimes(4))
  })
})

describe('Chart panel market header and timeframes', () => {
  const render4 = (marketContext?: WorkspaceApi['marketContext']) => {
    const { factory } = fakeAdapter()
    return render(<ChartPanel entries={entries()} selectedId="" instrument="BTC" onSelect={vi.fn()}
      source={{ api: chartApi(vi.fn().mockResolvedValue(candleSeriesFixture), marketContext), accountId: accountFixture.id }} createAdapter={factory} />)
  }

  it('shows exact venue statistics with a derived 24h change', async () => {
    render4()
    const stats = screen.getByLabelText('BTC market statistics')
    await vi.waitFor(() => expect(stats).toHaveTextContent('Mark103.5'))
    expect(stats).toHaveTextContent('Oracle103.4')
    expect(stats).toHaveTextContent('+3.5 / +3.50%')
    expect(stats).toHaveTextContent('42.5 BTC')
    expect(stats).toHaveTextContent('0.0013%')
  })

  it('keeps the chart usable when statistics fail', async () => {
    render4(vi.fn().mockRejectedValue(new ApiError('http', 'Venue market statistics are unavailable.', 502)))
    expect(await screen.findByRole('alert')).toHaveTextContent('Venue market statistics are unavailable.')
    expect(await screen.findByText(/Updated/)).toBeInTheDocument()
  })

  it('pins favorite timeframes to the bar and remembers them', async () => {
    const view = render4()
    const bar = screen.getByRole('group', { name: 'Timeframe' })
    expect(within(bar).getAllByRole('button').map(button => button.textContent)).toEqual(['5m', '1h', '4h', 'D', ''])
    await userEvent.click(within(bar).getByRole('button', { name: 'All timeframes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Favorite 15 minutes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Favorite 5 minutes' }))
    await userEvent.click(screen.getByRole('button', { name: '1 week' }))
    expect(within(bar).getAllByRole('button').map(button => button.textContent)).toEqual(['15m', '1h', '4h', 'D', 'W', ''])
    expect(within(bar).getByRole('button', { name: '1 week' })).toHaveAttribute('aria-pressed', 'true')
    view.unmount()
    render4()
    const restored = screen.getByRole('group', { name: 'Timeframe' })
    expect(within(restored).getAllByRole('button').map(button => button.textContent)).toEqual(['15m', '1h', '4h', 'D', 'W', ''])
    expect(within(restored).getByRole('button', { name: '1 week' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Chart panel tools and average entry', () => {
  it('prepares the drawing rail with only the crosshair active', async () => {
    const { factory } = fakeAdapter()
    render(<ChartPanel entries={entries()} selectedId="" instrument="BTC" onSelect={vi.fn()}
      source={{ api: chartApi(vi.fn().mockResolvedValue(candleSeriesFixture)), accountId: accountFixture.id }} createAdapter={factory} />)
    const rail = await screen.findByRole('group', { name: 'Chart tools' })
    expect(within(rail).getByRole('button', { name: 'Crosshair' })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Trend line', 'Horizontal line', 'Rectangle zone', 'Fibonacci retracement', 'Long/short position', 'Text note', 'Clear drawings']) {
      expect(within(rail).getByRole('button', { name })).toBeDisabled()
    }
    expect(within(rail).getByRole('button', { name: 'Trend line' })).toHaveAttribute('title', 'Trend line · Coming with drawing tools')
  })

  it('plots and lists the quantity-weighted average entry in the aggregate view', async () => {
    const list = [{ ...createEntry(0), price: '100', share: '60' }, { ...createEntry(1), price: '90', share: '40' }]
    const { state, factory } = fakeAdapter()
    render(<ChartPanel entries={list} selectedId={list[0]!.id} instrument="BTC" onSelect={vi.fn()}
      source={{ api: chartApi(vi.fn().mockResolvedValue(candleSeriesFixture)), accountId: accountFixture.id }} createAdapter={factory} />)
    await screen.findByText(/Updated/)
    expect(state.overlays.find(o => o.label === 'AVG')?.price).toBeCloseTo(96)
    expect(screen.getByText('Average entry')).toHaveTextContent('Average entry 96')
    await userEvent.click(screen.getByRole('button', { name: 'Chart view: Aggregate · All entries' }))
    await userEvent.click(screen.getByRole('button', { name: 'Entry 1' }))
    expect(state.overlays.some(o => o.label === 'AVG')).toBe(false)
    expect(screen.queryByText('Average entry')).toBeNull()
  })
})
