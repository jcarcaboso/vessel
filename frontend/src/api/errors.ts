export type ApiErrorKind = 'missing-token' | 'unauthorized' | 'unavailable' | 'invalid-response' | 'http'

/** A failure the browser may show: `message` is always a fixed or bounded safe text, never a raw response body. */
export class ApiError extends Error {
  constructor(public readonly kind: ApiErrorKind, message: string, public readonly status?: number, public readonly retryAtUtc?: string,
    /** The ProblemDetails `code` of session and public calls, e.g. `step-up-required`; never shown as text. */
    public readonly code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Show only API-safe text, retaining each caller's fallback for other failures. */
export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}
