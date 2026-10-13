import type { BrokerAccount, Portfolio } from '@/api/workspace'

export function overviewAccounts(scope: string, accounts: BrokerAccount[]): BrokerAccount[] {
  return accounts.filter(a => a.isEnabled !== false && (scope === 'all' || scope === `account:${a.id}` ||
    scope === 'unassigned' && a.portfolioId === null || scope === `portfolio:${a.portfolioId}`))
}
export function resolveOverviewScope(scope: string, accounts: BrokerAccount[], portfolios: Portfolio[]): string {
  return scope === 'all' || scope === 'unassigned' && accounts.some(a => a.isEnabled !== false && a.portfolioId === null) ||
    scope.startsWith('portfolio:') && portfolios.some(p => scope === `portfolio:${p.id}`) ||
    scope.startsWith('account:') && accounts.some(a => a.isEnabled !== false && scope === `account:${a.id}`) ? scope : 'all'
}
