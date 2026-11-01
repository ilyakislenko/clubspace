/// <reference lib="dom" />

// Where the browser keeps downloaded lessons: Cache Storage, one cache per
// video, every file keyed by a same-origin URL under /__offline/<videoId>/.
//
// Why Cache Storage (not IndexedDB or OPFS): it stores Responses — binary,
// streamed, no structured-clone copies — and it is the one store every target
// supports from both the page and the service worker: Safari/iOS 11.1+ (OPFS
// writes need Safari 17+, and Safari's IndexedDB had years of Blob bugs),
// Chrome and Firefox. It shares the origin's quota with IndexedDB, falls under
// navigator.storage.persist(), and on iOS a home-screen web app is exempt from
// Safari's 7-day script-storage purge. One cache per video makes deleting a
// lesson a single caches.delete().
//
// The service worker must leave caches with this prefix alone when it drops
// the previous deploy's cache (public/service-worker.js).
//
// Safe to import on native: without `caches` every lookup is a miss.

export const OFFLINE_CACHE_PREFIX = "cs-offline:"
export const OFFLINE_PATH_PREFIX = "/__offline/"

export const offlineCacheName = (videoId: string): string =>
  `${OFFLINE_CACHE_PREFIX}${videoId}`

// Absolute, so hls.js resolves the playlist's URIs to the very keys stored.
export const offlineBaseUrl = (videoId: string): string =>
  `${globalThis.location?.origin ?? ""}${OFFLINE_PATH_PREFIX}${encodeURIComponent(videoId)}/`

const offlineVideoIdOf = (url: string): string | null => {
  const origin = globalThis.location?.origin
  if (!origin) return null
  let parsed: URL
  try {
    parsed = new URL(url, origin)
  } catch {
    return null
  }
  if (parsed.origin !== origin || !parsed.pathname.startsWith(OFFLINE_PATH_PREFIX)) {
    return null
  }
  const id = parsed.pathname.slice(OFFLINE_PATH_PREFIX.length).split("/")[0]
  return id ? decodeURIComponent(id) : null
}

export const isOfflineUrl = (url: string): boolean => offlineVideoIdOf(url) !== null

export const hasCacheStorage = (): boolean => typeof caches !== "undefined"

/** A stored file by its /__offline/… URL; null on a miss or without Cache Storage. */
export const matchOfflineResource = async (url: string): Promise<Response | null> => {
  if (!hasCacheStorage()) return null
  const videoId = offlineVideoIdOf(url)
  if (!videoId) return null
  try {
    const hit = await caches.match(new URL(url, globalThis.location.origin).href, {
      cacheName: offlineCacheName(videoId),
    })
    return hit ?? null
  } catch {
    return null
  }
}
