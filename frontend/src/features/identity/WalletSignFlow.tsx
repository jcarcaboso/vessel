import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { challengeAddress, type Challenge } from '@/api/auth'
import { ApiError } from '@/api/errors'
import { SourceChip } from '@/components/accounts/AccountIdentity'
import { Button } from '@/components/ui/button'
import { checksumAddress } from '@/lib/eip55'
import { challengeLifetime, useCountdown } from './countdown'
import { MessagePreview, WalletButton, WalletMark } from './IdentityParts'
import { flowErrorText, signInError, type SignInError } from './sign-in-machine'
import { readLastWallet, type BrowserWallet } from './wallets/discovery'
import { requestAccount, sameAddress, signMessage, watchWallet } from './wallets/provider'
import { useBrowserWallets } from './wallets/useBrowserWallets'

type Flow =
  | { step: 'choose' }
  | { step: 'connecting'; wallet: BrowserWallet }
  | { step: 'preparing'; wallet: BrowserWallet; address: string }
  | { step: 'ready'; wallet: BrowserWallet; address: string; challenge: Challenge; waiting: boolean }
  | { step: 'completing'; wallet: BrowserWallet; address: string }
  // Not watched: the person may switch the wallet to a linked account to confirm.
  | { step: 'stepping-up'; wallet: BrowserWallet; address: string }
  // `refused`: `accept` turned the address down, so only another wallet or account can continue.
  | { step: 'failed'; wallet: BrowserWallet | null; address: string | null; message: string; refused?: boolean }

export interface WalletSignFlowProps {
  /** The caption over the message, e.g. "Confirm" or "Link wallet". */
  purpose: string
  /** A reason to refuse the shared address before asking the server, e.g. "not linked to your journal". */
  accept?: (address: string) => string | null
  requestChallenge: (address: string, signal: AbortSignal) => Promise<Challenge>
  complete: (challenge: Challenge, signature: string, signal: AbortSignal) => Promise<void>
  /**
   * A `step-up-required` answer opens the step-up, once per attempt. At the challenge request, the request is then
   * retried; at completion (the grant lapsed while the wallet signed) the spent challenge is replaced by a fresh one
   * for the person to sign again.
   */
  onStepUp?: () => Promise<boolean>
  onDone: () => void
  onCancel: () => void
  /** Hears the browser wallet the person chose, e.g. to suggest its name as a label. */
  onWallet?: (wallet: BrowserWallet) => void
  /** Extra fields shown with the message, such as a label. */
  children?: ReactNode
}

/**
 * Choose a browser wallet, connect, show the server's message and sign it: the shared part of step-up and linking.
 * Only `eth_requestAccounts` and `personal_sign` are called; each run discards the answers of the run it replaced.
 */
export function WalletSignFlow({ purpose, accept, requestChallenge, complete, onStepUp, onDone, onCancel, onWallet, children }: WalletSignFlowProps) {
  const { wallets, settled } = useBrowserWallets()
  const [lastRdns] = useState(readLastWallet)
  const [flow, setFlowState] = useState<Flow>({ step: 'choose' })
  const flowRef = useRef(flow)
  const setFlow = useCallback((next: Flow) => { flowRef.current = next; setFlowState(next) }, [])
  const run = useRef({ id: 0, controller: new AbortController() })
  const begin = useCallback(() => {
    run.current.controller.abort()
    run.current = { id: run.current.id + 1, controller: new AbortController() }
    return run.current
  }, [])
  // Unmount replaces the run too, so a late wallet or server answer stops before any callback.
  useEffect(() => () => { begin() }, [begin])
  // Whether this attempt already used its one step-up; a new attempt (connect, Try again) resets it.
  const steppedUp = useRef(false)
  const fail = useCallback((wallet: BrowserWallet | null, address: string | null, error: SignInError) =>
    setFlow({ step: 'failed', wallet, address, message: flowErrorText(error) }), [setFlow])

  const stepUpNeeded = useCallback((error: unknown) =>
    !!onStepUp && !steppedUp.current && error instanceof ApiError && error.code === 'step-up-required', [onStepUp])
  /** The attempt's one step-up; false (with the failure shown) when it was declined or the run was replaced. */
  const stepUp = useCallback(async (current: typeof run.current, wallet: BrowserWallet, address: string) => {
    steppedUp.current = true
    setFlow({ step: 'stepping-up', wallet, address })
    const done = await onStepUp!()
    if (run.current !== current) return false
    if (!done) setFlow({ step: 'failed', wallet, address, message: 'Confirm with a wallet already linked to this journal to continue.' })
    return done
  }, [onStepUp, setFlow])

  const prepare = useCallback(async (current: typeof run.current, wallet: BrowserWallet, address: string) => {
    setFlow({ step: 'preparing', wallet, address })
    const refused = accept?.(address)
    if (refused) { setFlow({ step: 'failed', wallet, address, message: refused, refused: true }); return }
    for (;;) {
      try {
        const challenge = await requestChallenge(address, current.controller.signal)
        if (run.current !== current) return
        if (!sameAddress(challengeAddress(challenge.message), address))
          throw new ApiError('invalid-response', 'Vessel returned a message for another address. Start again.')
        setFlow({ step: 'ready', wallet, address, challenge, waiting: false })
        return
      } catch (error) {
        if (run.current !== current) return
        if (stepUpNeeded(error)) {
          if (await stepUp(current, wallet, address)) continue
          return
        }
        fail(wallet, address, signInError(error))
        return
      }
    }
  }, [accept, fail, requestChallenge, setFlow, stepUpNeeded, stepUp])

  const connect = useCallback(async (wallet: BrowserWallet) => {
    const current = begin()
    steppedUp.current = false
    onWallet?.(wallet)
    setFlow({ step: 'connecting', wallet })
    try {
      const address = await requestAccount(wallet.provider)
      if (run.current === current) await prepare(current, wallet, address)
    } catch (error) {
      if (run.current === current) fail(wallet, null, signInError(error, 'connect'))
    }
  }, [begin, fail, onWallet, prepare, setFlow])

  async function sign() {
    if (flow.step !== 'ready' || flow.waiting) return
    const { wallet, address, challenge } = flow
    const current = begin()
    setFlow({ ...flow, waiting: true })
    try {
      const signature = await signMessage(wallet.provider, challenge.message, address)
      if (run.current !== current) return
      setFlow({ step: 'completing', wallet, address })
      await complete(challenge, signature, current.controller.signal)
      if (run.current === current) onDone()
    } catch (error) {
      if (run.current !== current) return
      // The server consumed or refused this challenge: confirm again, then sign a fresh one.
      if (stepUpNeeded(error)) { if (await stepUp(current, wallet, address)) await prepare(current, wallet, address); return }
      fail(wallet, address, signInError(error))
    }
  }

  const watched = flow.step === 'connecting' || flow.step === 'preparing' || flow.step === 'ready' ? flow.wallet.provider : null
  useEffect(() => {
    if (!watched) return
    return watchWallet(watched, {
      accountChanged: address => {
        const current = flowRef.current
        if (current.step !== 'ready' && current.step !== 'preparing' || sameAddress(address, current.address)) return
        begin()
        fail(current.wallet, current.address, address ? { kind: 'switched', address } : { kind: 'disconnected' })
      },
      disconnected: () => {
        const current = flowRef.current
        if (current.step === 'choose' || current.step === 'failed' || current.step === 'completing') return
        begin()
        fail(current.wallet, null, { kind: 'disconnected' })
      },
    })
  }, [watched, begin, fail])
  const expire = useCallback(() => {
    const current = flowRef.current
    if (current.step !== 'ready') return
    begin()
    fail(current.wallet, current.address, { kind: 'expired' })
  }, [begin, fail])

  const back = () => { begin(); setFlow({ step: 'choose' }) }
  if (flow.step === 'choose') return <div className="sign-flow">
    {wallets.length > 0 ? <div className="wallet-options" role="group" aria-label="Browser wallets">
      {wallets.map(wallet => <WalletButton key={wallet.key} wallet={wallet} last={wallet.rdns !== null && wallet.rdns === lastRdns} onChoose={() => { void connect(wallet) }} />)}
    </div> : <p className="muted" role="status">{settled ? 'No browser wallet found. Install a wallet extension, then reload this page.' : 'Looking for browser wallets…'}</p>}
    <div className="sign-in-actions is-end"><Button variant="outline" onClick={onCancel}>Cancel</Button></div>
  </div>
  const identity = 'wallet' in flow && flow.wallet && <div className="identity-row">
    <WalletMark wallet={flow.wallet} />
    <span className="identity-row-meta"><strong title={flow.wallet.name}>{flow.wallet.name}</strong>{'address' in flow && flow.address && <span><SourceChip source={checksumAddress(flow.address)} /></span>}</span>
    <Button variant="ghost" size="sm" onClick={back}>Change</Button>
  </div>
  return <div className="sign-flow" aria-busy={flow.step === 'connecting' || flow.step === 'preparing' || flow.step === 'completing' || flow.step === 'stepping-up'}>
    {identity}
    {flow.step === 'connecting' && <p className="muted" role="status">Approve the connection request in {flow.wallet.name}. Vessel only reads your address.</p>}
    {flow.step === 'preparing' && <p className="muted" role="status">Preparing the message…</p>}
    {flow.step === 'ready' && <ReadyMessage key={flow.challenge.challengeId} challenge={flow.challenge} purpose={purpose} onExpired={expire} />}
    {/* Still editable after a refusal (a label the server refused), before Try again asks for a fresh message. */}
    {(flow.step === 'ready' || flow.step === 'failed' && flow.address && !flow.refused) && children}
    {flow.step === 'completing' && <p className="muted" role="status">Checking the signature…</p>}
    {flow.step === 'stepping-up' && <p className="muted" role="status">Confirm with a linked wallet to continue.</p>}
    {flow.step === 'failed' && <p className="error" role="alert">{flow.message}</p>}
    <div className="sign-in-actions">
      {flow.step === 'ready' && <Button className="sign-in-primary" onClick={() => { void sign() }} disabled={flow.waiting} aria-busy={flow.waiting}>
        {flow.waiting ? <><span className="identity-spinner" aria-hidden="true" /><span className="identity-truncate">Waiting for {flow.wallet.name}…</span></>
          : <span className="identity-truncate">Sign with {flow.wallet.name}</span>}</Button>}
      {flow.step === 'failed' && flow.wallet && !flow.refused && <Button className="sign-in-primary" onClick={() => {
        const wallet = flow.wallet!
        steppedUp.current = false
        if (flow.address) void prepare(begin(), wallet, flow.address)
        else void connect(wallet)
      }}>Try again</Button>}
      {/* After a refused address, trying the same one again can only fail: another wallet is the way on. */}
      {flow.step === 'failed' && <Button {...flow.refused ? { className: 'sign-in-primary' } : { variant: 'ghost' as const }} onClick={back}>
        <ArrowLeft size={15} aria-hidden="true" />Other wallets</Button>}
      <Button variant="outline" onClick={() => { begin(); onCancel() }}>Cancel</Button>
    </div>
  </div>
}

function ReadyMessage({ challenge, purpose, onExpired }: { challenge: Challenge; purpose: string; onExpired: () => void }) {
  const [lifetime] = useState(() => challengeLifetime(challenge.message, challenge.expiresAt))
  const seconds = useCountdown(lifetime, onExpired)
  return <MessagePreview message={challenge.message} purpose={purpose} seconds={seconds} />
}
