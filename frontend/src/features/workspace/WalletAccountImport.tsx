import { useState, type FormEvent } from 'react'
import type { AccountDiscovery, DiscoveredAccount } from '@/api/account-access'
import { credentialTransportAllowed } from '@/api/account-access'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { useVenues } from '@/api/venues'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ReadOnlyTokenInput } from './AccountCredential'
import { money } from './format'

type ImportResult = { account?: BrokerAccount; message: string }

export function WalletAccountImport({ venueId, api, portfolios, accounts, onCreated, onBusy, onClose }: {
  venueId: string; api: WorkspaceApi; portfolios: Portfolio[]; accounts: BrokerAccount[]
  onCreated: () => void; onBusy: (busy: boolean) => void; onClose: () => void
}) {
  const venues = useVenues()
  const [address, setAddress] = useState('')
  const [discovery, setDiscovery] = useState<AccountDiscovery | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [portfolioId, setPortfolioId] = useState('')
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [loadingNames, setLoadingNames] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [namesNotice, setNamesNotice] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ImportResult>>({})
  // Keep confirmed creations visible even if a subsequent workspace reload is slow or fails.
  const [created, setCreated] = useState<BrokerAccount[]>([])
  const currentAccounts = [...created, ...accounts]
  const existing = (candidate: DiscoveredAccount) =>
    currentAccounts.find(a => a.venueId === venueId && (a.sourceId ?? a.address) === candidate.sourceId)
  const added = (candidate: DiscoveredAccount) => !!(candidate.existingAccountId || existing(candidate))
  const begin = () => { setPending(true); onBusy(true); setError(null) }
  const finish = () => { setToken(''); setPending(false); onBusy(false) }
  async function find(event: FormEvent) {
    event.preventDefault(); setError(null); setToken('')
    if (!/^0x[\da-f]{40}$/i.test(address.trim())) { setError('Use a valid public wallet address, starting with 0x.'); return }
    begin(); setDiscovery(null); setSelected([]); setResults({}); setNamesNotice(null)
    try {
      const next = await api.discoverAccounts(venueId, address.trim().toLowerCase())
      setDiscovery(next); setNames(Object.fromEntries(next.accounts.map(a => [a.sourceId, a.name])))
    } catch { setError('Could not find accounts for this wallet. Check the address and try again.') }
    finally { finish() }
  }
  async function loadNames() {
    if (!discovery || !token || !credentialTransportAllowed()) return
    const submitted = token
    setToken(''); setNamesNotice(null); setLoadingNames(true); begin()
    try {
      const next = await api.discoverAccounts(venueId, discovery.address, undefined, submitted)
      // A name the owner already edited belongs to Vessel; do not overwrite it.
      setNames(previous => Object.fromEntries(next.accounts.map(a => {
        const edited = previous[a.sourceId]
        return [a.sourceId, edited !== undefined && edited !== discovery.accounts.find(old => old.sourceId === a.sourceId)?.name
          ? edited : a.name]
      })))
      setDiscovery(next)
      setNamesNotice('Venue names loaded where available. Unnamed accounts keep their index label. The token was not saved; re-enter it at import if you also want order access.')
    } catch {
      setError('Could not load venue names. Check the read-only token’s wallet, scope and expiry. Public balances and your selections are unchanged.')
    } finally { setLoadingNames(false); finish() }
  }
  async function importSelected(event: FormEvent) {
    event.preventDefault()
    const candidates = discovery?.accounts.filter(a => selected.includes(a.sourceId) && !added(a) && !results[a.sourceId]) ?? []
    const submitted = token
    setToken(''); setError(null)
    if (!candidates.length) return
    if (candidates.some(a => !names[a.sourceId]?.trim())) { setError('Name each selected account before importing.'); return }
    begin()
    try {
      for (const candidate of candidates) {
        let account: BrokerAccount
        try {
          account = await api.createAccount({ venueId, sourceId: candidate.sourceId, name: names[candidate.sourceId]!.trim(),
            portfolioId: portfolios.some(p => p.id === portfolioId) ? portfolioId : null })
          setCreated(previous => [...previous, account]); onCreated()
        } catch (cause) {
          setResults(previous => ({ ...previous, [candidate.sourceId]: { message: cause instanceof ApiError && cause.status === 409
            ? 'Already added. Close this dialog to manage or re-enable the existing account.'
            : 'Import not confirmed. Find wallet again before retrying; any existing account will be shown.' } }))
          // Reconcile the workspace even when a request completed but its response was lost.
          onCreated()
          continue
        }
        let message = 'Imported. Public reads are available; add an optional token in Manage account for orders.'
        if (submitted && credentialTransportAllowed()) {
          try {
            await api.saveAccountCredential(account.id, submitted)
            message = 'Imported. Read-only token verified and saved.'
          } catch {
            message = 'Imported, but token not saved. Open Manage account to retry. Check token scope and expiry, or ask the operator to check credential storage.'
          }
        }
        setResults(previous => ({ ...previous, [candidate.sourceId]: { account, message } }))
      }
      setSelected([])
    } finally { finish() }
  }
  const importable = discovery?.accounts.filter(a => selected.includes(a.sourceId) && !added(a) && !results[a.sourceId]) ?? []
  return <div className="wallet-import" aria-busy={pending}>
    <form className="workspace-form" onSubmit={event => { void find(event) }}>
      <label htmlFor="discovery-wallet">Public wallet address</label>
      <div className="wallet-search"><Input id="discovery-wallet" value={address} placeholder="0x…" autoComplete="off"
        spellCheck={false} disabled={pending} maxLength={128} onChange={event => {
          setAddress(event.target.value); setDiscovery(null); setSelected([]); setResults({}); setToken(''); setNamesNotice(null)
        }} />
        <Button type="submit" variant="outline" disabled={pending}>{pending && !discovery ? 'Finding…' : 'Find wallet'}</Button>
      </div>
      <p className="field-help">Find the main account and subaccounts, then choose which to import. No wallet signing or history refresh.</p>
    </form>
    {discovery && <form className="workspace-form" autoComplete="off" onSubmit={event => { void importSelected(event) }}>
      <div className="import-heading"><h3>Choose accounts</h3><span className="muted">{discovery.accounts.length} found</span></div>
      {discovery.accounts.length === 0 && <p className="credential-notice" role="status">No accounts were found for this wallet. Check the address or try another wallet.</p>}
      <div className="discovered-accounts">
        {discovery.accounts.map(candidate => {
          const record = existing(candidate)
          const alreadyAdded = added(candidate)
          const disabled = record ? record.isEnabled === false : candidate.isEnabled === false
          const result = results[candidate.sourceId]
          const checked = !alreadyAdded && selected.includes(candidate.sourceId)
          return <div className={`discovered-account${checked ? ' selected' : ''}`} key={candidate.sourceId}>
            <label className="discovered-choice">
              <input type="checkbox" checked={checked} disabled={pending || alreadyAdded || !!result}
                onChange={event => setSelected(previous => event.target.checked ? [...previous, candidate.sourceId] : previous.filter(id => id !== candidate.sourceId))} />
              <span><strong>{candidate.name}</strong><small>{candidate.accountType === 'main' ? 'Main account' : 'Subaccount'} · Index {candidate.sourceId}</small></span>
              <span className="discovered-value">
                {candidate.collateralUsd != null || candidate.availableBalanceUsd != null ? <>
                  <span title={candidate.collateralUsd ?? undefined}>Collateral · {candidate.collateralUsd == null ? 'Unavailable' : money(candidate.collateralUsd)}</span>
                  <small title={candidate.availableBalanceUsd ?? undefined}>Available · {candidate.availableBalanceUsd == null ? 'Unavailable' : money(candidate.availableBalanceUsd)}</small>
                </> : candidate.accountValueUsd === null ? 'Balance unavailable' : <>Account value · {money(candidate.accountValueUsd)}</>}
              </span>
            </label>
            {alreadyAdded && <p className="field-help">Already imported{disabled ? ' · Disabled' : ''}. {disabled ? 'Re-enable in Manage account.' : 'Manage the existing account instead.'}</p>}
            {checked && !result && <div className="workspace-form">
              <label htmlFor={`import-name-${candidate.sourceId}`}>Account name · {candidate.sourceId}</label>
              <Input id={`import-name-${candidate.sourceId}`} value={names[candidate.sourceId] ?? ''} maxLength={200}
                disabled={pending} onChange={event => setNames(previous => ({ ...previous, [candidate.sourceId]: event.target.value }))} />
            </div>}
            {result && <p className="import-result" role="status">{result.message}</p>}
          </div>
        })}
      </div>
      {discovery.notice && <p className="field-help">{discovery.notice}</p>}
      {discovery.accounts.some(a => a.collateralUsd != null || a.availableBalanceUsd != null) &&
        <p className="field-help">Venue-reported collateral and available balance in USD, not total equity. Balances are a snapshot from discovery.</p>}
      {importable.length > 0 && <>
        <label htmlFor="import-portfolio">Portfolio <span className="optional">optional · selected accounts</span></label>
        <select id="import-portfolio" value={portfolioId} disabled={pending} onChange={event => setPortfolioId(event.target.value)}>
          <option value="">No portfolio · All accounts only</option>{portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </>}
        {discovery.accounts.length > 0 && Object.keys(results).length === 0 && venues.can(venueId, 'readOnlyCredential') && <section className="credential-panel" aria-label="Optional order access">
          <h3>Venue names &amp; order access <span className="optional">optional</span></h3>
          <p className="field-help">Public discovery does not include account names. Use an all-scope read-only token from the main account to load {venues.name(venueId)} names before selecting. A single-scope token loads only its account name.</p>
          {importable.length > 0 && <p className="field-help">{importable.length === 1
            ? 'Choose single scope for this account, or all scope from the main account.'
            : 'For multiple selected accounts, create an all-scope token from the main account.'} Each account is verified separately. Skip this to import public reads only.</p>}
          <ReadOnlyTokenInput venueId={venueId} value={token} onChange={setToken} disabled={pending} />
          <Button type="button" variant="outline" disabled={pending || !token || !credentialTransportAllowed()}
            onClick={() => { void loadNames() }}>{loadingNames ? 'Loading names…' : `Load ${venues.name(venueId)} names`}</Button>
          {namesNotice && <p className="field-help" role="status">{namesNotice}</p>}
        </section>}
      <div className="credential-actions">
        <Button type="button" variant="outline" disabled={pending} onClick={() => { setToken(''); onClose() }}>Done</Button>
        <Button type="submit" disabled={pending || importable.length === 0}>{pending && !loadingNames ? 'Importing…' : `Import selected${importable.length ? ` (${importable.length})` : ''}`}</Button>
      </div>
      <p className="field-help">Import creates account records only. Open an account and choose Refresh account for current state and bounded recent fills, not full history.</p>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>
}
