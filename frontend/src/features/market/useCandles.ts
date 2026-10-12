import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { CandleInterval, VenueCandle, WorkspaceApi } from '@/api/workspace'
import { candleCache, type CandleCache, type CandleEntry } from './candleCache'
export { mergeCandles, upsertCandle, toChartCandle } from './candleCache'
export type { CandleState } from './candleCache'

export interface CandleSource { api: WorkspaceApi; accountId: string; instrument: string; interval: CandleInterval }

/** Cached series appear synchronously; each activation revalidates, never persisting across connections. */
export function useCandles({ api, accountId, instrument, interval }: CandleSource) {
  const cache = useMemo(() => candleCache(api), [api])
  const keyed = useMemo(() => cache.entry(accountId, instrument, interval), [cache, accountId, instrument, interval])
  // A dropped entry (404/409/eviction) keeps its error until the owner retries, which takes a fresh entry.
  const [retried, setRetried] = useState<{ cache: CandleCache; entry: CandleEntry } | null>(null)
  const entry = cache.entries.get(keyed.key) !== keyed && retried?.cache === cache && retried.entry.key === keyed.key
    ? retried.entry : keyed
  const subscribe = useCallback((listener: () => void) => cache.subscribe(entry, listener), [cache, entry])
  const snapshot = useSyncExternalStore(subscribe, () => entry.snapshot)
  useEffect(() => { cache.activate(entry) }, [cache, entry])
  const refresh = useCallback(() => {
    if (cache.entries.get(entry.key) === entry) void cache.load(entry, 'refresh')
    else setRetried({ cache, entry: cache.entry(accountId, instrument, interval) })
  }, [cache, entry, accountId, instrument, interval])
  const revalidate = useCallback(() => { void cache.load(entry, 'latest') }, [cache, entry])
  const upsert = useCallback((candle: VenueCandle, receivedAt: string) => cache.upsert(entry, candle, receivedAt), [cache, entry])
  const loadOlder = useCallback(() => {
    if (!entry.snapshot.loadingOlder && !entry.snapshot.olderError) void cache.load(entry, 'older')
  }, [cache, entry])
  const retryOlder = useCallback(() => { void cache.load(entry, 'older') }, [cache, entry])
  return { ...snapshot, refresh, revalidate, upsert, loadOlder, retryOlder }
}
