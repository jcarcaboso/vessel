import { overviewSummaryPath, isOverviewSummary, type OverviewQuery, type OverviewSummaryDocument } from './overview-summary'
import { isActivityDocument, type ActivityDocument } from './activity'
import { SseOverflowError, SseParser } from './sse'
import { candleIntervals, type CandleInterval } from './candles'
import { ApiError } from './errors'
import { emitApiEvent } from './events'
import { isImportedFill, type ImportedFill } from './fills'
import {
  isCount, isFilledText, isGuid, isNonNegativeDecimal, isNullOr, isPlainDecimal, isPositiveCount, isRecord, isText, isTimestamp,
} from './guards'
import {
  accountIndex, credentialSaveMessage, credentialTransportAllowed, credentialTransportMessage,
  type AccountCredential, type AccountDiscovery,
} from './account-access'
import {
  isPlayExecution, isPlayHistory, isPlaySummary, isSavedEvidence, isSavedPlay,
  type LinkOrder, type PlayExecution, type PlayFields, type PlayHistory, type PlaySummary, type SavedEvidence, type SavedPlay, type StatusRequest,
} from './plays'
import { isSizingDocument, type SizingDocument } from './sizing'
import { isReviewDocument, reviewPath, isReviewExclusions, reviewExclusionsPath, type ReviewDocument, type ReviewQuery, type ReviewExclusions } from './review'
import {
  isRetrospectivePreview, isCreateRetrospectivePlayRequest, retrospectivePreviewPath, retrospectivePlayPath,
  type RetrospectivePreview, type CreateRetrospectivePlayRequest,
} from './retrospective'
import {
  isManualExecutions, isManualExecutionInput, isManualExecutionCorrection,
  type ManualExecutions, type ManualExecutionInput, type ManualExecutionCorrection,
} from './diary'
import type { ImageMarkup } from './markup'

export interface Portfolio {
  id: string
  name: string
  accountCount: number
  totalValueUsd: string | null
  valueCoverage: 'complete' | 'partial' | 'unavailable'
  /** Sum of account balances (perps plus stablecoin wallet, or the wallet alone in unified modes). */
  balanceUsd?: string | null
  balanceCoverage?: 'complete' | 'partial' | 'unavailable'
  availableBalanceUsd?: string | null
  availableBalanceAccountCount?: number
  availableBalanceCoverage?: 'complete' | 'partial' | 'unavailable'
  enabledAccountCount?: number
  /** Icon key chosen by the owner; absent from servers that predate portfolio icons. */
  icon?: string
}
export interface VenueInstrument {
  contractId: string
  quantityDecimals: number
  maxLeverage: number
  /** Asset prices are quoted and margined in, e.g. USDC for BTC/USDC. */
  quoteAsset: string
  /** Price tick when the venue has one; prices placed on the chart round to it. */
  priceStep?: number | null
  /** Market category such as stocks or commodity; absent for venues that do not label markets. */
  category?: string | null
  /** The venue's own identifier when it differs from the contract key, e.g. a numeric market ID. */
  venueContractId?: string | null
  /** Maintenance margin as a fraction of notional when the venue states it; liquidation estimates otherwise assume one. */
  maintenanceMarginFraction?: number | null
}
export interface InstrumentCatalog {
  venueId: string
  marketScope: 'perpetuals'
  scope: 'venue-perpetuals' | 'manual'
  instruments: VenueInstrument[]
  notice: string
}
/** Venue trade candle. OHLCV stay exact decimal strings; times are UTC Unix milliseconds. */
export interface VenueCandle {
  openTime: number
  closeTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  /** Null when the venue reports no trade count. */
  trades: number | null
}
export interface CandleSeries {
  venueId: string
  instrument: string
  interval: CandleInterval
  priceSource: 'trades'
  candles: VenueCandle[]
  requestedFrom: number
  requestedTo: number
  retrievedAt: string
  historyExhausted: boolean
  notice: string
}
export interface CandleQuery {
  instrument: string
  interval: CandleInterval
  endTime?: number
  refresh?: boolean
}
/** Venue header statistics for one perpetual. Decimal strings are kept exactly as reported. */
export interface MarketContext {
  venueId: string
  instrument: string
  markPrice: string
  oraclePrice: string
  midPrice: string | null
  /** Null when the venue does not report it; the 24-hour change is then not shown. */
  previousDayPrice: string | null
  dayNotionalVolume: string
  openInterest: string
  fundingRate: string
  premium: string | null
  observedAt: string
  notice: string
}
export type LiveStreamState = 'live' | 'reconnecting' | 'stale'
/** Server-side state of the upstream venue feed behind one market stream. */
export interface MarketStreamStatus {
  state: LiveStreamState
  observedAt: string
}
/** One validated market-stream event. Prices are observations, never fills. */
export type MarketStreamEvent =
  | { type: 'candle'; candle: VenueCandle }
  | { type: 'context'; context: MarketContext }
  | { type: 'status'; status: MarketStreamStatus }
export interface MarketStreamQuery {
  instrument: string
  interval: CandleInterval
}
export interface BrokerAccount {
  id: string
  portfolioId: string | null
  name: string
  venueId: string
  address: string | null
  /** Missing on older servers. Display sourceId ?? address for EVM compatibility. */
  sourceId?: string | null
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
  /** Supported stablecoins in the wallet, held amounts included. */
  totalStablecoinNominalUsd?: string | null
  /** Nominal balance: perps plus wallet, or the wallet alone in unified and portfolio-margin modes. */
  balanceUsd?: string | null
  /** Exactly one availability source selected by the server, never summed with another ledger. */
  availableBalanceUsd?: string | null
  availableBalanceSource?: 'wallet' | 'margin' | 'withdrawable' | null
  settingsRevision?: number
}
export interface AccountSettingsExpectation {
  accountId: string
  settingsRevision: number
}
export interface AccountSnapshot {
  observedAtUtc: string
  valueScope: string
  accountValueUsd: string | null
  withdrawableUsd: string | null
  /** Reported available balance/free collateral, not guaranteed withdrawal capacity. */
  availableMarginUsd?: string | null
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
    totalBalanceUsd?: string | null
    balanceAccountCount?: number
    balanceCoverage?: 'complete' | 'partial' | 'unavailable'
    availableBalanceUsd?: string | null
    availableBalanceAccountCount?: number
    availableBalanceCoverage?: 'complete' | 'partial' | 'unavailable'
    enabledAccountCount?: number
  }
  recentActivity: ImportedFill[]
  scopeNote: string
}
export interface CreateAccount {
  portfolioId: string | null
  name: string
  venueId: string
  address?: string
  sourceId?: string
  manualAccountValueUsd?: string
}
export interface WorkspaceApi {
  overviewSummary(query: OverviewQuery, signal?: AbortSignal): Promise<OverviewSummaryDocument>
  activity(accountId?: string, signal?: AbortSignal): Promise<ActivityDocument>
  review(query: ReviewQuery, signal?: AbortSignal): Promise<ReviewDocument>
  reviewExclusions?(query: ReviewQuery, signal?: AbortSignal): Promise<ReviewExclusions>
  retrospectivePreview?(accountId: string, operationId: string, signal?: AbortSignal): Promise<RetrospectivePreview>
  createRetrospectivePlay?(body: CreateRetrospectivePlayRequest, signal?: AbortSignal): Promise<SavedPlay>
  overview(signal?: AbortSignal): Promise<Overview>
  portfolios(signal?: AbortSignal): Promise<Portfolio[]>
  accounts(signal?: AbortSignal): Promise<BrokerAccount[]>
  account(id: string, signal?: AbortSignal): Promise<BrokerAccount>
  instruments(id: string, signal?: AbortSignal): Promise<InstrumentCatalog>
  candles(id: string, query: CandleQuery, signal?: AbortSignal): Promise<CandleSeries>
  marketContext(id: string, instrument: string, signal?: AbortSignal): Promise<MarketContext>
  /**
   * Reads live candles, statistics and feed status until the server ends the stream (resolves), the signal
   * aborts (resolves) or the connection fails (rejects with ApiError). Invalid events are ignored.
   */
  marketStream(id: string, query: MarketStreamQuery, signal: AbortSignal, onEvent: (event: MarketStreamEvent) => void): Promise<void>
  createPortfolio(name: string, icon?: string, accountIds?: string[], expected?: AccountSettingsExpectation[]): Promise<Portfolio>
  moveAccounts(accountIds: string[], portfolioId: string | null, expected?: AccountSettingsExpectation[]): Promise<BrokerAccount[]>
  createAccount(account: CreateAccount): Promise<BrokerAccount>
  discoverAccounts(venueId: string, address: string, signal?: AbortSignal, token?: string): Promise<AccountDiscovery>
  accountCredential(id: string, signal?: AbortSignal): Promise<AccountCredential>
  saveAccountCredential(id: string, token: string): Promise<AccountCredential>
  deleteAccountCredential(id: string): Promise<void>
  updatePortfolio(id: string, settings: { name: string; icon?: string }): Promise<Portfolio>
  deletePortfolio(id: string): Promise<void>
  updateAccount(id: string, settings: { name: string; portfolioId: string | null; isEnabled: boolean; expectedRevision: number }): Promise<BrokerAccount>
  deleteAccount(id: string): Promise<void>
  snapshot(id: string, signal?: AbortSignal): Promise<AccountSnapshot | null>
  fills(id: string, signal?: AbortSignal): Promise<ImportedFill[]>
  sync(id: string, signal?: AbortSignal): Promise<BrokerAccount>
  plays(signal?: AbortSignal): Promise<PlaySummary[]>
  play(id: string, signal?: AbortSignal): Promise<SavedPlay>
  createPlay(fields: PlayFields): Promise<SavedPlay>
  /** A plan change after planning needs `revisionReason`. A stale `expectedVersion` is a 409. */
  updatePlay(id: string, fields: PlayFields & { expectedVersion: number; revisionReason?: string }): Promise<SavedPlay>
  changePlayStatus(id: string, expectedVersion: number, request: StatusRequest): Promise<SavedPlay>
  playHistory(id: string, signal?: AbortSignal): Promise<PlayHistory>
  manualExecutions?(id: string, signal?: AbortSignal): Promise<ManualExecutions>
  addManualExecution?(id: string, input: ManualExecutionInput, signal?: AbortSignal): Promise<ManualExecutions>
  correctManualExecution?(id: string, executionId: string, input: ManualExecutionCorrection, signal?: AbortSignal): Promise<ManualExecutions>
  deletePlay(id: string): Promise<void>
  playExecution(id: string, signal?: AbortSignal): Promise<PlayExecution>
  /** Refreshes the account's fills and orders at the venue, links what matches and applies status changes. */
  checkPlayExecution(id: string, signal?: AbortSignal): Promise<PlayExecution>
  linkOrder(id: string, link: LinkOrder): Promise<PlayExecution>
  unlinkOrder(id: string, linkId: string): Promise<PlayExecution>
  evidence(playId: string, signal?: AbortSignal): Promise<SavedEvidence[]>
  evidenceImage(id: string, signal?: AbortSignal): Promise<Blob>
  uploadEvidence(playId: string, image: Blob, fields: { source: 'capture' | 'upload'; note: string; markup: ImageMarkup | null; name: string }): Promise<SavedEvidence>
  updateEvidenceNote(id: string, note: string): Promise<SavedEvidence>
  updateEvidenceMarkup(id: string, markup: ImageMarkup | null): Promise<SavedEvidence>
  deleteEvidence(id: string): Promise<void>
  /** The owner's risk setting, closed-play record and suggestion limits. */
  sizing(signal?: AbortSignal): Promise<SizingDocument>
  /** Saves the risk per trade (0.1 to 5 percent, a decimal string) and returns the new sizing document. */
  updateSizingSettings(settings: { riskPercent: string }): Promise<SizingDocument>
}

const coverages = ['complete', 'partial', 'unavailable']
const validExpected = (ids: string[] | undefined, expected: AccountSettingsExpectation[] | undefined) =>
  expected === undefined || Array.isArray(expected) && !!ids?.length && expected.length === ids.length &&
  expected.every(e => isRecord(e) && isGuid(e.accountId) && ids.includes(e.accountId) && isPositiveCount(e.settingsRevision)) &&
  new Set(expected.map(e => e.accountId)).size === expected.length
const instrumentCatalog = (v: unknown): v is InstrumentCatalog => isRecord(v) && isFilledText(v.venueId, 64) &&
  v.marketScope === 'perpetuals' && ['venue-perpetuals', 'manual'].includes(String(v.scope)) &&
  Array.isArray(v.instruments) && v.instruments.length <= 10_000 &&
  v.instruments.every((i: unknown) => isRecord(i) && isFilledText(i.contractId, 128) && i.contractId.trim() === i.contractId &&
    isCount(i.quantityDecimals) && i.quantityDecimals <= 28 && isPositiveCount(i.maxLeverage) &&
    isText(i.quoteAsset) && /^[A-Za-z0-9]{1,16}$/.test(i.quoteAsset) &&
    (i.priceStep == null || typeof i.priceStep === 'number' && Number.isFinite(i.priceStep) && i.priceStep > 0) &&
    (i.category == null || isText(i.category, 32)) &&
    (i.venueContractId == null || isText(i.venueContractId, 128)) &&
    (i.maintenanceMarginFraction == null || typeof i.maintenanceMarginFraction === 'number' && i.maintenanceMarginFraction > 0 &&
      i.maintenanceMarginFraction < 1)) &&
  new Set(v.instruments.map((i: VenueInstrument) => i.contractId)).size === v.instruments.length &&
  (v.scope !== 'manual' || v.instruments.length === 0) && isText(v.notice, 1000)
const candle = (v: unknown): v is VenueCandle => isRecord(v) && isPositiveCount(v.openTime) && isPositiveCount(v.closeTime) &&
  v.closeTime >= v.openTime && ['open', 'high', 'low', 'close', 'volume'].every(k => isNonNegativeDecimal(v[k])) &&
  isNullOr(v.trades, isCount)
const candleSeries = (query: CandleQuery) => (v: unknown): v is CandleSeries => isRecord(v) && isFilledText(v.venueId, 64) &&
  v.instrument === query.instrument && v.interval === query.interval && v.priceSource === 'trades' &&
  Array.isArray(v.candles) && v.candles.length <= 5_000 && v.candles.every(candle) &&
  v.candles.every((c: VenueCandle, i: number, all: VenueCandle[]) => i === 0 || c.openTime > all[i - 1]!.openTime) &&
  isCount(v.requestedFrom) && isPositiveCount(v.requestedTo) && v.requestedTo >= v.requestedFrom && isTimestamp(v.retrievedAt) &&
  typeof v.historyExhausted === 'boolean' && isText(v.notice, 1000)
const marketContext = (instrument: string) => (v: unknown): v is MarketContext => isRecord(v) &&
  isFilledText(v.venueId, 64) && v.instrument === instrument &&
  ['markPrice', 'oraclePrice', 'dayNotionalVolume', 'openInterest'].every(k => isNonNegativeDecimal(v[k])) &&
  isNullOr(v.previousDayPrice, isNonNegativeDecimal) && isNullOr(v.midPrice, isNonNegativeDecimal) &&
  isPlainDecimal(v.fundingRate) && isNullOr(v.premium, isPlainDecimal) && isTimestamp(v.observedAt) && isText(v.notice, 1000)
const streamStatus = (v: unknown): v is MarketStreamStatus => isRecord(v) &&
  ['live', 'reconnecting', 'stale'].includes(String(v.state)) && isTimestamp(v.observedAt, 40)
const streamLimit = 1024 * 1024
const instrumentPattern = /^[A-Za-z0-9_-]{1,32}$/
const portfolio = (v: unknown): v is Portfolio => isRecord(v) && isGuid(v.id) && isText(v.name) &&
  isCount(v.accountCount) && isNullOr(v.totalValueUsd, isPlainDecimal) &&
  coverages.includes(String(v.valueCoverage)) &&
  (v.balanceUsd === undefined || isNullOr(v.balanceUsd, isPlainDecimal)) &&
  (v.balanceCoverage === undefined || coverages.includes(String(v.balanceCoverage))) &&
  (v.availableBalanceUsd === undefined || isNullOr(v.availableBalanceUsd, isPlainDecimal)) &&
  (v.availableBalanceAccountCount === undefined || isCount(v.availableBalanceAccountCount)) &&
  (v.enabledAccountCount === undefined || isCount(v.enabledAccountCount)) &&
  (v.availableBalanceCoverage === undefined || isText(v.availableBalanceCoverage) && coverages.includes(v.availableBalanceCoverage)) &&
  (v.icon === undefined || isText(v.icon, 40))
const account = (v: unknown): v is BrokerAccount => isRecord(v) && isGuid(v.id) &&
  isNullOr(v.portfolioId, isGuid) && isText(v.name) && isText(v.venueId) &&
  isNullOr(v.address, isText) && isNullOr(v.accountValueUsd, isPlainDecimal) &&
  (v.sourceId === undefined || isNullOr(v.sourceId, isText)) &&
  isNullOr(v.lastSyncedAtUtc, isTimestamp) &&
  ['manual', 'not-synced', 'synced', 'error'].includes(String(v.syncStatus)) &&
  isNullOr(v.lastSyncError, isText) && isCount(v.positionCount) && isNullOr(v.historyNotice, isText) &&
  (v.isEnabled === undefined || typeof v.isEnabled === 'boolean') &&
  (v.availableStablecoinNominalUsd === undefined || isNullOr(v.availableStablecoinNominalUsd, isPlainDecimal)) &&
  (v.stablecoinScope === undefined || isNullOr(v.stablecoinScope, isText)) &&
  (v.accountMode === undefined || isNullOr(v.accountMode, isText)) &&
  (v.totalStablecoinNominalUsd === undefined || isNullOr(v.totalStablecoinNominalUsd, isPlainDecimal)) &&
  (v.balanceUsd === undefined || isNullOr(v.balanceUsd, isPlainDecimal)) &&
  (v.availableBalanceUsd === undefined || isNullOr(v.availableBalanceUsd, isPlainDecimal)) &&
  (v.availableBalanceSource === undefined || v.availableBalanceSource === null ||
    isText(v.availableBalanceSource) && ['wallet', 'margin', 'withdrawable'].includes(v.availableBalanceSource)) &&
  (v.settingsRevision === undefined || isPositiveCount(v.settingsRevision))
const discovery = (venueId: string, address: string) => (v: unknown): v is AccountDiscovery => isRecord(v) &&
  v.venueId === venueId && isText(v.address) && v.address.toLowerCase() === address.toLowerCase() &&
  isText(v.notice, 2000) && Array.isArray(v.accounts) && v.accounts.length <= 1000 &&
  v.accounts.every((a: unknown) => isRecord(a) && accountIndex(a.sourceId) && isText(a.name, 200) &&
    ['main', 'subaccount'].includes(String(a.accountType)) && isNullOr(a.accountValueUsd, isPlainDecimal) &&
    (a.collateralUsd === undefined || isNullOr(a.collateralUsd, isPlainDecimal)) &&
    (a.availableBalanceUsd === undefined || isNullOr(a.availableBalanceUsd, isPlainDecimal)) &&
    isNullOr(a.existingAccountId, isGuid) && (a.isEnabled === null || typeof a.isEnabled === 'boolean')) &&
  new Set(v.accounts.map(a => a.sourceId)).size === v.accounts.length
const credential = (v: unknown): v is AccountCredential => isRecord(v) && typeof v.storageConfigured === 'boolean' &&
  Object.keys(v).every(k => ['storageConfigured', 'credential'].includes(k)) &&
  (v.credential === null || isRecord(v.credential) &&
    Object.keys(v.credential).every(k => ['scope', 'expiresAt', 'lastVerifiedAt', 'status'].includes(k)) &&
    ['single', 'all'].includes(String(v.credential.scope)) && isTimestamp(v.credential.expiresAt) &&
    isNullOr(v.credential.lastVerifiedAt, isTimestamp) &&
    ['valid', 'expiring', 'expired', 'unavailable'].includes(String(v.credential.status)))
const wallet = (v: unknown): v is StablecoinWallet | null => v === null || isRecord(v) &&
  isTimestamp(v.observedAtUtc) && isText(v.accountMode) && isText(v.scope) && isPlainDecimal(v.totalNominalUsd) &&
  isPlainDecimal(v.availableNominalUsd) && isText(v.notice) && Array.isArray(v.balances) &&
  v.balances.every(b => isRecord(b) && isText(b.symbol) && isCount(b.tokenIndex) && isText(b.tokenId) &&
    isPlainDecimal(b.total) && isPlainDecimal(b.held) && isPlainDecimal(b.available))
const snapshot = (v: unknown): v is AccountSnapshot | null => v === null || isRecord(v) &&
  isTimestamp(v.observedAtUtc) && isText(v.valueScope) &&
  ['accountValueUsd', 'withdrawableUsd', 'marginUsedUsd'].every(k => isNullOr(v[k], isPlainDecimal)) &&
  (v.availableMarginUsd === undefined || isNullOr(v.availableMarginUsd, isPlainDecimal)) &&
  Array.isArray(v.positions) && v.positions.every(p => isRecord(p) && isText(p.contractId) &&
    ['signedQuantity', 'entryPrice', 'unrealizedPnlUsd', 'marginUsedUsd'].every(k => isPlainDecimal(p[k])) &&
    (p.leverage === null || typeof p.leverage === 'number' && Number.isInteger(p.leverage) && p.leverage > 0)) &&
  (v.stablecoinWallet === undefined || wallet(v.stablecoinWallet))
const overview = (v: unknown): v is Overview => isRecord(v) && Array.isArray(v.portfolios) && v.portfolios.every(portfolio) &&
  Array.isArray(v.accounts) && v.accounts.every(account) && isRecord(v.totals) &&
  ['portfolioCount', 'accountCount', 'valuedAccountCount', 'openPositionCount', 'importedFillCount'].every(k => isRecord(v.totals) && isCount(v.totals[k])) &&
  isNullOr(v.totals.totalAccountValueUsd, isPlainDecimal) &&
  (v.totals.availableStablecoinNominalUsd === undefined || isNullOr(v.totals.availableStablecoinNominalUsd, isPlainDecimal)) &&
  (v.totals.stablecoinAccountCount === undefined || isCount(v.totals.stablecoinAccountCount)) &&
  (v.totals.totalBalanceUsd === undefined || isNullOr(v.totals.totalBalanceUsd, isPlainDecimal)) &&
  (v.totals.availableBalanceUsd === undefined || isNullOr(v.totals.availableBalanceUsd, isPlainDecimal)) &&
  ['balanceAccountCount', 'availableBalanceAccountCount', 'enabledAccountCount'].every(k => isRecord(v.totals) &&
    (v.totals[k] === undefined || isCount(v.totals[k]))) &&
  ['balanceCoverage', 'availableBalanceCoverage'].every(k => isRecord(v.totals) &&
    (v.totals[k] === undefined || coverages.includes(String(v.totals[k])))) &&
  Array.isArray(v.recentActivity) && v.recentActivity.every(isImportedFill) && isText(v.scopeNote)

export function createWorkspaceApi(token: string): WorkspaceApi {
  const bearer = token.trim()
  if (!bearer) throw new ApiError('missing-token', 'Enter your Vessel API token.')
  const resourceId = (id: string) => {
    if (!isGuid(id)) throw new ApiError('invalid-response', 'The account identifier is invalid.')
    return id
  }
  const accountPath = (id: string) => `/api/accounts/${resourceId(id)}`
  async function httpError(response: Response, badGateway?: string, tooMany?: string,
    notFound = 'This account or portfolio is no longer available.'): Promise<ApiError> {
    if (response.status === 401 || response.status === 403) {
      return new ApiError('unauthorized', 'Your API token was rejected. Disconnect and connect again.', response.status)
    }
    let detail = response.status === 502 && badGateway ? badGateway : response.status === 429 && tooMany ? tooMany : 'The request could not be completed.'
    if ([400, 409, 413, 415].includes(response.status)) {
      try {
        const problem: unknown = await response.json()
        if (isRecord(problem) && isText(problem.detail, 500)) detail = problem.detail
      } catch { /* The safe default remains when a proxy returns non-JSON. */ }
    }
    if (response.status === 404) detail = notFound
    if (response.status === 503) detail = 'The service is unavailable. Check the database and server configuration.'
    // Only the server-generated trace format is shown, so a proxy cannot inject text.
    const reference = response.headers.get('X-Correlation-ID')
    if (response.status >= 500 && reference && /^[\da-f]{32}$/.test(reference)) detail += ` Reference: ${reference}`
    return new ApiError('http', detail, response.status)
  }
  async function marketStream(id: string, query: MarketStreamQuery, signal: AbortSignal, onEvent: (event: MarketStreamEvent) => void) {
    if (!instrumentPattern.test(query.instrument) || !candleIntervals.includes(query.interval)) {
      throw new ApiError('invalid-response', 'The live chart request is invalid.')
    }
    const path = `${accountPath(id)}/market-stream?${new URLSearchParams({ instrument: query.instrument, interval: query.interval })}`
    const interrupted = () => new ApiError('unavailable', 'The live market stream was interrupted.')
    // Only the wait for response headers is bounded; an open stream is long-lived by design.
    const connect = new AbortController()
    const timer = setTimeout(() => connect.abort(), 25_000)
    let response: Response
    try {
      response = await fetch(path, {
        headers: { Authorization: `Bearer ${bearer}`, Accept: 'text/event-stream' },
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, connect.signal]),
      })
    } catch {
      if (signal.aborted) return
      throw new ApiError('unavailable', 'The live market stream did not connect. Check the API and try again.')
    } finally {
      clearTimeout(timer)
    }
    if (response.status === 401 || response.status === 403) emitApiEvent(api, { type: 'unauthorized' })
    if (!response.ok) {
      throw await httpError(response, 'Venue market data is unavailable. Try refreshing the chart.',
        'Too many live chart streams. Close another chart and try again.')
    }
    if (!response.body || !/^text\/event-stream\b/i.test(response.headers.get('Content-Type') ?? '')) {
      await response.body?.cancel().catch(() => undefined)
      throw new ApiError('invalid-response', 'The API returned an invalid live market stream.')
    }
    const isContext = marketContext(query.instrument)
    const parser = new SseParser(({ event, data }) => {
      if (signal.aborted || data.length > streamLimit) return
      let body: unknown
      try { body = JSON.parse(data) } catch { return }
      if (event === 'candle' && candle(body)) onEvent({ type: 'candle', candle: body })
      else if (event === 'context' && isContext(body)) onEvent({ type: 'context', context: body })
      else if (event === 'status' && streamStatus(body)) onEvent({ type: 'status', status: body })
    }, streamLimit)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const stop = () => { void reader.cancel().catch(() => undefined) }
    signal.addEventListener('abort', stop, { once: true })
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try { chunk = await reader.read() } catch {
          if (signal.aborted) return
          throw interrupted()
        }
        if (signal.aborted) return
        if (chunk.done) {
          parser.push(decoder.decode())
          parser.end()
          return
        }
        try { parser.push(decoder.decode(chunk.value, { stream: true })) } catch (error) {
          if (error instanceof SseOverflowError) {
            stop()
            throw new ApiError('invalid-response', 'The live market stream sent an oversized message.')
          }
          throw error
        }
      }
    } finally {
      signal.removeEventListener('abort', stop)
    }
  }
  async function request<T>(path: string, validate: (v: unknown) => v is T, options: RequestInit = {}, timeout = 10_000, badGateway?: string, safeError?: string): Promise<T> {
    let response: Response
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
      response = await fetch(path, {
        ...options, headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
      })
    } catch {
      throw new ApiError('unavailable', safeError ?? 'The request did not complete. Check the API and try again.')
    }
    // Credential failures must never echo provider or proxy response bodies.
    if (response.status === 401 || response.status === 403) emitApiEvent(api, { type: 'unauthorized' })
    if (!response.ok) throw safeError ? new ApiError('http', safeError, response.status) : await httpError(response, badGateway)
    if (response.status === 204) {
      const noContent: unknown = undefined
      if (validate(noContent)) return noContent
      throw new ApiError('invalid-response', safeError ?? 'The API returned no workspace data.')
    }
    let body: unknown
    try { body = await response.json() } catch { throw new ApiError('invalid-response', safeError ?? 'The API returned invalid data.') }
    if (!validate(body)) throw new ApiError('invalid-response', safeError ?? 'The API returned incompatible workspace data.')
    return body
  }
  // Plays and evidence: JSON bodies, multipart uploads and image downloads share auth and error handling.
  async function send(path: string, options: RequestInit & { accept?: string } = {}, timeout = 15_000) {
    let response: Response
    const { accept = 'application/json', ...init } = options
    try {
      const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
      response = await fetch(path, {
        ...init, headers: { Authorization: `Bearer ${bearer}`, Accept: accept, ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
      })
    } catch {
      throw new ApiError('unavailable', 'The request did not complete. Check the API and try again.')
    }
    if (response.status === 401 || response.status === 403) emitApiEvent(api, { type: 'unauthorized' })
    if (!response.ok) throw await httpError(response, undefined, undefined, 'This play or image is no longer available.')
    return response
  }
  async function json<T>(path: string, validate: (v: unknown) => v is T, options: RequestInit = {}, timeout?: number): Promise<T> {
    const response = await send(path, options, timeout)
    if (response.status === 204) {
      const noContent: unknown = undefined
      if (validate(noContent)) return noContent
      throw new ApiError('invalid-response', 'The API returned no play data.')
    }
    let body: unknown
    try { body = await response.json() } catch { throw new ApiError('invalid-response', 'The API returned invalid data.') }
    if (!validate(body)) throw new ApiError('invalid-response', 'The API returned incompatible play data.')
    return body
  }
  const playPath = (id: string) => {
    if (!isGuid(id)) throw new ApiError('invalid-response', 'The play identifier is invalid.')
    return `/api/plays/${id}`
  }
  const evidencePath = (id: string) => {
    if (!isGuid(id)) throw new ApiError('invalid-response', 'The image identifier is invalid.')
    return `/api/evidence/${id}`
  }
  const none = (v: unknown): v is undefined => v === undefined
  const withSignal = (signal?: AbortSignal) => signal ? { signal } : {}
  const api: WorkspaceApi = {
    plays: signal => json('/api/plays', (v): v is PlaySummary[] => Array.isArray(v) && v.every(isPlaySummary), withSignal(signal)),
    play: (id, signal) => json(playPath(id), isSavedPlay, withSignal(signal)),
    createPlay: fields => json('/api/plays', isSavedPlay, { method: 'POST', body: JSON.stringify(fields) }),
    updatePlay: (id, fields) => json(playPath(id), isSavedPlay, { method: 'PUT', body: JSON.stringify(fields) }),
    changePlayStatus: (id, expectedVersion, request) =>
      json(`${playPath(id)}/status`, isSavedPlay, { method: 'POST', body: JSON.stringify({ expectedVersion, ...request }) }),
    playHistory: (id, signal) => json(`${playPath(id)}/history`, isPlayHistory, withSignal(signal)),
    manualExecutions: (id, signal) => json(`${playPath(id)}/manual-executions`,
      (v): v is ManualExecutions => isManualExecutions(v) && v.play.summary.id === id, withSignal(signal)),
    addManualExecution: (id, input, signal) => {
      if (!isManualExecutionInput(input)) return Promise.reject(new ApiError('invalid-response', 'Provide valid manual execution facts, a UTC time and a request identity.'))
      return json(`${playPath(id)}/manual-executions`, (v): v is ManualExecutions => isManualExecutions(v) && v.play.summary.id === id,
        { method: 'POST', body: JSON.stringify(input), ...withSignal(signal) })
    },
    correctManualExecution: (id, executionId, input, signal) => {
      if (!isManualExecutionCorrection(input)) return Promise.reject(new ApiError('invalid-response', 'Provide valid correction facts and a reason.'))
      return json(`${playPath(id)}/manual-executions/${resourceId(executionId)}`,
        (v): v is ManualExecutions => isManualExecutions(v) && v.play.summary.id === id,
        { method: 'PUT', body: JSON.stringify(input), ...withSignal(signal) })
    },
    deletePlay: id => json(playPath(id), none, { method: 'DELETE' }),
    playExecution: (id, signal) => json(`${playPath(id)}/execution`, isPlayExecution, withSignal(signal)),
    checkPlayExecution: (id, signal) => json(`${playPath(id)}/execution/check`, isPlayExecution, { method: 'POST', ...withSignal(signal) }, 45_000),
    linkOrder: (id, link) => json(`${playPath(id)}/execution/links`, isPlayExecution, { method: 'POST', body: JSON.stringify(link) }),
    unlinkOrder: (id, linkId) => {
      if (!isGuid(linkId)) return Promise.reject(new ApiError('invalid-response', 'The link identifier is invalid.'))
      return json(`${playPath(id)}/execution/links/${linkId}`, isPlayExecution, { method: 'DELETE' })
    },
    evidence: (playId, signal) => json(`${playPath(playId)}/evidence`, (v): v is SavedEvidence[] => Array.isArray(v) && v.every(isSavedEvidence), withSignal(signal)),
    evidenceImage: async (id, signal) => {
      const response = await send(`${evidencePath(id)}/content`, { ...withSignal(signal), accept: 'image/*' }, 60_000)
      return response.blob()
    },
    uploadEvidence: (playId, image, fields) => {
      const form = new FormData()
      form.append('file', image, fields.name)
      form.append('source', fields.source)
      form.append('note', fields.note)
      if (fields.markup) form.append('markup', JSON.stringify(fields.markup))
      return json(`${playPath(playId)}/evidence`, isSavedEvidence, { method: 'POST', body: form }, 60_000)
    },
    updateEvidenceNote: (id, note) => json(evidencePath(id), isSavedEvidence, { method: 'PATCH', body: JSON.stringify({ note }) }),
    updateEvidenceMarkup: (id, markup) => json(`${evidencePath(id)}/markup`, isSavedEvidence,
      markup ? { method: 'PUT', body: JSON.stringify(markup) } : { method: 'DELETE' }),
    deleteEvidence: id => json(evidencePath(id), none, { method: 'DELETE' }),
    sizing: signal => json('/api/sizing', isSizingDocument, withSignal(signal)),
    review: (query, signal) => json(reviewPath(query), isReviewDocument, withSignal(signal)),
    reviewExclusions: (query, signal) => json(reviewExclusionsPath(query), isReviewExclusions, withSignal(signal)),
    retrospectivePreview: (accountId, operationId, signal) => json(retrospectivePreviewPath(resourceId(accountId), operationId),
      (v): v is RetrospectivePreview => isRetrospectivePreview(v) && v.operation.accountId === accountId && v.operation.id === operationId, withSignal(signal)),
    createRetrospectivePlay: (input, signal) => {
      if (!isCreateRetrospectivePlayRequest(input)) return Promise.reject(new ApiError('invalid-response', 'Provide a valid retrospective request and preview fingerprint.'))
      return json(retrospectivePlayPath(), (v): v is SavedPlay => isSavedPlay(v) &&
        v.summary.accountId === input.accountId && v.summary.origin === 'retrospective',
        { method: 'POST', body: JSON.stringify(input), ...withSignal(signal) })
    },
    updateSizingSettings: settings => json('/api/sizing/settings', isSizingDocument,
      { method: 'PUT', body: JSON.stringify({ riskPercent: settings.riskPercent }) }),
    activity: (id, signal) => request(`/api/activity${id !== undefined ? `?${new URLSearchParams({ accountId: resourceId(id) })}` : ''}`,
      (v): v is ActivityDocument => isActivityDocument(v) && (id === undefined ||
        v.operations.every(op => op.accountId.toLowerCase() === id.toLowerCase()) && v.coverage.every(c => c.accountId.toLowerCase() === id.toLowerCase())), signal ? { signal } : {}),
    overviewSummary: (query, signal) => request(overviewSummaryPath(query), (v): v is OverviewSummaryDocument => isOverviewSummary(v, query), signal ? { signal } : {}),
    overview: signal => request('/api/overview', overview, signal ? { signal } : {}),
    portfolios: signal => request('/api/portfolios', (v): v is Portfolio[] => Array.isArray(v) && v.every(portfolio), signal ? { signal } : {}),
    accounts: signal => request('/api/accounts', (v): v is BrokerAccount[] => Array.isArray(v) && v.every(account), signal ? { signal } : {}),
    account: (id, signal) => request(accountPath(id), account, signal ? { signal } : {}),
    instruments: (id, signal) => request(`${accountPath(id)}/instruments`, instrumentCatalog, signal ? { signal } : {},
      25_000, 'The venue instrument catalogue is unavailable. Try again or enter a manual label.'),
    candles: (id, query, signal) => {
      if (!instrumentPattern.test(query.instrument) || !candleIntervals.includes(query.interval) ||
        (query.endTime !== undefined && !isPositiveCount(query.endTime))) {
        return Promise.reject(new ApiError('invalid-response', 'The chart request is invalid.'))
      }
      const params = new URLSearchParams({ instrument: query.instrument, interval: query.interval })
      if (query.endTime !== undefined) params.set('endTime', String(query.endTime))
      if (query.refresh === true) params.set('refresh', 'true')
      return request(`${accountPath(id)}/candles?${params}`, candleSeries(query), signal ? { signal } : {},
        25_000, 'Venue candles are unavailable. Try refreshing the chart.')
    },
    marketContext: (id, instrument, signal) => {
      if (!instrumentPattern.test(instrument)) return Promise.reject(new ApiError('invalid-response', 'The market request is invalid.'))
      return request(`${accountPath(id)}/market-context?${new URLSearchParams({ instrument })}`, marketContext(instrument),
        signal ? { signal } : {}, 25_000, 'Venue market statistics are unavailable.')
    },
    marketStream,
    createPortfolio: (name, icon, accountIds, expected) => {
      if (!validExpected(accountIds, expected)) return Promise.reject(new ApiError('invalid-response', 'Reload accounts and provide one positive settings revision per selected account.'))
      return request('/api/portfolios', portfolio, { method: 'POST', body: JSON.stringify({ name, icon, accountIds, expected }) })
    },
    moveAccounts: (accountIds, portfolioId, expected) => {
      if (!accountIds.length || accountIds.length > 200 || !accountIds.every(isGuid) || new Set(accountIds).size !== accountIds.length ||
          portfolioId !== null && !isGuid(portfolioId)) return Promise.reject(new ApiError('invalid-response', 'Choose between 1 and 200 distinct accounts and a valid portfolio.'))
      if (!validExpected(accountIds, expected)) return Promise.reject(new ApiError('invalid-response', 'Reload accounts and provide one positive settings revision per selected account.'))
      return request('/api/accounts/portfolio', (v): v is BrokerAccount[] => Array.isArray(v) && v.length === accountIds.length &&
        v.every(a => account(a) && accountIds.includes(a.id) && a.portfolioId === portfolioId && isPositiveCount(a.settingsRevision)) &&
        new Set(v.map(a => a.id)).size === v.length, { method: 'POST', body: JSON.stringify({ accountIds, portfolioId, expected }) })
    },
    createAccount: body => request('/api/accounts', account, { method: 'POST', body: JSON.stringify(body) }),
    discoverAccounts: (venueId, address, signal, token) => {
      if (!/^[a-z][a-z\d-]{0,63}$/.test(venueId) || !/^0x[\da-f]{40}$/i.test(address)) {
        return Promise.reject(new ApiError('invalid-response', 'Use a valid venue and public wallet address.'))
      }
      if (token !== undefined) {
        if (!credentialTransportAllowed()) return Promise.reject(new ApiError('http', credentialTransportMessage))
        if (!token.trim() || token.length > 512) return Promise.reject(new ApiError('http', credentialSaveMessage))
        token = token.trim()
        return request(`/api/venues/${venueId}/accounts/credential`, discovery(venueId, address),
          { ...withSignal(signal), method: 'POST', body: JSON.stringify({ address, token }) }, 30_000, undefined,
          'Could not load venue names. Check the read-only token’s wallet, scope and expiry.')
      }
      return request(`/api/venues/${venueId}/accounts?${new URLSearchParams({ address })}`, discovery(venueId, address),
        withSignal(signal), 30_000, undefined, 'Could not find accounts for this wallet. Check the address and try again.')
    },
    accountCredential: (id, signal) => request(`${accountPath(id)}/credential`, credential, withSignal(signal), 10_000,
      undefined, 'Credential status is unavailable. Retry or ask the operator to check credential storage.'),
    saveAccountCredential: (id, token) => {
      if (!credentialTransportAllowed()) return Promise.reject(new ApiError('http', credentialTransportMessage))
      if (!token.trim() || token.length > 512) return Promise.reject(new ApiError('http', credentialSaveMessage))
      token = token.trim()
      return request(`${accountPath(id)}/credential`, credential, { method: 'PUT', body: JSON.stringify({ token }) },
        30_000, undefined, credentialSaveMessage)
    },
    deleteAccountCredential: id => request(`${accountPath(id)}/credential`, none, { method: 'DELETE' }, 10_000,
      undefined, 'Could not remove the credential. Refresh its status before trying again.'),
    updatePortfolio: (id, { name, icon }) => request(`/api/portfolios/${resourceId(id)}`, portfolio, { method: 'PATCH', body: JSON.stringify({ name, icon }) }),
    deletePortfolio: id => request(`/api/portfolios/${resourceId(id)}`, (v): v is undefined => v === undefined, { method: 'DELETE' }),
    updateAccount: async (id, settings) => {
      const updated = await request(accountPath(id), account, { method: 'PUT', body: JSON.stringify(settings) })
      if (updated.isEnabled === false) emitApiEvent(api, { type: 'account-removed', accountId: id })
      return updated
    },
    deleteAccount: async id => {
      await request(accountPath(id), (v): v is undefined => v === undefined, { method: 'DELETE' })
      emitApiEvent(api, { type: 'account-removed', accountId: id })
    },
    snapshot: (id, signal) => request(`${accountPath(id)}/snapshot`, snapshot, signal ? { signal } : {}),
    fills: (id, signal) => request(`${accountPath(id)}/fills`, (v): v is ImportedFill[] => Array.isArray(v) && v.every(isImportedFill), signal ? { signal } : {}),
    sync: (id, signal) => request(`${accountPath(id)}/sync`, account, { method: 'POST', ...withSignal(signal) }, 30_000, 'The venue refresh failed. Previous account data is still available.'),
  }
  return api
}
