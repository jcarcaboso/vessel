import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceApi } from './workspace'
import { createWorkspaceApi } from './workspace'
import { isAfter, isEventCursor, isEventSequence, isRequestCursor, isUnknownCursor, readHeadCursor, unknownCursor } from './event-cursor'

const epoch = '0123456789abcdef0123456789abcdef'
const other = 'fedcba9876543210fedcba9876543210'

describe('owner event cursor', () => {
  it('reads the head from one bounded reset page and returns its opaque cursor', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [], nextCursor: `${epoch}.9007199254740993`, resetRequired: true })))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    expect(await readHeadCursor(createWorkspaceApi('test'), signal)).toBe(`${epoch}.9007199254740993`)
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://vessel.test')
    expect(url.pathname).toBe('/api/events')
    expect(url.searchParams.get('limit')).toBe('1')
    expect(isUnknownCursor(url.searchParams.get('after')!)).toBe(true)
    vi.unstubAllGlobals()
  })
  it('rejects an invalid page and passes the abort signal', async () => {
    const api = { monitorEvents: vi.fn().mockResolvedValue({ nextCursor: `${epoch}.1` }) } as unknown as WorkspaceApi
    const signal = new AbortController().signal
    await readHeadCursor(api, signal)
    expect(api.monitorEvents).toHaveBeenCalledWith(expect.any(String), 1, signal)
    for (const nextCursor of [3, '3', `${epoch}.-1`, `${epoch.toUpperCase()}.3`]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [], nextCursor, resetRequired: true }))))
      await expect(readHeadCursor(createWorkspaceApi('test'), signal)).rejects.toMatchObject({ kind: 'invalid-response' })
    }
    vi.unstubAllGlobals()
  })
  it('owns the cursor syntax: epoch cursors and the stream start, never bare sequences', () => {
    expect(isEventCursor('0')).toBe(true)
    expect(isEventCursor(`${epoch}.0`)).toBe(true)
    expect(isEventCursor(`${epoch}.9223372036854775807`)).toBe(true)
    for (const value of ['', '12', `${epoch}.`, `${epoch}.01`, `${epoch.slice(1)}.1`, `${epoch}.1.2`, `${epoch}.12345678901234567890`, 12, null]) {
      expect(isEventCursor(value)).toBe(false)
    }
    expect(isEventSequence('9007199254740993')).toBe(true)
    expect(isEventSequence(`${epoch}.1`)).toBe(false)
    // Only this module's head probe extends what a request may send.
    expect(isRequestCursor(unknownCursor)).toBe(true)
    expect(isRequestCursor('12')).toBe(false)
  })
  it('orders events after a known cursor only, exactly beyond 2^53 and across epochs', () => {
    expect(isAfter(`${epoch}.9007199254740993`, `${epoch}.9007199254740992`)).toBe(true)
    expect(isAfter(`${epoch}.9007199254740992`, `${epoch}.9007199254740992`)).toBe(false)
    expect(isAfter(`${epoch}.1`, `${epoch}.2`)).toBe(false)
    // A restored database streams under a new epoch: its events are new whatever their sequence.
    expect(isAfter(`${other}.1`, `${epoch}.2`)).toBe(true)
    expect(isAfter(`${epoch}.1`, '0')).toBe(true)
    expect(isAfter(`${epoch}.1`, unknownCursor)).toBe(false)
    expect(isAfter('not-a-cursor', `${epoch}.1`)).toBe(false)
  })
})
