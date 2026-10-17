import { waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { onApiEvent, type ApiEvent } from '@/api/events'
import { createApiCall } from '@/api/request'
import { createWorkspaceApi } from '@/api/workspace'
import { sessionFixture } from '@/test/identity-fixture'
import { channelBus } from '@/test/session-channel'
import { landingKey, noticeKey, notices, SessionController, takeLanding, takeNotice } from './session'

const otherUser = '0d4f7c2a-9b1e-4e63-8a05-2c7b9d1f3e68'
const newSession = 'c7a2e9f4-1d3b-4b6a-9e85-3f0c2d7a1b96'
function live(overrides: Partial<ConstructorParameters<typeof SessionController>[0]> = {}) {
  const bus = channelBus()
  const navigate = vi.fn()
  const controller = new SessionController({ session: sessionFixture, channels: bus.factory, navigate, ...overrides })
  controller.markLive()
  return { controller, bus, navigate }
}

describe('forced teardown', () => {
  it('writes the notice, clears the shell exit state and replaces the page on a 401', () => {
    const { controller, navigate } = live()
    const clear = vi.fn()
    controller.registerExitState(clear)
    controller.handleFailure({ status: 401, code: 'session-expired', generation: 0 })
    expect(sessionStorage.getItem(noticeKey)).toBe(notices.ended)
    expect(clear).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}${window.location.search}`)
    // The notice survives the reload and shows once.
    expect(takeNotice()).toBe(notices.ended)
    expect(takeNotice()).toBeNull()
    controller.handleFailure({ status: 401 })
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('tears down from a real session-kind request answered 401', async () => {
    const { controller, navigate } = live()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'session-revoked' }), { status: 401 })))
    const api = createWorkspaceApi(controller.credentials(), controller.handleFailure)
    await expect(api.overview()).rejects.toMatchObject({ status: 401 })
    expect(navigate).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(noticeKey)).toBe(notices.ended)
  })

  it.each(['csrf-rejected', 'origin-rejected', 'operator-required', 'step-up-required', undefined])('never tears down for a 403 %s', code => {
    const onSuspended = vi.fn()
    const { controller, navigate } = live({ onSuspended })
    controller.handleFailure({ status: 403, ...code ? { code } : {} })
    expect(navigate).not.toHaveBeenCalled()
    expect(onSuspended).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(noticeKey)).toBeNull()
  })

  it('opens the suspended screen for user-suspended', () => {
    const onSuspended = vi.fn()
    const { controller, navigate } = live({ onSuspended })
    controller.handleFailure({ status: 403, code: 'user-suspended' })
    expect(onSuspended).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('still reloads when the workspace was never shown, marking the next load to skip the probe', () => {
    const navigate = vi.fn()
    const controller = new SessionController({ session: sessionFixture, channels: channelBus().factory, navigate })
    controller.handleFailure({ status: 401 })
    // The stores already switched to this user, so the page reloads; the marker keeps it from probing into a loop.
    expect(navigate).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(landingKey)).toBe('sign-in')
    expect(sessionStorage.getItem(noticeKey)).toBe(notices.ended)
    expect(takeLanding()).toBe(true)
    expect(takeLanding()).toBe(false)
  })

  it('reloads a live tab without the landing marker, so the next load probes', () => {
    const { controller } = live()
    controller.handleFailure({ status: 401 })
    expect(sessionStorage.getItem(landingKey)).toBeNull()
  })

  it('marks only its own landing value', () => {
    sessionStorage.setItem(landingKey, 'elsewhere')
    expect(takeLanding()).toBe(false)
    expect(sessionStorage.getItem(landingKey)).toBeNull()
  })

  it('only accepts its own notices', () => {
    sessionStorage.setItem(noticeKey, '<img src=x>')
    expect(takeNotice()).toBeNull()
    expect(sessionStorage.getItem(noticeKey)).toBeNull()
  })
})

describe('voluntary sign-out', () => {
  it('signs out the expected session, tells other tabs and reloads', async () => {
    const { controller, bus, navigate } = live()
    const otherNavigate = vi.fn()
    const other = new SessionController({ session: sessionFixture, channels: bus.factory, navigate: otherNavigate })
    other.markLive()
    const signOut = vi.fn().mockResolvedValue(undefined)
    await controller.signOut({ signOut })
    expect(signOut).toHaveBeenCalledWith(sessionFixture.session.id)
    expect(bus.posted).toEqual([{ type: 'signed-out', userId: sessionFixture.user.id, sessionId: sessionFixture.session.id }])
    expect(navigate).toHaveBeenCalledOnce()
    // The other tab shares the session that ended (its own notice lands in its own sessionStorage in a browser).
    expect(otherNavigate).toHaveBeenCalledOnce()
    other.dispose()
  })

  it('leaves no notice in the tab that signed out', async () => {
    const { controller } = live()
    await controller.signOut({ signOut: vi.fn().mockResolvedValue(undefined) })
    expect(sessionStorage.getItem(noticeKey)).toBeNull()
  })

  it('reloads without broadcasting when the cookie belongs to another session (409 session-changed)', async () => {
    const { controller, bus, navigate } = live()
    const signOut = vi.fn().mockRejectedValue(new ApiError('http', 'changed', 409, undefined, 'session-changed'))
    await controller.signOut({ signOut })
    expect(bus.posted).toEqual([])
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('keeps the tab and throws when sign-out cannot reach the server', async () => {
    const { controller, bus, navigate } = live()
    await expect(controller.signOut({ signOut: vi.fn().mockRejectedValue(new ApiError('unavailable', 'down')) })).rejects.toThrow('down')
    expect(bus.posted).toEqual([])
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('cross-tab messages', () => {
  it('announces a sign-in with IDs only', () => {
    const { controller, bus } = live()
    controller.announceSignIn()
    expect(bus.posted).toEqual([{ type: 'signed-in', userId: sessionFixture.user.id, sessionId: sessionFixture.session.id }])
  })

  it('ends only the tab whose session a sign-out names', () => {
    const { bus, navigate } = live()
    bus.send({ type: 'signed-out', userId: sessionFixture.user.id, sessionId: newSession })
    expect(navigate).not.toHaveBeenCalled()
    bus.send({ type: 'signed-out', userId: sessionFixture.user.id, sessionId: sessionFixture.session.id })
    expect(navigate).toHaveBeenCalledOnce()
    expect(takeNotice()).toBe(notices.signedOutElsewhere)
  })

  it('reloads with a notice when someone else signs in from another tab', () => {
    const { bus, navigate } = live()
    bus.send({ type: 'signed-in', userId: otherUser, sessionId: newSession })
    expect(navigate).toHaveBeenCalledOnce()
    expect(takeNotice()).toBe(notices.otherUser)
  })

  it('adopts a new session of the same user and discards answers to older requests', () => {
    const { controller, bus, navigate } = live()
    const before = controller.credentials()
    const heard = vi.fn()
    before.generation!.subscribe(heard)
    bus.send({ type: 'signed-in', userId: sessionFixture.user.id, sessionId: newSession })
    expect(navigate).not.toHaveBeenCalled()
    expect(controller.sessionId).toBe(newSession)
    expect(controller.generation).toBe(1)
    expect(before.generation!.current()).toBe(1)
    expect(heard).toHaveBeenCalledOnce()
    // A 401 to a request sent under generation 0 is stale.
    controller.handleFailure({ status: 401, generation: 0 })
    expect(navigate).not.toHaveBeenCalled()
    controller.handleFailure({ status: 401, generation: 1 })
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('ignores malformed messages and stops listening once disposed', () => {
    const { controller, bus, navigate } = live()
    bus.send({ type: 'signed-in', userId: 'not-a-guid', sessionId: newSession })
    bus.send('signed-out')
    expect(navigate).not.toHaveBeenCalled()
    controller.dispose()
    expect(bus.open()).toBe(0)
  })
})

describe('after the session ends', () => {
  const isText = (value: unknown): value is string => typeof value === 'string'
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const accountId = '5c5e3f43-2aa4-4b7a-9d1e-0e6b0d3c5a11'
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(settle => { resolve = settle })
    return { promise, resolve }
  }
  /** Another tab first adopts a newer session of the same user, then someone else signs in there. */
  function sameUserThenOther(bus: ReturnType<typeof channelBus>) {
    bus.send({ type: 'signed-in', userId: sessionFixture.user.id, sessionId: newSession })
    bus.send({ type: 'signed-in', userId: otherUser, sessionId: '8d2e4f61-3a7b-4c85-b0e1-6f8a2d5c7b34' })
  }
  /** An SSE response that stays open until its request is aborted. */
  function liveStream(signal: AbortSignal | null | undefined) {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    signal?.addEventListener('abort', () => { try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* closed */ } }, { once: true })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  }

  it('never reissues an older read once another person\'s sign-in has started the reload', async () => {
    const { controller, bus, navigate } = live()
    const pending = deferred<Response>()
    const failures = vi.fn(), changed = vi.fn()
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json('after the user changed'))
    vi.stubGlobal('fetch', fetch)
    const result = createApiCall(controller.credentials(), failures, changed)('/api/example', { timeout: 1_000, validate: isText })
    sameUserThenOther(bus)
    expect(navigate).toHaveBeenCalledOnce()
    pending.resolve(json('old'))
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(failures).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })

  it('never reopens a generation-bound stream, and the stream settles quietly', async () => {
    const { controller, bus, navigate } = live()
    const fetch = vi.fn(async (_path: string, init: RequestInit) => liveStream(init.signal))
    vi.stubGlobal('fetch', fetch)
    const stop = new AbortController()
    const onEvent = vi.fn()
    const done = createWorkspaceApi(controller.credentials(), controller.handleFailure).marketStream(accountId, { instrument: 'BTC', interval: '1h' }, stop.signal, onEvent)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    sameUserThenOther(bus)
    expect(navigate).toHaveBeenCalledOnce()
    await expect(done).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
    expect(onEvent).not.toHaveBeenCalled()
    expect(stop.signal.aborted).toBe(false)
  })

  it.each<[string, (tab: ReturnType<typeof live>) => unknown]>([
    ['a forced teardown', tab => tab.controller.handleFailure({ status: 401, generation: 0 })],
    ['a voluntary sign-out', tab => tab.controller.signOut({ signOut: vi.fn().mockResolvedValue(undefined) })],
    ['another person\'s sign-in', tab => tab.bus.send({ type: 'signed-in', userId: otherUser, sessionId: newSession })],
    ['disposal', tab => tab.controller.dispose()],
  ])('after %s, aborts what is in flight, sends nothing more and never asks the shell to reload', async (_, end) => {
    const tab = live()
    const credentials = tab.controller.credentials()
    const events: ApiEvent[] = []
    let sent: AbortSignal | null | undefined
    const fetch = vi.fn((_path: string, init: RequestInit) => {
      sent = init.signal
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    vi.stubGlobal('fetch', fetch)
    const api = createWorkspaceApi(credentials, tab.controller.handleFailure)
    onApiEvent(api, event => events.push(event))
    const write = api.deletePlay('8b7c7a64-34b4-4d61-9b5f-1b0b9d5c1e20')
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await end(tab)
    expect(credentials.generation!.ended.aborted).toBe(true)
    expect(sent?.aborted).toBe(true)
    await expect(write).rejects.toMatchObject({ name: 'AbortError' })
    await expect(api.overview()).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(events).toEqual([])
  })
})
