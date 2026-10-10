import { useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, getSystem, type SystemInfo } from '@/api/system'
import { createWorkspaceApi, type WorkspaceApi } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function ConnectionGate({ children }: { children: (system: SystemInfo, disconnect: () => void, api: WorkspaceApi) => ReactNode }) {
  const [token, setToken] = useState('')
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [api, setApi] = useState<WorkspaceApi | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!token.trim()) {
      setError('Enter your Vessel API token.')
      return
    }
    setPending(true)
    try {
      const info = await getSystem(token)
      setApi(createWorkspaceApi(token))
      setSystem(info)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to connect to Vessel API.')
    } finally {
      setToken('')
      setPending(false)
    }
  }

  if (system && api) return children(system, () => { setSystem(null); setApi(null); setError(null); setToken('') }, api)
  return (
    <main className="connection-page">
      <section className="panel connection-card" aria-labelledby="connection-title">
        <p className="eyebrow">VESSEL / FOUNDATION</p>
        <h1 id="connection-title">Connect to your diary</h1>
        <p>Use the token configured on your self-hosted Vessel API.</p>
        <form onSubmit={(event) => { void connect(event) }} aria-busy={pending}>
          <label htmlFor="api-token">API token</label>
          <Input id="api-token" type="password" autoComplete="off" spellCheck={false}
            value={token} onChange={(event) => setToken(event.target.value)} disabled={pending}
            aria-invalid={error !== null} aria-describedby={error ? 'token-policy connection-error' : 'token-policy'} />
        <p id="token-policy" className="muted">Kept in memory for this session. Never stored in the browser or sent in a URL.</p>
          {error && <p role="alert" id="connection-error" className="error">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Connecting…' : 'Connect'}</Button>
        </form>
        <p className="muted">Self-hosted, read-only venue access. No order placement. Unsaved Play drafts are kept in memory until you save them.</p>
      </section>
    </main>
  )
}
