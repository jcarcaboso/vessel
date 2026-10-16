import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceApi } from '@/api/workspace'
import type { LinkOrder, PlayExecution } from '@/api/plays'
import type { AccountMonitor, MonitorRunAccepted } from '@/api/monitor'
import { ApiError } from '@/api/errors'
import { checkPollInterval, checkPollLimit, executionRefreshInterval, usePlayExecution } from './usePlayExecution'

const id = 'play-1'
const request: LinkOrder = { orderId: 'order-1', role: 'entry', entryId: 'entry-1' }
function monitor(manualState: AccountMonitor['manualState']): AccountMonitor {
  return { accountId: '5b0c1f8e-2a4d-4c6b-9e7f-1a2b3c4d5e6f', state: 'live', lastAttemptAtUtc: null, lastSuccessAtUtc: null,
    nextRunAtUtc: null, manualState, nextManualAllowedAtUtc: null, error: null, workerOnline: true, discrepancies: [] }
}
function execution(notice: string, status: PlayExecution['status'] = 'draft', playId = id, manualState?: AccountMonitor['manualState']): PlayExecution {
  return { playId, status, tracked: status !== 'draft', reason: null, notice, checkedAtUtc: null,
    totals: { enteredQuantity: '0', exitedQuantity: '0', openQuantity: '0', closedPnlUsd: '0', closedPnlBasis: 'gross', fees: [] },
    entries: [], links: [], suggestions: [], unlinkedOrders: [], issues: [],
    ...(manualState ? { monitor: monitor(manualState), discrepancies: [], watches: [] } : {}) }
}
const accepted = (manualState: AccountMonitor['manualState'] = 'pending'): MonitorRunAccepted =>
  ({ requestId: '0192f0c4-7b3a-7cc2-9d4e-6a1b2c3d4e5f', monitor: monitor(manualState) })
function deferred<T = PlayExecution>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function client() {
  const methods = {
    playExecution: vi.fn<WorkspaceApi['playExecution']>().mockResolvedValue(execution('initial')),
    checkPlayExecution: vi.fn<WorkspaceApi['checkPlayExecution']>().mockResolvedValue(accepted()),
    linkOrder: vi.fn<WorkspaceApi['linkOrder']>().mockResolvedValue(execution('linked')),
    unlinkOrder: vi.fn<WorkspaceApi['unlinkOrder']>().mockResolvedValue(execution('unlinked')),
  }
  return { methods, api: methods as unknown as WorkspaceApi }
}
async function settle<T>(pending: ReturnType<typeof deferred<T>>, next: T) {
  await act(async () => { pending.resolve(next) })
}
async function flush() { await act(async () => {}) }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(document, 'visibilityState') })

describe('execution request ownership', () => {
  it('does not apply an older check acceptance over a newer link, and stays busy until the check is observed', async () => {
    vi.useFakeTimers()
    const { api, methods } = client()
    const older = deferred<MonitorRunAccepted>(), newer = deferred()
    methods.checkPlayExecution.mockReturnValueOnce(older.promise)
    methods.linkOrder.mockReturnValueOnce(newer.promise)
    const { result } = renderHook(() => usePlayExecution(api, id))
    expect(result.current.busy).toBe(true)
    await flush()
    expect(result.current.busy).toBe(false)
    act(() => { void result.current.check(); void result.current.link(request) })
    await settle(newer, execution('linked'))
    expect(result.current.execution?.notice).toBe('linked')
    expect(result.current.busy).toBe(true)
    await settle(older, accepted('pending'))
    expect(result.current.execution?.notice).toBe('linked')
    expect(result.current.execution?.monitor).toBeUndefined()
    // The acceptance was superseded, but the queued run is still observed through stored reads.
    expect(result.current.busy).toBe(true)
    methods.playExecution.mockResolvedValueOnce(execution('checked', 'draft', id, 'idle'))
    await advance(checkPollInterval)
    expect(result.current.execution?.notice).toBe('checked')
    expect(result.current.busy).toBe(false)
  })

  it('merges a current acceptance into the stored view until a newer request applies', async () => {
    vi.useFakeTimers()
    const { api, methods } = client()
    const older = deferred<MonitorRunAccepted>(), newer = deferred()
    methods.checkPlayExecution.mockReturnValueOnce(older.promise)
    methods.unlinkOrder.mockReturnValueOnce(newer.promise)
    const { result } = renderHook(() => usePlayExecution(api, id))
    await flush()
    act(() => { void result.current.check(); void result.current.unlink('link-1') })
    await settle(older, accepted('pending'))
    expect(result.current.execution?.notice).toBe('initial')
    expect(result.current.execution?.monitor?.manualState).toBe('pending')
    expect(result.current.busy).toBe(true)
    await settle(newer, execution('unlinked'))
    expect(result.current.execution?.notice).toBe('unlinked')
    expect(result.current.busy).toBe(true)
    methods.playExecution.mockResolvedValueOnce(execution('checked', 'draft', id, 'idle'))
    await advance(checkPollInterval)
    expect(result.current.busy).toBe(false)
  })

  it('suppresses old errors after a newer success, and keeps a newer error when an older request finishes', async () => {
    const { api, methods } = client()
    const older = deferred<MonitorRunAccepted>(), newer = deferred()
    methods.checkPlayExecution.mockReturnValueOnce(older.promise)
    methods.linkOrder.mockReturnValueOnce(newer.promise)
    const { result } = renderHook(() => usePlayExecution(api, id))
    await flush()
    act(() => { void result.current.check(); void result.current.link(request) })
    await settle(newer, execution('linked'))
    await act(async () => { older.reject(new ApiError('unavailable', 'Old error.')) })
    expect(result.current.error).toBeNull()
    expect(result.current.busy).toBe(false)
    const check = deferred<MonitorRunAccepted>(), write = deferred()
    methods.checkPlayExecution.mockReturnValueOnce(check.promise)
    methods.unlinkOrder.mockReturnValueOnce(write.promise)
    act(() => { void result.current.check(); void result.current.unlink('link-1') })
    await act(async () => { write.reject(new ApiError('unavailable', 'New error.')) })
    await settle(check, accepted())
    expect(result.current.execution?.notice).toBe('linked')
    expect(result.current.execution?.monitor).toBeUndefined()
    expect(result.current.error).toBe('New error.')
    // Still waiting for the accepted check to be observed.
    expect(result.current.busy).toBe(true)
  })

  it('includes the initial read in ordering and never checks for a stale active read', async () => {
    const { api, methods } = client()
    const read = deferred()
    methods.playExecution.mockReturnValueOnce(read.promise)
    const { result } = renderHook(() => usePlayExecution(api, id))
    await act(async () => { await result.current.link(request) })
    expect(result.current.busy).toBe(true)
    await settle(read, execution('old', 'open'))
    expect(result.current.execution?.notice).toBe('linked')
    expect(methods.checkPlayExecution).not.toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
  })

  it('keeps a newer terminal mutation that settles in the same turn as an initial active read', async () => {
    const { api, methods } = client()
    const read = deferred(), write = deferred()
    methods.playExecution.mockReturnValueOnce(read.promise)
    methods.unlinkOrder.mockReturnValueOnce(write.promise)
    const { result } = renderHook(() => usePlayExecution(api, id))
    act(() => { void result.current.unlink('link-1') })
    await act(async () => { read.resolve(execution('initial', 'open')); write.resolve(execution('closed', 'closed')) })
    expect(result.current.execution?.status).toBe('closed')
    expect(result.current.busy).toBe(false)
    expect(methods.checkPlayExecution).not.toHaveBeenCalled()
  })

  it('does not let an aborted StrictMode read keep the live session busy', async () => {
    const { api, methods } = client()
    const first = deferred(), second = deferred()
    methods.playExecution.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => usePlayExecution(api, id), { wrapper: StrictMode })
    await settle(second, execution('live'))
    expect(result.current.busy).toBe(false)
    await settle(first, execution('old', 'open'))
    expect(result.current.execution?.notice).toBe('live')
    expect(result.current.busy).toBe(false)
    expect(methods.checkPlayExecution).not.toHaveBeenCalled()
  })

  it.each(['play', 'api', 'status', 'disconnect'] as const)('aborts reads/checks and ignores stale completions on %s replacement', async replacement => {
    const first = client(), second = client()
    const initial = deferred(), check = deferred<MonitorRunAccepted>(), mutation = deferred()
    first.methods.playExecution.mockReturnValueOnce(initial.promise)
    first.methods.checkPlayExecution.mockReturnValueOnce(check.promise)
    first.methods.linkOrder.mockReturnValueOnce(mutation.promise)
    const { result, rerender } = renderHook(({ api, playId, status }) => usePlayExecution(api, playId, status),
      { initialProps: { api: first.api, playId: id as string | null, status: 'draft' } })
    const oldCheck = result.current.check
    act(() => { void result.current.check(); void result.current.link(request) })
    const initialSignal = first.methods.playExecution.mock.calls[0]![1]!
    const checkSignal = first.methods.checkPlayExecution.mock.calls[0]![1]!
    rerender({ api: replacement === 'api' ? second.api : first.api,
      playId: replacement === 'disconnect' ? null : replacement === 'play' ? 'play-2' : id,
      status: replacement === 'status' ? 'planned' : 'draft' })
    expect(initialSignal.aborted).toBe(true)
    expect(checkSignal.aborted).toBe(true)
    // linkOrder deliberately receives no abort signal: the write may already have committed.
    expect(first.methods.linkOrder).toHaveBeenCalledWith(id, request)
    await flush()
    const current = result.current.execution
    await settle(initial, execution('stale read', 'open'))
    await act(async () => { check.reject(new ApiError('unavailable', 'Stale check.')) })
    await settle(mutation, execution('stale write'))
    await act(async () => { await oldCheck() })
    expect(result.current.execution).toBe(current)
    expect(result.current.error).toBeNull()
    expect(result.current.busy).toBe(false)
    expect(first.methods.checkPlayExecution).toHaveBeenCalledTimes(1)
  })

  it('aborts on unmount and handles StrictMode effect replay without using an aborted read', async () => {
    const { api, methods } = client()
    const first = deferred(), second = deferred(), check = deferred<MonitorRunAccepted>()
    methods.playExecution.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    methods.checkPlayExecution.mockReturnValueOnce(check.promise)
    const { result, unmount } = renderHook(() => usePlayExecution(api, id), { wrapper: StrictMode })
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
    expect(methods.playExecution.mock.calls[0]![1]!.aborted).toBe(true)
    await settle(first, execution('strict stale', 'open'))
    expect(result.current.execution).toBeNull()
    expect(result.current.busy).toBe(true)
    await settle(second, execution('current'))
    expect(result.current.execution?.notice).toBe('current')
    act(() => { void result.current.check() })
    unmount()
    // Completed reads are no longer in flight; cleanup only cancels the live check.
    expect(methods.playExecution.mock.calls[1]![1]!.aborted).toBe(false)
    expect(methods.checkPlayExecution.mock.calls[0]![1]!.aborted).toBe(true)
    await settle(check, accepted())
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
  })
})

describe('execution refresh and on-demand checks', () => {
  it('never checks on opening or on the timer; rereads stored state while visible and stops for terminal state and unmount', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const { api, methods } = client()
    methods.playExecution.mockResolvedValue(execution('initial', 'planned'))
    const { result, unmount } = renderHook(() => usePlayExecution(api, id))
    await flush()
    expect(methods.playExecution).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await advance(executionRefreshInterval)
    expect(methods.playExecution).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const pending = deferred()
    methods.playExecution.mockReturnValueOnce(pending.promise)
    await advance(executionRefreshInterval)
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
    expect(result.current.busy).toBe(true)
    // No overlapping refresh while one is in flight.
    await advance(executionRefreshInterval * 3)
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
    await settle(pending, execution('closed', 'closed'))
    await advance(executionRefreshInterval * 2)
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
    unmount()
    await advance(executionRefreshInterval * 2)
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
    expect(methods.checkPlayExecution).not.toHaveBeenCalled()
  })

  it('does not refresh untracked plays, and skips ticks while a link write is still running', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const { api, methods } = client()
    methods.playExecution.mockResolvedValue(execution('untracked'))
    const { result, rerender, unmount } = renderHook(({ status }) => usePlayExecution(api, id, status), { initialProps: { status: 'draft' } })
    await flush()
    await advance(executionRefreshInterval * 2)
    expect(methods.playExecution).toHaveBeenCalledTimes(1)
    methods.playExecution.mockResolvedValue(execution('planned', 'planned'))
    rerender({ status: 'planned' })
    await flush()
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
    const write = deferred()
    methods.linkOrder.mockReturnValueOnce(write.promise)
    act(() => { void result.current.link(request) })
    await advance(executionRefreshInterval * 2)
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
    await settle(write, execution('linked', 'open'))
    await advance(executionRefreshInterval)
    expect(methods.playExecution).toHaveBeenCalledTimes(3)
    expect(methods.checkPlayExecution).not.toHaveBeenCalled()
    unmount()
  })

  it('after an accepted check, rereads stored state until the worker finishes and stays busy meanwhile', async () => {
    vi.useFakeTimers()
    const { api, methods } = client()
    methods.playExecution.mockResolvedValueOnce(execution('initial', 'planned', id, 'idle'))
    const { result } = renderHook(() => usePlayExecution(api, id))
    await flush()
    methods.playExecution.mockResolvedValueOnce(execution('waiting', 'planned', id, 'pending'))
      .mockResolvedValueOnce(execution('running', 'planned', id, 'running'))
      .mockResolvedValueOnce(execution('checked', 'open', id, 'idle'))
    act(() => { void result.current.check() })
    await flush()
    expect(methods.checkPlayExecution).toHaveBeenCalledTimes(1)
    expect(result.current.execution?.monitor?.manualState).toBe('pending')
    expect(result.current.busy).toBe(true)
    // Acceptance alone reads nothing; the worker's outcome arrives through stored reads.
    expect(methods.playExecution).toHaveBeenCalledTimes(1)
    await advance(checkPollInterval)
    expect(result.current.execution?.notice).toBe('waiting')
    expect(result.current.busy).toBe(true)
    await advance(checkPollInterval)
    expect(result.current.execution?.notice).toBe('running')
    expect(result.current.busy).toBe(true)
    await advance(checkPollInterval)
    expect(result.current.execution?.notice).toBe('checked')
    expect(result.current.busy).toBe(false)
    await advance(checkPollInterval * 5)
    expect(methods.playExecution).toHaveBeenCalledTimes(4)
    expect(methods.checkPlayExecution).toHaveBeenCalledTimes(1)
  })

  it('bounds the wait for a check that never finishes', async () => {
    vi.useFakeTimers()
    const { api, methods } = client()
    methods.playExecution.mockResolvedValue(execution('waiting', 'draft', id, 'pending'))
    const { result } = renderHook(() => usePlayExecution(api, id))
    await flush()
    act(() => { void result.current.check() })
    await advance(checkPollInterval * (checkPollLimit - 1))
    expect(result.current.busy).toBe(true)
    await advance(checkPollInterval * 10)
    expect(methods.playExecution).toHaveBeenCalledTimes(1 + checkPollLimit)
    expect(result.current.busy).toBe(false)
  })

  it('stops after the first read when the server reports no monitor or the read fails', async () => {
    vi.useFakeTimers()
    const { api, methods } = client()
    const { result } = renderHook(() => usePlayExecution(api, id))
    await flush()
    act(() => { void result.current.check() })
    await advance(checkPollInterval * 3)
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
    expect(result.current.busy).toBe(false)
    methods.playExecution.mockRejectedValueOnce(new ApiError('unavailable', 'Stored read failed.'))
    act(() => { void result.current.check() })
    await advance(checkPollInterval * 3)
    expect(methods.playExecution).toHaveBeenCalledTimes(3)
    expect(result.current.error).toBe('Stored read failed.')
    expect(result.current.busy).toBe(false)
  })

  it('shows a refused check without waiting for it', async () => {
    vi.useFakeTimers()
    const { api, methods } = client()
    methods.checkPlayExecution.mockRejectedValueOnce(
      new ApiError('http', 'This account check is running or cooling down. Try again in 30 seconds.', 429))
    const { result } = renderHook(() => usePlayExecution(api, id))
    await flush()
    act(() => { void result.current.check() })
    await flush()
    expect(result.current.error).toBe('This account check is running or cooling down. Try again in 30 seconds.')
    expect(result.current.busy).toBe(false)
    await advance(checkPollInterval * 3)
    expect(methods.playExecution).toHaveBeenCalledTimes(1)
  })

  it.each(['unmount', 'replacement'] as const)('stops waiting for a check on %s', async ending => {
    vi.useFakeTimers()
    const { api, methods } = client()
    methods.playExecution.mockResolvedValue(execution('waiting', 'draft', id, 'pending'))
    const { result, rerender, unmount } = renderHook(({ playId }) => usePlayExecution(api, playId), { initialProps: { playId: id as string | null } })
    await flush()
    act(() => { void result.current.check() })
    await advance(checkPollInterval)
    expect(methods.playExecution).toHaveBeenCalledTimes(2)
    const read = deferred()
    methods.playExecution.mockReturnValueOnce(read.promise)
    await advance(checkPollInterval)
    const signal = methods.playExecution.mock.calls[2]![1]!
    if (ending === 'unmount') unmount()
    else rerender({ playId: null })
    expect(signal.aborted).toBe(true)
    await settle(read, execution('late', 'draft', id, 'idle'))
    await advance(checkPollInterval * 5)
    expect(methods.playExecution).toHaveBeenCalledTimes(3)
    if (ending === 'replacement') {
      expect(result.current.execution).toBeNull()
      expect(result.current.busy).toBe(false)
    }
  })
})
