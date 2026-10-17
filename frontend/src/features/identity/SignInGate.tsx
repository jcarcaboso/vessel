import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Lock, Plug } from 'lucide-react'
import { createPublicAuthApi, createSessionAuthApi, type PublicAuthApi, type RegistrationPolicy, type SessionDto, type UserDto } from '@/api/auth'
import { ApiError, errorMessage } from '@/api/errors'
import { getSystem, type SystemInfo } from '@/api/system'
import { createWorkspaceApi, type WorkspaceApi } from '@/api/workspace'
import { clearCandleCache } from '@/features/market/candleCache'
import { scopePreferences } from '@/lib/preference-scope'
import { SignInBrand, StateCard } from './IdentityParts'
import { SignInScreen } from './SignInScreen'
import { notices, SessionController, takeNotice, type SessionChannelFactory } from './session'
import type { ShellIdentity } from './types'
import type { BrowserWallet } from './wallets/discovery'

type Ready = { session: SessionDto; system: SystemInfo; api: WorkspaceApi; controller: SessionController; walletName: string | null }
type GateState =
  | { kind: 'probing' }
  | { kind: 'sign-in'; notice: string | null }
  | { kind: 'loading' }
  | { kind: 'ready'; ready: Ready }
  | { kind: 'failed'; message: string; retry: { session: SessionDto; walletName: string | null } | null }
  | { kind: 'suspended' }
  | { kind: 'signing-out'; ready: Ready }
  | { kind: 'sign-out-failed'; ready: Ready; message: string }

export type GateChildren = (system: SystemInfo, disconnect: () => void, api: WorkspaceApi, identity: ShellIdentity) => ReactNode

interface SignInGateProps {
  registration: RegistrationPolicy
  originAccepted: boolean
  children: GateChildren
  /** Tests inject the cross-tab channel, the full navigation and the public client. */
  channels?: SessionChannelFactory
  navigate?: (url: string) => void
  publicApi?: PublicAuthApi
}

/**
 * Wallet mode's first screen. It probes the session with the public call kind: a 200 opens the workspace, and a
 * 401 shows sign-in and never reloads (a teardown's reload lands here, so reloading again would loop).
 */
export function SignInGate({ registration, originAccepted, children, channels, navigate, publicApi }: SignInGateProps) {
  const api = useMemo(() => publicApi ?? createPublicAuthApi(), [publicApi])
  const [state, setState] = useState<GateState>({ kind: 'probing' })
  const [notice] = useState(takeNotice)
  const controllerRef = useRef<SessionController | null>(null)
  useEffect(() => () => { controllerRef.current?.dispose() }, [])

  const enter = useCallback(async (session: SessionDto, fresh: boolean, walletName: string | null) => {
    setState({ kind: 'loading' })
    controllerRef.current?.dispose()
    // The stores switch to this user before the workspace reads any preference.
    scopePreferences(session.user.id, session.adoptsLegacyPreferences)
    const controller: SessionController = new SessionController({
      session, ...channels ? { channels } : {}, ...navigate ? { navigate } : {},
      onSuspended: () => { controller.dispose(); setState({ kind: 'suspended' }) },
      onEndedEarly: ended => setState({ kind: 'sign-in', notice: ended }),
    })
    controllerRef.current = controller
    if (fresh) controller.announceSignIn()
    try {
      const credentials = controller.credentials()
      const system = await getSystem(credentials, controller.handleFailure)
      if (controllerRef.current !== controller) return
      const workspace = createWorkspaceApi(credentials, controller.handleFailure)
      controller.markLive()
      setState({ kind: 'ready', ready: { session, system, api: workspace, controller, walletName } })
    } catch (cause) {
      // A 401 or suspension already moved the gate; anything else may be retried.
      if (controllerRef.current !== controller || cause instanceof ApiError && (cause.status === 401 || cause.code === 'user-suspended')) return
      setState({ kind: 'failed', message: errorMessage(cause, 'The workspace could not be loaded.'), retry: { session, walletName } })
    }
  }, [channels, navigate])

  const settleProbe = useCallback((result: { session: SessionDto } | { cause: unknown }) => {
    if ('session' in result) { void enter(result.session, false, null); return }
    const { cause } = result
    if (cause instanceof ApiError && cause.status === 401) setState({ kind: 'sign-in', notice })
    else if (cause instanceof ApiError && cause.code === 'user-suspended') setState({ kind: 'suspended' })
    else setState({ kind: 'failed', message: errorMessage(cause, 'Vessel is unreachable.'), retry: null })
  }, [enter, notice])
  const probe = useCallback((signal: AbortSignal) => {
    api.session(signal).then(session => ({ session }), (cause: unknown) => ({ cause }))
      .then(result => { if (!signal.aborted) settleProbe(result) })
  }, [api, settleProbe])

  useEffect(() => {
    const controller = new AbortController()
    probe(controller.signal)
    return () => controller.abort()
  }, [probe])

  const ready = state.kind === 'ready' ? state.ready : null
  const signOut = useCallback((current: Ready) => {
    setState({ kind: 'signing-out', ready: current })
    clearCandleCache(current.api)
    current.controller.signOut(createSessionAuthApi(current.controller.credentials(), current.controller.handleFailure))
      .catch((cause: unknown) => setState({ kind: 'sign-out-failed', ready: current, message: errorMessage(cause, 'Sign-out did not complete.') }))
  }, [])
  const identity = useMemo<ShellIdentity | null>(() => {
    if (!ready) return null
    const { controller } = ready
    return {
      session: ready.session, walletName: ready.walletName,
      auth: createSessionAuthApi(controller.credentials(), controller.handleFailure),
      registerExitState: clear => controller.registerExitState(clear),
      onProfile: (user: UserDto) => setState(current => current.kind !== 'ready' ? current : { kind: 'ready', ready: {
        ...current.ready, session: { ...current.ready.session, user }, system: { ...current.ready.system, owner: { ...current.ready.system.owner, displayName: user.displayName } } } }),
      endSession: () => controller.teardown(notices.ended),
    }
  }, [ready])

  if (state.kind === 'ready' && identity) return children(state.ready.system, () => signOut(state.ready), state.ready.api, identity)
  if (state.kind === 'sign-in') return <SignInScreen api={api} registration={registration} originAccepted={originAccepted} notice={state.notice}
    onSignedIn={(session: SessionDto, wallet: BrowserWallet) => { void enter(session, true, wallet.name) }} />
  return <main className="connection-page sign-in-page">
    <section className="panel connection-card sign-in-card" aria-labelledby="gate-title">
      <div className="sign-in-head"><SignInBrand /></div>
      {(state.kind === 'probing' || state.kind === 'loading') && <><h1 id="gate-title" className="sr-only">Vessel</h1>
        <p className="muted" role="status">{state.kind === 'probing' ? 'Checking your session…' : 'Loading your workspace…'}</p></>}
      {state.kind === 'signing-out' && <><h1 id="gate-title" className="sr-only">Signing out</h1><p className="muted" role="status">Signing out…</p></>}
      {state.kind === 'failed' && <><h1 id="gate-title" className="sr-only">Vessel</h1>
        <StateCard icon={<Plug size={16} />} title="Vessel is unreachable" actions={[{ label: 'Retry', primary: true, onClick: () => {
          if (state.retry) void enter(state.retry.session, false, state.retry.walletName)
          else { setState({ kind: 'probing' }); probe(new AbortController().signal) }
        } }]}>{state.message}</StateCard></>}
      {state.kind === 'suspended' && <><h1 id="gate-title" className="sr-only">Vessel</h1>
        <StateCard icon={<Lock size={16} />} tone="bad" title="Journal suspended" actions={[{ label: 'Use another wallet', onClick: () => window.location.reload() }]}>
          The operator of this server has suspended this journal. Contact them to restore access.</StateCard></>}
      {state.kind === 'sign-out-failed' && <><h1 id="gate-title" className="sr-only">Vessel</h1>
        <StateCard icon={<Plug size={16} />} tone="warn" title="Sign-out did not complete" actions={[
          { label: 'Try again', primary: true, onClick: () => signOut(state.ready) },
          { label: 'Reload', onClick: () => window.location.reload() },
        ]}>{state.message} Your session may still be active on this device.</StateCard></>}
    </section>
  </main>
}
