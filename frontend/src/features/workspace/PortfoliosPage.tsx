import type { BrokerAccount, Portfolio } from '@/api/workspace'
import { Button } from '@/components/ui/button'
import { Folder, Pencil } from 'lucide-react'
import { money } from '@/lib/format'
import { PortfolioIcon } from './PortfolioIcon'

export function PortfoliosPage({ accounts, portfolios, onAddAccount, onCreatePortfolio, onOpen, onManage }: {
  accounts: BrokerAccount[]; portfolios: Portfolio[]; onAddAccount: () => void; onCreatePortfolio: () => void
  onOpen: (id: string) => void; onManage: (id: string, focusAccounts: boolean) => void
}) {
  return <section className="workspace-page-content">
    {!portfolios.length ? <div className="shell-panel workspace-empty">
      <Folder size={30} /><strong>No portfolios yet</strong>
      <p>Portfolios optionally group accounts by purpose. You can use accounts without one.</p>
      {!accounts.length && <Button onClick={onAddAccount}>Add your first account</Button>}
      <Button variant="outline" onClick={onCreatePortfolio}>Create a portfolio</Button>
    </div> : <div className="portfolio-grid">
      {portfolios.map(portfolio => <article className="shell-panel portfolio-tile" key={portfolio.id}>
        <button className="portfolio-open" aria-label={`Open ${portfolio.name}`} onClick={() => onOpen(portfolio.id)}>
          <span className="portfolio-icon"><PortfolioIcon icon={portfolio.icon} /></span>
          <h2>{portfolio.name}</h2><p>{portfolio.accountCount} {portfolio.accountCount === 1 ? 'account record' : 'account records'}</p>
          <strong>{money(portfolio.balanceUsd === undefined ? portfolio.totalValueUsd : portfolio.balanceUsd)}</strong>
          <small>{(portfolio.balanceCoverage ?? portfolio.valueCoverage) === 'complete' ? 'All enabled account balances recorded' :
            (portfolio.balanceCoverage ?? portfolio.valueCoverage) === 'partial' ? 'Partial balance · some enabled accounts unavailable' : 'Enabled account balances unavailable'}</small>
          <small>Perps/manual value {money(portfolio.totalValueUsd)}</small>
          <small>Available balance {money(portfolio.availableBalanceUsd ?? null)} · {portfolio.availableBalanceAccountCount ?? 0} of {portfolio.enabledAccountCount ?? 0} enabled · {portfolio.availableBalanceCoverage ?? 'unavailable'}</small>
        </button>
        <button className="icon-button portfolio-manage" aria-label={`Manage portfolio ${portfolio.name}`}
          title="Rename, change icon, manage accounts or delete portfolio" onClick={() => onManage(portfolio.id, false)}><Pencil size={14} /></button>
        <Button variant="outline" size="sm" aria-label={`Add accounts to ${portfolio.name}`} onClick={() => onManage(portfolio.id, true)}>Add accounts</Button>
      </article>)}
    </div>}
  </section>
}
