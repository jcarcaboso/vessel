import { useEffect, type RefObject } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionAuthApi } from '@/api/auth'
import { emitApiEvent } from '@/api/events'
import { createWorkspaceApi } from '@/api/workspace'
import { noticeKey, notices, SessionController, workspaceNotices } from '@/features/identity/session'
import type { ShellIdentity } from '@/features/identity/types'
import { createPlaysSession, type PlaysSession } from '@/features/plays/saved'
import { secondWalletFixture, sessionFixture, sessionRowsFixture, walletFixture } from '@/test/identity-fixture'
import { channelBus } from '@/test/session-channel'
import { systemFixture } from '@/test/system-fixture'
import { emptyOverview, playApiStubs } from '@/test/workspace-fixture'
import { ApplicationShell } from './ApplicationShell'

type PlaysProps = { session: PlaysSession; onSession: (session: PlaysSession) => void; workRef: RefObject<symbol | null> }
let plays: PlaysProps
vi.mock('@/features/plays/PlaysPage', () => ({ PlaysPage: function TestPlays(props: PlaysProps) {
  useEffect(() => { plays = props })
  return <p>Test Play editor</p>
} }))

type Route = (init: RequestInit) => Response
let routes: Record<string, Route>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const problem = (status: number, code: string) => json({ code }, status)

function unload() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
function dirty() {
  const session = createPlaysSession()
  act(() => plays.onSession({ ...session, draft: { ...session.draft, leverage: '3' } }))
}

async function mount(role: 'member' | 'operator' = 'member', extra: Partial<ShellIdentity> = {}) {
  const session = { ...sessionFixture, user: { ...sessionFixture.user, role } }
  const navigate = vi.fn()
  const controller = new SessionController({ session, channels: channelBus().factory, navigate })
  controller.markLive()
  const api = { ...createWorkspaceApi(controller.credentials(), controller.handleFailure), ...playApiStubs(), overview: vi.fn().mockResolvedValue(emptyOverview) }
  const identity: ShellIdentity = {
    session, walletName: 'Rabby Wallet', auth: createSessionAuthApi(controller.credentials(), controller.handleFailure),
    registerExitState: clear => controller.registerExitState(clear), onProfile: vi.fn(), endSession: () => controller.teardown(notices.ended),
    ...extra,
  }
  const disconnect = vi.fn()
  render(<ApplicationShell system={systemFixture} api={api} disconnect={disconnect} identity={identity} />)
  await screen.findByText('Test Play editor')
  await waitFor(() => expect(plays).toBeDefined())
  return { identity, navigate, disconnect, api, user: userEvent.setup() }
}

beforeEach(() => {
  plays = undefined as unknown as PlaysProps
  window.history.replaceState(null, '', '/#plays')
  routes = {
    '/api/auth/sessions': () => json(sessionRowsFixture),
    '/api/auth/wallets': () => json([walletFixture, secondWalletFixture]),
  }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => routes[path]?.(init) ?? new Response(null, { status: 404 })))
})
afterEach(() => vi.restoreAllMocks())

describe('Wallet-mode session teardown in the shell', () => {
  it('drops unsaved-work protection on a 401, so the reload never asks, and leaves the notice', async () => {
    const { identity, navigate } = await mount()
    dirty()
    expect(unload()).toBe(true)
    routes['/api/auth/sessions'] = () => problem(401, 'session-expired')
    await expect(identity.auth.sessions()).rejects.toMatchObject({ status: 401 })
    expect(navigate).toHaveBeenCalledOnce()
    expect(unload()).toBe(false)
    expect(sessionStorage.getItem(noticeKey)).toBe(notices.ended)
  })

  it('keeps the workspace and its protection for a 403 that is not about the session', async () => {
    const { identity, navigate } = await mount()
    dirty()
    routes['/api/auth/sessions'] = () => problem(403, 'csrf-rejected')
    await expect(identity.auth.sessions()).rejects.toMatchObject({ status: 403 })
    expect(navigate).not.toHaveBeenCalled()
    expect(unload()).toBe(true)
    expect(screen.getByText('Test Play editor')).toBeInTheDocument()
  })
})

describe('session notices in the workspace', () => {
  it('shows a notice the reload left, as a dismissible status, and only then marks it shown', async () => {
    const noticePresented = vi.fn()
    const { user } = await mount('member', { notice: workspaceNotices[notices.otherUser], noticePresented })
    const status = await screen.findByText(workspaceNotices[notices.otherUser])
    expect(status.closest('[role="status"]')).not.toBeNull()
    expect(noticePresented).toHaveBeenCalled()
    await user.click(within(status.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Dismiss notification' }))
    await waitFor(() => expect(screen.queryByText(workspaceNotices[notices.otherUser])).not.toBeInTheDocument())
  })

  it('reloads the workspace and says why when a write was answered under a session another tab replaced', async () => {
    const { api, navigate } = await mount()
    const overviews = vi.mocked(api.overview).mock.calls.length
    // The client emits this when it drops a write's answer (see request.generation.test.ts).
    act(() => emitApiEvent(api, { type: 'session-changed' }))
    expect(await screen.findByText(/Your session changed in another tab\. Vessel reloaded your workspace/)).toBeVisible()
    await waitFor(() => expect(vi.mocked(api.overview).mock.calls.length).toBeGreaterThan(overviews))
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('account menu', () => {
  it('opens from the owner card and signs out after the unsaved-Play confirmation', async () => {
    const { disconnect, user } = await mount()
    dirty()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: /^Sam Rivera, account menu/ }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Profile & sign-in' })).toBeVisible()
    expect(await within(menu).findByRole('menuitem', { name: /Sessions/ })).toHaveTextContent('2')
    expect(within(menu).queryByRole('menuitem', { name: /Users & invitations/ })).not.toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
    expect(confirm).toHaveBeenCalledWith('Sign out and discard unsaved Play work?')
    expect(disconnect).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /^Sam Rivera, account menu/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('returns focus to the owner card on Escape, and moves it to Sessions when chosen', async () => {
    const { user } = await mount()
    const trigger = screen.getByRole('button', { name: /^Sam Rivera, account menu/ })
    await user.click(trigger)
    await screen.findByRole('menu')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: /Sessions/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sessions' })).toHaveFocus())
  })

  it('shows operators a disabled Users & invitations item until its page exists', async () => {
    const { user } = await mount('operator')
    await user.click(screen.getByRole('button', { name: /^Sam Rivera, account menu/ }))
    const item = await screen.findByRole('menuitem', { name: /Users & invitations/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('Soon')
  })

  it('opens Settings on Profile & sign-in with wallets and sessions', async () => {
    const { user } = await mount()
    await user.click(screen.getByRole('button', { name: /^Sam Rivera, account menu/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Profile & sign-in' }))
    expect(await screen.findByRole('tab', { name: 'Profile & sign-in', selected: true })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Private session' })).not.toBeInTheDocument()
    const wallets = await screen.findByRole('region', { name: /Sign-in wallets/ })
    expect(await within(wallets).findByText('This session')).toBeVisible()
    expect(within(wallets).getAllByRole('button', { name: /Remove/ })).toHaveLength(2)
    const sessions = screen.getByRole('region', { name: 'Sessions' })
    expect(within(sessions).getByText('This browser')).toBeVisible()
    expect(within(sessions).getByRole('button', { name: 'Sign out Safari on iOS session' })).toBeVisible()
  })

  it('opens the step-up dialog when removing a wallet needs a fresh signature, without tearing down', async () => {
    const { user, navigate } = await mount()
    routes[`/api/auth/wallets/${secondWalletFixture.id}`] = () => problem(403, 'step-up-required')
    await user.click(screen.getByRole('button', { name: /^Sam Rivera, account menu/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Profile & sign-in' }))
    const wallets = await screen.findByRole('region', { name: /Sign-in wallets/ })
    const removes = await within(wallets).findAllByRole('button', { name: /Remove/ })
    await user.click(removes[1]!)
    await user.click(await screen.findByRole('button', { name: 'Remove wallet' }))
    expect(await screen.findByRole('dialog', { name: 'Confirm with a linked wallet' })).toBeVisible()
    expect(navigate).not.toHaveBeenCalled()
  })
})
