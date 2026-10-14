import { describe, expect, it } from 'vitest'
import { ApiError, errorMessage } from './errors'

describe('errorMessage', () => {
  it('returns the safe API message', () => {
    expect(errorMessage(new ApiError('http', 'Reload current settings.', 409), 'Fallback')).toBe('Reload current settings.')
  })

  it.each([new Error('private transport detail'), new DOMException('Aborted', 'AbortError'),
    { message: 'untrusted response' }, null, undefined, 'raw response'])('keeps the caller fallback for %j', cause => {
    expect(errorMessage(cause, 'Could not load this page.')).toBe('Could not load this page.')
  })
})
