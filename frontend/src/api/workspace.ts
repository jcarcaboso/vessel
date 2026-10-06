import { SseOverflowError, SseParser } from './sse'
import { ApiError } from './system'
import {
  isPlayExecution, isPlayHistory, isPlaySummary, isSavedEvidence, isSavedPlay,
  type LinkOrder, type PlayExecution, type PlayFields, type PlayHistory, type PlaySummary, type SavedEvidence, type SavedPlay, type StatusRequest,
} from './plays'
import { isSizingDocument, type SizingDocument } from './sizing'
import type { ImageMarkup } from '@/features/plays/markup'

export interface Portfolio {
  id: string
  name: string
  accountCount: number
  totalValueUsd: string | null
  valueCoverage: 'complete' | 'partial' | 'unavailable'
  /** Sum of account balances (perps plus stablecoin wallet, or the wallet alone in unified modes). */
  balanceUsd?: string | null
  balanceCoverage?: 'complete' | 'partial' | 'unavailable'
}
export interface VenueInstrument {
  contractId: string
  quantityDecimals: number
  maxLeverage: number
  /** Asset prices are quoted and margined in, e.g. USDC for BTC/USDC. */
  quoteAsset: string
}
export interface InstrumentCatalog {
  venueId: string
  marketScope: 'perpetuals'
  scope: 'primary-perpetual-dex' | 'manual'
  instruments: VenueInstrument[]
  notice: string
}
export const candleIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M'] as const
export type CandleInterval = typeof candleIntervals[number]
/** Venue trade candle. OHLCV stay exact decimal strings; times are UTC Unix milliseconds. */
export interface VenueCandle {
  openTime: number
  closeTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  trades: number
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
}
/** Venue header statistics for one perpetual. Decimal strings are kept exactly as reported. */
export interface MarketContext {
  venueId: string
  instrument: string
  markPrice: string
  oraclePrice: string
  midPrice: string | null
  previousDayPrice: string
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
  /** open, close, flip or unknown. */
  positionEffect: string
  /** reported, or standard-account-free when the account tier trades without fees. */
  feeBasis: string
  /** gross (fee separate) or net-of-fee (already taken off the closed PnL). */
  pnlBasis: string
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
  venueId: string
  address?: string
  manualAccountValueUsd?: string
}
export interface WorkspaceApi {
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
  createPortfolio(name: string): Promise<Portfolio>
  createAccount(account: CreateAccount): Promise<BrokerAccount>
  renamePortfolio(id: string, name: string): Promise<Portfolio>
  deletePortfolio(id: string): Promise<void>
  updateAccount(id: string, settings: { name: string; portfolioId: string | null; isEnabled: boolean; expectedRevision: number }): Promise<BrokerAccount>
  deleteAccount(id: string): Promise<void>
  snapshot(id: string, signal?: AbortSignal): Promise<AccountSnapshot | null>
  fills(id: string, signal?: AbortSignal): Promise<ImportedFill[]>
  sync(id: string): Promise<BrokerAccount>
  plays(signal?: AbortSignal): Promise<PlaySummary[]>
  play(id: string, signal?: AbortSignal): Promise<SavedPlay>
  createPlay(fields: PlayFields): Promise<SavedPlay>
  /** A plan change after planning needs `revisionReason`. A stale `expectedVersion` is a 409. */
  updatePlay(id: string, fields: PlayFields & { expectedVersion: number; revisionReason?: string }): Promise<SavedPlay>
  changePlayStatus(id: string, expectedVersion: number, request: StatusRequest): Promise<SavedPlay>
  playHistory(id: string, signal?: AbortSignal): Promise<PlayHistory>
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

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const text = (v: unknown): v is string => typeof v === 'string'
const nullableText = (v: unknown) => v === null || text(v)
const guid = (v: unknown) => text(v) && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
const decimal = (v: unknown): v is string => text(v) && v.length <= 100 && /^-?\d+(\.\d+)?$/.test(v)
const nullableDecimal = (v: unknown) => v === null || decimal(v)
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v))
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const instrumentCatalog = (v: unknown): v is InstrumentCatalog => object(v) &&
  text(v.venueId) && v.venueId.length > 0 && v.venueId.length <= 64 &&
  v.marketScope === 'perpetuals' && ['primary-perpetual-dex', 'manual'].includes(String(v.scope)) &&
  Array.isArray(v.instruments) && v.instruments.length <= 10_000 &&
  v.instruments.every((i: unknown) => object(i) && text(i.contractId) && i.contractId.trim() === i.contractId &&
    i.contractId.length > 0 && i.contractId.length <= 128 && count(i.quantityDecimals) &&
    (i.quantityDecimals as number) <= 28 && count(i.maxLeverage) && (i.maxLeverage as number) > 0 &&
    text(i.quoteAsset) && /^[A-Za-z0-9]{1,16}$/.test(i.quoteAsset)) &&
  new Set(v.instruments.map((i: VenueInstrument) => i.contractId)).size === v.instruments.length &&
  (v.scope !== 'manual' || v.instruments.length === 0) && text(v.notice) && v.notice.length <= 1000
const epoch = (v: unknown): v is number => count(v) && (v as number) > 0
const unsignedDecimal = (v: unknown): v is string => decimal(v) && !v.startsWith('-')
const candle = (v: unknown): v is VenueCandle => object(v) && epoch(v.openTime) && epoch(v.closeTime) &&
  v.closeTime >= v.openTime && ['open', 'high', 'low', 'close', 'volume'].every(k => unsignedDecimal(v[k])) && count(v.trades)
const candleSeries = (query: CandleQuery) => (v: unknown): v is CandleSeries => object(v) &&
  text(v.venueId) && v.venueId.length > 0 && v.venueId.length <= 64 &&
  v.instrument === query.instrument && v.interval === query.interval && v.priceSource === 'trades' &&
  Array.isArray(v.candles) && v.candles.length <= 5_000 && v.candles.every(candle) &&
  v.candles.every((c: VenueCandle, i: number, all: VenueCandle[]) => i === 0 || c.openTime > all[i - 1]!.openTime) &&
  count(v.requestedFrom) && epoch(v.requestedTo) && v.requestedTo >= (v.requestedFrom as number) && date(v.retrievedAt) &&
  typeof v.historyExhausted === 'boolean' && text(v.notice) && v.notice.length <= 1000
const marketContext = (instrument: string) => (v: unknown): v is MarketContext => object(v) &&
  text(v.venueId) && v.venueId.length > 0 && v.venueId.length <= 64 && v.instrument === instrument &&
  ['markPrice', 'oraclePrice', 'previousDayPrice', 'dayNotionalVolume', 'openInterest'].every(k => unsignedDecimal(v[k])) &&
  (v.midPrice === null || unsignedDecimal(v.midPrice)) && decimal(v.fundingRate) && nullableDecimal(v.premium) &&
  date(v.observedAt) && text(v.notice) && v.notice.length <= 1000
const streamStatus = (v: unknown): v is MarketStreamStatus => object(v) &&
  ['live', 'reconnecting', 'stale'].includes(String(v.state)) && text(v.observedAt) && v.observedAt.length <= 40 && date(v.observedAt)
const streamLimit = 1024 * 1024
const instrumentPattern = /^[A-Za-z0-9_-]{1,32}$/
const portfolio = (v: unknown): v is Portfolio => object(v) && guid(v.id) && text(v.name) &&
  count(v.accountCount) && nullableDecimal(v.totalValueUsd) &&
  ['complete', 'partial', 'unavailable'].includes(String(v.valueCoverage)) &&
  (v.balanceUsd === undefined || nullableDecimal(v.balanceUsd)) &&
  (v.balanceCoverage === undefined || ['complete', 'partial', 'unavailable'].includes(String(v.balanceCoverage)))
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
  (v.totalStablecoinNominalUsd === undefined || nullableDecimal(v.totalStablecoinNominalUsd)) &&
  (v.balanceUsd === undefined || nullableDecimal(v.balanceUsd)) &&
  (v.settingsRevision === undefined || typeof v.settingsRevision === 'number' && count(v.settingsRevision) && v.settingsRevision > 0)
const fill = (v: unknown): v is ImportedFill => object(v) && guid(v.id) && guid(v.accountId) &&
  ['contractId', 'direction', 'feeToken', 'orderId', 'sourceFillId', 'transactionHash'].every(k => text(v[k])) &&
  (v.side === 'buy' || v.side === 'sell') && ['open', 'close', 'flip', 'unknown'].includes(v.positionEffect as string) &&
  ['reported', 'standard-account-free'].includes(v.feeBasis as string) && ['gross', 'net-of-fee'].includes(v.pnlBasis as string) &&
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
  async function httpError(response: Response, badGateway?: string, tooMany?: string,
    notFound = 'This account or portfolio is no longer available.'): Promise<ApiError> {
    if (response.status === 401 || response.status === 403) {
      return new ApiError('unauthorized', 'Your API token was rejected. Disconnect and connect again.', response.status)
    }
    let detail = response.status === 502 && badGateway ? badGateway : response.status === 429 && tooMany ? tooMany : 'The request could not be completed.'
    if ([400, 409, 413, 415].includes(response.status)) {
      try {
        const problem: unknown = await response.json()
        if (object(problem) && text(problem.detail) && problem.detail.length <= 500) detail = problem.detail
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
    if (!response.ok) throw await httpError(response, badGateway)
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
    if (!guid(id)) throw new ApiError('invalid-response', 'The play identifier is invalid.')
    return `/api/plays/${id}`
  }
  const evidencePath = (id: string) => {
    if (!guid(id)) throw new ApiError('invalid-response', 'The image identifier is invalid.')
    return `/api/evidence/${id}`
  }
  const none = (v: unknown): v is undefined => v === undefined
  const withSignal = (signal?: AbortSignal) => signal ? { signal } : {}
  return {
    plays: signal => json('/api/plays', (v): v is PlaySummary[] => Array.isArray(v) && v.every(isPlaySummary), withSignal(signal)),
    play: (id, signal) => json(playPath(id), isSavedPlay, withSignal(signal)),
    createPlay: fields => json('/api/plays', isSavedPlay, { method: 'POST', body: JSON.stringify(fields) }),
    updatePlay: (id, fields) => json(playPath(id), isSavedPlay, { method: 'PUT', body: JSON.stringify(fields) }),
    changePlayStatus: (id, expectedVersion, request) =>
      json(`${playPath(id)}/status`, isSavedPlay, { method: 'POST', body: JSON.stringify({ expectedVersion, ...request }) }),
    playHistory: (id, signal) => json(`${playPath(id)}/history`, isPlayHistory, withSignal(signal)),
    deletePlay: id => json(playPath(id), none, { method: 'DELETE' }),
    playExecution: (id, signal) => json(`${playPath(id)}/execution`, isPlayExecution, withSignal(signal)),
    checkPlayExecution: (id, signal) => json(`${playPath(id)}/execution/check`, isPlayExecution, { method: 'POST', ...withSignal(signal) }, 45_000),
    linkOrder: (id, link) => json(`${playPath(id)}/execution/links`, isPlayExecution, { method: 'POST', body: JSON.stringify(link) }),
    unlinkOrder: (id, linkId) => {
      if (!guid(linkId)) return Promise.reject(new ApiError('invalid-response', 'The link identifier is invalid.'))
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
    updateSizingSettings: settings => json('/api/sizing/settings', isSizingDocument,
      { method: 'PUT', body: JSON.stringify({ riskPercent: settings.riskPercent }) }),
    overview: signal => request('/api/overview', overview, signal ? { signal } : {}),
    portfolios: signal => request('/api/portfolios', (v): v is Portfolio[] => Array.isArray(v) && v.every(portfolio), signal ? { signal } : {}),
    accounts: signal => request('/api/accounts', (v): v is BrokerAccount[] => Array.isArray(v) && v.every(account), signal ? { signal } : {}),
    account: (id, signal) => request(accountPath(id), account, signal ? { signal } : {}),
    instruments: (id, signal) => request(`${accountPath(id)}/instruments`, instrumentCatalog, signal ? { signal } : {},
      25_000, 'The venue instrument catalogue is unavailable. Try again or enter a manual label.'),
    candles: (id, query, signal) => {
      if (!instrumentPattern.test(query.instrument) || !candleIntervals.includes(query.interval) ||
        (query.endTime !== undefined && !epoch(query.endTime))) {
        return Promise.reject(new ApiError('invalid-response', 'The chart request is invalid.'))
      }
      const params = new URLSearchParams({ instrument: query.instrument, interval: query.interval })
      if (query.endTime !== undefined) params.set('endTime', String(query.endTime))
      return request(`${accountPath(id)}/candles?${params}`, candleSeries(query), signal ? { signal } : {},
        25_000, 'Venue candles are unavailable. Try refreshing the chart.')
    },
    marketContext: (id, instrument, signal) => {
      if (!instrumentPattern.test(instrument)) return Promise.reject(new ApiError('invalid-response', 'The market request is invalid.'))
      return request(`${accountPath(id)}/market-context?${new URLSearchParams({ instrument })}`, marketContext(instrument),
        signal ? { signal } : {}, 25_000, 'Venue market statistics are unavailable.')
    },
    marketStream,
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
