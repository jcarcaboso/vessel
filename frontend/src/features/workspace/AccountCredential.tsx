import { useEffect, useId, useState, type FormEvent } from 'react'
import {
  credentialSaveMessage, credentialStorageMessage, credentialTransportAllowed, credentialTransportMessage,
  type AccountCredential as CredentialMetadata,
} from '@/api/account-access'
import type { WorkspaceApi } from '@/api/workspace'
import { isHttpsUrl } from '@/api/system'
import { useVenues } from '@/api/venues'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { time } from './format'

export function ReadOnlyTokenInput({ venueId, value, onChange, disabled = false }: {
  venueId: string; value: string; onChange: (value: string) => void; disabled?: boolean
}) {
  const id = useId()
  const venues = useVenues()
  const setupUrl = venues.find(venueId)?.credentialSetupUrl
  const secure = credentialTransportAllowed()
  return <div className="workspace-form token-field">
    {isHttpsUrl(setupUrl) && <a className="credential-setup-link" href={setupUrl} target="_blank" rel="noopener noreferrer">
      Create a read-only token in {venues.name(venueId)}
    </a>}
    <label htmlFor={id}>Read-only token</label>
    <Input id={id} type="password" value={value} onChange={event => onChange(event.target.value)}
      disabled={disabled || !secure} autoComplete="new-password" spellCheck={false}
      autoCapitalize="none" maxLength={512} aria-describedby={`${id}-help`} />
    <p id={`${id}-help`} className="field-help">{secure
      ? 'Only a read-only token. Do not enter API private keys. No wallet signing is required. Vessel verifies access before storing it encrypted; the token is never displayed again.'
      : credentialTransportMessage}</p>
  </div>
}

export function AccountCredential({ accountId, venueId, enabled, api, onBusy }: {
  accountId: string; venueId: string; enabled: boolean; api: WorkspaceApi; onBusy: (busy: boolean) => void
}) {
  const [metadata, setMetadata] = useState<CredentialMetadata | null>(null)
  const [token, setToken] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const secure = credentialTransportAllowed()
  useEffect(() => {
    const controller = new AbortController()
    api.accountCredential(accountId, controller.signal).then(value => {
      if (!controller.signal.aborted) { setMetadata(value); setError(null); setLoaded(true) }
    }).catch(() => {
      if (!controller.signal.aborted) { setError('Credential status is unavailable. Retry to check it.'); setLoaded(true) }
    })
    return () => controller.abort()
  }, [api, accountId, retry])

  async function save(event: FormEvent) {
    event.preventDefault()
    const submitted = token
    setToken(''); setError(null); setNotice(null)
    if (!secure) { setError(credentialTransportMessage); return }
    if (!enabled || !metadata?.storageConfigured || !submitted.trim()) return
    setPending(true); onBusy(true)
    try {
      setMetadata(await api.saveAccountCredential(accountId, submitted))
      setNotice('Read-only token verified and saved.')
    } catch { setError(credentialSaveMessage) }
    finally { setToken(''); setPending(false); onBusy(false) }
  }
  async function remove() {
    setToken(''); setPending(true); onBusy(true); setError(null); setNotice(null)
    try {
      await api.deleteAccountCredential(accountId)
      setMetadata(previous => previous && { ...previous, credential: null })
      setRemoving(false); setNotice('Credential removed. Public account reads remain available.')
    } catch { setError('Could not remove the credential. Refresh its status before trying again.') }
    finally { setPending(false); onBusy(false) }
  }
  const stored = metadata?.credential
  const statuses = { valid: 'Valid', expiring: 'Expiring', expired: 'Expired', unavailable: 'Unavailable' }
  return <section className="credential-panel" aria-label="Order access" aria-busy={pending || !loaded}>
    <header><div><h3>Order access</h3><p className="field-help">Optional for public reads. A read-only token is required to read orders.</p></div>
      <span className={`workspace-badge${!stored || stored.status !== 'valid' ? ' warning-badge' : ''}`}>
        {!loaded ? 'Checking…' : !metadata || !metadata.storageConfigured ? 'Unavailable' : stored ? statuses[stored.status] : 'Missing'}
      </span>
    </header>
    {metadata && !metadata.storageConfigured && <p className="credential-notice">{credentialStorageMessage}</p>}
    {!enabled && <p className="credential-notice">Enable the account and save its settings before adding or replacing a token. You can still remove a stored token.</p>}
    {stored && <dl className="credential-metadata">
      <div><dt>Scope</dt><dd>{stored.scope === 'all' ? 'All accounts · verified for this account' : 'This account'}</dd></div>
      <div><dt>Expires</dt><dd>{time(stored.expiresAt)}</dd></div>
      <div><dt>Last verified</dt><dd>{stored.lastVerifiedAt ? time(stored.lastVerifiedAt) : 'Unavailable'}</dd></div>
    </dl>}
    {stored?.status === 'expiring' && <p className="credential-notice">The token expires soon. Replace it to keep order reads available.</p>}
    {stored?.status === 'expired' && <p className="credential-notice">The token has expired. Replace it to restore order reads. Public reads are unaffected.</p>}
    {stored?.status === 'unavailable' && <p className="credential-notice">The saved credential is unavailable. Replace it or ask the operator to check the vault.</p>}
    {removing ? <div className="workspace-form">
      <p className="credential-notice">Remove this read-only token? Order reads will stop. Imported records and public reads are kept.</p>
      <div className="management-actions">
        <Button type="button" variant="outline" disabled={pending} onClick={() => setRemoving(false)}>Keep token</Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={() => { void remove() }}>Confirm remove token</Button>
      </div>
    </div> : <form className="workspace-form" autoComplete="off" onSubmit={event => { void save(event) }}>
      <p className="field-help">Choose single scope for this account, or all scope from the main account. Vessel verifies that the token covers this account.</p>
      <ReadOnlyTokenInput venueId={venueId} value={token} onChange={setToken} disabled={pending || !enabled || !metadata?.storageConfigured} />
      <div className="credential-actions">
        {stored && <Button type="button" variant="outline" disabled={pending} onClick={() => { setToken(''); setRemoving(true); setError(null); setNotice(null) }}>Remove token</Button>}
        <Button type="submit" disabled={pending || !enabled || !secure || !metadata?.storageConfigured || !token.trim()}>
          {pending ? 'Verifying…' : stored ? 'Verify and replace token' : 'Verify and save token'}
        </Button>
      </div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="credential-notice" role="status">{notice}</p>}
    <Button type="button" variant="ghost" size="sm" disabled={pending || !loaded} onClick={() => {
      setToken(''); setMetadata(null); setLoaded(false); setError(null); setNotice(null); setRetry(value => value + 1)
    }}>Refresh credential status</Button>
  </section>
}
