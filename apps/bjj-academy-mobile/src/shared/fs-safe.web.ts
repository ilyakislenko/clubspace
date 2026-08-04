/// <reference lib="dom" />

/**
 * The web backing store for everything the app persists locally.
 *
 * `expo-file-system` has no web implementation, so on the PWA every read and
 * write through `fs-safe.ts` failed silently (the helpers swallow errors by
 * design). That quietly disabled *all* local state in the browser: the offline
 * SWR cache every list screen paints from, resume positions, the queued-writes
 * outbox, and the whole preferences file — theme, autoplay, belt,
 * onboarding-seen, notes, bookmarks, pinned courses. A member's theme choice
 * didn't survive a reload and no screen could ever paint offline.
 *
 * Metro picks this file for web (`fs-safe.web.ts`), tsc and native resolve the
 * base `fs-safe.ts` — the same platform-file pattern as `use-player.web.tsx`.
 * The API is identical, so no caller changes: paths become localStorage keys
 * and a path ending in "/" behaves like a directory.
 *
 * localStorage (not IndexedDB) because the callers are synchronous-ish JSON
 * blobs measured in kilobytes, it's available in every target browser, and the
 * failure modes are well understood. Video files are never stored here —
 * offline downloads stay native-only.
 */

// Namespaced so the app's own keys (tokens, workspaces cache — see kv.ts) and
// anything else on the origin can't collide with a stored path.
const PREFIX = "bjjfs:"

// The one unbounded consumer: API snapshots, all rebuildable from the network.
// Evicted first when the origin runs out of quota.
const CACHE_PREFIX = `${PREFIX}${"app/"}resource-cache/`

export const DOCUMENT_DIR = "app/"

type WebStorage = {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const store = (): WebStorage | undefined => {
  try {
    return (globalThis as { localStorage?: WebStorage }).localStorage
  } catch {
    // Accessing localStorage throws outright in some privacy modes.
    return undefined
  }
}

const allKeys = (storage: WebStorage): string[] => {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key !== null && key.startsWith(PREFIX)) keys.push(key)
  }
  return keys
}

const isQuotaError = (error: unknown): boolean => {
  const name = (error as { name?: string } | null)?.name
  // Safari reports the legacy name; Chrome/Firefox use QuotaExceededError.
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED"
}

export const safeGetInfo = async (
  path: string,
): Promise<{
  exists: boolean
  uri?: string
  size?: number
  isDirectory?: boolean
}> => {
  const storage = store()
  if (!storage) return { exists: false }
  const value = storage.getItem(PREFIX + path)
  if (value !== null) {
    return { exists: true, uri: path, size: value.length, isDirectory: false }
  }
  // A directory "exists" once something lives under it — matching how the
  // native helper answers for a folder created by an earlier write.
  const dir = path.endsWith("/") ? path : `${path}/`
  const hasChildren = allKeys(storage).some((key) =>
    key.startsWith(PREFIX + dir),
  )
  return hasChildren
    ? { exists: true, uri: path, isDirectory: true }
    : { exists: false }
}

export const safeReadString = async (path: string): Promise<string | null> => {
  try {
    return store()?.getItem(PREFIX + path) ?? null
  } catch {
    return null
  }
}

export const safeWriteString = async (
  path: string,
  content: string,
): Promise<boolean> => {
  const storage = store()
  if (!storage) return false
  try {
    storage.setItem(PREFIX + path, content)
    return true
  } catch (error) {
    if (!isQuotaError(error)) return false
    // Out of room: drop the rebuildable API snapshots and try once more, so a
    // full cache can never block a preference or an outbox write.
    for (const key of allKeys(storage)) {
      if (key.startsWith(CACHE_PREFIX) && key !== PREFIX + path) {
        try {
          storage.removeItem(key)
        } catch {
          /* keep evicting */
        }
      }
    }
    try {
      storage.setItem(PREFIX + path, content)
      return true
    } catch {
      // Report failure HONESTLY — same contract as the native helper, so a
      // caller never treats a dropped write as a success.
      return false
    }
  }
}

// Directories are implicit here: a key is a full path, so there's nothing to
// create. Kept for API parity with the native helper.
export const safeMakeDir = async (_path: string): Promise<void> => {}

export const safeDelete = async (path: string): Promise<void> => {
  const storage = store()
  if (!storage) return
  try {
    storage.removeItem(PREFIX + path)
    // `deleteAsync` on a directory removes its contents too — e.g. signing out
    // wipes the whole resource cache in one call.
    const dir = path.endsWith("/") ? path : `${path}/`
    for (const key of allKeys(storage)) {
      if (key.startsWith(PREFIX + dir)) storage.removeItem(key)
    }
  } catch {
    /* storage disabled — nothing persisted to delete */
  }
}

export const safeListDir = async (path: string): Promise<string[]> => {
  const storage = store()
  if (!storage) return []
  const dir = path.endsWith("/") ? path : `${path}/`
  const base = PREFIX + dir
  // `readDirectoryAsync` returns immediate child names, not full paths.
  const names = new Set<string>()
  for (const key of allKeys(storage)) {
    if (!key.startsWith(base)) continue
    const rest = key.slice(base.length)
    if (rest.length === 0) continue
    const slash = rest.indexOf("/")
    names.add(slash === -1 ? rest : rest.slice(0, slash))
  }
  return [...names]
}
