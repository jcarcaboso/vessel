import type { Challenge, SessionDto, VerifyResult } from '@/api/auth'
import { ApiError, rateLimitMessage } from '@/api/errors'
import { checksumAddress } from '@/lib/eip55'
import { shortSource } from '@/lib/format'
import type { BrowserWallet } from './wallets/discovery'
import { WalletError, sameAddress } from './wallets/provider'

/** A failure the sign-in card explains, each with its own next step (mockup screen 6). */
export type SignInError =
  | { kind: 'declined'; during: 'connect' | 'sign' }
  | { kind: 'pending' }
  | { kind: 'expired' }
  | { kind: 'switched'; address: string }
  | { kind: 'disconnected' }
  | { kind: 'invitation' }
  | { kind: 'unsupported' }
  | { kind: 'rate-limited'; retryAt: string | null }
  | { kind: 'suspended' }
  | { kind: 'closed' }
  | { kind: 'unreachable' }
  | { kind: 'other'; message: string }

export interface RegistrationForm {
  registration: string
  requiresInvitation: boolean
  submitting: boolean
  /** `retryAt` is a rate limit's deadline: Create journal waits for it, keeping the form as typed. */
  error: { field: 'displayName' | 'invitation' | null; message: string; retryAt?: string } | null
}

/**
 * The sign-in flow as an explicit state machine:
 * choose → connecting → signing → verifying → signed-in | registration → signed-in, with `failed` reachable from
 * every wallet or server step. The component runs the effects; this reducer only decides what the screen shows.
 */
export type SignInState =
  | { step: 'choose' }
  | { step: 'connecting'; wallet: BrowserWallet }
  | { step: 'signing'; wallet: BrowserWallet; address: string; challenge: Challenge | null; waiting: boolean }
  | { step: 'verifying'; wallet: BrowserWallet; address: string }
  | ({ step: 'registration'; wallet: BrowserWallet; address: string } & RegistrationForm)
  | { step: 'failed'; wallet: BrowserWallet | null; address: string | null; error: SignInError }
  | { step: 'signed-in'; session: SessionDto }

export type SignInEvent =
  | { type: 'choose'; wallet: BrowserWallet }
  | { type: 'connected'; address: string }
  | { type: 'challenge'; challenge: Challenge }
  | { type: 'sign' }
  | { type: 'signed' }
  | { type: 'verified'; result: VerifyResult }
  | { type: 'register' }
  | { type: 'registered'; session: SessionDto }
  | { type: 'registration-failed'; error: unknown }
  | { type: 'account-changed'; address: string | null }
  | { type: 'disconnected' }
  | { type: 'expired' }
  | { type: 'failed'; error: unknown; during?: 'connect' | 'sign' }
  | { type: 'use-address'; address: string }
  | { type: 'retry' }
  | { type: 'reset' }

export const initialSignIn: SignInState = { step: 'choose' }

/** Maps a wallet or API failure to the state the card shows. Raw wallet and server texts are never displayed. */
export function signInError(cause: unknown, during: 'connect' | 'sign' = 'sign'): SignInError {
  if (cause instanceof WalletError) {
    if (cause.reason === 'declined') return { kind: 'declined', during }
    if (cause.reason === 'pending') return { kind: 'pending' }
    if (cause.reason === 'unsupported') return { kind: 'unsupported' }
    return { kind: 'other', message: cause.reason === 'no-account' ? 'The wallet did not share an address. Unlock it and try again.' : 'The wallet could not complete the request. Try again or choose another wallet.' }
  }
  if (cause instanceof ApiError) {
    if (cause.status === 429) return { kind: 'rate-limited', retryAt: cause.retryAtUtc ?? null }
    switch (cause.code) {
      case 'challenge-expired': return { kind: 'expired' }
      case 'signature-unsupported': return { kind: 'unsupported' }
      case 'rate-limited': return { kind: 'rate-limited', retryAt: cause.retryAtUtc ?? null }
      case 'user-suspended': return { kind: 'suspended' }
      case 'registration-closed': return { kind: 'closed' }
      case 'invitation-required': return { kind: 'invitation' }
      case 'identity-unavailable': return { kind: 'unreachable' }
    }
    if (cause.kind === 'unavailable') return { kind: 'unreachable' }
    return { kind: 'other', message: cause.message }
  }
  return { kind: 'other', message: 'Sign-in could not be completed. Start again.' }
}

/** The same failures as one line of text, for the step-up and link dialogs. */
export function flowErrorText(error: SignInError): string {
  switch (error.kind) {
    case 'declined': return error.during === 'connect' ? 'No address was shared. Try again or choose another wallet.' : 'Nothing was signed. Try again or choose another wallet.'
    case 'pending': return 'The wallet already has a request waiting. Open it to finish or reject it, then try again.'
    case 'expired': return 'This request expired after five minutes. Start again.'
    case 'switched': return `The wallet switched to ${shortSource(checksumAddress(error.address))}. Start again with the address you want to use.`
    case 'disconnected': return 'The wallet ended the connection. Connect again or choose another wallet.'
    case 'invitation': return 'This server only admits invited wallets.'
    case 'unsupported': return 'This signature format isn’t supported yet, as with Safe and other smart accounts. Use a regular wallet address.'
    case 'rate-limited': return rateLimitMessage(error.retryAt)
    case 'suspended': return 'The operator of this server has suspended this journal.'
    case 'closed': return 'This server is not admitting new journals.'
    case 'unreachable': return 'Vessel is unreachable. Check your connection and try again.'
    case 'other': return error.message
  }
}

const fail = (state: SignInState, error: SignInError): SignInState => ({
  step: 'failed', error,
  wallet: 'wallet' in state ? state.wallet : null,
  address: 'address' in state ? state.address : null,
})

export function signIn(state: SignInState, event: SignInEvent): SignInState {
  switch (event.type) {
    case 'reset': return initialSignIn
    case 'choose':
      return state.step === 'choose' || state.step === 'failed' || state.step === 'connecting' || state.step === 'signing'
        ? { step: 'connecting', wallet: event.wallet } : state
    case 'connected':
      return state.step === 'connecting' ? { step: 'signing', wallet: state.wallet, address: event.address, challenge: null, waiting: false } : state
    case 'challenge':
      return state.step === 'signing' && !state.challenge ? { ...state, challenge: event.challenge } : state
    case 'sign':
      return state.step === 'signing' && state.challenge && !state.waiting ? { ...state, waiting: true } : state
    case 'signed':
      return state.step === 'signing' && state.waiting ? { step: 'verifying', wallet: state.wallet, address: state.address } : state
    case 'verified':
      if (state.step !== 'verifying') return state
      return event.result.status === 'signed-in' ? { step: 'signed-in', session: event.result.session }
        : { step: 'registration', wallet: state.wallet, address: state.address, registration: event.result.registration,
            requiresInvitation: event.result.requiresInvitation, submitting: false, error: null }
    case 'register':
      return state.step === 'registration' && !state.submitting ? { ...state, submitting: true, error: null } : state
    case 'registered':
      return state.step === 'registration' && state.submitting ? { step: 'signed-in', session: event.session } : state
    case 'registration-failed': {
      if (state.step !== 'registration') return state
      const code = event.error instanceof ApiError ? event.error.code : undefined
      const message = event.error instanceof ApiError ? event.error.message : 'The journal could not be created. Try again.'
      // Field errors keep the pending registration, which the server does not burn on a failed attempt.
      if (code === 'display-name-invalid') return { ...state, submitting: false, error: { field: 'displayName', message } }
      if (code === 'invitation-required' || code === 'invitation-invalid')
        return { ...state, submitting: false, requiresInvitation: true, error: { field: 'invitation', message } }
      if (event.error instanceof ApiError && (event.error.status === 429 || code === 'rate-limited')) {
        const retryAt = event.error.retryAtUtc
        return { ...state, submitting: false, error: { field: null, message: rateLimitMessage(retryAt), ...retryAt ? { retryAt } : {} } }
      }
      if (code === undefined || event.error instanceof ApiError && event.error.kind === 'unavailable')
        return { ...state, submitting: false, error: { field: null, message } }
      return fail(state, signInError(event.error))
    }
    case 'account-changed':
      // Only an address change while the message waits for a signature matters; after it, the server checks the signer.
      if (state.step === 'signing' && !sameAddress(event.address, state.address))
        return event.address ? fail(state, { kind: 'switched', address: event.address }) : fail(state, { kind: 'disconnected' })
      return state
    case 'disconnected':
      return state.step === 'connecting' || state.step === 'signing' ? fail(state, { kind: 'disconnected' }) : state
    case 'expired':
      return state.step === 'signing' ? fail(state, { kind: 'expired' }) : state
    case 'failed':
      if (state.step === 'choose' || state.step === 'signed-in' || state.step === 'failed') return state
      return fail(state, signInError(event.error, event.during ?? (state.step === 'connecting' ? 'connect' : 'sign')))
    case 'use-address':
      return state.step === 'failed' && state.wallet ? { step: 'signing', wallet: state.wallet, address: event.address, challenge: null, waiting: false } : state
    case 'retry':
      // A new challenge for the same wallet and address; without an address, connect again.
      if (state.step !== 'failed' || !state.wallet) return state
      return state.address ? { step: 'signing', wallet: state.wallet, address: state.address, challenge: null, waiting: false }
        : { step: 'connecting', wallet: state.wallet }
  }
}
