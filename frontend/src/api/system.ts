export interface SystemInfo {
  application: 'Vessel'
  stage: 'foundation' | 'core'
  owner: { id: string; displayName: string }
  marketScope: 'perpetuals'
  allowsConcurrentPlays: true
  venues: Array<{
    id: 'hyperliquid' | 'lighter' | 'quantfury' | 'manual'
    name: string
    status: 'planned' | 'candidate' | 'manual' | 'read-only'
  }>
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

function isSystemInfo(value: unknown): value is SystemInfo {
  if (!isRecord(value) || !isRecord(value.owner) || !Array.isArray(value.venues)) return false
  const venues: unknown[] = value.venues
  const expectedVenues: Record<string, string[]> = {
    hyperliquid: ['planned', 'read-only'], lighter: ['planned'], quantfury: ['candidate'], manual: ['manual'],
  }
  return value.application === 'Vessel' && ['foundation', 'core'].includes(String(value.stage)) &&
    value.marketScope === 'perpetuals' && value.allowsConcurrentPlays === true &&
    typeof value.owner.id === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.owner.id) &&
    typeof value.owner.displayName === 'string' && value.owner.displayName.trim().length > 0 &&
    venues.length === 4 && Object.entries(expectedVenues).every(([id, statuses]) =>
      venues.filter((venue) => isRecord(venue) && venue.id === id &&
        statuses.includes(String(venue.status)) && typeof venue.name === 'string' && venue.name.trim().length > 0).length === 1)
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
