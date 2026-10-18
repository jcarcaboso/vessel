import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from 'radix-ui'
import { NotificationProvider } from '@/components/notifications/NotificationProvider'
import type { SessionDto } from '@/api/auth'
import { sessionFixture, walletFixture, secondWalletFixture, sessionRowsFixture } from '@/test/identity-fixture'
import { channelBus } from '@/test/session-channel'
import { systemFixture } from '@/test/system-fixture'
import { SignInGate } from './SignInGate'
import { ProfileSettings } from './ProfileSettings'
import type { ShellIdentity } from './types'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const original: SessionDto = { ...sessionFixture, user: { ...sessionFixture.user, displayName: 'Before restore', revision: 10 } }
const restored: SessionDto = { ...sessionFixture, user: { ...sessionFixture.user, displayName: 'Restored profile', revision: 1 } }
const adopted: SessionDto = { ...restored, wallet: { ...secondWalletFixture, current: true }, session: { ...restored.session, id: '11111111-2222-4333-8444-555555555555' } }
const deferred = <T,>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve } }
let identity: ShellIdentity
let routes: Record<string, (init: RequestInit) => Response | Promise<Response>>
let saves: number[]
beforeEach(() => {
  saves = []
  routes = {
    '/api/auth/session': () => json(original), '/api/system': () => json(systemFixture),
    '/api/auth/wallets': () => json([walletFixture, secondWalletFixture]), '/api/auth/sessions': () => json(sessionRowsFixture),
    '/api/auth/profile': init => { saves.push(JSON.parse(init.body as string).expectedRevision); return json({ code: 'revision-conflict' }, 409) },
  }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => routes[path]?.(init) ?? new Response(null, { status: 404 })))
})
function mount() {
  const bus = channelBus()
  const view = render(<Tooltip.Provider><NotificationProvider><SignInGate registration="invitation" originAccepted channels={bus.factory} navigate={vi.fn()}>
    {(_system, _disconnect, _api, current) => { identity = current; return <><p data-testid="current">{current.session.user.displayName}:{current.session.user.revision}</p><ProfileSettings identity={current} onSignOut={vi.fn()} /></> }}
  </SignInGate></NotificationProvider></Tooltip.Provider>)
  return { ...view, bus, user: userEvent.setup() }
}
async function attempt(user: ReturnType<typeof userEvent.setup>, name: string) {
  const field = screen.getByRole('textbox', { name: 'Display name' })
  await user.clear(field); await user.type(field, name); await user.click(screen.getByRole('button', { name: 'Save' }))
}
// Every asynchronous profile read (session probe, conflict recovery read) applies its snapshot only if the session
// generation and profile epoch it started under are still current (SignInGate `profiles`).
describe('profile epoch: late reads never restore a stale profile', () => {
  it('does not undo an authoritative conflict rebase with a late same-generation session probe', async () => {
    const { user } = mount()
    await screen.findByText('Before restore:10')
    const late = deferred<Response>()
    routes['/api/auth/session'] = () => late.promise
    let check!: Promise<unknown>
    act(() => { check = identity.checkSession() })
    routes['/api/auth/session'] = () => json(restored)
    await attempt(user, 'New name')
    await screen.findByText('Restored profile:1')
    await act(async () => { late.resolve(json(original)); await check })
    expect(screen.getByTestId('current')).toHaveTextContent('Restored profile:1')
  })
  it('does not undo adoption of a restored session with an old-generation conflict recovery read', async () => {
    const { user, bus } = mount()
    await screen.findByText('Before restore:10')
    const late = deferred<Response>()
    routes['/api/auth/session'] = () => late.promise
    await attempt(user, 'New name')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Display name' })).toBeEnabled())
    routes['/api/auth/session'] = () => json(adopted)
    await act(async () => { bus.send({ type: 'signed-in', userId: adopted.user.id, sessionId: adopted.session.id }) })
    await screen.findByText('Restored profile:1')
    await act(async () => { late.resolve(json(original)); await new Promise(done => setTimeout(done, 0)) })
    expect(screen.getByTestId('current')).toHaveTextContent('Restored profile:1')
  })
  it('does not overwrite a newer save with the recovery read of a refused revision', async () => {
    const { user } = mount()
    await screen.findByText('Before restore:10')
    const late = deferred<Response>()
    routes['/api/auth/session'] = () => late.promise
    await attempt(user, 'First try')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Display name' })).toBeEnabled())
    routes['/api/auth/profile'] = init => { saves.push(JSON.parse(init.body as string).expectedRevision); return json({ ...original.user, displayName: 'Newer save', revision: 11 }) }
    await attempt(user, 'Newer save')
    await screen.findByText('Newer save:11')
    await act(async () => { late.resolve(json(restored)); await new Promise(done => setTimeout(done, 0)) })
    expect(screen.getByTestId('current')).toHaveTextContent('Newer save:11')
    expect(saves).toEqual([10, 10])
  })
  it('does not rebase over a newer successful save whose revision equals an older refused revision', async () => {
    routes['/api/auth/session'] = () => json({ ...original, user: { ...original.user, revision: 2 } })
    const { user } = mount()
    await screen.findByText('Before restore:2')
    const late = deferred<Response>()
    routes['/api/auth/session'] = () => late.promise
    await attempt(user, 'First conflict')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Display name' })).toBeEnabled())
    routes['/api/auth/session'] = () => json(restored)
    await attempt(user, 'Second conflict')
    await screen.findByText('Restored profile:1')
    routes['/api/auth/profile'] = init => { saves.push(JSON.parse(init.body as string).expectedRevision); return json({ ...restored.user, displayName: 'New save after restore', revision: 2 }) }
    await attempt(user, 'New save after restore')
    await screen.findByText('New save after restore:2')
    await act(async () => { late.resolve(json(restored)); await new Promise(done => setTimeout(done, 0)) })
    expect(screen.getByTestId('current')).toHaveTextContent('New save after restore:2')
    expect(saves).toEqual([2, 2, 1])
  })
  it('resets session generations safely on a fresh gate mount', async () => {
    const first = mount()
    await screen.findByText('Before restore:10')
    routes['/api/auth/session'] = () => json(adopted)
    await act(async () => { first.bus.send({ type: 'signed-in', userId: adopted.user.id, sessionId: adopted.session.id }) })
    await screen.findByText('Restored profile:1')
    first.unmount()
    routes['/api/auth/session'] = () => json({ ...adopted, user: { ...adopted.user, displayName: 'Restored again', revision: 0 } })
    mount()
    await screen.findByText('Restored again:0')
    expect(identity.session.user.revision).toBe(0)
  })
})
