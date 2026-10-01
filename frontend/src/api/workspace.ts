import { ApiError } from './system'

export interface Portfolio {
  id: string
  name: string
  accountCount: number
  totalValueUsd: string | null
  valueCoverage: 'complete' | 'partial' | 'unavailable'
}
export interface BrokerAccount {
  id: string
  portfolioId: string | null
  name: string
  venueId: string
  address: string | null
  accountValueUsd: string | null
  lastSyncedAtUtc: string | null
  syncStatus: 'manual' | 'not-synced' | 'synced' | 'error'
  lastSyncError: string | null
  positionCount: number
  historyNotice: string | null
  /** Missing only during rollout from the previous API; treated as enabled. */
  isEnabled?: boolean
  availableStablecoinNominalUsd?: string | null
  stablecoinScope?: string | null
  accountMode?: string | null
  settingsRevision?: number
}
export interface ImportedFill {
  id: string
  accountId: string
  contractId: string
  side: string
  direction: string
  price: string
  quantity: string
  fee: string
  feeToken: string
  closedPnlUsd: string
  occurredAtUtc: string
  orderId: string
  sourceFillId: string
  transactionHash: string
  playId: string | null
}
export interface AccountSnapshot {
  observedAtUtc: string
  valueScope: string
  accountValueUsd: string | null
  withdrawableUsd: string | null
  marginUsedUsd: string | null
  positions: Array<{
    contractId: string
    signedQuantity: string
    entryPrice: string
    unrealizedPnlUsd: string
    marginUsedUsd: string
    leverage: number | null
  }>
  stablecoinWallet?: StablecoinWallet | null
}
export interface StablecoinWallet {
  observedAtUtc: string
  accountMode: string
  scope: string
  totalNominalUsd: string
  availableNominalUsd: string
  balances: Array<{ symbol: string; tokenIndex: number; tokenId: string; total: string; held: string; available: string }>
  notice: string
}
export interface Overview {
  portfolios: Portfolio[]
  accounts: BrokerAccount[]
  totals: {
    portfolioCount: number
    accountCount: number
    totalAccountValueUsd: string | null
    valuedAccountCount: number
    openPositionCount: number
    importedFillCount: number
    availableStablecoinNominalUsd?: string | null
    stablecoinAccountCount?: number
  }
  recentActivity: ImportedFill[]
  scopeNote: string
}
export interface CreateAccount {
  portfolioId: string | null
  name: string
  venueId: 'manual' | 'hyperliquid'
  address?: string
  manualAccountValueUsd?: string
}
export interface WorkspaceApi {
  overview(signal?: AbortSignal): Promise<Overview>
  portfolios(signal?: AbortSignal): Promise<Portfolio[]>
  accounts(signal?: AbortSignal): Promise<BrokerAccount[]>
  account(id: string, signal?: AbortSignal): Promise<BrokerAccount>
  createPortfolio(name: string): Promise<Portfolio>
  createAccount(account: CreateAccount): Promise<BrokerAccount>
  renamePortfolio(id: string, name: string): Promise<Portfolio>
  deletePortfolio(id: string): Promise<void>
  updateAccount(id: string, settings: { name: string; portfolioId: string | null; isEnabled: boolean; expectedRevision: number }): Promise<BrokerAccount>
  deleteAccount(id: string): Promise<void>
  snapshot(id: string, signal?: AbortSignal): Promise<AccountSnapshot | null>
  fills(id: string, signal?: AbortSignal): Promise<ImportedFill[]>
  sync(id: string): Promise<BrokerAccount>
}

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const text = (v: unknown): v is string => typeof v === 'string'
const nullableText = (v: unknown) => v === null || text(v)
const guid = (v: unknown) => text(v) && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
const decimal = (v: unknown): v is string => text(v) && v.length <= 100 && /^-?\d+(\.\d+)?$/.test(v)
const nullableDecimal = (v: unknown) => v === null || decimal(v)
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v))
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const portfolio = (v: unknown): v is Portfolio => object(v) && guid(v.id) && text(v.name) &&
  count(v.accountCount) && nullableDecimal(v.totalValueUsd) &&
  ['complete', 'partial', 'unavailable'].includes(String(v.valueCoverage))
const account = (v: unknown): v is BrokerAccount => object(v) && guid(v.id) &&
  (v.portfolioId === null || guid(v.portfolioId)) && text(v.name) && text(v.venueId) &&
  nullableText(v.address) && nullableDecimal(v.accountValueUsd) &&
  (v.lastSyncedAtUtc === null || date(v.lastSyncedAtUtc)) &&
  ['manual', 'not-synced', 'synced', 'error'].includes(String(v.syncStatus)) &&
  nullableText(v.lastSyncError) && count(v.positionCount) && nullableText(v.historyNotice) &&
  (v.isEnabled === undefined || typeof v.isEnabled === 'boolean') &&
  (v.availableStablecoinNominalUsd === undefined || nullableDecimal(v.availableStablecoinNominalUsd)) &&
  (v.stablecoinScope === undefined || nullableText(v.stablecoinScope)) &&
  (v.accountMode === undefined || nullableText(v.accountMode)) &&
  (v.settingsRevision === undefined || typeof v.settingsRevision === 'number' && count(v.settingsRevision) && v.settingsRevision > 0)
const fill = (v: unknown): v is ImportedFill => object(v) && guid(v.id) && guid(v.accountId) &&
  ['contractId', 'side', 'direction', 'feeToken', 'orderId', 'sourceFillId', 'transactionHash'].every(k => text(v[k])) &&
  ['price', 'quantity', 'fee', 'closedPnlUsd'].every(k => decimal(v[k])) && date(v.occurredAtUtc) && (v.playId === null || guid(v.playId))
const wallet = (v: unknown): v is StablecoinWallet | null => v === null || object(v) &&
  date(v.observedAtUtc) && text(v.accountMode) && text(v.scope) && decimal(v.totalNominalUsd) &&
  decimal(v.availableNominalUsd) && text(v.notice) && Array.isArray(v.balances) &&
  v.balances.every(b => object(b) && text(b.symbol) && count(b.tokenIndex) && text(b.tokenId) &&
    decimal(b.total) && decimal(b.held) && decimal(b.available))
const snapshot = (v: unknown): v is AccountSnapshot | null => v === null || object(v) &&
  date(v.observedAtUtc) && text(v.valueScope) && ['accountValueUsd', 'withdrawableUsd', 'marginUsedUsd'].every(k => nullableDecimal(v[k])) &&
  Array.isArray(v.positions) && v.positions.every(p => object(p) && text(p.contractId) &&
    ['signedQuantity', 'entryPrice', 'unrealizedPnlUsd', 'marginUsedUsd'].every(k => decimal(p[k])) &&
    (p.leverage === null || typeof p.leverage === 'number' && Number.isInteger(p.leverage) && p.leverage > 0)) &&
  (v.stablecoinWallet === undefined || wallet(v.stablecoinWallet))
const overview = (v: unknown): v is Overview => object(v) && Array.isArray(v.portfolios) && v.portfolios.every(portfolio) &&
  Array.isArray(v.accounts) && v.accounts.every(account) && object(v.totals) &&
  ['portfolioCount', 'accountCount', 'valuedAccountCount', 'openPositionCount', 'importedFillCount'].every(k => object(v.totals) && count(v.totals[k])) &&
  nullableDecimal(v.totals.totalAccountValueUsd) &&
  (v.totals.availableStablecoinNominalUsd === undefined || nullableDecimal(v.totals.availableStablecoinNominalUsd)) &&
  (v.totals.stablecoinAccountCount === undefined || count(v.totals.stablecoinAccountCount)) &&
  Array.isArray(v.recentActivity) && v.recentActivity.every(fill) && text(v.scopeNote)

export function createWorkspaceApi(token: string): WorkspaceApi {
  const bearer = token.trim()
  if (!bearer) throw new ApiError('missing-token', 'Enter your Vessel API token.')
  const resourceId = (id: string) => {
    if (!guid(id)) throw new ApiError('invalid-response', 'The account identifier is invalid.')
    return id
  }
  const accountPath = (id: string) => `/api/accounts/${resourceId(id)}`
  async function request<T>(path: string, validate: (v: unknown) => v is T, options: RequestInit = {}, timeout = 10_000, badGateway?: string): Promise<T> {
    let response: Response
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
      response = await fetch(path, {
        ...options, headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
      })
    } catch {
      throw new ApiError('unavailable', 'The request did not complete. Check the API and try again.')
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError('unauthorized', 'Your API token was rejected. Disconnect and connect again.', response.status)
    }
    if (!response.ok) {
      let detail = response.status === 502 && badGateway ? badGateway : 'The request could not be completed.'
      if (response.status === 400 || response.status === 409) {
        try {
          const problem: unknown = await response.json()
          if (object(problem) && text(problem.detail) && problem.detail.length <= 500) detail = problem.detail
        } catch { /* The safe default remains when a proxy returns non-JSON. */ }
      }
      if (response.status === 404) detail = 'This account or portfolio is no longer available.'
      if (response.status === 503) detail = 'The service is unavailable. Check the database and server configuration.'
      // Only the server-generated trace format is shown, so a proxy cannot inject text.
      const reference = response.headers.get('X-Correlation-ID')
      if (response.status >= 500 && reference && /^[\da-f]{32}$/.test(reference)) detail += ` Reference: ${reference}`
      throw new ApiError('http', detail, response.status)
    }
    if (response.status === 204) {
      const noContent: unknown = undefined
      if (validate(noContent)) return noContent
      throw new ApiError('invalid-response', 'The API returned no workspace data.')
    }
    let body: unknown
    try { body = await response.json() } catch { throw new ApiError('invalid-response', 'The API returned invalid data.') }
    if (!validate(body)) throw new ApiError('invalid-response', 'The API returned incompatible workspace data.')
    return body
  }
  return {
    overview: signal => request('/api/overview', overview, signal ? { signal } : {}),
    portfolios: signal => request('/api/portfolios', (v): v is Portfolio[] => Array.isArray(v) && v.every(portfolio), signal ? { signal } : {}),
    accounts: signal => request('/api/accounts', (v): v is BrokerAccount[] => Array.isArray(v) && v.every(account), signal ? { signal } : {}),
    account: (id, signal) => request(accountPath(id), account, signal ? { signal } : {}),
    createPortfolio: name => request('/api/portfolios', portfolio, { method: 'POST', body: JSON.stringify({ name }) }),
    createAccount: body => request('/api/accounts', account, { method: 'POST', body: JSON.stringify(body) }),
    renamePortfolio: (id, name) => request(`/api/portfolios/${resourceId(id)}`, portfolio, { method: 'PATCH', body: JSON.stringify({ name }) }),
    deletePortfolio: id => request(`/api/portfolios/${resourceId(id)}`, (v): v is undefined => v === undefined, { method: 'DELETE' }),
    updateAccount: (id, settings) => request(accountPath(id), account, { method: 'PUT', body: JSON.stringify(settings) }),
    deleteAccount: id => request(accountPath(id), (v): v is undefined => v === undefined, { method: 'DELETE' }),
    snapshot: (id, signal) => request(`${accountPath(id)}/snapshot`, snapshot, signal ? { signal } : {}),
    fills: (id, signal) => request(`${accountPath(id)}/fills`, (v): v is ImportedFill[] => Array.isArray(v) && v.every(fill), signal ? { signal } : {}),
    sync: id => request(`${accountPath(id)}/sync`, account, { method: 'POST' }, 30_000, 'The venue refresh failed. Previous account data is still available.'),
  }
}
