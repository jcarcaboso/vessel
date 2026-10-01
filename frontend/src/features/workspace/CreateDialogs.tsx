import { useState, type FormEvent } from 'react'
import type { Portfolio, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function CreatePortfolioDialog({ open, onOpenChange, api, onCreated }: {
  open: boolean; onOpenChange: (open: boolean) => void; api: WorkspaceApi; onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null)
    if (!name.trim()) { setError('Give the portfolio a name.'); return }
    setPending(true)
    try {
      await api.createPortfolio(name.trim()); setName(''); onOpenChange(false); onCreated()
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Could not create this portfolio.') }
    finally { setPending(false) }
  }
  return <Dialog open={open} onOpenChange={next => { if (!pending) { onOpenChange(next); setError(null) } }}>
    <DialogContent className="workspace-dialog">
      <DialogHeader><DialogTitle>New portfolio</DialogTitle><DialogDescription>Group accounts by the way you trade. Portfolio values use available account records, not estimated performance.</DialogDescription></DialogHeader>
      <form onSubmit={event => { void submit(event) }} className="workspace-form" aria-busy={pending}>
        <label htmlFor="portfolio-name">Portfolio name</label><Input id="portfolio-name" value={name} onChange={event => setName(event.target.value)} maxLength={200} placeholder="e.g. Swing trading" disabled={pending} autoFocus />
        {error && <p className="error" role="alert">{error}</p>}
        <Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create portfolio'}</Button>
      </form>
    </DialogContent>
  </Dialog>
}

export function CreateAccountDialog({ open, onOpenChange, api, portfolios, onCreated }: {
  open: boolean; onOpenChange: (open: boolean) => void; api: WorkspaceApi; portfolios: Portfolio[]
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [portfolioId, setPortfolioId] = useState('')
  const [venue, setVenue] = useState<'manual' | 'hyperliquid'>('hyperliquid')
  const [address, setAddress] = useState('')
  const [manualValue, setManualValue] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosenPortfolio = portfolios.some(p => p.id === portfolioId) ? portfolioId : ''
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null)
    if (!name.trim()) { setError('Name the account. A portfolio is optional.'); return }
    if (venue === 'hyperliquid' && !/^0x[\da-f]{40}$/i.test(address.trim())) { setError('Use a valid public wallet address, starting with 0x.'); return }
    if (venue === 'manual' && manualValue.trim() && !/^\d+(\.\d+)?$/.test(manualValue.trim())) { setError('Use a nonnegative balance, or leave it unavailable.'); return }
    setPending(true)
    try {
      await api.createAccount({
        portfolioId: chosenPortfolio || null, name: name.trim(), venueId: venue,
        ...(venue === 'hyperliquid' ? { address: address.trim().toLowerCase() } : manualValue.trim() ? { manualAccountValueUsd: manualValue.trim() } : {}),
      })
      setName(''); setAddress(''); setManualValue(''); onOpenChange(false); onCreated()
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Could not create this account.') }
    finally { setPending(false) }
  }
  return <Dialog open={open} onOpenChange={next => { if (!pending) { onOpenChange(next); setError(null) } }}>
    <DialogContent className="workspace-dialog">
      <DialogHeader><DialogTitle>Add an account</DialogTitle><DialogDescription>Hyperliquid uses a public address for read-only perpetual data. Manual accounts need no connection.</DialogDescription></DialogHeader>
      <form onSubmit={event => { void submit(event) }} className="workspace-form" aria-busy={pending}>
          <label htmlFor="account-portfolio">Portfolio <span className="optional">optional</span></label><select id="account-portfolio" value={chosenPortfolio} onChange={event => setPortfolioId(event.target.value)} disabled={pending}><option value="">No portfolio · All accounts only</option>{portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <label htmlFor="account-name">Account name</label><Input id="account-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Main account" maxLength={200} disabled={pending} />
          <label htmlFor="account-venue">Venue</label><select id="account-venue" value={venue} onChange={event => { setVenue(event.target.value as 'manual' | 'hyperliquid'); setError(null) }} disabled={pending}>
            <option value="hyperliquid">Hyperliquid · read-only perps</option><option value="manual">Manual account</option>
          </select>
          {venue === 'hyperliquid' ? <><label htmlFor="account-address">Public wallet address</label><Input id="account-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="0x…" maxLength={128} spellCheck={false} autoComplete="off" disabled={pending} /><p className="field-help">Never enter a private key or seed phrase. Adding the account does not automatically import its history.</p></> :
            <><label htmlFor="manual-balance">Known account value · USD <span className="optional">optional</span></label><Input id="manual-balance" value={manualValue} onChange={event => setManualValue(event.target.value)} placeholder="Leave blank if unavailable" inputMode="decimal" disabled={pending} /><p className="field-help">An unavailable value stays unknown, not zero.</p></>}
          {error && <p role="alert" className="error">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add account'}</Button>
        </form>
    </DialogContent>
  </Dialog>
}
