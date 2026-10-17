import { ApiError } from './errors'
import { isRecord, isText } from './guards'

interface RequestOptions {
  method?: string
  body?: BodyInit
  signal?: AbortSignal
  accept?: string
  timeout: number
  unavailable?: string
  notFound?: string
  badGateway?: string
  tooMany?: string
  serviceUnavailable?: string
  safeError?: string
  noContent?: string
  invalidJson?: string
  invalidData?: string
  httpError?: (response: Response) => ApiError
}

async function httpError(response: Response, options: RequestOptions): Promise<ApiError> {
  if (options.safeError) return new ApiError('http', options.safeError, response.status)
  if (options.httpError) return options.httpError(response)
  if (response.status === 401 || response.status === 403) {
    return new ApiError('unauthorized', 'Your API token was rejected. Disconnect and connect again.', response.status)
  }
  let detail = response.status === 502 && options.badGateway ? options.badGateway :
    response.status === 429 && options.tooMany ? options.tooMany : 'The request could not be completed.'
  // A caller's own 429 text wins; otherwise the API's bounded ProblemDetails explain the admission limit.
  if ([400, 409, 413, 415].includes(response.status) || response.status === 429 && !options.tooMany) {
    try {
      const problem: unknown = await response.json()
      if (isRecord(problem) && isText(problem.detail, 500) && problem.detail.trim()) detail = problem.detail
      else if (response.status === 429 && isRecord(problem) && isText(problem.title, 500) && problem.title.trim()) detail = problem.title
    } catch { /* Keep the safe default for non-JSON proxy responses. */ }
  }
  if (response.status === 404) detail = options.notFound ?? 'This account or portfolio is no longer available.'
  if (response.status === 503) detail = options.serviceUnavailable ?? 'The service is unavailable. Check the database and server configuration.'
  const reference = response.headers.get('X-Correlation-ID')
  if (response.status >= 500 && reference && /^[\da-f]{32}$/.test(reference)) detail += ` Reference: ${reference}`
  const retryAfter = response.headers.get('Retry-After')
  const retryAt = retryAfter === null ? undefined : /^\d+$/.test(retryAfter) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter)
  return new ApiError('http', detail, response.status,
    retryAt !== undefined && Number.isFinite(retryAt) && Math.abs(retryAt) <= 8.64e15 ? new Date(retryAt).toISOString() : undefined)
}

/** The token stays in this session closure. JSON, images and stream headers share the same transport. */
export function createApiCall(token: string, onUnauthorized?: () => void) {
  const bearer = token.trim()
  if (!bearer) throw new ApiError('missing-token', 'Enter your Vessel API token.')

  return async function call<T>(path: string, options: RequestOptions & (
    { validate: (value: unknown) => value is T; read?: never } |
    { read: (response: Response) => Promise<T>; validate?: never }
  )): Promise<T> {
    // Clear the timer after decoding, or after headers for a long-lived SSE response.
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), options.timeout)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal
    try {
      let response: Response
      try {
        response = await fetch(path, {
          method: options.method ?? 'GET', ...(options.body !== undefined ? { body: options.body } : {}),
          headers: { Authorization: `Bearer ${bearer}`, Accept: options.accept ?? 'application/json',
            ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
          credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
        })
      } catch {
        throw new ApiError('unavailable', options.safeError ?? options.unavailable ?? 'The request did not complete. Check the API and try again.')
      }
      if (response.status === 401 || response.status === 403) onUnauthorized?.()
      if (!response.ok) throw await httpError(response, options)
      if (options.read) return await options.read(response)
      let body: unknown
      if (response.status === 204) {
        body = undefined
        if (!options.validate(body)) throw new ApiError('invalid-response', options.safeError ?? options.noContent ?? 'The API returned no workspace data.')
      } else {
        try { body = await response.json() } catch {
          throw new ApiError('invalid-response', options.safeError ?? options.invalidJson ?? 'The API returned invalid data.')
        }
        if (!options.validate(body)) throw new ApiError('invalid-response', options.safeError ?? options.invalidData ?? 'The API returned incompatible workspace data.')
      }
      return body
    } finally {
      clearTimeout(timer)
    }
  }
}
