export type ApiErrorKind = 'missing-token' | 'unauthorized' | 'unavailable' | 'invalid-response' | 'http'

/** A failure the browser may show: `message` is always a fixed or bounded safe text, never a raw response body. */
export class ApiError extends Error {
  constructor(public readonly kind: ApiErrorKind, message: string, public readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}
