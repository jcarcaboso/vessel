import type { WalletProvider } from './provider'

/**
 * A browser wallet found through EIP-6963, or the `window.ethereum` fallback. Everything except `provider` is
 * announced by the wallet and untrusted: the name is bounded text, the icon is a bounded image data URI rendered only
 * with `<img>`, and `rdns` only remembers the last wallet used, never decides trust.
 */
export interface BrowserWallet {
  /** Stable for this page: the announced UUID, or `fallback`. */
  key: string
  name: string
  icon: string | null
  rdns: string | null
  provider: WalletProvider
  fallback: boolean
}

export const fallbackDelayMs = 500
export const maxWallets = 16
export const maxWalletName = 40
export const maxIconBytes = 64 * 1024
export const lastWalletKey = 'vessel:device:last-wallet'

const iconPattern = /^data:image\/(png|jpeg|webp|svg\+xml)[;,]/
const rdnsPattern = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,7}$/i
const controls = /[\p{Cc}\p{Cf}]/gu

export function walletName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = [...value.replace(controls, '').replace(/\s+/g, ' ').trim()]
  if (!name.length) return null
  return name.length > maxWalletName ? `${name.slice(0, maxWalletName - 1).join('')}…` : name.join('')
}

export function walletIcon(value: unknown): string | null {
  return typeof value === 'string' && value.length <= maxIconBytes && iconPattern.test(value) ? value : null
}

export function isWalletProvider(value: unknown): value is WalletProvider {
  return typeof value === 'object' && value !== null && typeof (value as { request?: unknown }).request === 'function'
}

/** Validates one `eip6963:announceProvider` detail; anything malformed is ignored. */
export function announcedWallet(detail: unknown): BrowserWallet | null {
  if (typeof detail !== 'object' || detail === null) return null
  const { info, provider } = detail as { info?: unknown; provider?: unknown }
  if (typeof info !== 'object' || info === null || !isWalletProvider(provider)) return null
  const { uuid, name, icon, rdns } = info as Record<string, unknown>
  if (typeof uuid !== 'string' || !uuid || uuid.length > 64 || uuid === 'fallback') return null
  const label = walletName(name)
  if (!label) return null
  return { key: uuid, name: label, icon: walletIcon(icon), rdns: typeof rdns === 'string' && rdnsPattern.test(rdns) ? rdns.toLowerCase() : null, provider, fallback: false }
}

export function readLastWallet(): string | null {
  try {
    const value = localStorage.getItem(lastWalletKey)
    return value && rdnsPattern.test(value) ? value.toLowerCase() : null
  } catch { return null }
}

export function rememberWallet(wallet: BrowserWallet) {
  if (!wallet.rdns) return
  try { localStorage.setItem(lastWalletKey, wallet.rdns) } catch { /* The order is only a convenience. */ }
}

/** The last wallet used on this device first, then the order wallets announced themselves. */
export function orderWallets(wallets: readonly BrowserWallet[], last = readLastWallet()) {
  const index = wallets.findIndex(wallet => last !== null && wallet.rdns === last)
  return index <= 0 ? [...wallets] : [wallets[index]!, ...wallets.slice(0, index), ...wallets.slice(index + 1)]
}

/**
 * Listens for EIP-6963 announcements and asks wallets to announce. If none has answered after 500 ms and the page
 * has an injected `window.ethereum`, a "Browser wallet" fallback is listed; a later announcement replaces it.
 * `onChange` hears the current list and whether discovery has settled. After the returned stop function runs,
 * late announcements and the fallback timer are ignored.
 */
export function discoverWallets(onChange: (wallets: BrowserWallet[], settled: boolean) => void, target: Window = window) {
  let active = true
  let settled = false
  let announced: BrowserWallet[] = []
  let fallback: BrowserWallet | null = null
  const publish = () => { if (active) onChange(announced.length ? [...announced] : fallback ? [fallback] : [], settled) }
  const announce = (event: Event) => {
    if (!active) return
    const wallet = announcedWallet((event as CustomEvent<unknown>).detail)
    if (!wallet || announced.length >= maxWallets) return
    // A wallet that announces twice keeps its first entry; a different UUID is a different wallet.
    if (announced.some(item => item.key === wallet.key || item.provider === wallet.provider)) return
    announced = [...announced, wallet]
    publish()
  }
  target.addEventListener('eip6963:announceProvider', announce)
  target.dispatchEvent(new Event('eip6963:requestProvider'))
  const timer = target.setTimeout(() => {
    if (!active) return
    settled = true
    const injected = (target as Window & { ethereum?: unknown }).ethereum
    if (!announced.length && isWalletProvider(injected)) fallback = { key: 'fallback', name: 'Browser wallet', icon: null, rdns: null, provider: injected, fallback: true }
    publish()
  }, fallbackDelayMs)
  return () => {
    active = false
    target.clearTimeout(timer)
    target.removeEventListener('eip6963:announceProvider', announce)
  }
}
