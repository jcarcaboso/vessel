import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultReviewQuery, isReviewDocument, reviewPath } from './review'
import { createWorkspaceApi } from './workspace'
import { emptyReview, reviewFixture } from '@/test/review-fixture'

afterEach(() => vi.unstubAllGlobals())
describe('Review API', () => {
  it('accepts both empty and populated reports, preserving exact decimal strings', async () => {
    expect(isReviewDocument(emptyReview)).toBe(true)
    expect(isReviewDocument(reviewFixture)).toBe(true)
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(reviewFixture)))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const report = await createWorkspaceApi('token').review(defaultReviewQuery, controller.signal)
    expect(report.metrics.net).toBe('150.123456789')
    expect(fetch).toHaveBeenCalledWith('/api/review?period=month&portfolio=all', expect.objectContaining({
      signal: expect.any(AbortSignal), cache: 'no-store', credentials: 'omit',
      headers: { Authorization: 'Bearer token', Accept: 'application/json' },
    }))
    controller.abort()
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true)
  })
  it.each([
    { metrics: { ...reviewFixture.metrics, net: 150 } },
    { metrics: { ...reviewFixture.metrics, batting: '1.1' } },
    { metrics: { ...reviewFixture.metrics, riskCount: 4 } },
    { metrics: { ...reviewFixture.metrics, wins: 9 } },
    { series: [{ ...reviewFixture.series[0], cumulative: 'NaN' }] },
    { periods: [reviewFixture.periods[0]] },
    { bucketDays: 0 }, { nextOffset: 0 }, { currency: 'USDC' },
    { plays: [{ ...reviewFixture.plays[0], id: '../../play' }] },
  ])('rejects malformed data %#', change => {
    expect(isReviewDocument({ ...reviewFixture, ...change })).toBe(false)
  })
  it('encodes asset identifiers without changing scope', () => {
    const path = reviewPath({ ...defaultReviewQuery, instrument: 'A&B/#', offset: 50 })
    const query = new URL(path, 'http://localhost').searchParams
    expect(query.get('instrument')).toBe('A&B/#')
    expect(query.get('portfolio')).toBe('all')
    expect(query.get('offset')).toBe('50')
  })
  it('does not use mocked performance when the endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('server details', { status: 500 })))
    await expect(createWorkspaceApi('token').review(defaultReviewQuery)).rejects.toThrow()
  })
})
