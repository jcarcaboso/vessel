import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceApi } from './workspace'
import { isAccountMonitor, isMonitorEvent, isMonitorSummary, monitorFrame } from './monitor'
import { discrepancyFixture, monitorEventFixture, monitorFixture, monitorSummaryFixture } from '@/test/monitor-fixture'
import { accountFixture, savedPlayFixture } from '@/test/workspace-fixture'

afterEach(() => vi.unstubAllGlobals())
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

describe('monitor contract', () => {
  it('validates nullable times, exact detail strings and large string cursors', () => {
    expect(isMonitorSummary(monitorSummaryFixture)).toBe(true)
    expect(isAccountMonitor({ ...monitorFixture, discrepancies: [discrepancyFixture] })).toBe(true)
    expect(isMonitorEvent(monitorEventFixture)).toBe(true)
    expect(isMonitorEvent({ ...monitorEventFixture, dedupKey: 'a'.repeat(1024) })).toBe(true)
    expect(isMonitorEvent({ ...monitorEventFixture, dedupKey: 'a'.repeat(1025) })).toBe(false)
    expect(isMonitorEvent({ ...monitorEventFixture, sequence: Number(monitorEventFixture.sequence) })).toBe(false)
    expect(isMonitorEvent({ ...monitorEventFixture, sequence: '-1' })).toBe(false)
    expect(isAccountMonitor({ ...monitorFixture, nextManualAllowedAtUtc: 'tomorrow' })).toBe(false)
    expect(isAccountMonitor({ ...monitorFixture, nextManualAllowedAtUtc: '10' })).toBe(false)
    expect(isAccountMonitor({ ...monitorFixture, nextManualAllowedAtUtc: '2026-10-14T10:00:00+03:00' })).toBe(false)
    expect(isAccountMonitor({ ...monitorFixture, nextManualAllowedAtUtc: '2026-10-14T10:00:00.1234567+00:00' })).toBe(true)
    expect(isAccountMonitor({ ...monitorFixture, manualState: 'unknown' })).toBe(false)
    expect(isMonitorSummary({ ...monitorSummaryFixture, accounts: [monitorFixture, monitorFixture] })).toBe(false)
  })
  it('ignores malformed frames and unsupported event types', () => {
    for (const [type, data] of [['event', '{'], ['event', '{}'], ['message', JSON.stringify(monitorEventFixture)],
      ['status', '{"state":"reset","nextSequence":12}'], ['status', '{"state":"other","nextSequence":"0"}']]) {
      expect(monitorFrame(type!, data!)).toBeNull()
    }
    expect(monitorFrame('status', '{"state":"reset","nextSequence":"10"}')).toEqual({ type: 'status', status: { state: 'reset', nextSequence: '10' } })
  })
  it('uses authenticated no-store reads and a body-free account run request, not execution/check', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(monitorSummaryFixture)).mockResolvedValueOnce(json(monitorFixture))
      .mockResolvedValueOnce(json({ requestId: 'run-1', monitor: { ...monitorFixture, manualState: 'pending' } }, 202))
    vi.stubGlobal('fetch', fetcher)
    const api = createWorkspaceApi('private-token')
    const signal = new AbortController().signal
    await api.monitor(signal)
    await api.accountMonitor(accountFixture.id, signal)
    await api.runAccountMonitor(accountFixture.id, signal)
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/monitor', `/api/accounts/${accountFixture.id}/monitor`, `/api/accounts/${accountFixture.id}/monitor/run`])
    for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer private-token' } })
    expect(fetcher.mock.calls[2]![1]).toMatchObject({ method: 'POST' })
    expect(fetcher.mock.calls[2]![1].body).toBeUndefined()
  })
  it('rejects monitor state belonging to another account and preserves Retry-After on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ ...monitorFixture, accountId: savedPlayFixture.summary.id }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '60' } })))
    const api = createWorkspaceApi('test')
    await expect(api.accountMonitor(accountFixture.id)).rejects.toMatchObject({ kind: 'invalid-response' })
    const before = Date.now()
    const failure = await api.runAccountMonitor(accountFixture.id).catch(error => error)
    expect(failure.status).toBe(429)
    expect(Date.parse(failure.retryAtUtc)).toBeGreaterThanOrEqual(before + 60_000)
  })
  it('dismisses from either Play or account using exact IDs and plain-text notes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetcher)
    const api = createWorkspaceApi('test')
    await api.dismissPlayDiscrepancy(savedPlayFixture.summary.id, discrepancyFixture.id, 'Still investigating.')
    await api.dismissAccountDiscrepancy(accountFixture.id, discrepancyFixture.id)
    expect(fetcher.mock.calls[0]).toEqual([`/api/plays/${savedPlayFixture.summary.id}/discrepancies/${discrepancyFixture.id}/dismiss`,
      expect.objectContaining({ method: 'POST', body: '{"note":"Still investigating."}' })])
    expect(fetcher.mock.calls[1]![0]).toBe(`/api/accounts/${accountFixture.id}/discrepancies/${discrepancyFixture.id}/dismiss`)
  })
  it('decodes split frames, skips malformed messages, and cancels the fetch and reader on abort', async () => {
    const cancelled = vi.fn()
    let writer!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller }, cancel: cancelled })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetcher)
    const abort = new AbortController()
    const received = vi.fn()
    const task = createWorkspaceApi('test').monitorStream('9007199254740992', abort.signal, received)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
    const encoder = new TextEncoder()
    writer.enqueue(encoder.encode(': keepalive\r\nevent: event\ndata: invalid\n\nevent: event\nda'))
    writer.enqueue(encoder.encode(`ta: ${JSON.stringify(monitorEventFixture)}\n\nevent: status\ndata: {"state":"ready","nextSequence":"9007199254740993"}\n\n`))
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2))
    abort.abort()
    await task
    expect(cancelled).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]![0]).toBe('/api/events/stream?after=9007199254740992')
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ signal: abort.signal, headers: { Authorization: 'Bearer test', Accept: 'text/event-stream' } })
  })
})
