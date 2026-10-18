import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { Tooltip } from 'radix-ui'
import { createPublicAuthApi, type SessionDto } from '@/api/auth'
import { ApiError } from '@/api/errors'
import { NotificationProvider } from '@/components/notifications/NotificationProvider'
import { challengeFixture, secondWalletFixture, sessionFixture, sessionRowsFixture, walletFixture } from '@/test/identity-fixture'
import { channelBus } from '@/test/session-channel'
import { systemFixture } from '@/test/system-fixture'
import { lastWalletKey } from './wallets/discovery'
import type { WalletProvider } from './wallets/provider'
import { landingKey, noticeKey, notices, workspaceNotices } from './session'
import { SignInGate } from './SignInGate'
import { SignInScreen } from './SignInScreen'
import { ProfileSettings } from './ProfileSettings'
import type { ShellIdentity } from './types'

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

function walletProvider(sign: () => Promise<unknown> = async () => signature, account = address) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const requests: Array<{ method: string; params?: unknown[] }> = []
  return {
    requests,
    request: vi.fn(async (args: { method: string; params?: unknown[] }) => {
      requests.push(args)
      if (args.method === 'eth_requestAccounts') return [account]
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

  describe('a probe that answers after the gate is gone', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void
      const promise = new Promise<T>(settle => { resolve = settle })
      return { promise, resolve }
    }
    async function retryThenUnmount(replace?: (view: ReturnType<typeof render>, api: ReturnType<typeof createPublicAuthApi>) => void) {
      const pending = deferred<SessionDto>()
      let retried: AbortSignal | undefined
      const api = createPublicAuthApi()
      vi.spyOn(api, 'session').mockRejectedValueOnce(new ApiError('unavailable', 'unreachable'))
        .mockImplementationOnce(signal => { retried = signal; return pending.promise })
      const bus = channelBus()
      const gate = (publicApi: typeof api) => <SignInGate registration="invitation" originAccepted publicApi={publicApi} channels={bus.factory} navigate={vi.fn()}>
        {() => <p>Workspace</p>}</SignInGate>
      const view = render(gate(api))
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }))
      expect(api.session).toHaveBeenCalledTimes(2)
      if (replace) view.rerender(gate(createPublicAuthApi()))
      else view.unmount()
      const aborted = retried?.aborted
      pending.resolve(sessionFixture)
      await new Promise(resolve => setTimeout(resolve, 25))
      return { aborted, bus }
    }

    it('aborts a manual Retry on unmount, and its late answer opens no session channel or workspace', async () => {
      const { aborted, bus } = await retryThenUnmount()
      expect(aborted).toBe(true)
      expect(bus.open()).toBe(0)
      expect(sent('/api/system')).toHaveLength(0)
    })

    it('aborts a manual Retry when the public client is replaced', async () => {
      const { aborted } = await retryThenUnmount(() => undefined)
      expect(aborted).toBe(true)
    })
  })
})

describe('notices and the reload boundary', () => {
  function mountShell(bus = channelBus(), navigate = vi.fn()) {
    const view = render(<SignInGate registration="invitation" originAccepted channels={bus.factory} navigate={navigate}>
      {(_system, _disconnect, _api, identity) => <div><p>Shell for {identity.session.user.displayName}</p>
        {identity.notice && <p role="status">{identity.notice}</p>}
        <button type="button" onClick={() => identity.noticePresented?.()}>Presented</button></div>}
    </SignInGate>)
    return { ...view, navigate, user: userEvent.setup() }
  }

  it('hands the notice to the workspace when the reload finds another person signed in, and keeps it until shown', async () => {
    sessionStorage.setItem(noticeKey, notices.otherUser)
    routes['/api/auth/session'] = () => json(sessionFixture)
    const { user } = mountShell()
    expect(await screen.findByText(workspaceNotices[notices.otherUser])).toHaveAttribute('role', 'status')
    expect(screen.getByText(/^Shell for Sam Rivera/)).toBeVisible()
    expect(sessionStorage.getItem(noticeKey)).toBe(notices.otherUser)
    await user.click(screen.getByRole('button', { name: 'Presented' }))
    await waitFor(() => expect(screen.queryByText(workspaceNotices[notices.otherUser])).not.toBeInTheDocument())
    expect(sessionStorage.getItem(noticeKey)).toBeNull()
  })

  it('does not repeat a notice the sign-in card already showed', async () => {
    sessionStorage.setItem(noticeKey, notices.ended)
    const { user } = mountShell()
    expect(await screen.findByText(notices.ended)).toBeVisible()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(await screen.findByText(/^Shell for Sam Rivera/)).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reloads onto the chooser when the session fails before the workspace is shown, and the next load does not loop', async () => {
    routes['/api/auth/session'] = () => json(sessionFixture)
    routes['/api/system'] = () => problem(401, 'session-revoked')
    const first = mountShell()
    await waitFor(() => expect(first.navigate).toHaveBeenCalledOnce())
    expect(sessionStorage.getItem(landingKey)).toBe('sign-in')
    expect(sessionStorage.getItem(noticeKey)).toBe(notices.ended)
    first.unmount()
    // The reload: the cookie still opens the probe, so only the marker keeps this from coming back here.
    const probes = sent('/api/auth/session').length
    const second = mountShell()
    expect(await screen.findByRole('heading', { name: 'Sign in to Vessel' })).toBeVisible()
    expect(screen.getByText(notices.ended)).toBeVisible()
    expect(sent('/api/auth/session')).toHaveLength(probes)
    expect(second.navigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(landingKey)).toBeNull()
    second.unmount()
    // The marker is one-shot: a later load probes as usual.
    mountShell()
    await waitFor(() => expect(sent('/api/auth/session')).toHaveLength(probes + 1))
  })

  it('reloads onto the chooser from the suspended screen', async () => {
    routes['/api/auth/session'] = () => problem(403, 'user-suspended')
    const first = mountShell()
    await first.user.click(await screen.findByRole('button', { name: 'Use another wallet' }))
    expect(first.navigate).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(landingKey)).toBe('sign-in')
    first.unmount()
    mountShell()
    expect(await screen.findByRole('heading', { name: 'Sign in to Vessel' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Journal suspended' })).not.toBeInTheDocument()
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

  it('shows the checksum address a wallet shared in lower case, and signs with the address as shared', async () => {
    const checksummed = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' // An EIP-55 test vector.
    wallet = walletProvider(undefined, checksummed.toLowerCase())
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await screen.findByRole('timer')
    expect(screen.getByText('0x5aAe…eAed')).toHaveAttribute('title', checksummed)
    await user.click(screen.getByRole('button', { name: 'Sign with Rabby Wallet' }))
    await screen.findByText(/^Shell for Sam Rivera/)
    expect((wallet.requests[1]!.params as [string, string])[1]).toBe(checksummed.toLowerCase())
  })

  it('truncates a long announced wallet name without widening the card, keeping the full name accessible', async () => {
    const long = 'A'.repeat(40)
    window.removeEventListener('eip6963:requestProvider', announcer)
    announcer = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid: 'long-uuid', name: long, icon: null, rdns: 'test.long' }, provider: wallet },
    }))
    window.addEventListener('eip6963:requestProvider', announcer)
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: new RegExp(long) }))
    await screen.findByRole('timer')
    const sign = screen.getByRole('button', { name: `Sign with ${long}` })
    expect(sign).toHaveClass('sign-in-primary')
    expect(sign.querySelector('.identity-truncate')).toHaveTextContent(`Sign with ${long}`)
    expect(screen.getByTitle(long).tagName).toBe('STRONG')
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

  it('locks the remember choice once signing starts, so verify sends what the box shows', async () => {
    let release!: (value: unknown) => void
    wallet = walletProvider(() => new Promise(resolve => { release = resolve }))
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    const remember = await screen.findByRole('checkbox', { name: 'Keep me signed in on this device' })
    await user.click(remember)
    await user.click(screen.getByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(await screen.findByRole('button', { name: /Waiting for Rabby Wallet/ })).toBeDisabled()
    expect(remember).toBeDisabled()
    await user.click(remember)
    expect(remember).toBeChecked()
    release(signature)
    expect(await screen.findByText(/^Shell for Sam Rivera/)).toBeVisible()
    expect(JSON.parse(sent('/api/auth/verify')[0]!.init.body as string)).toMatchObject({ remember: true })
  })

  it('unlocks the remember choice when the wallet declines', async () => {
    wallet = walletProvider(() => Promise.reject(Object.assign(new Error('private'), { code: 4001 })))
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('checkbox', { name: 'Keep me signed in on this device' })).toBeEnabled()
  })

  it('never reports a sign-in whose verification answers after the screen unmounted', async () => {
    let answer!: (response: Response) => void
    routes['/api/auth/verify'] = () => new Promise(resolve => { answer = resolve })
    const onSignedIn = vi.fn()
    const user = userEvent.setup()
    const view = render(<SignInScreen api={createPublicAuthApi()} registration="invitation" originAccepted notice={null} onSignedIn={onSignedIn} />)
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    await waitFor(() => expect(sent('/api/auth/verify')).toHaveLength(1))
    view.unmount()
    answer(json({ status: 'signed-in', session: sessionFixture }))
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(localStorage.getItem(lastWalletKey)).toBeNull()
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

  it('shows the unsupported-signature state for a smart account\'s ERC-6492 signature without spending the challenge', async () => {
    wallet = walletProvider(async () => `0x${'00'.repeat(200)}${'6492'.repeat(16)}`)
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    expect(await screen.findByRole('heading', { name: 'Signature not supported' })).toBeVisible()
    expect(sent('/api/auth/verify')).toHaveLength(0)
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
    const wait = screen.getByRole('button', { name: /Try again in 1:(29|30)/ })
    expect(wait).toBeDisabled()
    // Waiting reads as muted text in an outline, not a faded primary fill.
    expect(wait).toHaveClass('identity-waiting')
    expect(wait).not.toHaveClass('bg-primary')
  })

  it('holds Create journal until a registration rate limit passes, keeping what was typed', async () => {
    routes['/api/auth/verify'] = () => json({ status: 'registration-required', registration: 'pending', requiresInvitation: true, expiresAt: challengeFixture().expiresAt })
    routes['/api/auth/register'] = () => new Response(JSON.stringify({ code: 'rate-limited' }), { status: 429, headers: { 'Retry-After': '90' } })
    const { user } = mount()
    await user.click(await screen.findByRole('button', { name: /Rabby Wallet/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign with Rabby Wallet' }))
    await user.type(await screen.findByLabelText('Display name'), 'Sam')
    await user.type(screen.getByLabelText(/Invitation code/), 'VSL-CODE')
    await user.click(screen.getByRole('button', { name: 'Create journal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Wait (89|90) seconds before trying again\./)
    const create = screen.getByRole('button', { name: /^Create journal in 1:(29|30)$/ })
    expect(create).toBeDisabled()
    expect(create).toHaveClass('identity-waiting')
    expect(screen.getByLabelText('Display name')).toHaveValue('Sam')
    expect(screen.getByLabelText(/Invitation code/)).toHaveValue('VSL-CODE')
    expect(sent('/api/auth/register')).toHaveLength(1)
  })

  it('says when no browser wallet is found', async () => {
    window.removeEventListener('eip6963:requestProvider', announcer)
    mount()
    expect(await screen.findByRole('heading', { name: 'No browser wallet found' }, { timeout: 2_000 })).toBeVisible()
  })
})

describe('same-user session adoption', () => {
  // Tab A signed in with the hot wallet; another tab of the same user then signed in with the Ledger (session B).
  const sessionB: SessionDto = { ...sessionFixture, wallet: { ...secondWalletFixture, current: true },
    session: { ...sessionFixture.session, id: '11111111-2222-4333-8444-555555555555' } }
  let server: SessionDto | null
  beforeEach(() => {
    server = sessionFixture
    routes['/api/auth/session'] = () => server ? json(server) : problem(401, 'session-revoked')
    routes['/api/auth/wallets'] = () => json([walletFixture, secondWalletFixture].map(row => ({ ...row, current: row.id === server?.wallet.id })))
    routes['/api/auth/sessions'] = () => json(sessionRowsFixture)
  })

  function mountProfile() {
    const bus = channelBus(), navigate = vi.fn()
    const view = render(<Tooltip.Provider><NotificationProvider><SignInGate registration="invitation" originAccepted channels={bus.factory} navigate={navigate}>
      {(_system, _disconnect, _api, identity) => <><p>Signed in with {identity.session.wallet.label} via {identity.walletName ?? 'unknown'}</p>
        <ProfileSettings identity={identity} onSignOut={vi.fn()} /></>}
    </SignInGate></NotificationProvider></Tooltip.Provider>)
    const adopt = () => act(async () => { server = sessionB; bus.send({ type: 'signed-in', userId: sessionB.user.id, sessionId: sessionB.session.id }) })
    return { ...view, navigate, adopt, user: userEvent.setup() }
  }
  const rowOf = (label: string) => screen.getByText(label, { selector: 'strong *, strong' }).closest('li')!

  it('refreshes the sign-in wallet and the lists, and removing the old wallet keeps the tab', async () => {
    const { navigate, adopt, user, unmount } = mountProfile()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1))
    expect(screen.getByText('Signed in with Hot wallet via unknown')).toBeVisible()
    await adopt()
    expect(await screen.findByText('Signed in with Ledger via unknown')).toBeVisible()
    await waitFor(() => expect(within(rowOf('Ledger')).getByText('This session')).toBeVisible())
    routes[`/api/auth/wallets/${walletFixture.id}`] = () => new Response(null, { status: 204 })
    await user.click(within(rowOf('Hot wallet')).getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/will no longer sign in to this journal/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Remove wallet' }))
    expect(await screen.findByText('Sign-in wallet removed.')).toBeVisible()
    expect(navigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(noticeKey)).toBeNull()
    unmount()
  })

  it('closes a removal dialog prepared under the old session', async () => {
    const { adopt, user, unmount } = mountProfile()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1))
    await user.click(within(rowOf('Ledger')).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByRole('dialog', { name: 'Remove sign-in wallet?' })).toBeVisible()
    await adopt()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent(`/api/auth/wallets/${secondWalletFixture.id}`)).toHaveLength(0)
    // The Ledger now signs this tab, so it is no longer offered for removal here.
    await waitFor(() => expect(within(rowOf('Ledger')).getByText('This session')).toBeVisible())
    expect(within(rowOf('Ledger')).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    unmount()
  })

  // The third session of this user, signed in from yet another tab with the Ledger.
  const sessionC: SessionDto = { ...sessionB, session: { ...sessionB.session, id: '11111111-2222-4333-8444-666666666666' } }
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    return { promise: new Promise<T>(done => { resolve = done }), resolve }
  }
  /** A shell with unsaved work and a profile save, optionally with the Profile page. */
  function Shell({ identity, profile }: { identity: ShellIdentity; profile: boolean }) {
    const [draft, setDraft] = useState('unsaved play')
    return <>
      <p>Signed in with {identity.session.wallet.label} as {identity.session.user.displayName}</p>
      <input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
      <button onClick={() => identity.onProfile({ ...identity.session.user, displayName: 'New profile', revision: 10 })}>Save profile</button>
      {profile && <ProfileSettings identity={identity} onSignOut={vi.fn()} />}
    </>
  }
  function mountShell(profile = false) {
    const bus = channelBus(), navigate = vi.fn()
    const view = render(<Tooltip.Provider><NotificationProvider><SignInGate registration="invitation" originAccepted channels={bus.factory} navigate={navigate}>
      {(system, _disconnect, _api, identity) => <><p>Owner {system.owner.displayName}</p><Shell identity={identity} profile={profile} /></>}
    </SignInGate></NotificationProvider></Tooltip.Provider>)
    const adopt = (session: SessionDto) => act(async () => { bus.send({ type: 'signed-in', userId: session.user.id, sessionId: session.session.id }) })
    return { ...view, navigate, adopt, user: userEvent.setup() }
  }

  it.each([[401, 'session-revoked'], [403, 'user-suspended']] as const)('drops a late %i from the probe of a session this tab has since left', async (status, code) => {
    const { navigate, adopt, unmount } = mountShell()
    await screen.findByText('Signed in with Hot wallet as Sam Rivera')
    const late = deferred<Response>()
    routes['/api/auth/session'] = () => late.promise
    await adopt(sessionB)
    const probeB = sent('/api/auth/session').at(-1)!.init.signal!
    routes['/api/auth/session'] = () => json(sessionC)
    await adopt(sessionC)
    expect(await screen.findByText('Signed in with Ledger as Sam Rivera')).toBeVisible()
    // Adopting C superseded B's probe.
    expect(probeB.aborted).toBe(true)
    await act(async () => late.resolve(problem(status, code)))
    expect(navigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(noticeKey)).toBeNull()
    expect(screen.queryByText('Journal suspended')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toHaveValue('unsaved play')
    unmount()
  })

  it('keeps a profile saved while the adoption probe was answering', async () => {
    const { adopt, user, unmount } = mountShell()
    await screen.findByText('Signed in with Hot wallet as Sam Rivera')
    const late = deferred<Response>()
    routes['/api/auth/session'] = () => late.promise
    await adopt(sessionB)
    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(screen.getByText('Signed in with Hot wallet as New profile')).toBeVisible()
    // The probe's snapshot carries revision 1; the save made revision 10. The wallet still follows the probe.
    await act(async () => late.resolve(json(sessionB)))
    expect(await screen.findByText('Signed in with Ledger as New profile')).toBeVisible()
    expect(screen.getByText('Owner New profile')).toBeVisible()
    unmount()
  })

  it('offers no destructive action on the old lists until the adopted session\'s lists load', async () => {
    const { adopt, unmount } = mountShell(true)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1))
    const lists = deferred<Response>()
    routes['/api/auth/wallets'] = () => lists.promise
    server = sessionB
    await adopt(sessionB)
    expect(await screen.findByText('Signed in with Ledger as Sam Rivera')).toBeVisible()
    // The old rows still mark the hot wallet as this session's and offer the Ledger, which now signs this tab.
    expect(within(rowOf('Ledger')).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out other sessions' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sign out Safari on iOS session' })).toBeDisabled()
    await act(async () => lists.resolve(json([{ ...walletFixture, current: false }, { ...secondWalletFixture, current: true }])))
    await waitFor(() => expect(within(rowOf('Hot wallet')).getByRole('button', { name: 'Remove' })).toBeVisible())
    expect(within(rowOf('Ledger')).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    unmount()
  })

  it('follows an adoption received while the workspace was loading', async () => {
    const system = deferred<Response>()
    let systemCalls = 0
    routes['/api/system'] = () => ++systemCalls === 1 ? system.promise : json(systemFixture)
    const { adopt, unmount } = mountShell()
    await screen.findByText('Loading your workspace…')
    server = sessionB
    await adopt(sessionB)
    await act(async () => system.resolve(json(systemFixture)))
    expect(await screen.findByText('Signed in with Ledger as Sam Rivera')).toBeVisible()
    // The system answer belonged to the old generation, so it was read again.
    expect(systemCalls).toBe(2)
    unmount()
  })

  it('leaves when the server says a removal ended this tab, though the row said otherwise', async () => {
    const { navigate, user, unmount } = mountProfile()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1))
    // Another tab moved the shared cookie onto the Ledger's session before any message reached this tab.
    server = sessionB
    routes[`/api/auth/wallets/${secondWalletFixture.id}`] = () => { server = null; return new Response(null, { status: 204 }) }
    await user.click(within(rowOf('Ledger')).getByRole('button', { name: 'Remove' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove wallet' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(sessionStorage.getItem(noticeKey)).toBe(notices.ended)
    expect(screen.queryByText('Sign-in wallet removed.')).not.toBeInTheDocument()
    unmount()
  })
})
