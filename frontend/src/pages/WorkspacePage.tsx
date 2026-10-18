import { useEffect, useState, type ComponentType } from 'react'
import { createPublicAuthApi, type AuthConfig } from '@/api/auth'
import { errorMessage } from '@/api/errors'
import { ConnectionGate } from '@/features/connection/ConnectionGate'
import { applyStoredAppearance } from '@/features/settings/appearance'
import { Button } from '@/components/ui/button'
import type { ApplicationShell as Shell } from '@/features/workspace/ApplicationShell'
import type { SignInGate as Gate } from '@/features/identity/SignInGate'

type ShellComponent = ComponentType<Parameters<typeof Shell>[0]>

// The connection screen is always first, so it ships without the workspace. The workspace starts
// downloading as soon as this module runs, while the owner enters the token.
let loadedShell: ShellComponent | null = null
const shellModule: Promise<ShellComponent> = import('@/features/workspace/ApplicationShell')
  .then(module => module.ApplicationShell as ShellComponent)
  // A rejected native module URL can stay failed for the document's lifetime: offer a reload, not a retry.
  .catch(() => ShellLoadFallback)
  .then(component => (loadedShell = component))

function ShellLoadFallback() {
  return <main className="connection-page">
    <section className="panel connection-card" role="alert">
      <h1>The workspace could not be loaded.</h1>
      <p className="muted">The browser could not load or initialize the workspace code. This can follow a connection problem or app update. Reloading the browser may ask you to connect or sign in again.</p>
      <Button variant="outline" onClick={() => window.location.reload()}>Reload browser</Button>
    </section>
  </main>
}

/**
 * Not React.lazy: a lazy component suspends once even when its module is already loaded, and React
 * then holds the Suspense fallback for its reveal throttle (about 300 ms) after every connect.
 */
function DeferredShell(props: Parameters<typeof Shell>[0]) {
  const [Loaded, setLoaded] = useState<ShellComponent | null>(() => loadedShell)
  useEffect(() => {
    if (Loaded) return
    let active = true
    void shellModule.then(component => { if (active) setLoaded(() => component) })
    return () => { active = false }
  }, [Loaded])
  if (!Loaded) return <main className="connection-page"><p className="muted" role="status">Loading your workspace…</p></main>
  return <Loaded {...props} />
}

type GateComponent = typeof Gate
// Wallet sign-in loads only when the server is in Wallet mode, so Token mode's first screen stays as light as before.
let signInGate: Promise<GateComponent> | null = null
const loadSignInGate = () => signInGate ??= import('@/features/identity/SignInGate').then(module => module.SignInGate)

function WalletGate({ config }: { config: Extract<AuthConfig, { mode: 'wallet' }> }) {
  const [Loaded, setLoaded] = useState<GateComponent | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    loadSignInGate().then(component => { if (active) setLoaded(() => component) }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])
  if (failed) return <ShellLoadFallback />
  if (!Loaded) return <main className="connection-page"><p className="muted" role="status">Loading sign-in…</p></main>
  return <Loaded registration={config.registration} originAccepted={config.originAccepted}>
    {(system, disconnect, api, identity) => <DeferredShell system={system} disconnect={disconnect} api={api} identity={identity} />}
  </Loaded>
}

/** The server decides the sign-in mode: the token form in Token mode, wallet sign-in in Wallet mode. */
export function WorkspacePage() {
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    createPublicAuthApi().config(window.location.origin, controller.signal).then(next => {
      if (controller.signal.aborted) return
      if (next.mode === 'token') applyStoredAppearance()
      else void loadSignInGate().catch(() => undefined)
      setConfig(next)
    }, (cause: unknown) => { if (!controller.signal.aborted) setError(errorMessage(cause, 'Vessel is unreachable.')) })
    return () => controller.abort()
  }, [attempt])
  if (config?.mode === 'token') return <ConnectionGate>{(system, disconnect, api) => <DeferredShell system={system} disconnect={disconnect} api={api} />}</ConnectionGate>
  if (config?.mode === 'wallet') return <WalletGate config={config} />
  return <main className="connection-page">
    {error ? <section className="panel connection-card" role="alert">
      <h1>Vessel is unreachable</h1>
      <p className="muted">{error}</p>
      <Button variant="outline" onClick={() => { setError(null); setAttempt(value => value + 1) }}>Retry</Button>
    </section> : <p className="muted" role="status">Connecting to Vessel…</p>}
  </main>
}
