import { ApiError } from './errors'
import { isGuid, isRecord, isText } from './guards'

/**
 * How a call proves who it is. `bearer` is Token mode's in-memory token. `session` rides the same-origin session
 * cookie and binds the tab to its user with `X-Vessel-User`. `public` is for the anonymous auth routes and the
 * session probe. Both cookie kinds send a real `Origin` despite the page's `no-referrer` policy.
 */
export type ApiCredentials =
  | { kind: 'bearer'; token: string }
  | { kind: 'session'; userId: string; sessionId: string; generation?: () => number }
  | { kind: 'public' }

/**
 * A 401 or 403 answer, with the ProblemDetails `code` when a cookie call received one. `generation` is the session
 * generation read when the request started, so a caller can discard answers to requests sent before a session change.
 */
export interface AuthFailure { status: 401 | 403; code?: string; generation?: number }

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
  /** Copy for a ProblemDetails `code` on session and public calls; `undefined` keeps the status default. */
  codeMessage?: (code: string, status: number) => string | undefined
}

interface Problem { code?: string; detail?: string; title?: string }

const codePattern = /^[a-z][a-z-]{0,63}$/

async function readProblem(response: Response): Promise<Problem> {
  try {
    const problem: unknown = await response.json()
    if (!isRecord(problem)) return {}
    return {
      ...typeof problem.code === 'string' && codePattern.test(problem.code) ? { code: problem.code } : {},
      ...isText(problem.detail, 500) && problem.detail.trim() ? { detail: problem.detail } : {},
      ...isText(problem.title, 500) && problem.title.trim() ? { title: problem.title } : {},
    }
  } catch { return {} /* Keep the safe default for non-JSON proxy responses. */ }
}

function retryAt(response: Response) {
  const retryAfter = response.headers.get('Retry-After')
  const at = retryAfter === null ? undefined : /^\d+$/.test(retryAfter) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter)
  return at !== undefined && Number.isFinite(at) && Math.abs(at) <= 8.64e15 ? new Date(at).toISOString() : undefined
}

async function httpError(response: Response, options: RequestOptions, cookie: boolean): Promise<ApiError> {
  const auth = response.status === 401 || response.status === 403
  if (options.safeError) {
    // Only the code of a cookie call's 401 or 403 is read, so session handling still works; the body is never shown.
    const code = cookie && auth ? (await readProblem(response)).code : undefined
    return new ApiError('http', options.safeError, response.status, undefined, code)
  }
  if (options.httpError) return options.httpError(response)
  if (auth && !cookie) {
    return new ApiError('unauthorized', 'Your API token was rejected. Disconnect and connect again.', response.status)
  }
  const problem = cookie || [400, 409, 413, 415, 429].includes(response.status) ? await readProblem(response) : {}
  const coded = problem.code ? options.codeMessage?.(problem.code, response.status) : undefined
  if (auth) {
    return new ApiError(response.status === 401 || problem.code === 'user-suspended' ? 'unauthorized' : 'http',
      coded ?? (response.status === 401 ? 'Your session ended. Sign in again.' : 'Vessel refused this request.'),
      response.status, undefined, problem.code)
  }
  let detail = response.status === 502 && options.badGateway ? options.badGateway :
    response.status === 429 && options.tooMany ? options.tooMany : 'The request could not be completed.'
  // A caller's own 429 text wins; otherwise the API's bounded ProblemDetails explain the admission limit.
  if ([400, 409, 413, 415].includes(response.status) || response.status === 429 && !options.tooMany) {
    if (problem.detail) detail = problem.detail
    else if (response.status === 429 && problem.title) detail = problem.title
  }
  if (coded && !(response.status === 429 && options.tooMany)) detail = coded
  if (response.status === 404) detail = options.notFound ?? 'This account or portfolio is no longer available.'
  if (response.status === 503 && !coded) detail = options.serviceUnavailable ?? 'The service is unavailable. Check the database and server configuration.'
  const reference = response.headers.get('X-Correlation-ID')
  if (response.status >= 500 && reference && /^[\da-f]{32}$/.test(reference)) detail += ` Reference: ${reference}`
  return new ApiError('http', detail, response.status, retryAt(response), problem.code)
}

function transport(credentials: ApiCredentials): { headers: Record<string, string>; init: RequestInit } {
  switch (credentials.kind) {
    case 'bearer': {
      const bearer = credentials.token.trim()
      if (!bearer) throw new ApiError('missing-token', 'Enter your Vessel API token.')
      return { headers: { Authorization: `Bearer ${bearer}` }, init: { credentials: 'omit' } }
    }
    case 'session':
      if (!isGuid(credentials.userId)) throw new ApiError('unauthorized', 'Your session ended. Sign in again.')
      return { headers: { 'X-Vessel-User': credentials.userId }, init: { credentials: 'same-origin', referrerPolicy: 'same-origin' } }
    case 'public':
      return { headers: { 'X-Vessel-Request': '1' }, init: { credentials: 'same-origin', referrerPolicy: 'same-origin' } }
  }
}

/**
 * One transport for JSON, images and stream headers. A token stays in this closure. `onUnauthorized` hears every 401
 * and 403, with the cookie call's code; the caller decides what ends a session.
 */
export function createApiCall(credentials: string | ApiCredentials, onUnauthorized?: (failure: AuthFailure) => void) {
  const kind: ApiCredentials = typeof credentials === 'string' ? { kind: 'bearer', token: credentials } : credentials
  const { headers: identity, init } = transport(kind)
  const cookie = kind.kind !== 'bearer'

  return async function call<T>(path: string, options: RequestOptions & (
    { validate: (value: unknown) => value is T; read?: never } |
    { read: (response: Response) => Promise<T>; validate?: never }
  )): Promise<T> {
    // Clear the timer after decoding, or after headers for a long-lived SSE response.
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), options.timeout)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal
    const generation = kind.kind === 'session' ? kind.generation?.() : undefined
    try {
      let response: Response
      try {
        response = await fetch(path, {
          method: options.method ?? 'GET', ...(options.body !== undefined ? { body: options.body } : {}),
          headers: { ...identity, Accept: options.accept ?? 'application/json',
            ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}) },
          ...init, redirect: 'error', cache: 'no-store', signal,
        })
      } catch {
        throw new ApiError('unavailable', options.safeError ?? options.unavailable ?? 'The request did not complete. Check the API and try again.')
      }
      if (!response.ok) {
        const error = await httpError(response, options, cookie)
        if (response.status === 401 || response.status === 403)
          onUnauthorized?.({ status: response.status, ...error.code ? { code: error.code } : {}, ...generation !== undefined ? { generation } : {} })
        throw error
      }
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
