import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useEffect, useRef, useState } from "react"

import { errorMessage } from "../error-message"
import { subscribeInvalidation } from "./cache-events"
import { readResource, writeResource } from "./resource-cache"

export type CachedResource<T> = {
  /** Latest data — from cache first, then replaced by the fresh fetch. */
  data: T | null
  /** Set only when there's no data to show at all (first load failed). */
  error: string | null
  /** First load with nothing cached yet — show a spinner. */
  loading: boolean
  /** A revalidation is in flight while data is already on screen. */
  refreshing: boolean
  /** Showing cached data because the last fetch failed (e.g. offline). */
  stale: boolean
  /** Manual revalidate (pull-to-refresh / retry). */
  refetch: () => void
  /** Optimistically patch the in-memory data (e.g. before a mutation); the
   *  next revalidation reconciles + persists it. */
  mutate: (updater: T | ((prev: T | null) => T | null)) => void
}

/**
 * Read-through, stale-while-revalidate cache for a single API resource.
 *
 * - Paints the last cached snapshot instantly (works offline).
 * - Revalidates from the network on mount, on every screen focus, and on
 *   demand — so data never silently goes stale while a screen is open.
 * - A failed revalidation never blanks existing data; it just flips `stale`.
 *
 * Pass `key = null` to disable (e.g. before a workspace is known). The
 * `fetcher` may be an inline closure — it's read through a ref, so only `key`
 * drives re-subscription.
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): CachedResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [stale, setStale] = useState(false)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  // Bumped whenever the key changes so late async results from a previous key
  // (or an unmounted screen) are ignored instead of clobbering current state.
  const genRef = useRef(0)
  const hasDataRef = useRef(false)
  hasDataRef.current = data !== null

  const revalidate = useCallback(async () => {
    if (!key) return
    const gen = genRef.current
    if (hasDataRef.current) setRefreshing(true)
    try {
      const fresh = await fetcherRef.current()
      if (gen !== genRef.current) return
      setData(fresh)
      setError(null)
      setStale(false)
      await writeResource(key, fresh)
    } catch (err) {
      if (gen !== genRef.current) return
      // Keep whatever we have; only surface an error when there's nothing.
      if (hasDataRef.current) {
        setStale(true)
      } else {
        setError(errorMessage(err, "Не удалось загрузить"))
      }
    } finally {
      if (gen === genRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [key])

  // On key change: reset, then paint the cached snapshot (no network here).
  useEffect(() => {
    genRef.current += 1
    const gen = genRef.current
    setData(null)
    setError(null)
    setStale(false)
    setRefreshing(false)
    if (!key) {
      setLoading(false)
      return
    }
    setLoading(true)
    void (async () => {
      const cached = await readResource<T>(key)
      if (gen !== genRef.current) return
      if (cached) {
        setData(cached.data)
        setLoading(false)
      }
    })()
  }, [key])

  // Revalidate on mount-focus and every time the screen regains focus.
  useFocusEffect(
    useCallback(() => {
      void revalidate()
    }, [revalidate]),
  )

  // Refetch immediately when the realtime layer pushes an invalidation for
  // this key (e.g. a coach published an announcement) — no manual refresh.
  useEffect(() => {
    if (!key) return
    return subscribeInvalidation(key, () => {
      void revalidate()
    })
  }, [key, revalidate])

  const refetch = useCallback(() => {
    void revalidate()
  }, [revalidate])

  const mutate = useCallback(
    (updater: T | ((prev: T | null) => T | null)) => {
      setData((prev) =>
        typeof updater === "function"
          ? (updater as (p: T | null) => T | null)(prev)
          : updater,
      )
    },
    [],
  )

  return { data, error, loading, refreshing, stale, refetch, mutate }
}
