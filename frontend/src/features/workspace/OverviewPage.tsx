import type { ReactNode } from 'react'
import type { BrokerAccount, Overview, WorkspaceApi } from '@/api/workspace'
import type { OverviewQuery } from '@/api/overview-summary'
import { Button } from '@/components/ui/button'
import { ArrowRight, Wallet } from 'lucide-react'
import { AccountRows } from './AccountRows'
import { ActivityOperations } from './ActivityOperations'
import { OverviewScope } from './OverviewScope'
import { overviewAccounts } from './overview-scope'
import { OverviewSummary } from './OverviewSummary'
import { OverviewPlays } from './OverviewPlays'
import { OverviewAllocation } from './OverviewAllocation'

export function OverviewPage({ data, api, overviewQuery, setOverviewQuery, reloadKey, refreshAllAction, refreshing,
  onAddAccount, onCreatePortfolio, onAccounts, onActivity, viewAccount, sync, manageAccount, browsePlays, viewPlay, reload }: {
  data: Overview; api: WorkspaceApi; overviewQuery: OverviewQuery
  setOverviewQuery: (query: OverviewQuery | ((previous: OverviewQuery) => OverviewQuery)) => void
  reloadKey: number; refreshAllAction: ReactNode; refreshing: string | null
  onAddAccount: () => void; onCreatePortfolio: () => void; onAccounts: () => void; onActivity: () => void
  viewAccount: (id: string) => void; sync: (id: string) => Promise<void>; manageAccount: (account: BrokerAccount) => void
  browsePlays: () => void; viewPlay: (id: string, signal: AbortSignal) => Promise<void>; reload: () => void
}) {
  const { accounts, portfolios } = data
  const enabledAccounts = accounts.filter(account => account.isEnabled !== false)
  const scopedAccounts = overviewAccounts(overviewQuery.scope, accounts)
  const scopeAccountIds = scopedAccounts.map(account => account.id)
  const portfolioNames = Object.fromEntries(portfolios.map(p => [p.id, p.name]))
  return <>
    <OverviewScope scope={overviewQuery.scope} onScope={scope => setOverviewQuery(query => ({ ...query, scope }))}
      accounts={accounts} portfolios={portfolios} />
    <OverviewSummary api={api} query={overviewQuery} onQuery={setOverviewQuery} reloadGeneration={reloadKey}
      fallback={data} accountCount={scopedAccounts.length}
      beforeSummary={<OverviewAllocation accounts={accounts} portfolios={portfolios} scope={overviewQuery.scope}
        onScope={scope => setOverviewQuery(query => ({ ...query, scope }))} />} />
    {!accounts.length ? <section className="shell-panel workspace-start">
      <span className="start-icon"><Wallet size={26} /></span>
      <div className="eyebrow">SET UP YOUR DIARY</div>
      <h2>Start with your accounts.</h2>
      <p>Add a read-only exchange account or a manual record. Portfolios are optional groups you can create now or later.</p>
      <div className="start-steps"><span><i>1</i>Add an account</span><span><i>2</i>Refresh venue facts when ready</span><span><i>3</i>Record or review a Play</span></div>
      <Button onClick={onAddAccount}>Add your first account<ArrowRight size={15} /></Button>
      <Button variant="ghost" onClick={onCreatePortfolio}>Create an optional portfolio</Button>
    </section> : <section className="shell-panel">
      <header className="shell-panel-heading">
        <div><h2>Your enabled accounts</h2><p>Disabled records stay in account management; their imported activity is hidden.</p></div>
        <div className="panel-heading-actions">{refreshAllAction}<button className="text-action" onClick={onAccounts}>View all<ArrowRight size={14} /></button></div>
      </header>
      {enabledAccounts.length ? <AccountRows accounts={scopedAccounts.slice(0, 4)} portfolioNames={portfolioNames}
        refreshing={refreshing} onDetail={viewAccount} onSync={id => { void sync(id) }} onManage={manageAccount} /> :
        <div className="workspace-empty small-empty">
          <strong>All accounts are disabled</strong>
          <p>Open All accounts to enable a record again. Retained imports have not been deleted.</p>
          <Button variant="outline" onClick={onAccounts}>Manage accounts</Button>
        </div>}
    </section>}
    <div className="overview-bottom-grid">
      <section className="shell-panel">
        <header className="shell-panel-heading">
          <div><h2>Recent activity</h2><p>Aggregated position operations</p></div>
          <button className="text-action" onClick={onActivity}>View activity<ArrowRight size={14} /></button>
        </header>
        <ActivityOperations api={api} accounts={accounts} scopeAccountIds={scopeAccountIds}
          accountId={overviewQuery.scope.startsWith('account:') ? overviewQuery.scope.slice(8) : undefined}
          compact reloadGeneration={reloadKey} onOpenPlay={viewPlay} onCreated={reload} />
      </section>
      <OverviewPlays api={api} accounts={accounts} scopeAccountIds={scopeAccountIds} reloadGeneration={reloadKey}
        onBrowse={browsePlays} onOpen={viewPlay} />
    </div>
    <p className="workspace-scope-note">{data.scopeNote} Balances describe account observations. Activity describes retained imported operations. Review scores eligible saved closed Plays, including manual facts; it is not an account-equity return.</p>
  </>
}
