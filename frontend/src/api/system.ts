import { candleIntervals, type CandleInterval } from './workspace'

export interface VenueCapabilities {
  sync: boolean; instruments: boolean; orders: boolean; candles: boolean
  marketContext: boolean; stream: boolean; stablecoinWallet: boolean
  accountDiscovery?: boolean; readOnlyCredential?: boolean
}

/** One venue and what Vessel can do there. The browser checks capabilities, never venue names. */
export interface VenueInfo {
  id: string
  name: string
  status: 'planned' | 'candidate' | 'manual' | 'read-only'
  /** Account indices stay strings, including indices beyond JavaScript's safe integer range. */
  source: 'none' | 'evm-address' | 'account-index'
  capabilities: VenueCapabilities
  quoteAsset: string | null
  /** Uses canonical `{instrument}` and/or the catalogue's native `{venueContractId}`. */
  tradeUrlTemplate: string | null
  /** Optional venue page where the owner creates a read-only credential. */
  credentialSetupUrl?: string | null
  /** Candle intervals the venue serves natively. */
  intervals: CandleInterval[]
  /** Five significant figures, or each instrument's tick. */
  priceRule: 'significant-figures' | 'tick-size'
}

export interface SystemInfo {
  application: 'Vessel'
  stage: 'foundation' | 'core'
  owner: { id: string; displayName: string }
  marketScope: 'perpetuals'
  allowsConcurrentPlays: true
  venues: VenueInfo[]
}

export type ApiErrorKind = 'missing-token' | 'unauthorized' | 'unavailable' | 'invalid-response' | 'http'

export class ApiError extends Error {
  constructor(public readonly kind: ApiErrorKind, message: string, public readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const capabilityNames = ['sync', 'instruments', 'orders', 'candles', 'marketContext', 'stream', 'stablecoinWallet']

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('https://') || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
  } catch { return false }
}

export function isTradeUrlTemplate(value: unknown): value is string {
  if (typeof value !== 'string' || !/\{(?:instrument|venueContractId)\}/.test(value)) return false
  const resolved = value.replaceAll('{instrument}', 'BTC').replaceAll('{venueContractId}', 'BTC')
  return !/[{}]/.test(resolved) && isHttpsUrl(resolved)
}

function isVenue(value: unknown): value is VenueInfo {
  return isRecord(value) && typeof value.id === 'string' && /^[a-z][a-z\d-]{0,63}$/.test(value.id) &&
    typeof value.name === 'string' && value.name.trim().length > 0 &&
    ['planned', 'candidate', 'manual', 'read-only'].includes(String(value.status)) &&
    ['none', 'evm-address', 'account-index'].includes(String(value.source)) &&
    isRecord(value.capabilities) && capabilityNames.every(name => typeof (value.capabilities as Record<string, unknown>)[name] === 'boolean') &&
    ['accountDiscovery', 'readOnlyCredential'].every(name => {
      const flag = (value.capabilities as Record<string, unknown>)[name]
      return flag === undefined || typeof flag === 'boolean'
    }) &&
    (value.quoteAsset === null || typeof value.quoteAsset === 'string') &&
    (value.tradeUrlTemplate === null || isTradeUrlTemplate(value.tradeUrlTemplate)) &&
    (value.credentialSetupUrl == null || isHttpsUrl(value.credentialSetupUrl)) &&
    Array.isArray(value.intervals) && value.intervals.every(interval => candleIntervals.includes(interval as CandleInterval)) &&
    ['significant-figures', 'tick-size'].includes(String(value.priceRule))
}

function isSystemInfo(value: unknown): value is SystemInfo {
  if (!isRecord(value) || !isRecord(value.owner) || !Array.isArray(value.venues)) return false
  const venues: unknown[] = value.venues
  const ids = venues.map(venue => isRecord(venue) ? venue.id : null)
  return value.application === 'Vessel' && ['foundation', 'core'].includes(String(value.stage)) &&
    value.marketScope === 'perpetuals' && value.allowsConcurrentPlays === true &&
    typeof value.owner.id === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.owner.id) &&
    typeof value.owner.displayName === 'string' && value.owner.displayName.trim().length > 0 &&
    venues.every(isVenue) && new Set(ids).size === ids.length && ids.includes('manual')
}

/** Token stays in the caller's runtime memory; never put it in an environment variable or URL. */
export async function getSystem(token: string): Promise<SystemInfo> {
  if (!token.trim()) throw new ApiError('missing-token', 'Enter your Vessel API token.')
  let response: Response
  try {
    response = await fetch('/api/system', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    throw new ApiError('unavailable', 'Vessel API is unavailable. Check that the API is running and the proxy target is correct.')
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError('unauthorized', 'The API rejected this token. Check the configured server token and try again.', response.status)
  }
  if (response.status >= 500) {
    throw new ApiError('unavailable', 'Vessel API is unavailable. Check the server configuration and try again.', response.status)
  }
  if (!response.ok) throw new ApiError('http', `The API request failed with HTTP ${response.status}.`, response.status)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError('invalid-response', 'The API returned an invalid system response.')
  }
  if (!isSystemInfo(body)) throw new ApiError('invalid-response', 'The API returned an incompatible system contract.')
  return body
}
