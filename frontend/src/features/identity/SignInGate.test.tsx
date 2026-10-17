import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { challengeFixture, sessionFixture, walletFixture } from '@/test/identity-fixture'
import { channelBus } from '@/test/session-channel'
import { systemFixture } from '@/test/system-fixture'
import { lastWalletKey } from './wallets/discovery'
import type { WalletProvider } from './wallets/provider'
import { noticeKey, notices } from './session'
import { SignInGate } from './SignInGate'

const address = walletFixture.address
const other = '0x19B4c7aE02F3d81e6C5a9b0D2E7f4A3c8D1e0a53'
const signature = `0x${'ab'.repeat(65)}`
type Route = (init: RequestInit) => Response | Promise<Response>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const problem = (status: number, code: string) => json({ title: 'private', code }, status)

let routes: Record<string, Route>
let calls: Array<{ path: string; init: RequestInit }>
let wallet: WalletProvider & { emit: (event: string, value?: unknown) => void; requests: Array<{ method: string; params?: unknown[] }> }
let announcer: () => void

function walletProvider(sign: () => Promise<unknown> = async () => signature) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const requests: Array<{ method: string; params?: unknown[] }> = []
  return {
    requests,
    request: vi.fn(async (args: { method: string; params?: unknown[] }) => {
      requests.push(args)
      if (args.method === 'eth_requestAccounts') return [address]
      if (args.method === 'personal_sign') return sign()
      throw Object.assign(new Error('unexpected'), { code: 4200 })
    }),
    on: (event: string, listener: (...args: unknown[]) => void) => { listeners.set(event, (listeners.get(event) ?? new Set()).add(listener)) },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => { listeners.get(event)?.delete(listener) },
    emit: (event: string, value?: unknown) => { for (const listener of listeners.get(event) ?? []) listener(value) },
  }
}

beforeEach(() => {
  calls = []
  wallet = walletProvider()
  routes = {
    '/api/auth/session': () => problem(401, 'session-required'),
    '/api/auth/challenge': init => json(challengeFixture(JSON.parse(init.body as string).address)),
    '/api/auth/verify': () => json({ status: 'signed-in', session: sessionFixture }),
    '/api/system': () => json(systemFixture),
  }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    calls.push({ path, init })
    const route = routes[path]
    return route ? route(init) : new Response(null, { status: 404 })
  }))
  announcer = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info: { uuid: 'rabby-uuid', name: 'Rabby Wallet', icon: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E', rdns: 'io.rabby' }, provider: wallet },
  }))
  window.addEventListener('eip6963:requestProvider', announcer)
})
afterEach(() => window.removeEventListener('eip6963:requestProvider', announcer))

function mount(bus = channelBus(), navigate = vi.fn()) {
  const view = render(<SignInGate registration="invitation" originAccepted channels={bus.factory} navigate={navigate}>
    {(system, _disconnect, api, identity) => <p>Shell for {identity.session.user.displayName} · {system.owner.displayName} · {typeof api.overview}</p>}
  </SignInGate>)
  return { ...view, bus, navigate, user: userEvent.setup() }
}
const sent = (path: string) => calls.filter(call => call.path === path)
const headers = (path: string) => sent(path).at(-1)!.init.headers as Record<string, string>

describe('session probe', () => {
  it('shows sign-in on a 401 without reloading, using the public call kind', async () => {
    const { navigate } = mount()
    expect(await screen.findByRole('heading', { name: 'Sign in to Vessel' })).toBeVisible()
    expect(navigate).not.toHaveBeenCalled()
    expect(headers('/api/auth/session')).toEqual({ 'X-Vessel-Request': '1', Accept: 'application/json' })
    expect(sent('/api/auth/session')[0]!.init).toMatchObject({ credentials: 'same-origin', referrerPolicy: 'same-origin' })
    expect(sessionStorage.getItem(noticeKey)).toBeNull()
  })

  it('shows the notice a teardown left, once', async () => {
    sessionStorage.setItem(noticeKey, notices.ended)
    mount()
    expect(await screen.findByText(notices.ended)).toBeVisible()
    expect(sessionStorage.getItem(noticeKey)).toBeNull()
  })

  it('opens the workspace for an existing session with the session kind, without announcing a new sign-in', async () => {
    routes['/api/auth/session'] = () => json(sessionFixture)
    const { bus } = mount()
    expect(await screen.findByText(`Shell for ${sessionFixture.user.displayName} · ${systemFixture.owner.displayName} · function`)).toBeVisible()
    expect(headers('/api/system')).toMatchObject({ 'X-Vessel-User': sessionFixture.user.id })
    expect(sent('/api/system')[0]!.init).toMatchObject({ credentials: 'same-origin', referrerPolicy: 'same-origin' })
    expect(bus.posted).toEqual([])
  })

  it('shows the suspended screen when the probe says so', async () => {
    routes['/api/auth/session'] = () => problem(403, 'user-suspended')
    mount()
    expect(await screen.findByRole('heading', { name: 'Journal suspended' })).toBeVisible()
  })

  it('offers a retry when Vessel is unreachable', async () => {
    routes['/api/auth/session'] = () => { throw new TypeError('offline') }
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(sent('/api/auth/session')).toHaveLength(2)
  })
})

describe('wallet sign-in', () => {
  it('connects, shows the message, signs and opens the workspace', async () => {
    const { bus, user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    expect(await screen.findByRole('heading', { name: 'Sign the message' })).toBeVisible()
    expect(screen.getByRole('timer')).toHaveTextContent(/^[45]:\d\d$/)
    expect(screen.getByLabelText('Message to sign')).toHaveTextContent('Sign in to Vessel. This is not a transaction and costs no gas.')
    expect(JSON.parse(sent('/api/auth/challenge')[0]!.init.body as string)).toEqual({ address })
    expect(headers('/api/auth/challenge')).toMatchObject({ 'X-Vessel-Request': '1' })
    const remember = screen.getByRole('checkbox', { name: 'Keep me signed in on this device' })
    expect(remember).not.toBeChecked()
    await user.click(remember)
    await user.click(screen.getByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(await screen.findByText(/^Shell for Sam Rivera/)).toBeVisible()
    const message = challengeFixture(address).message
    expect(wallet.requests.map(request => request.method)).toEqual(['eth_requestAccounts', 'personal_sign'])
    const params = wallet.requests[1]!.params as [string, string]
    expect(params[1]).toBe(address)
    expect(new TextDecoder().decode(Uint8Array.from(params[0].slice(2).match(/../g)!.map(byte => parseInt(byte, 16)))).split('\n')[0]).toBe(message.split('\n')[0])
    expect(JSON.parse(sent('/api/auth/verify')[0]!.init.body as string)).toEqual({ challengeId: challengeFixture().challengeId, signature, remember: true })
    expect(bus.posted).toEqual([{ type: 'signed-in', userId: sessionFixture.user.id, sessionId: sessionFixture.session.id }])
    expect(localStorage.getItem(lastWalletKey)).toBe('io.rabby')
  })

  it('creates a journal for a new wallet, asking for an invitation when the server requires one', async () => {
    routes['/api/auth/verify'] = () => json({ status: 'registration-required', registration: 'pending-registration-token', requiresInvitation: true, expiresAt: challengeFixture().expiresAt })
    routes['/api/auth/register'] = () => json({ session: sessionFixture }, 201)
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(await screen.findByRole('heading', { name: 'Create your journal' })).toBeVisible()
    expect(screen.getByText(/This wallet is your key\./)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create journal' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Use 1 to 60 printable characters for the display name.')
    await user.type(screen.getByLabelText('Display name'), '  Sam Rivera ')
    await user.click(screen.getByRole('button', { name: 'Create journal' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the invitation code')
    await user.type(screen.getByLabelText(/Invitation code/), 'VSL-7Q4MK-2XD00-00000-00000-0')
    await user.click(screen.getByRole('button', { name: 'Create journal' }))
    expect(await screen.findByText(/^Shell for Sam Rivera/)).toBeVisible()
    expect(JSON.parse(sent('/api/auth/register')[0]!.init.body as string)).toEqual({
      registration: 'pending-registration-token', displayName: 'Sam Rivera', invitation: 'VSL-7Q4MK-2XD00-00000-00000-0', remember: false })
  })

  it('keeps the pending registration after a refused invitation', async () => {
    routes['/api/auth/verify'] = () => json({ status: 'registration-required', registration: 'pending', requiresInvitation: false, expiresAt: challengeFixture().expiresAt })
    routes['/api/auth/register'] = () => problem(403, 'invitation-required')
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(screen.queryByLabelText(/Invitation code/)).not.toBeInTheDocument()
    await user.type(await screen.findByLabelText('Display name'), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Create journal' }))
    expect(await screen.findByLabelText(/Invitation code/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('heading', { name: 'Create your journal' })).toBeVisible()
  })

  it('shows the switched-account state and starts again with the new address', async () => {
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await screen.findByRole('heading', { name: 'Sign the message' })
    wallet.emit('accountsChanged', [other])
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { name: 'Wallet switched account' })).toBeVisible()
    await user.click(within(alert).getByRole('button', { name: 'Use new address' }))
    await screen.findByRole('heading', { name: 'Sign the message' })
    expect(JSON.parse(sent('/api/auth/challenge').at(-1)!.init.body as string)).toEqual({ address: other })
  })

  it('discards a signature that arrives after the person cancelled', async () => {
    let release!: (value: unknown) => void
    wallet = walletProvider(() => new Promise(resolve => { release = resolve }))
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(await screen.findByRole('button', { name: /Waiting for Rabby Wallet/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    release(signature)
    expect(await screen.findByRole('heading', { name: 'Sign in to Vessel' })).toBeVisible()
    await waitFor(() => expect(sent('/api/auth/verify')).toHaveLength(0))
  })

  it.each([
    ['declined', () => Promise.reject(Object.assign(new Error('private'), { code: 4001 })), 'Signature declined'],
  ])('shows the %s state with its next step', async (_name, sign, title) => {
    wallet = walletProvider(sign)
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
    expect(screen.queryByText('private')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: 'Sign the message' })
    expect(sent('/api/auth/challenge')).toHaveLength(2)
  })

  it.each([
    ['signature-unsupported', 'Signature not supported'],
    ['challenge-expired', 'Request expired'],
    ['registration-closed', 'Not admitting new journals'],
    ['user-suspended', 'Journal suspended'],
  ])('maps a verify %s to its state', async (code, title) => {
    routes['/api/auth/verify'] = () => problem(code === 'signature-unsupported' || code === 'challenge-expired' ? 400 : 403, code)
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  })

  it('waits out a rate limit before allowing a retry', async () => {
    routes['/api/auth/challenge'] = () => new Response(JSON.stringify({ code: 'rate-limited' }), { status: 429, headers: { 'Retry-After': '90' } })
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    expect(await screen.findByRole('heading', { name: 'Too many attempts' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Try again in 1:(29|30)/ })).toBeDisabled()
  })

  it('says when no browser wallet is found', async () => {
    window.removeEventListener('eip6963:requestProvider', announcer)
    mount()
    expect(await screen.findByRole('heading', { name: 'No browser wallet found' }, { timeout: 2_000 })).toBeVisible()
  })
})
