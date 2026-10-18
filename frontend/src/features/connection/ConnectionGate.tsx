import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { errorMessage } from '@/api/errors'
import { getSystem, type SystemInfo } from '@/api/system'
import { createWorkspaceApi, type WorkspaceApi } from '@/api/workspace'
import { clearCandleCache } from '@/features/market/candleCache'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InfoTip } from '@/components/ui/info-tip'
import { VesselMark } from '@/components/brand/VesselMark'
import { LockKeyhole } from 'lucide-react'

const tokenPolicy = 'Kept in memory for this session. Never stored in the browser or sent in a URL.'

export function ConnectionGate({ children }: { children: (system: SystemInfo, disconnect: () => void, api: WorkspaceApi) => ReactNode }) {
  const [token, setToken] = useState('')
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [api, setApi] = useState<WorkspaceApi | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => () => { if (api) clearCandleCache(api) }, [api])

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
      setError(errorMessage(cause, 'Unable to connect to Vessel API.'))
    } finally {
      setToken('')
      setPending(false)
    }
  }

  if (system && api) return children(system, () => { clearCandleCache(api); setSystem(null); setApi(null); setError(null); setToken('') }, api)
  return (
    <main className="connection-page">
      <section className="panel connection-card" aria-labelledby="connection-title">
        <div className="connection-brand" aria-hidden="true"><span className="shell-monogram"><VesselMark size={26} /></span><span>vessel<small>The trading journal</small></span></div>
        <h1 id="connection-title">Connect to your diary</h1>
        <form className="connection-form" onSubmit={(event) => { void connect(event) }} aria-busy={pending}>
          <div className="connection-label"><label htmlFor="api-token">API token</label><InfoTip icon={LockKeyhole} label="How the token is kept" side="right">{tokenPolicy}</InfoTip></div>
          <Input id="api-token" type="password" autoComplete="off" spellCheck={false}
            value={token} onChange={(event) => setToken(event.target.value)} disabled={pending}
            aria-invalid={error !== null} aria-describedby={error ? 'token-policy connection-error' : 'token-policy'} />
          <p id="token-policy" className="sr-only">{tokenPolicy}</p>
          {error && <p role="alert" id="connection-error" className="error">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Connecting…' : 'Connect'}</Button>
        </form>
      </section>
    </main>
  )
}
