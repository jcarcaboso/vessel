import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip } from 'radix-ui'
import { describe, expect, it, vi } from 'vitest'
import { createPublicAuthApi, createSessionAuthApi } from '@/api/auth'
import { createWorkspaceApi } from '@/api/workspace'
import { NotificationProvider } from '@/components/notifications/NotificationProvider'
import { useMonitorEvents } from '@/features/workspace/useMonitorEvents'
import { secondWalletFixture, sessionFixture, sessionRowsFixture, walletFixture } from '@/test/identity-fixture'
import { eventCursor } from '@/test/monitor-fixture'
import { channelBus } from '@/test/session-channel'
import { ProfileSettings } from './ProfileSettings'
import { SessionController } from './session'
import { SignInGate } from './SignInGate'
import type { ShellIdentity } from './types'

const json = (body: unknown) => new Response(JSON.stringify(body))
function live() {
  const bus = channelBus()
  const navigate = vi.fn()
  const controller = new SessionController({ session: sessionFixture, channels: bus.factory, navigate })
  controller.markLive()
  return { bus, navigate, controller }
}
/** Someone else signs in in another tab: this tab's session ends and the page is replaced. */
function otherSignIn(bus: ReturnType<typeof channelBus>) {
  bus.send({ type: 'signed-in', userId: '7d2e4f61-3a7b-4c85-b0e1-6f8a2d5c7b34', sessionId: '8d2e4f61-3a7b-4c85-b0e1-6f8a2d5c7b34' })
}
/** A request that stays open until it is aborted, like the browser. */
function pending(signal: AbortSignal | null | undefined) {
  return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
}

describe('a session that ends while a request is pending', () => {
  it('does not turn the gate\'s system read into a workspace-load failure', async () => {
    const bus = channelBus(), navigate = vi.fn()
    const api = createPublicAuthApi()
    vi.spyOn(api, 'session').mockResolvedValue(sessionFixture)
    const fetch = vi.fn((_path: string, init: RequestInit) => pending(init.signal))
    vi.stubGlobal('fetch', fetch)
    const view = render(<SignInGate registration="invitation" originAccepted publicApi={api} channels={bus.factory} navigate={navigate}>
      {() => <p>Workspace</p>}</SignInGate>)
    try {
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
      await act(async () => { otherSignIn(bus) })
      expect(navigate).toHaveBeenCalledOnce()
      expect((fetch.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true)
      expect(screen.queryByText('The workspace could not be loaded.')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
      expect(screen.getByRole('status')).toHaveTextContent('Loading your workspace…')
    } finally { view.unmount() }
  })

  it('does not report a pending wallet removal as failed or reload the wallets', async () => {
    const tab = live()
    const fetch = vi.fn((path: string, init: RequestInit) => {
      if (init.method === 'DELETE') return pending(init.signal)
      return Promise.resolve(json(path === '/api/auth/wallets' ? [walletFixture, secondWalletFixture] : sessionRowsFixture))
    })
    vi.stubGlobal('fetch', fetch)
    const identity: ShellIdentity = { session: sessionFixture, walletName: null, auth: createSessionAuthApi(tab.controller.credentials(), tab.controller.handleFailure),
      registerExitState: () => () => {}, onProfile: vi.fn(), checkSession: vi.fn(async () => 'current' as const),
      onSessionChange: listener => tab.controller.sessionGeneration.subscribe(listener) }
    const view = render(<Tooltip.Provider><NotificationProvider><ProfileSettings identity={identity} onSignOut={vi.fn()} /></NotificationProvider></Tooltip.Provider>)
    try {
      const user = userEvent.setup()
      const removes = await screen.findAllByRole('button', { name: 'Remove' })
      await user.click(removes[0]!)
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove wallet' }))
      await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(true))
      const sent = fetch.mock.calls.length
      await act(async () => { otherSignIn(tab.bus) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(tab.navigate).toHaveBeenCalledOnce()
      expect(screen.queryByText('The wallet could not be removed.')).toBeNull()
      expect(fetch).toHaveBeenCalledTimes(sent)
    } finally { view.unmount(); tab.controller.dispose() }
  })

  it('does not publish monitor-unavailable for a pending monitor summary', async () => {
    const tab = live()
    const fetch = vi.fn((path: string, init: RequestInit) => path.startsWith('/api/events?')
      ? Promise.resolve(json({ events: [], nextCursor: eventCursor('0'), resetRequired: false }))
      : pending(init.signal))
    vi.stubGlobal('fetch', fetch)
    const api = createWorkspaceApi(tab.controller.credentials(), tab.controller.handleFailure)
    const view = renderHook(() => useMonitorEvents(api, true, vi.fn(), 0))
    try {
      await waitFor(() => expect(fetch.mock.calls.some(([path]) => path === '/api/monitor')).toBe(true))
      await act(async () => { otherSignIn(tab.bus) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
      expect(tab.navigate).toHaveBeenCalledOnce()
      expect(view.result.current.error).toBeNull()
    } finally { view.unmount(); tab.controller.dispose() }
  })
})
