import type { ActivityOperation } from '@/api/activity'
import type { BrokerAccount } from '@/api/workspace'
import { operationStatus } from './activity-format'

export interface Filters { account: string; portfolio: string; contract: string; direction: string; status: string; period: string; from: string; to: string }
export const emptyFilters: Filters = { account: '', portfolio: '', contract: '', direction: '', status: '', period: 'all', from: '', to: '' }

export function filterOperations(operations: ActivityOperation[], accounts: BrokerAccount[], filters: Filters, now: number) {
  const from = filters.period === 'custom' ? filters.from ? Date.parse(`${filters.from}T00:00:00Z`) : null :
    filters.period === 'all' ? null : now - Number(filters.period) * 86_400_000
  const to = filters.period === 'custom' && filters.to ? Date.parse(`${filters.to}T00:00:00Z`) + 86_400_000 : null
  return operations.filter(op => {
    const account = accounts.find(a => a.id === op.accountId && a.isEnabled !== false)
    const at = Date.parse(op.lastOccurredAtUtc)
    return account && (!filters.account || op.accountId === filters.account) &&
      (!filters.portfolio || (filters.portfolio === 'unassigned' ? account.portfolioId === null : account.portfolioId === filters.portfolio)) &&
      (!filters.contract || op.contractId === filters.contract) && (!filters.direction || op.direction === filters.direction) &&
      (!filters.status || (filters.status === 'partial' ? operationStatus(op).tone === 'partial' : op.status === filters.status)) &&
      (from === null || at >= from) && (to === null || at < to)
  })
}
