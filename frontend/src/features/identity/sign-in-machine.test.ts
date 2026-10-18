import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { challengeFixture, sessionFixture, walletFixture } from '@/test/identity-fixture'
import { initialSignIn, signIn, signInError, type SignInEvent, type SignInState } from './sign-in-machine'
import type { BrowserWallet } from './wallets/discovery'
import { WalletError } from './wallets/provider'

const wallet: BrowserWallet = { key: 'rabby', name: 'Rabby Wallet', icon: null, rdns: 'io.rabby', provider: { request: async () => null }, fallback: false }
const address = walletFixture.address
const other = '0x19B4c7aE02F3d81e6C5a9b0D2E7f4A3c8D1e0a53'
const run = (...events: SignInEvent[]) => events.reduce(signIn, initialSignIn as SignInState)
const signing = () => run({ type: 'choose', wallet }, { type: 'connected', address }, { type: 'challenge', challenge: challengeFixture() })
const coded = (code: string, status = 400) => new ApiError('http', `copy for ${code}`, status, undefined, code)

describe('sign-in state machine', () => {
  it('goes choose → connecting → signing → verifying → signed-in', () => {
    expect(run({ type: 'choose', wallet })).toEqual({ step: 'connecting', wallet })
    expect(run({ type: 'choose', wallet }, { type: 'connected', address })).toMatchObject({ step: 'signing', challenge: null, waiting: false })
    const waiting = signIn(signing(), { type: 'sign' })
    expect(waiting).toMatchObject({ step: 'signing', waiting: true })
    const verifying = signIn(waiting, { type: 'signed' })
    expect(verifying).toEqual({ step: 'verifying', wallet, address })
    expect(signIn(verifying, { type: 'verified', result: { status: 'signed-in', session: sessionFixture } })).toEqual({ step: 'signed-in', session: sessionFixture })
  })

  it('cannot sign before the challenge arrives, or twice', () => {
    const preparing = run({ type: 'choose', wallet }, { type: 'connected', address })
    expect(signIn(preparing, { type: 'sign' })).toBe(preparing)
    const waiting = signIn(signing(), { type: 'sign' })
    expect(signIn(waiting, { type: 'sign' })).toBe(waiting)
    const ready = signing()
    expect(signIn(ready, { type: 'signed' })).toBe(ready)
  })

  it('asks a new wallet to create a journal, with invitation only when required, and keeps the registration on field errors', () => {
    const verifying = signIn(signIn(signing(), { type: 'sign' }), { type: 'signed' })
    const registration = signIn(verifying, { type: 'verified', result: { status: 'registration-required', registration: 'reg-token', requiresInvitation: false, expiresAt: challengeFixture().expiresAt } })
    expect(registration).toMatchObject({ step: 'registration', registration: 'reg-token', requiresInvitation: false, submitting: false })
    const submitting = signIn(registration, { type: 'register' })
    expect(signIn(submitting, { type: 'registration-failed', error: coded('display-name-invalid') }))
      .toMatchObject({ step: 'registration', submitting: false, error: { field: 'displayName' } })
    expect(signIn(submitting, { type: 'registration-failed', error: coded('invitation-required', 403) }))
      .toMatchObject({ step: 'registration', requiresInvitation: true, error: { field: 'invitation' } })
    expect(signIn(submitting, { type: 'registration-failed', error: coded('registration-closed', 403) }))
      .toMatchObject({ step: 'failed', error: { kind: 'closed' } })
    expect(signIn(submitting, { type: 'registered', session: sessionFixture })).toEqual({ step: 'signed-in', session: sessionFixture })
  })

  it('shows the switched-account state only while the message waits for a signature', () => {
    expect(signIn(signing(), { type: 'account-changed', address: other })).toMatchObject({ step: 'failed', error: { kind: 'switched', address: other } })
    const ready = signing()
    expect(signIn(ready, { type: 'account-changed', address: address.toLowerCase() })).toEqual(ready)
    expect(signIn(signing(), { type: 'account-changed', address: null })).toMatchObject({ step: 'failed', error: { kind: 'disconnected' } })
    const connecting = run({ type: 'choose', wallet })
    expect(signIn(connecting, { type: 'account-changed', address: other })).toBe(connecting)
    const switched = signIn(signing(), { type: 'account-changed', address: other })
    expect(signIn(switched, { type: 'use-address', address: other })).toEqual({ step: 'signing', wallet, address: other, challenge: null, waiting: false })
  })

  it('expires the message, then retries with a new challenge for the same address', () => {
    const expired = signIn(signing(), { type: 'expired' })
    expect(expired).toMatchObject({ step: 'failed', error: { kind: 'expired' }, address })
    expect(signIn(expired, { type: 'retry' })).toEqual({ step: 'signing', wallet, address, challenge: null, waiting: false })
    expect(signIn(expired, { type: 'reset' })).toEqual(initialSignIn)
  })

  it.each([
    [new WalletError('declined'), { kind: 'declined', during: 'sign' }],
    [new WalletError('pending'), { kind: 'pending' }],
    [coded('challenge-expired'), { kind: 'expired' }],
    [coded('signature-unsupported'), { kind: 'unsupported' }],
    [new ApiError('http', 'wait', 429, '2026-10-17T10:00:00.000Z', 'rate-limited'), { kind: 'rate-limited', retryAt: '2026-10-17T10:00:00.000Z' }],
    [coded('user-suspended', 403), { kind: 'suspended' }],
    [coded('registration-closed', 403), { kind: 'closed' }],
    [new ApiError('unavailable', 'down'), { kind: 'unreachable' }],
    [coded('identity-unavailable', 503), { kind: 'unreachable' }],
    [coded('signature-mismatch'), { kind: 'other', message: 'copy for signature-mismatch' }],
    [new Error('private wallet detail'), { kind: 'other', message: 'Sign-in could not be completed. Start again.' }],
  ] as const)('maps %s to its state', (cause, error) => {
    expect(signInError(cause)).toEqual(error)
  })

  it('records whether a decline happened while connecting', () => {
    const failed = signIn(run({ type: 'choose', wallet }), { type: 'failed', error: new WalletError('declined') })
    expect(failed).toMatchObject({ step: 'failed', address: null, error: { kind: 'declined', during: 'connect' } })
    expect(signIn(failed, { type: 'retry' })).toEqual({ step: 'connecting', wallet })
  })
})
