import { useEffect, useState, type ComponentType } from 'react'
import { ConnectionGate } from '@/features/connection/ConnectionGate'
import { Button } from '@/components/ui/button'
import type { ApplicationShell as Shell } from '@/features/workspace/ApplicationShell'

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
      <p className="muted">The browser could not load or initialize the workspace code. This can follow a connection problem or app update. Reloading the browser asks for the API token again.</p>
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

export function WorkspacePage() {
  return <ConnectionGate>{(system, disconnect, api) => <DeferredShell system={system} disconnect={disconnect} api={api} />}</ConnectionGate>
}
