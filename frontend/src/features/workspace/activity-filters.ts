import type { ActivityPeriod, ActivityQuery, ActivityStatusFilter } from '@/api/activity'
import { defaultPageSize, type PageSize } from '@/components/ui/paging'

/** Activity filters as the selects hold them; blank means all. The server applies them. */
export interface Filters { account: string; portfolio: string; contract: string; direction: string; status: string; period: string; from: string; to: string }
export const emptyFilters: Filters = { account: '', portfolio: '', contract: '', direction: '', status: '', period: 'all', from: '', to: '' }

/** Filters, page and page size of a paged Activity list, kept in shell memory for the Activity page. */
export interface ActivityListState { filters: Filters; page: number; pageSize: PageSize }
export const initialActivityState: ActivityListState = { filters: emptyFilters, page: 1, pageSize: defaultPageSize }

/** The request parameters for these filters. Dates apply only to a custom period. */
export function filterQuery(filters: Filters): Omit<ActivityQuery, 'page' | 'pageSize'> {
  const period = (['all', '7', '30', '90', 'custom'].includes(filters.period) ? filters.period : 'all') as ActivityPeriod
  return {
    ...(filters.account ? { account: filters.account } : {}),
    ...(filters.portfolio ? { portfolio: filters.portfolio } : {}),
    ...(filters.contract ? { contract: filters.contract } : {}),
    ...(filters.direction === 'long' || filters.direction === 'short' ? { direction: filters.direction } : {}),
    ...(['open', 'partial', 'closed', 'incomplete'].includes(filters.status) ? { status: filters.status as ActivityStatusFilter } : {}),
    ...(period !== 'all' ? { period } : {}),
    ...(period === 'custom' && filters.from ? { from: filters.from } : {}),
    ...(period === 'custom' && filters.to ? { to: filters.to } : {}),
  }
}
