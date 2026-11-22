import { onAuthSessionChange } from "./client"

// The reads many components of one page ask for at once — the account, the
// club list, the club's settings and billing, content tags. Callers that ask
// while a request is in flight share it. A positive `ttlMs` also keeps the
// answer that long: only for session-stable data, and every write that
// changes it calls `invalidateReads`. With `ttlMs` 0 nothing outlives the
// request, so a later mount (or a reload after a save) always asks the
// server. Failures are never kept. Signing in or out drops everything, and an
// answer that arrives for the previous account is not stored.

type Entry = {
  promise: Promise<unknown>
  // null while the request is in flight.
  expiresAt: number | null
  value?: unknown
}

const entries = new Map<string, Entry>()

onAuthSessionChange(() => entries.clear())

export const cachedRead = <T>(
  key: string,
  load: () => Promise<T>,
  ttlMs = 0,
): Promise<T> => {
  const hit = entries.get(key)
  if (hit && (hit.expiresAt === null || Date.now() < hit.expiresAt)) {
    return hit.promise as Promise<T>
  }
  const entry: Entry = { promise: Promise.resolve(), expiresAt: null }
  const promise = load().then(
    (value) => {
      // Not ours any more: invalidated, superseded or the session changed.
      if (entries.get(key) !== entry) return value
      if (ttlMs > 0) {
        entry.expiresAt = Date.now() + ttlMs
        entry.value = value
      } else {
        entries.delete(key)
      }
      return value
    },
    (error: unknown) => {
      if (entries.get(key) === entry) entries.delete(key)
      throw error
    },
  )
  entry.promise = promise
  entries.set(key, entry)
  return promise
}

// The kept answer for `key` when it is still fresh, synchronously — so a
// component can render it on its first pass instead of a loading state.
export const peekCachedRead = <T>(key: string): T | undefined => {
  const hit = entries.get(key)
  return hit?.expiresAt != null && Date.now() < hit.expiresAt
    ? (hit.value as T)
    : undefined
}

// Forget `key` and every key under it (`settings` covers `settings:<id>`),
// including a request still in flight, which a write may have overtaken.
export const invalidateReads = (...keys: string[]): void => {
  for (const cached of [...entries.keys()]) {
    if (keys.some((key) => cached === key || cached.startsWith(`${key}:`))) {
      entries.delete(cached)
    }
  }
}
