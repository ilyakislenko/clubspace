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

// Refetch every open cached screen. Used when connectivity returns: the socket
// doesn't replay missed events, so a blanket revalidate is the safety net.
export const invalidateAll = (): void => {
  for (const listener of listeners) listener.onInvalidate()
}

// ---- List deltas (patch a cached list in place, no refetch) ----

export type DeltaOp = "create" | "update" | "delete"
export type DeltaItem = { id: string } & Record<string, unknown>

type DeltaListener = { key: string; onDelta: (op: DeltaOp, item: DeltaItem) => void }
const deltaListeners = new Set<DeltaListener>()

// Subscribe a list cache key to incoming deltas; returns an unsubscribe fn.
export const subscribeListDelta = (
  key: string,
  onDelta: (op: DeltaOp, item: DeltaItem) => void,
): (() => void) => {
  const listener: DeltaListener = { key, onDelta }
  deltaListeners.add(listener)
  return () => {
    deltaListeners.delete(listener)
  }
}

// Deliver a delta to whichever open screen holds this exact list key.
export const applyListDelta = (
  key: string,
  op: DeltaOp,
  item: DeltaItem,
): void => {
  for (const listener of deltaListeners) {
    if (listener.key === key) listener.onDelta(op, item)
  }
  // A screen holding a deeper key under this list (e.g. Home's one-item
  // "announcements:<ws>:latest") can't patch the page it fetched, so it
  // refetches instead.
  for (const listener of listeners) {
    if (listener.key.startsWith(`${key}:`)) listener.onInvalidate()
  }
}

// Pure list mutation used by list screens' onDelta: create prepends (deduped by
// id), update replaces by id, delete removes by id. Callers usually re-sort the
// result for their own ordering.
export const applyListOp = <T extends { id: string }>(
  list: T[],
  op: DeltaOp,
  item: DeltaItem,
): T[] => {
  switch (op) {
    case "delete":
      return list.filter((x) => x.id !== item.id)
    case "update":
      return list.map((x) => (x.id === item.id ? (item as unknown as T) : x))
    case "create":
      return [item as unknown as T, ...list.filter((x) => x.id !== item.id)]
  }
}
