import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorStreamEvent } from '@/api/monitor'
import type { WorkspaceApi } from '@/api/workspace'
import { monitorEventFixture, monitorSummaryFixture } from '@/test/monitor-fixture'
import { useMonitorEvents } from './useMonitorEvents'

function client() {
  const connections: { after: string; signal: AbortSignal; emit: (frame: MonitorStreamEvent) => void; finish: () => void }[] = []
  const api = {
    monitor: vi.fn().mockResolvedValue(monitorSummaryFixture),
    monitorStream: vi.fn((after: string, signal: AbortSignal, emit: (frame: MonitorStreamEvent) => void) => new Promise<void>(resolve => {
      connections.push({ after, signal, emit, finish: resolve })
      signal.addEventListener('abort', () => resolve(), { once: true })
    })),
    runAccountMonitor: vi.fn(), sync: vi.fn(),
  } as unknown as WorkspaceApi
  return { api, connections }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('one shell monitor subscription', () => {
  it('debounces owner events and reset into stored reloads without browser persistence or venue reads', async () => {
    const { api, connections } = client()
    const reload = vi.fn()
    const local = vi.spyOn(Storage.prototype, 'setItem')
    const view = renderHook(() => useMonitorEvents(api, true, reload, 0))
    await advance(0)
    act(() => {
      connections[0]!.emit({ type: 'event', event: monitorEventFixture })
      connections[0]!.emit({ type: 'event', event: { ...monitorEventFixture, sequence: '9007199254740994' } })
      connections[0]!.emit({ type: 'status', status: { state: 'reset', nextSequence: '9007199254740995' } })
    })
    await advance(249)
    expect(reload).not.toHaveBeenCalled()
    await advance(1)
    expect(reload).toHaveBeenCalledOnce()
    expect(api.monitorStream).toHaveBeenCalledOnce()
    expect(api.sync).not.toHaveBeenCalled()
    expect(api.runAccountMonitor).not.toHaveBeenCalled()
    expect(local).not.toHaveBeenCalled()
    view.unmount()
    local.mockRestore()
  })
  it('reconnects with exact cursors, ignores duplicate events and permits a server reset to a lower cursor', async () => {
    const { api, connections } = client()
    const reload = vi.fn()
    renderHook(() => useMonitorEvents(api, true, reload, 0))
    act(() => {
      connections[0]!.emit({ type: 'event', event: monitorEventFixture })
      connections[0]!.finish()
    })
    await advance(5000)
    expect(connections[1]!.after).toBe(monitorEventFixture.sequence)
    reload.mockClear()
    act(() => connections[1]!.emit({ type: 'event', event: monitorEventFixture }))
    await advance(250)
    expect(reload).not.toHaveBeenCalled()
    act(() => {
      connections[1]!.emit({ type: 'status', status: { state: 'reset', nextSequence: '2' } })
      connections[1]!.finish()
    })
    await advance(5000)
    expect(connections[2]!.after).toBe('2')
    expect(reload).toHaveBeenCalledOnce()
  })
  it('does not acknowledge undispatched catch-up events from a ready frame', async () => {
    const { api, connections } = client()
    const reload = vi.fn()
    renderHook(() => useMonitorEvents(api, true, reload, 0))
    act(() => {
      connections[0]!.emit({ type: 'status', status: { state: 'ready', nextSequence: '9007199254740999' } })
      connections[0]!.emit({ type: 'event', event: monitorEventFixture })
      connections[0]!.finish()
    })
    await advance(5000)
    expect(connections[1]!.after).toBe(monitorEventFixture.sequence)
    expect(reload).toHaveBeenCalledOnce()
  })
  it('uses a 60-second stored-data fallback while disconnected and health reads while ready', async () => {
    const { api, connections } = client()
    const reload = vi.fn()
    renderHook(() => useMonitorEvents(api, true, reload, 0))
    await advance(59_999)
    expect(reload).not.toHaveBeenCalled()
    await advance(251)
    expect(reload).toHaveBeenCalledOnce()
    act(() => connections[0]!.emit({ type: 'status', status: { state: 'ready', nextSequence: '0' } }))
    await advance(250)
    reload.mockClear()
    await advance(60_000)
    expect(reload).not.toHaveBeenCalled()
    expect(api.monitor).toHaveBeenCalledTimes(2)
    expect(api.sync).not.toHaveBeenCalled()
  })
  it('aborts on API replacement, disconnect and unmount and ignores late callbacks and queued reloads', async () => {
    const first = client(), second = client()
    const reload = vi.fn()
    const view = renderHook(({ api, enabled }) => useMonitorEvents(api, enabled, reload, 0), { initialProps: { api: first.api, enabled: true } })
    act(() => first.connections[0]!.emit({ type: 'event', event: monitorEventFixture }))
    view.rerender({ api: second.api, enabled: true })
    expect(first.connections[0]!.signal.aborted).toBe(true)
    act(() => first.connections[0]!.emit({ type: 'event', event: { ...monitorEventFixture, sequence: '999999999999999999' } }))
    await advance(1000)
    expect(reload).not.toHaveBeenCalled()
    expect(second.connections[0]!.after).toBe('0')
    view.rerender({ api: second.api, enabled: false })
    expect(second.connections[0]!.signal.aborted).toBe(true)
    await advance(120_000)
    expect(reload).not.toHaveBeenCalled()
    view.rerender({ api: second.api, enabled: true })
    view.unmount()
    expect(second.connections[1]!.signal.aborted).toBe(true)
  })
})
