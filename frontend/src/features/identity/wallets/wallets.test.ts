import { afterEach, describe, expect, it, vi } from 'vitest'
import { announcedWallet, discoverWallets, fallbackDelayMs, lastWalletKey, maxIconBytes, maxWallets, orderWallets, readLastWallet, rememberWallet, type BrowserWallet } from './discovery'
import { requestAccount, signMessage, utf8Hex, WalletError, watchWallet, type WalletProvider } from './provider'

const address = '0x7A3f9C2e5b1D4a8F0c6E2b9D3a7F1e5C8b2D4caa'
const png = 'data:image/png;base64,iVBORw0KGgo='
const provider = (request: WalletProvider['request'] = vi.fn()): WalletProvider => ({ request })
function announce(info: Record<string, unknown>, target = provider()) {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider: target }) }))
  return target
}
const info = (uuid: string, name = `Wallet ${uuid}`, extra: Record<string, unknown> = {}) => ({ uuid, name, icon: png, rdns: `io.${uuid}`, ...extra })

afterEach(() => {
  vi.useRealTimers()
  delete (window as Window & { ethereum?: unknown }).ethereum
})

describe('EIP-6963 discovery', () => {
  it('asks wallets to announce and lists each UUID once, in announcement order', () => {
    const requests = vi.fn()
    window.addEventListener('eip6963:requestProvider', requests)
    const seen: BrowserWallet[][] = []
    // A wallet that answers the request synchronously is still heard.
    const answer = () => announce(info('rabby', 'Rabby Wallet'))
    window.addEventListener('eip6963:requestProvider', answer)
    const stop = discoverWallets(wallets => seen.push(wallets))
    window.removeEventListener('eip6963:requestProvider', answer)
    window.removeEventListener('eip6963:requestProvider', requests)
    announce(info('metamask', 'MetaMask'))
    announce(info('rabby', 'Rabby again'))
    expect(requests).toHaveBeenCalledOnce()
    expect(seen.at(-1)!.map(wallet => wallet.name)).toEqual(['Rabby Wallet', 'MetaMask'])
    stop()
  })

  it('lists the injected provider as "Browser wallet" only after 500 ms without announcements', () => {
    vi.useFakeTimers()
    const injected = provider();
    (window as Window & { ethereum?: unknown }).ethereum = injected
    const onChange = vi.fn()
    const stop = discoverWallets(onChange)
    vi.advanceTimersByTime(fallbackDelayMs - 1)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ key: 'fallback', name: 'Browser wallet', provider: injected, fallback: true, icon: null })], true)
    // A late announcement replaces the fallback.
    announce(info('rabby', 'Rabby Wallet'))
    expect(onChange.mock.lastCall![0].map((wallet: BrowserWallet) => wallet.name)).toEqual(['Rabby Wallet'])
    stop()
  })

  it('has no fallback when a wallet announced in time or nothing is injected', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const stop = discoverWallets(onChange)
    vi.advanceTimersByTime(fallbackDelayMs)
    expect(onChange).toHaveBeenLastCalledWith([], true)
    stop()
    ;(window as Window & { ethereum?: unknown }).ethereum = provider()
    const next = vi.fn()
    const stopNext = discoverWallets(next)
    announce(info('rabby'))
    vi.advanceTimersByTime(fallbackDelayMs)
    expect(next.mock.lastCall![0].map((wallet: BrowserWallet) => wallet.key)).toEqual(['rabby'])
    stopNext()
  })

  it('ignores announcements and the fallback timer after it stops (stale results)', () => {
    vi.useFakeTimers()
    ;(window as Window & { ethereum?: unknown }).ethereum = provider()
    const onChange = vi.fn()
    discoverWallets(onChange)()
    announce(info('late'))
    vi.advanceTimersByTime(fallbackDelayMs * 2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it(`keeps at most ${maxWallets} wallets`, () => {
    const onChange = vi.fn()
    const stop = discoverWallets(onChange)
    for (let index = 0; index < maxWallets + 4; index++) announce(info(`w${index}`))
    expect(onChange.mock.lastCall![0]).toHaveLength(maxWallets)
    stop()
  })
})

describe('untrusted wallet metadata', () => {
  it('bounds the name to 40 characters and strips control and format characters', () => {
    const wallet = announcedWallet({ info: info('a', `‮Evil\u0007 ${'x'.repeat(60)}`), provider: provider() })!
    expect([...wallet.name]).toHaveLength(40)
    expect(wallet.name.startsWith('Evil x')).toBe(true)
    expect(wallet.name.endsWith('…')).toBe(true)
    expect(announcedWallet({ info: info('a', ' ​ '), provider: provider() })).toBeNull()
  })

  it.each([
    ['png', png, true],
    ['jpeg', 'data:image/jpeg;base64,/9j/', true],
    ['webp', 'data:image/webp;base64,UklGR', true],
    ['svg', 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E', true],
    ['gif', 'data:image/gif;base64,R0lGOD', false],
    ['remote URL', 'https://wallet.example/icon.png', false],
    ['javascript', 'javascript:alert(1)', false],
    ['html', 'data:text/html,<b>x</b>', false],
    ['oversized', `data:image/png;base64,${'A'.repeat(maxIconBytes)}`, false],
  ])('accepts a %s icon: %s', (_kind, icon, accepted) => {
    expect(announcedWallet({ info: info('a', 'A', { icon }), provider: provider() })!.icon).toBe(accepted ? icon : null)
  })

  it('never trusts rdns beyond remembering the last wallet, and refuses malformed announcements', () => {
    expect(announcedWallet({ info: info('a', 'A', { rdns: 'not a domain' }), provider: provider() })!.rdns).toBeNull()
    expect(announcedWallet({ info: info('a'), provider: {} })).toBeNull()
    expect(announcedWallet({ info: { name: 'No UUID' }, provider: provider() })).toBeNull()
    expect(announcedWallet({ info: info('fallback'), provider: provider() })).toBeNull()
    expect(announcedWallet(null)).toBeNull()
  })

  it('keeps the last-used rdns per device and lists that wallet first', () => {
    const wallets = ['io.a', 'io.b', 'io.c'].map(rdns => announcedWallet({ info: info(rdns.slice(3), rdns, { rdns }), provider: provider() })!)
    rememberWallet(wallets[2]!)
    expect(localStorage.getItem(lastWalletKey)).toBe('io.c')
    expect(readLastWallet()).toBe('io.c')
    expect(orderWallets(wallets).map(wallet => wallet.rdns)).toEqual(['io.c', 'io.a', 'io.b'])
    localStorage.setItem(lastWalletKey, '<script>')
    expect(readLastWallet()).toBeNull()
  })
})

describe('wallet requests', () => {
  it('signs the UTF-8 bytes of the exact message as hex with the address', async () => {
    const request = vi.fn().mockResolvedValue(`0x${'ab'.repeat(65)}`)
    const message = 'vessel.test wants you to sign in with your Ethereum account:\nAñ €'
    await expect(signMessage(provider(request), message, address)).resolves.toBe(`0x${'ab'.repeat(65)}`)
    expect(request).toHaveBeenCalledWith({ method: 'personal_sign', params: [utf8Hex(message), address] })
    expect(utf8Hex('Añ €')).toBe('0x41c3b120e282ac')
  })

  it('calls only eth_requestAccounts to connect and maps EIP-1193 errors', async () => {
    const request = vi.fn().mockResolvedValue([address])
    await expect(requestAccount(provider(request))).resolves.toBe(address)
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
    await expect(requestAccount(provider(vi.fn().mockRejectedValue({ code: 4001, message: 'private wallet text' })))).rejects.toMatchObject({ reason: 'declined' })
    await expect(requestAccount(provider(vi.fn().mockRejectedValue({ code: -32002 })))).rejects.toMatchObject({ reason: 'pending' })
    await expect(requestAccount(provider(vi.fn().mockResolvedValue([])))).rejects.toMatchObject({ reason: 'no-account' })
    const failure = await signMessage(provider(vi.fn().mockResolvedValue('not hex')), 'm', address).catch((cause: unknown) => cause)
    expect(failure).toBeInstanceOf(WalletError)
    expect((failure as Error).message).not.toContain('private')
  })

  it('hears accountsChanged and disconnect until unsubscribed', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const wallet: WalletProvider = { request: vi.fn(), on: (event, listener) => listeners.set(event, listener), removeListener: event => listeners.delete(event) }
    const accountChanged = vi.fn(), disconnected = vi.fn()
    const stop = watchWallet(wallet, { accountChanged, disconnected })
    listeners.get('accountsChanged')!([address])
    listeners.get('accountsChanged')!([])
    listeners.get('disconnect')!()
    expect(accountChanged.mock.calls).toEqual([[address], [null]])
    expect(disconnected).toHaveBeenCalledOnce()
    stop()
    expect(listeners.size).toBe(0)
  })
})
