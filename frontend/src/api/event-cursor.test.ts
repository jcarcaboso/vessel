import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceApi } from './workspace'
import { createWorkspaceApi } from './workspace'
import { isAfter, isUnknownCursor, readHeadCursor, unknownCursor } from './event-cursor'

describe('owner event cursor', () => {
  it('reads the head as an opaque cursor from one bounded event page beyond any retained sequence', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [], nextSequence: '9007199254740993', resetRequired: true })))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    expect(await readHeadCursor(createWorkspaceApi('test'), signal)).toBe('9007199254740993')
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://vessel.test')
    expect(url.pathname).toBe('/api/events')
    expect(url.searchParams.get('limit')).toBe('1')
    expect(isUnknownCursor(url.searchParams.get('after')!)).toBe(true)
    vi.unstubAllGlobals()
  })
  it('rejects an invalid page and passes the abort signal', async () => {
    const api = { monitorEvents: vi.fn().mockResolvedValue({ nextSequence: '1' }) } as unknown as WorkspaceApi
    const signal = new AbortController().signal
    await readHeadCursor(api, signal)
    expect(api.monitorEvents).toHaveBeenCalledWith(expect.any(String), 1, signal)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [], nextSequence: 3, resetRequired: true }))))
    await expect(readHeadCursor(createWorkspaceApi('test'), signal)).rejects.toMatchObject({ kind: 'invalid-response' })
    vi.unstubAllGlobals()
  })
  it('orders events after a known cursor only, exactly beyond 2^53', () => {
    expect(isAfter('9007199254740993', '9007199254740992')).toBe(true)
    expect(isAfter('9007199254740992', '9007199254740992')).toBe(false)
    expect(isAfter('1', unknownCursor)).toBe(false)
  })
})
