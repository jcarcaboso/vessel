/** The EIP-1193 surface Vessel uses: two methods and two events, nothing else. */
export interface WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown
}

/** Why a wallet request failed, in the terms the sign-in screen shows. Raw wallet messages are never displayed. */
export type WalletFailure = 'declined' | 'pending' | 'no-account' | 'failed'

export class WalletError extends Error {
  constructor(public readonly reason: WalletFailure) {
    super(reason === 'declined' ? 'The wallet request was declined.' : reason === 'pending' ? 'The wallet already has a request open.'
      : reason === 'no-account' ? 'The wallet shared no address.' : 'The wallet request failed.')
    this.name = 'WalletError'
  }
}

const addressPattern = /^0x[\da-fA-F]{40}$/
const signaturePattern = /^0x[\da-fA-F]{2,1024}$/

function failure(cause: unknown): WalletError {
  const code = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined
  // EIP-1193: 4001 user rejected; -32002 is the common "request already pending" answer.
  return new WalletError(code === 4001 ? 'declined' : code === -32002 ? 'pending' : 'failed')
}

/** UTF-8 bytes as `0x`-prefixed lower-case hex, the form `personal_sign` expects. */
export function utf8Hex(text: string) {
  let hex = '0x'
  for (const byte of new TextEncoder().encode(text)) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** `eth_requestAccounts`: the first shared address. */
export async function requestAccount(provider: WalletProvider): Promise<string> {
  let accounts: unknown
  try { accounts = await provider.request({ method: 'eth_requestAccounts' }) } catch (cause) { throw failure(cause) }
  const first: unknown = Array.isArray(accounts) ? accounts[0] : undefined
  if (typeof first !== 'string' || !addressPattern.test(first)) throw new WalletError('no-account')
  return first
}

/** `personal_sign` over the exact server message, as `["0x" + hex(utf8(message)), address]`. */
export async function signMessage(provider: WalletProvider, message: string, address: string): Promise<string> {
  let signature: unknown
  try { signature = await provider.request({ method: 'personal_sign', params: [utf8Hex(message), address] }) } catch (cause) { throw failure(cause) }
  if (typeof signature !== 'string' || !signaturePattern.test(signature)) throw new WalletError('failed')
  return signature
}

/**
 * Hears `accountsChanged` (the first address, or null when none is shared) and `disconnect` until the returned
 * function runs. Providers without events are simply not watched.
 */
export function watchWallet(provider: WalletProvider, handlers: { accountChanged: (address: string | null) => void; disconnected: () => void }) {
  let active = true
  const accounts = (value: unknown) => {
    if (!active) return
    const first: unknown = Array.isArray(value) ? value[0] : undefined
    handlers.accountChanged(typeof first === 'string' && addressPattern.test(first) ? first : null)
  }
  const disconnect = () => { if (active) handlers.disconnected() }
  try {
    provider.on?.('accountsChanged', accounts)
    provider.on?.('disconnect', disconnect)
  } catch { /* A provider that throws on subscribe is used without events. */ }
  return () => {
    active = false
    try {
      provider.removeListener?.('accountsChanged', accounts)
      provider.removeListener?.('disconnect', disconnect)
    } catch { /* Ignored, as above. */ }
  }
}

export const sameAddress = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
