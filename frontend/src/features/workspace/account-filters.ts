/** How the Accounts table clusters the rows that survive the filters. Grouping never hides an account. */
export type AccountGroupBy = 'none' | 'venue' | 'address'
export interface AccountFilters { search: string; venue: string; status: string; groupBy: AccountGroupBy }
export const emptyAccountFilters: AccountFilters = { search: '', venue: '', status: '', groupBy: 'none' }
