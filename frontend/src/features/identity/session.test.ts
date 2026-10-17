import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
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
