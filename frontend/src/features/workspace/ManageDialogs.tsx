import { useState, type FormEvent } from 'react'
import type { BrokerAccount, Portfolio, WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Trash2 } from 'lucide-react'

const failure = (cause: unknown) => cause instanceof ApiError ? cause.message : 'The change could not be completed. Your stored records have not been replaced.'

export function ManagePortfolioDialog({ portfolio, api, onClose, onChanged }: {
  portfolio: Portfolio; api: WorkspaceApi; onClose: () => void; onChanged: (message: string) => void
}) {
  const [name, setName] = useState(portfolio.name)
  const [deleting, setDeleting] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function rename(event: FormEvent) {
    event.preventDefault(); setError(null)
    if (!name.trim()) { setError('Give the portfolio a name.'); return }
    setPending(true)
    try {
      await api.renamePortfolio(portfolio.id, name.trim()); onChanged('Portfolio renamed.'); onClose()
    } catch (cause) { setError(failure(cause)) }
    finally { setPending(false) }
  }
  async function remove() {
    setPending(true); setError(null)
    try {
      await api.deletePortfolio(portfolio.id)
      onChanged('Portfolio deleted. Its accounts are now available in All accounts.'); onClose()
    } catch (cause) { setError(failure(cause)) }
    finally { setPending(false) }
  }
  return <Dialog open onOpenChange={next => { if (!next && !pending) onClose() }}>
    <DialogContent className="workspace-dialog">
      <DialogHeader><DialogTitle>{deleting ? 'Delete portfolio?' : 'Manage portfolio'}</DialogTitle><DialogDescription>{deleting ?
        `Delete ${portfolio.name}? Its account records, imported executions, snapshots and plays are kept. Accounts will be unassigned and visible in All accounts.` :
        'Change the display name or remove the grouping without deleting its accounts.'}</DialogDescription></DialogHeader>
      {deleting ? <div className="workspace-form">
        {error && <p className="error" role="alert">{error}</p>}
        <div className="management-actions"><Button variant="outline" onClick={() => { setDeleting(false); setError(null) }} disabled={pending}>Keep portfolio</Button><Button variant="destructive" onClick={() => { void remove() }} disabled={pending}>{pending ? 'Deleting…' : 'Delete portfolio'}</Button></div>
      </div> : <form className="workspace-form" onSubmit={event => { void rename(event) }} aria-busy={pending}>
        <label htmlFor="rename-portfolio">Portfolio name</label><Input id="rename-portfolio" value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={pending} autoFocus />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="management-actions"><Button type="button" variant="ghost" className="danger-action" onClick={() => { setDeleting(true); setError(null) }} disabled={pending}><Trash2 size={14} />Delete</Button><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save name'}</Button></div>
      </form>}
    </DialogContent>
  </Dialog>
}

export function ManageAccountDialog({ account, portfolios, api, onClose, onChanged }: {
  account: BrokerAccount; portfolios: Portfolio[]; api: WorkspaceApi
  onClose: () => void; onChanged: (message: string) => void
}) {
  const [name, setName] = useState(account.name)
  const [portfolioId, setPortfolioId] = useState(account.portfolioId ?? '')
  const [enabled, setEnabled] = useState(account.isEnabled !== false)
  const [deleting, setDeleting] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(event: FormEvent) {
    event.preventDefault(); setError(null)
    if (!name.trim()) { setError('Name the account.'); return }
    setPending(true)
    try {
      await api.updateAccount(account.id, { name: name.trim(), portfolioId: portfolioId || null, isEnabled: enabled })
      onChanged(enabled ? 'Account settings saved.' : 'Account disabled. Its retained imports are hidden until enabled again.')
      onClose()
    } catch (cause) { setError(failure(cause)) }
    finally { setPending(false) }
  }
  async function remove() {
    setPending(true); setError(null)
    try {
      await api.deleteAccount(account.id); onChanged('Account and its retained imported records deleted.'); onClose()
    } catch (cause) { setError(failure(cause)) }
    finally { setPending(false) }
  }
  return <Dialog open onOpenChange={next => { if (!next && !pending) onClose() }}>
    <DialogContent className="workspace-dialog">
      <DialogHeader><DialogTitle>{deleting ? 'Delete account permanently?' : 'Manage account'}</DialogTitle><DialogDescription>{deleting ?
        `Delete ${account.name} and its retained imported executions, snapshots and positions? This cannot be undone here. Accounts with linked Play records cannot be deleted; disable them instead.` :
        'Rename, move or disable this record. The venue and public address do not change.'}</DialogDescription></DialogHeader>
      {deleting ? <div className="workspace-form">
        {error && <p className="error" role="alert">{error}</p>}
        <div className="management-actions"><Button variant="outline" onClick={() => { setDeleting(false); setError(null) }} disabled={pending}>Keep account</Button><Button variant="destructive" onClick={() => { void remove() }} disabled={pending}>{pending ? 'Deleting…' : 'Delete account'}</Button></div>
      </div> : <form className="workspace-form" onSubmit={event => { void save(event) }} aria-busy={pending}>
        <label htmlFor="rename-account">Account name</label><Input id="rename-account" value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={pending} autoFocus />
        <label htmlFor="move-account">Portfolio</label><select id="move-account" value={portfolioId} onChange={event => setPortfolioId(event.target.value)} disabled={pending}>
          <option value="">No portfolio · All accounts only</option>{portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <p className="field-help">Choosing No portfolio unlinks it without removing its history.</p>
        <label className="account-enabled-control"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={pending} />Account enabled</label>
        <p className="field-help">Disabled accounts keep their records. Imported history and positions are hidden from normal views, excluded from totals, and refresh is blocked. Enable again to restore them.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="management-actions"><Button type="button" variant="ghost" className="danger-action" onClick={() => { setDeleting(true); setError(null) }} disabled={pending}><Trash2 size={14} />Delete</Button><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save settings'}</Button></div>
      </form>}
    </DialogContent>
  </Dialog>
}
