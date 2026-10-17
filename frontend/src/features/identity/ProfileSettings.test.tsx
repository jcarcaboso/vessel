import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip } from 'radix-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionAuthApi } from '@/api/auth'
import { NotificationProvider } from '@/components/notifications/NotificationProvider'
import { challengeFixture, secondWalletFixture, sessionFixture, sessionRowsFixture, walletFixture } from '@/test/identity-fixture'
import { ProfileSettings } from './ProfileSettings'
import type { ShellIdentity } from './types'

type Route = (init: RequestInit) => Response
let routes: Record<string, Route | Route[]>
let calls: Array<{ path: string; method: string; body: unknown }>
let announcer: () => void
let account = walletFixture.address
const signature = `0x${'cd'.repeat(65)}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const problem = (status: number, code: string) => json({ code }, status)
const sent = (path: string, method = 'POST') => calls.filter(call => call.path === path && call.method === method)

beforeEach(() => {
  calls = []
  account = walletFixture.address
  routes = {
    'GET /api/auth/wallets': () => json([walletFixture, secondWalletFixture]),
    'GET /api/auth/sessions': () => json(sessionRowsFixture),
    'POST /api/auth/step-up/challenge': init => json(challengeFixture(JSON.parse(init.body as string).address)),
    'POST /api/auth/step-up': () => new Response(null, { status: 204 }),
  }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    const method = init.method ?? 'GET'
    calls.push({ path, method, body: init.body ? JSON.parse(init.body as string) : undefined })
    const route = routes[`${method} ${path}`]
    const next = Array.isArray(route) ? route.shift() : route
    return next?.(init) ?? new Response(null, { status: 404 })
  }))
  const provider = { request: vi.fn(async ({ method }: { method: string }) => method === 'eth_requestAccounts' ? [account] : signature) }
  announcer = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info: { uuid: 'rabby-uuid', name: 'Rabby Wallet', icon: null, rdns: 'io.rabby' }, provider },
  }))
  window.addEventListener('eip6963:requestProvider', announcer)
})
afterEach(() => window.removeEventListener('eip6963:requestProvider', announcer))

function mount() {
  const identity: ShellIdentity = {
    session: sessionFixture, walletName: 'Rabby Wallet', auth: createSessionAuthApi({ userId: sessionFixture.user.id, sessionId: sessionFixture.session.id }),
    registerExitState: () => () => {}, onProfile: vi.fn(), endSession: vi.fn(),
  }
  render(<Tooltip.Provider><NotificationProvider><ProfileSettings identity={identity} onSignOut={vi.fn()} /></NotificationProvider></Tooltip.Provider>)
  return { identity, user: userEvent.setup() }
}

async function confirmWithRabby(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Confirm with a linked wallet' })
  await user.click(await within(dialog).findByRole('button', { name: /Rabby Wallet/ }))
  await user.click(await within(dialog).findByRole('button', { name: 'Sign with Rabby Wallet' }))
}

describe('Profile & sign-in', () => {
  it('removes a wallet after a step-up, retrying the refused call once', async () => {
    routes[`DELETE /api/auth/wallets/${secondWalletFixture.id}`] = [() => problem(403, 'step-up-required'), () => new Response(null, { status: 204 })]
    const { user, identity } = mount()
    const removes = await screen.findAllByRole('button', { name: /Remove/ })
    await user.click(removes[1]!)
    await user.click(await screen.findByRole('button', { name: 'Remove wallet' }))
    await confirmWithRabby(user)
    await waitFor(() => expect(sent(`/api/auth/wallets/${secondWalletFixture.id}`, 'DELETE')).toHaveLength(2))
    expect(sent('/api/auth/step-up/challenge')[0]!.body).toEqual({ action: 'wallet.remove', target: secondWalletFixture.id, address: walletFixture.address })
    expect(sent('/api/auth/step-up')[0]!.body).toEqual({ challengeId: challengeFixture().challengeId, signature })
    expect(identity.endSession).not.toHaveBeenCalled()
  })

  it('does not retry a second time when the server still asks for a step-up', async () => {
    routes[`DELETE /api/auth/wallets/${secondWalletFixture.id}`] = () => problem(403, 'step-up-required')
    const { user } = mount()
    await user.click((await screen.findAllByRole('button', { name: /Remove/ }))[1]!)
    await user.click(await screen.findByRole('button', { name: 'Remove wallet' }))
    await confirmWithRabby(user)
    expect(await screen.findByText('Confirm with a wallet already linked to this journal to continue.')).toBeVisible()
    expect(sent(`/api/auth/wallets/${secondWalletFixture.id}`, 'DELETE')).toHaveLength(2)
  })

  it('refuses a step-up from an address that is not linked, before asking the server', async () => {
    account = '0x19B4c7aE02F3d81e6C5a9b0D2E7f4A3c8D1e0a53'
    routes[`DELETE /api/auth/wallets/${secondWalletFixture.id}`] = () => problem(403, 'step-up-required')
    const { user } = mount()
    await user.click((await screen.findAllByRole('button', { name: /Remove/ }))[1]!)
    await user.click(await screen.findByRole('button', { name: 'Remove wallet' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm with a linked wallet' })
    await user.click(await within(dialog).findByRole('button', { name: /Rabby Wallet/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This address isn’t linked to your journal.')
    expect(sent('/api/auth/step-up/challenge')).toHaveLength(0)
  })

  it('leaves this tab when the removed wallet signed this session', async () => {
    routes[`DELETE /api/auth/wallets/${walletFixture.id}`] = () => new Response(null, { status: 204 })
    const { user, identity } = mount()
    await user.click((await screen.findAllByRole('button', { name: /Remove/ }))[0]!)
    expect(await screen.findByText(/Removing it signs you out here/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Remove wallet' }))
    await waitFor(() => expect(identity.endSession).toHaveBeenCalledOnce())
  })

  it('links a wallet: step-up first, then the new wallet signs its own message', async () => {
    routes['POST /api/auth/wallets/challenge'] = init => json(challengeFixture(JSON.parse(init.body as string).address))
    routes['POST /api/auth/wallets'] = () => json({ ...secondWalletFixture, id: '7f3a1c9e-2b4d-4e8f-a6c0-5d9e1b3f7a24', address: '0x19B4c7aE02F3d81e6C5a9b0D2E7f4A3c8D1e0a53', label: 'Phone' }, 201)
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: 'Link wallet' }))
    const dialog = await screen.findByRole('dialog', { name: 'Link another wallet' })
    await user.click(await within(dialog).findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await within(dialog).findByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(await within(dialog).findByText(/Now sign with the wallet you want to add/)).toBeVisible()
    account = '0x19B4c7aE02F3d81e6C5a9b0D2E7f4A3c8D1e0a53'
    await user.click(await within(dialog).findByRole('button', { name: /Rabby Wallet/ }))
    await user.type(await within(dialog).findByLabelText(/Label/), 'Phone')
    await user.click(within(dialog).getByRole('button', { name: 'Sign with Rabby Wallet' }))
    await waitFor(() => expect(sent('/api/auth/wallets')).toHaveLength(1))
    expect(sent('/api/auth/step-up/challenge')[0]!.body).toEqual({ action: 'wallet.link', address: walletFixture.address })
    expect(sent('/api/auth/wallets/challenge')[0]!.body).toEqual({ address: account })
    expect(sent('/api/auth/wallets')[0]!.body).toEqual({ challengeId: challengeFixture().challengeId, signature, label: 'Phone' })
  })
})
