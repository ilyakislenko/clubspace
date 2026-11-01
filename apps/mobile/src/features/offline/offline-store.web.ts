/// <reference lib="dom" />

// Offline downloads in the browser (PWA / web build). Same API as the native
// `offline-store.ts`; Metro picks this file for web.
//
// - What is stored: the HLS rendition the server's offline manifest describes
//   (GET /videos/:id/offline-manifest — issued under the playback access gate),
//   its segments, keys and init sections, plus subtitles and the thumbnail.
//   The files go to Cache Storage (offline-media-cache.ts explains the choice);
//   a small JSON record per lesson goes through fs-safe (localStorage), so a
//   browser that evicted the files still has the record and the UI can say
//   «скачайте снова» instead of opening a broken player.
// - Playback: the player feeds the local playlist to hls.js with a loader that
//   reads Cache Storage (features/video/offline-hls-loader.ts).
// - Access: a stored copy re-asks the server's gate when online and stops
//   playing after the offline window (offline-access.ts). Lost access deletes
//   the files and keeps a stub saying why.
// - Pause / resume / cancel: files are keyed by their position in the
//   rendition, so a resumed download fetches a fresh manifest (the segment
//   links live 30 minutes) and skips what's already stored.

import type { CourseDetail, CourseSummary } from "../../shared/api/courses"
import {
  getOfflineManifest,
  getVideoPlayback,
  type VideoDetail,
} from "../../shared/api/videos"
import {
  DOCUMENT_DIR,
  safeDelete,
  safeListDir,
  safeReadString,
  safeWriteString,
} from "../../shared/fs-safe"
import {
  accessVerdictFromError,
  offlineAccessDecision,
  offlineAccessExpiresAt,
  shouldRevalidateAccess,
  type OfflineAccessVerdict,
} from "./offline-access"
import {
  checkStorageBudget,
  estimateTotalBytes,
  notEnoughSpaceMessage,
} from "./offline-budget"
import {
  OFFLINE_CACHE_PREFIX,
  offlineBaseUrl,
  offlineCacheName,
} from "./offline-media-cache"
import {
  buildOfflinePlan,
  OfflinePlanError,
  type OfflinePlan,
  type OfflineResource,
} from "./offline-plan"
import {
  OfflineDownloadInterrupted,
  type OfflineDownloadControls,
  type OfflineDownloadProgress,
  type OfflineLostReason,
  type OfflineVideoEntry,
  type OfflineVideoState,
  type ReadyOfflineVideoEntry,
} from "./offline-types"

const ROOT = `${DOCUMENT_DIR}offline-web/`
const META_DIR = `${ROOT}videos/`
const COURSES_DIR = `${ROOT}courses/`
const metaPath = (videoId: string) => `${META_DIR}${videoId}`
const courseMetaPath = (courseId: string) => `${COURSES_DIR}${courseId}`

const PLAYLIST = "index.m3u8"
const THUMBNAIL = "thumb"
// Parallel segment fetches: enough to fill a typical link, few enough not to
// starve the page's own requests.
const CONCURRENCY = 3
// Segment links are presigned for 30 minutes; refresh a little before.
const URL_REFRESH_AFTER_MS = 25 * 60 * 1000
const MAX_ATTEMPTS = 3
// Write the record every N files so a reload mid-download resumes close by.
const PERSIST_EVERY = 10

type Meta = {
  videoId: string
  video: VideoDetail
  course?: CourseSummary
  state: "partial" | "ready" | "lost"
  lostReason?: OfflineLostReason
  fingerprint: string
  // Files in the plan (segments, keys, init sections) and how many are stored.
  total: number
  done: number
  bytes: number
  // Cache entries a complete download has; fewer means the browser evicted.
  storedCount: number
  hasThumbnail: boolean
  savedAt: string
  // Last time the server confirmed access (manifest issued or check passed).
  lastValidatedAt: number
}

type Job = {
  controller: AbortController
  interrupt: "paused" | "cancelled" | null
  progress: OfflineDownloadProgress | null
  settled: Promise<void>
}

const jobs = new Map<string, Job>()
const listeners = new Set<
  (videoId: string, progress: OfflineDownloadProgress | null) => void
>()
const emit = (videoId: string, progress: OfflineDownloadProgress | null) => {
  for (const listener of listeners) listener(videoId, progress)
}

const localUrl = (videoId: string, path: string) =>
  `${offlineBaseUrl(videoId)}${path}`

const readMeta = async (videoId: string): Promise<Meta | null> => {
  const raw = await safeReadString(metaPath(videoId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as Meta
  } catch {
    return null
  }
}

// False when localStorage refused the write (full or disabled).
const writeMeta = (meta: Meta): Promise<boolean> =>
  safeWriteString(metaPath(meta.videoId), JSON.stringify(meta))

const errorName = (error: unknown): string | undefined =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  typeof error.name === "string"
    ? error.name
    : undefined

const isQuotaError = (error: unknown): boolean => {
  const name = errorName(error)
  // Safari reports the legacy name; Chrome/Firefox use QuotaExceededError.
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED"
}

// Object URLs for stored thumbnails, made once per lesson and per page load.
const thumbnailUrls = new Map<string, string>()

const thumbnailUri = async (meta: Meta): Promise<string | undefined> => {
  if (!meta.hasThumbnail) return undefined
  const known = thumbnailUrls.get(meta.videoId)
  if (known) return known
  try {
    const hit = await caches.match(localUrl(meta.videoId, THUMBNAIL), {
      cacheName: offlineCacheName(meta.videoId),
    })
    if (!hit) return undefined
    const url = URL.createObjectURL(await hit.blob())
    thumbnailUrls.set(meta.videoId, url)
    return url
  } catch {
    return undefined
  }
}

const removeMedia = async (videoId: string) => {
  const thumb = thumbnailUrls.get(videoId)
  if (thumb) {
    URL.revokeObjectURL(thumb)
    thumbnailUrls.delete(videoId)
  }
  try {
    await caches.delete(offlineCacheName(videoId))
  } catch {
    /* Cache Storage unavailable — nothing stored */
  }
}

const markLost = async (meta: Meta, reason: OfflineLostReason): Promise<Meta> => {
  await removeMedia(meta.videoId)
  const lost: Meta = {
    ...meta,
    state: "lost",
    lostReason: reason,
    done: 0,
    bytes: 0,
    storedCount: 0,
    hasThumbnail: false,
  }
  await writeMeta(lost)
  return lost
}

// Every file a finished download stored is still there.
const isIntact = async (meta: Meta): Promise<boolean> => {
  try {
    const name = offlineCacheName(meta.videoId)
    if (!(await caches.has(name))) return false
    const cache = await caches.open(name)
    const keys = await cache.keys()
    if (keys.length < meta.storedCount) return false
    return Boolean(await cache.match(localUrl(meta.videoId, PLAYLIST)))
  } catch {
    return false
  }
}

// Re-asks the playback gate when due (or forced) and online; closes the copy
// on refusal or once the offline window has passed.
const enforceAccess = async (meta: Meta, force: boolean): Promise<Meta> => {
  if (meta.state === "lost") return meta
  const now = Date.now()
  let current = meta
  if (
    shouldRevalidateAccess({
      lastValidatedAt: current.lastValidatedAt,
      now,
      online: navigator.onLine,
      force,
    })
  ) {
    let verdict: OfflineAccessVerdict
    try {
      await getVideoPlayback({ videoId: meta.videoId })
      verdict = "allowed"
    } catch (error) {
      verdict = accessVerdictFromError(error)
    }
    if (verdict === "denied") return await markLost(current, "revoked")
    if (verdict === "allowed") {
      current = { ...current, lastValidatedAt: now }
      await writeMeta(current)
    }
  }
  if (
    offlineAccessDecision({ lastValidatedAt: current.lastValidatedAt, now }) ===
    "expired"
  ) {
    return await markLost(current, "expired")
  }
  return current
}

// Access check plus, for a finished copy, the eviction check.
const settle = async (meta: Meta, force: boolean): Promise<Meta> => {
  const checked = await enforceAccess(meta, force)
  if (checked.state === "ready" && !(await isIntact(checked))) {
    return await markLost(checked, "evicted")
  }
  return checked
}

const toEntry = async (meta: Meta): Promise<OfflineVideoEntry> => {
  const base = {
    videoId: meta.videoId,
    video: meta.video,
    course: meta.course,
    savedAt: meta.savedAt,
    bytes: meta.bytes,
    thumbnailLocalUri: await thumbnailUri(meta),
  }
  const job = jobs.get(meta.videoId)
  if (job) {
    const p = job.progress
    return {
      ...base,
      status: "partial",
      active: true,
      progress: p?.phase === "video" ? p.done / Math.max(p.total, 1) : 0,
    }
  }
  switch (meta.state) {
    case "ready":
      return {
        ...base,
        status: "ready",
        videoUri: localUrl(meta.videoId, PLAYLIST),
        accessExpiresAt: offlineAccessExpiresAt(meta.lastValidatedAt),
      }
    case "partial":
      return {
        ...base,
        status: "partial",
        active: false,
        progress: meta.done / Math.max(meta.total, 1),
      }
    case "lost":
      return { ...base, status: "lost", lostReason: meta.lostReason ?? "evicted" }
  }
}

export const getOfflineVideoState = async (
  videoId: string,
  opts?: { revalidate?: boolean },
): Promise<OfflineVideoState> => {
  const meta = await readMeta(videoId)
  if (!meta) return { status: "absent" }
  const entry = await toEntry(
    jobs.has(videoId) ? meta : await settle(meta, opts?.revalidate === true),
  )
  switch (entry.status) {
    case "ready":
      return {
        status: "ready",
        uri: entry.videoUri,
        accessExpiresAt: entry.accessExpiresAt,
      }
    case "partial":
      return { status: "partial", progress: entry.progress, active: entry.active }
    case "lost":
      return { status: "lost", reason: entry.lostReason }
  }
}

export const removeOffline = async (videoId: string) => {
  const job = jobs.get(videoId)
  if (job) {
    job.interrupt = "cancelled"
    job.controller.abort()
    // Let in-flight writes land before deleting, or they'd recreate the cache.
    await job.settled
  }
  await removeMedia(videoId)
  await safeDelete(metaPath(videoId))
}

export const offlineDownloadControls: OfflineDownloadControls = {
  pause: (videoId) => {
    const job = jobs.get(videoId)
    if (!job) return
    job.interrupt = "paused"
    job.controller.abort()
  },
  cancel: removeOffline,
  subscribe: (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export const getCachedVideo = async (
  videoId: string,
): Promise<ReadyOfflineVideoEntry | null> => {
  const meta = await readMeta(videoId)
  if (!meta || meta.state !== "ready" || jobs.has(videoId)) return null
  const entry = await toEntry(await settle(meta, false))
  return entry.status === "ready" ? entry : null
}

export const getCachedCourse = async (
  courseId: string,
): Promise<CourseDetail | null> => {
  const raw = await safeReadString(courseMetaPath(courseId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as CourseDetail
  } catch {
    return null
  }
}

export const cacheCourse = async (course: CourseDetail) => {
  await safeWriteString(courseMetaPath(course.id), JSON.stringify(course))
}

// Asked once per page load, before the first download: a persisted origin is
// never evicted under storage pressure (Chrome grants it to installed PWAs and
// engaged sites, Firefox may prompt, Safari decides on its own).
let persistenceRequested = false
const requestPersistentStorage = async () => {
  if (persistenceRequested) return
  persistenceRequested = true
  try {
    if (await navigator.storage?.persisted?.()) return
    await navigator.storage?.persist?.()
  } catch {
    /* not supported — the eviction checks cover it */
  }
}

const fetchPlan = async (videoId: string): Promise<OfflinePlan> => {
  const { manifest } = await getOfflineManifest({ videoId })
  return buildOfflinePlan(manifest, offlineBaseUrl(videoId))
}

const contentTypeOf = (resource: OfflineResource): string => {
  if (resource.kind === "key") return "application/octet-stream"
  return resource.localPath.endsWith(".ts") ? "video/mp2t" : "video/mp4"
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const runDownload = async (
  params: Parameters<typeof downloadVideoForOffline>[0],
  job: Job,
): Promise<string> => {
  const { videoId } = params
  const { signal } = job.controller
  const report = (progress: OfflineDownloadProgress) => {
    job.progress = progress
    params.onProgress?.(progress)
    emit(videoId, progress)
  }

  void requestPersistentStorage()
  const plan = await fetchPlan(videoId)
  let urlsFetchedAt = Date.now()
  const remoteUrls = new Map(plan.resources.map((r) => [r.localPath, r.remoteUrl]))

  const previous = await readMeta(videoId)
  const resuming =
    previous?.state === "partial" && previous.fingerprint === plan.fingerprint
  if (!resuming) await removeMedia(videoId)
  const meta: Meta = {
    videoId,
    video: params.video,
    course: params.course ?? (resuming ? previous.course : undefined),
    state: "partial",
    fingerprint: plan.fingerprint,
    total: plan.resources.length,
    done: 0,
    bytes: resuming ? previous.bytes : 0,
    storedCount: 0,
    hasThumbnail: false,
    savedAt: resuming ? previous.savedAt : new Date().toISOString(),
    // The manifest was just issued under the access gate.
    lastValidatedAt: urlsFetchedAt,
  }
  if (!(await writeMeta(meta))) {
    throw new Error("Память браузера переполнена — не удалось начать загрузку.")
  }

  const cache = await caches.open(offlineCacheName(videoId))
  const stored = new Set((await cache.keys()).map((r) => r.url))
  const queue = plan.resources.filter(
    (r) => !stored.has(localUrl(videoId, r.localPath)),
  )
  meta.done = plan.resources.length - queue.length
  let storedDurationSec = plan.resources
    .filter((r) => stored.has(localUrl(videoId, r.localPath)))
    .reduce((sum, r) => sum + r.durationSec, 0)
  let estimatedBytes: number | undefined
  const reportVideo = () => {
    if (storedDurationSec > 0) {
      estimatedBytes = estimateTotalBytes({
        sampledBytes: meta.bytes,
        sampledDurationSec: storedDurationSec,
        totalDurationSec: plan.totalDurationSec,
      })
    }
    report({
      phase: "video",
      done: meta.done,
      total: meta.total,
      bytes: meta.bytes,
      estimatedBytes,
    })
  }
  reportVideo()

  // Single-flight: whichever worker notices the links aged out refreshes them
  // for all. A fresh manifest also re-checks access on the server.
  let refreshing: Promise<void> | null = null
  const refreshUrls = () => {
    refreshing ??= (async () => {
      try {
        const fresh = await fetchPlan(videoId)
        if (fresh.fingerprint !== plan.fingerprint) {
          throw new OfflinePlanError("Видео обновилось — скачайте урок заново.")
        }
        for (const r of fresh.resources) remoteUrls.set(r.localPath, r.remoteUrl)
        urlsFetchedAt = Date.now()
        meta.lastValidatedAt = urlsFetchedAt
      } finally {
        refreshing = null
      }
    })()
    return refreshing
  }

  const fetchBlob = async (resource: OfflineResource): Promise<Blob> => {
    for (let attempt = 1; ; attempt += 1) {
      if (Date.now() - urlsFetchedAt > URL_REFRESH_AFTER_MS) await refreshUrls()
      let response: Response
      try {
        response = await fetch(remoteUrls.get(resource.localPath) ?? resource.remoteUrl, {
          signal,
          cache: "no-store",
        })
      } catch (error) {
        if (signal.aborted || attempt >= MAX_ATTEMPTS) throw error
        await wait(1000 * attempt)
        continue
      }
      if (response.ok) return await response.blob()
      if (attempt < MAX_ATTEMPTS && (response.status === 403 || response.status >= 500)) {
        // 403 from storage: the presigned link expired.
        if (response.status === 403) await refreshUrls()
        else await wait(1000 * attempt)
        continue
      }
      throw new Error(`Хранилище не отдало файл урока (код ${response.status}).`)
    }
  }

  const storeOne = async (resource: OfflineResource) => {
    const blob = await fetchBlob(resource)
    if (signal.aborted) throw new DOMException("aborted", "AbortError")
    await cache.put(
      localUrl(videoId, resource.localPath),
      new Response(blob, { headers: { "Content-Type": contentTypeOf(resource) } }),
    )
    meta.done += 1
    meta.bytes += blob.size
    storedDurationSec += resource.durationSec
    if (meta.done % PERSIST_EVERY === 0) await writeMeta(meta)
    reportVideo()
  }

  try {
    // Fetch until one segment is stored: its bytes per second size the whole
    // rendition, checked against the origin's quota before going further.
    while (storedDurationSec === 0 && queue.length > 0) {
      const next = queue.shift()
      if (next) await storeOne(next)
    }
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
    const budget = checkStorageBudget({
      quota: estimate?.quota,
      usage: estimate?.usage,
      remainingBytes: Math.max(0, (estimatedBytes ?? 0) - meta.bytes),
    })
    if (!budget.ok) throw new NotEnoughSpaceError(notEnoughSpaceMessage(budget))

    const failures: unknown[] = []
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        try {
          for (let next = queue.shift(); next; next = queue.shift()) {
            if (signal.aborted) return
            await storeOne(next)
          }
        } catch (error) {
          failures.push(error)
          // Stop the other workers; the first real error is what's reported.
          job.controller.abort()
        }
      }),
    )
    if (failures.length > 0) {
      throw (
        failures.find((e) => errorName(e) !== "AbortError") ??
        failures[0]
      )
    }
    if (signal.aborted) throw new DOMException("aborted", "AbortError")

    const subtitles = await Promise.all(
      (params.video.subtitles ?? []).map(async (track) => {
        const url = localUrl(videoId, `sub/${encodeURIComponent(track.id)}.vtt`)
        try {
          const response = await fetch(track.publicUrl, { signal })
          if (!response.ok) return track
          await cache.put(
            url,
            new Response(await response.blob(), {
              headers: { "Content-Type": "text/vtt" },
            }),
          )
          return { ...track, publicUrl: url }
        } catch (error) {
          if (signal.aborted) throw error
          // Subtitles are optional; without them the lesson still plays.
          return track
        }
      }),
    )

    if (params.thumbnailUrl) {
      report({ phase: "thumbnail" })
      try {
        const response = await fetch(params.thumbnailUrl, { signal })
        if (response.ok) {
          await cache.put(localUrl(videoId, THUMBNAIL), new Response(await response.blob()))
          meta.hasThumbnail = true
        }
      } catch (error) {
        if (signal.aborted) throw error
      }
    }

    await cache.put(
      localUrl(videoId, PLAYLIST),
      new Response(plan.playlist, {
        headers: { "Content-Type": "application/vnd.apple.mpegurl" },
      }),
    )

    const finished: Meta = {
      ...meta,
      video: { ...params.video, subtitles },
      state: "ready",
      storedCount: (await cache.keys()).length,
      savedAt: new Date().toISOString(),
    }
    if (!(await writeMeta(finished))) {
      throw new Error("Память браузера переполнена — не удалось сохранить загрузку.")
    }
    report({ phase: "done" })
    return localUrl(videoId, PLAYLIST)
  } catch (error) {
    // Keep what's stored so «Продолжить» picks up from here.
    await writeMeta(meta)
    throw error
  }
}

class NotEnoughSpaceError extends Error {}

export const downloadVideoForOffline = async (params: {
  videoId: string
  video: VideoDetail
  course?: CourseSummary
  thumbnailUrl?: string | null
  onProgress?: (progress: OfflineDownloadProgress) => void
}): Promise<string> => {
  const { videoId } = params
  if (jobs.has(videoId)) throw new Error("Этот урок уже скачивается.")
  // Executor form, not Promise.withResolvers: that needs Safari 17.4, and
  // offline playback is offered from iOS 17.1.
  let markSettled!: () => void
  const job: Job = {
    controller: new AbortController(),
    interrupt: null,
    progress: null,
    settled: new Promise<void>((resolve) => {
      markSettled = resolve
    }),
  }
  jobs.set(videoId, job)
  try {
    return await runDownload(params, job)
  } catch (error) {
    if (job.interrupt === "paused") throw new OfflineDownloadInterrupted("paused")
    const discard =
      job.interrupt === "cancelled" ||
      error instanceof NotEnoughSpaceError ||
      error instanceof OfflinePlanError ||
      isQuotaError(error) ||
      accessVerdictFromError(error) === "denied"
    if (discard) {
      await removeMedia(videoId)
      await safeDelete(metaPath(videoId))
    }
    if (job.interrupt === "cancelled") throw new OfflineDownloadInterrupted("cancelled")
    if (isQuotaError(error)) {
      throw new Error(
        "Браузеру не хватило места для урока. Удалите другие загрузки и попробуйте снова.",
      )
    }
    if (errorName(error) === "TypeError") {
      // fetch() failing outright: offline or the connection dropped.
      throw new Error("Загрузка прервалась: нет связи. Нажмите «Продолжить», когда появится интернет.")
    }
    throw error
  } finally {
    jobs.delete(videoId)
    emit(videoId, null)
    markSettled()
  }
}

export const listOfflineEntries = async (): Promise<OfflineVideoEntry[]> => {
  const metas = (
    await Promise.all((await safeListDir(META_DIR)).map((id) => readMeta(id)))
  ).filter((m): m is Meta => m !== null)

  // Files without a record (a crash between writes): nothing can reach them.
  const known = new Set(metas.map((m) => m.videoId))
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith(OFFLINE_CACHE_PREFIX)) continue
      const id = name.slice(OFFLINE_CACHE_PREFIX.length)
      if (!known.has(id) && !jobs.has(id)) await caches.delete(name)
    }
  } catch {
    /* Cache Storage unavailable */
  }

  const entries: OfflineVideoEntry[] = []
  // One at a time: a due access check is a request per lesson.
  for (const meta of metas) {
    entries.push(await toEntry(jobs.has(meta.videoId) ? meta : await settle(meta, false)))
  }
  return entries.sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1))
}

export const getOfflineRootSizeBytes = async (): Promise<number> => {
  const metas = await Promise.all(
    (await safeListDir(META_DIR)).map((id) => readMeta(id)),
  )
  return metas.reduce((sum, m) => sum + (m?.bytes ?? 0), 0)
}

export const clearAllOffline = async () => {
  for (const job of jobs.values()) {
    job.interrupt = "cancelled"
    job.controller.abort()
  }
  await Promise.all([...jobs.values()].map((job) => job.settled))
  for (const url of thumbnailUrls.values()) URL.revokeObjectURL(url)
  thumbnailUrls.clear()
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith(OFFLINE_CACHE_PREFIX)) await caches.delete(name)
    }
  } catch {
    /* Cache Storage unavailable */
  }
  await safeDelete(ROOT)
}
