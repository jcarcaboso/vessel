import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceApi } from '@/api/workspace'
import type { LinkOrder, PlayExecution } from '@/api/plays'
import { ApiError } from '@/api/errors'
import { executionCheckInterval, usePlayExecution } from './usePlayExecution'

const id = 'play-1'
const request: LinkOrder = { orderId: 'order-1', role: 'entry', entryId: 'entry-1' }
function execution(notice: string, status: PlayExecution['status'] = 'draft', playId = id): PlayExecution {
  return { playId, status, tracked: status !== 'draft', reason: null, notice, checkedAtUtc: null,
    totals: { enteredQuantity: '0', exitedQuantity: '0', openQuantity: '0', closedPnlUsd: '0', closedPnlBasis: 'gross', fees: [] },
    entries: [], links: [], suggestions: [], unlinkedOrders: [], issues: [] }
}
function deferred() {
  let resolve!: (value: PlayExecution) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<PlayExecution>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function client() {
  const methods = {
    playExecution: vi.fn<WorkspaceApi['playExecution']>().mockResolvedValue(execution('initial')),
    checkPlayExecution: vi.fn<WorkspaceApi['checkPlayExecution']>().mockResolvedValue(execution('checked')),
    linkOrder: vi.fn<WorkspaceApi['linkOrder']>().mockResolvedValue(execution('linked')),
    unlinkOrder: vi.fn<WorkspaceApi['unlinkOrder']>().mockResolvedValue(execution('unlinked')),
  }
  return { methods, api: methods as unknown as WorkspaceApi }
}
async function settle(pending: ReturnType<typeof deferred>, next: PlayExecution) {
  await act(async () => { pending.resolve(next) })
}
async function flush() { await act(async () => {}) }
afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(document, 'visibilityState') })

describe('execution request ownership', () => {
  it('does not overwrite an applied link with an older check, and counts both until they finish', async () => {
    const { api, methods } = client()
    const older = deferred(), newer = deferred()
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
    await settle(older, execution('old check'))
    expect(result.current.execution?.notice).toBe('linked')
    expect(result.current.busy).toBe(false)
  })

  it('allows an older result until the newer request actually applies, then retains the newer one', async () => {
    const { api, methods } = client()
    const older = deferred(), newer = deferred()
    methods.checkPlayExecution.mockReturnValueOnce(older.promise)
    methods.unlinkOrder.mockReturnValueOnce(newer.promise)
    const { result } = renderHook(() => usePlayExecution(api, id))
    await flush()
    act(() => { void result.current.check(); void result.current.unlink('link-1') })
    await settle(older, execution('older'))
    expect(result.current.execution?.notice).toBe('older')
    expect(result.current.busy).toBe(true)
    await settle(newer, execution('unlinked'))
    expect(result.current.execution?.notice).toBe('unlinked')
    expect(result.current.busy).toBe(false)
  })

  it('suppresses old errors after a newer success, and keeps a newer error when an older request finishes', async () => {
    const { api, methods } = client()
    const older = deferred(), newer = deferred()
    methods.checkPlayExecution.mockReturnValueOnce(older.promise)
    methods.linkOrder.mockReturnValueOnce(newer.promise)
    const { result } = renderHook(() => usePlayExecution(api, id))
    await flush()
    act(() => { void result.current.check(); void result.current.link(request) })
    await settle(newer, execution('linked'))
    await act(async () => { older.reject(new ApiError('unavailable', 'Old error.')) })
    expect(result.current.error).toBeNull()
    const read = deferred(), write = deferred()
    methods.checkPlayExecution.mockReturnValueOnce(read.promise)
    methods.unlinkOrder.mockReturnValueOnce(write.promise)
    act(() => { void result.current.check(); void result.current.unlink('link-1') })
    await act(async () => { write.reject(new ApiError('unavailable', 'New error.')) })
    await settle(read, execution('older'))
    expect(result.current.execution?.notice).toBe('linked')
    expect(result.current.error).toBe('New error.')
    expect(result.current.busy).toBe(false)
  })

  it('includes the initial read in ordering and does not start an automatic check for a stale read', async () => {
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

  it('does not check from an initial active result when a newer terminal mutation settles in the same turn', async () => {
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
    const initial = deferred(), check = deferred(), mutation = deferred()
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
    const first = deferred(), second = deferred(), check = deferred()
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
    await settle(check, execution('late'))
  })
})

describe('execution polling', () => {
  it('checks active plays on opening, skips hidden/overlapping ticks, and stops for terminal state and unmount', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const { api, methods } = client()
    methods.playExecution.mockResolvedValue(execution('initial', 'planned'))
    methods.checkPlayExecution.mockResolvedValue(execution('checked', 'open'))
    const { result, unmount } = renderHook(() => usePlayExecution(api, id))
    await flush()
    expect(methods.checkPlayExecution).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => { vi.advanceTimersByTime(executionCheckInterval) })
    expect(methods.checkPlayExecution).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const pending = deferred()
    methods.checkPlayExecution.mockReturnValueOnce(pending.promise)
    await act(async () => { vi.advanceTimersByTime(executionCheckInterval) })
    expect(result.current.busy).toBe(true)
    await act(async () => { vi.advanceTimersByTime(executionCheckInterval * 3) })
    expect(methods.checkPlayExecution).toHaveBeenCalledTimes(2)
    await settle(pending, execution('closed', 'closed'))
    await act(async () => { vi.advanceTimersByTime(executionCheckInterval * 2) })
    expect(methods.checkPlayExecution).toHaveBeenCalledTimes(2)
    unmount()
    await act(async () => { vi.advanceTimersByTime(executionCheckInterval * 2) })
    expect(methods.checkPlayExecution).toHaveBeenCalledTimes(2)
  })

  it('does not poll untracked plays, and skips ticks while a link write is still running', async () => {
    vi.useFakeTimers()
    const { api, methods } = client()
    methods.playExecution.mockResolvedValue(execution('untracked'))
    const { result, rerender, unmount } = renderHook(({ status }) => usePlayExecution(api, id, status), { initialProps: { status: 'draft' } })
    await flush()
    await act(async () => { vi.advanceTimersByTime(executionCheckInterval * 2) })
    expect(methods.checkPlayExecution).not.toHaveBeenCalled()
    methods.playExecution.mockResolvedValue(execution('planned', 'planned'))
    methods.checkPlayExecution.mockResolvedValue(execution('checked', 'paused'))
    rerender({ status: 'planned' })
    await flush()
    const write = deferred()
    methods.linkOrder.mockReturnValueOnce(write.promise)
    act(() => { void result.current.link(request) })
    await act(async () => { vi.advanceTimersByTime(executionCheckInterval * 2) })
    expect(methods.checkPlayExecution).toHaveBeenCalledTimes(1)
    await settle(write, execution('linked', 'open'))
    await act(async () => { vi.advanceTimersByTime(executionCheckInterval) })
    expect(methods.checkPlayExecution).toHaveBeenCalledTimes(2)
    unmount()
  })
})
