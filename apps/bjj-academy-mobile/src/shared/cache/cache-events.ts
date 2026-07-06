// In-process invalidation bus that connects the realtime socket to the cache.
// useCachedResource subscribes its key here; when the server pushes an
// `invalidate` for a resource+workspace, every matching open screen refetches.

type Listener = { key: string; onInvalidate: () => void }

const listeners = new Set<Listener>()

// Subscribe a cache key; returns an unsubscribe fn.
export const subscribeInvalidation = (
  key: string,
  onInvalidate: () => void,
): (() => void) => {
  const listener: Listener = { key, onInvalidate }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Invalidate a resource within a workspace. Cache keys are
// "<resource>:<workspaceId>" (optionally with further ":"-segments), so we
// match the exact key and any deeper key under it.
export const invalidateResource = (
  resource: string,
  workspaceId: string,
): void => {
  const base = `${resource}:${workspaceId}`
  for (const listener of listeners) {
    if (listener.key === base || listener.key.startsWith(`${base}:`)) {
      listener.onInvalidate()
    }
  }
}
