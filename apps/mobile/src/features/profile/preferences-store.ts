import { type ThemeKey, type ThemeMode } from "@clubspace/ui-kit/util"

import { listMyFavorites, setVideoFavorite } from "../../shared/api/videos"
import {
  DOCUMENT_DIR,
  safeDelete,
  safeGetInfo,
  safeMakeDir,
  safeReadString,
  safeWriteString,
} from "../../shared/fs-safe"

const ROOT = `${DOCUMENT_DIR}prefs/`
const PREFERENCES_FILE = `${ROOT}preferences.json`
const FAVORITES_FILE = `${ROOT}favorites.json`
const FAVORITES_PENDING_FILE = `${ROOT}favorites-pending.json`
const RECENTS_FILE = `${ROOT}recents.json`
const NOTES_FILE = `${ROOT}notes.json`
const BOOKMARKS_FILE = `${ROOT}bookmarks.json`
const PINNED_COURSES_FILE = `${ROOT}pinned-courses.json`
const DRILL_CONFIG_FILE = `${ROOT}drill-config.json`

export type Preferences = {
  autoplay: boolean
  defaultPlaybackRate: number
  wifiOnlyDownloads: boolean
  onboardingSeen: boolean
  themeKey: ThemeKey
  themeMode: ThemeMode
}

const DEFAULT_PREFERENCES: Preferences = {
  autoplay: true,
  defaultPlaybackRate: 1,
  wifiOnlyDownloads: false,
  onboardingSeen: false,
  themeKey: "indigo",
  themeMode: "auto",
}

let rootEnsured = false
const ensureRoot = async () => {
  if (rootEnsured) return
  const info = await safeGetInfo(ROOT)
  if (!info.exists) await safeMakeDir(ROOT)
  rootEnsured = true
}

const readJsonOrDefault = async <T,>(path: string, fallback: T): Promise<T> => {
  await ensureRoot()
  const raw = await safeReadString(path)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return { ...fallback, ...(parsed as object) } as T
  } catch {
    return fallback
  }
}

const writeJson = async (path: string, value: unknown) => {
  await ensureRoot()
  await safeWriteString(path, JSON.stringify(value))
}

// Per-user files wiped on sign-out. preferences.json and drill-config.json
// are device-level settings and deliberately survive.
const USER_DATA_FILES = [
  FAVORITES_FILE,
  FAVORITES_PENDING_FILE,
  RECENTS_FILE,
  NOTES_FILE,
  BOOKMARKS_FILE,
  PINNED_COURSES_FILE,
]

export const clearUserPrefsData = async () => {
  await Promise.all(USER_DATA_FILES.map((path) => safeDelete(path)))
}

export const getPreferences = async (): Promise<Preferences> => {
  return readJsonOrDefault(PREFERENCES_FILE, DEFAULT_PREFERENCES)
}

const prefsListeners = new Set<(p: Preferences) => void>()

// Lets long-lived components (e.g. the theme) react to setting
// toggles in real time without re-mounting or polling.
export const subscribePreferences = (
  listener: (p: Preferences) => void,
): (() => void) => {
  prefsListeners.add(listener)
  return () => {
    prefsListeners.delete(listener)
  }
}

export const setPreferences = async (
  patch: Partial<Preferences>,
): Promise<Preferences> => {
  const current = await getPreferences()
  const next = { ...current, ...patch }
  await writeJson(PREFERENCES_FILE, next)
  prefsListeners.forEach((listener) => {
    try {
      listener(next)
    } catch {
      /* listener errors must not poison setPreferences */
    }
  })
  return next
}

// ---- Favorites ----
//
// Backed by the server (VideoFavorite). The local file is a cache so reads
// stay fast and synchronous-feeling (and survive offline). Toggles try the
// server inline; on failure the op goes onto a small pending queue and
// gets drained the next time syncFavoritesFromServer runs (workspace
// load / switch). The pending queue is what makes a star-while-offline
// actually reach the server when connectivity comes back.

type PendingFavoriteOp = { videoId: string; favorite: boolean }

const readFavorites = async (): Promise<string[]> => {
  await ensureRoot()
  const raw = await safeReadString(FAVORITES_FILE)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

const readPendingFavoriteOps = async (): Promise<PendingFavoriteOp[]> => {
  await ensureRoot()
  const raw = await safeReadString(FAVORITES_PENDING_FILE)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PendingFavoriteOp[]) : []
  } catch {
    return []
  }
}

const writePendingFavoriteOps = async (ops: PendingFavoriteOp[]) => {
  await writeJson(FAVORITES_PENDING_FILE, ops)
}

const enqueuePendingFavorite = async (op: PendingFavoriteOp) => {
  const ops = await readPendingFavoriteOps()
  // Last-writer-wins per video: if the user toggled the same star several
  // times offline (added then removed, etc.), only the final intent should
  // hit the server when we drain.
  const filtered = ops.filter((o) => o.videoId !== op.videoId)
  filtered.push(op)
  await writePendingFavoriteOps(filtered)
}

const clearPendingFavoriteFor = async (videoId: string) => {
  const ops = await readPendingFavoriteOps()
  const filtered = ops.filter((o) => o.videoId !== videoId)
  if (filtered.length !== ops.length) {
    await writePendingFavoriteOps(filtered)
  }
}

const drainPendingFavorites = async (): Promise<boolean> => {
  const ops = await readPendingFavoriteOps()
  if (ops.length === 0) return true
  const remaining: PendingFavoriteOp[] = []
  for (const op of ops) {
    try {
      await setVideoFavorite({
        videoId: op.videoId,
        favorite: op.favorite,
      })
    } catch {
      remaining.push(op)
    }
  }
  await writePendingFavoriteOps(remaining)
  return remaining.length === 0
}

export const isFavorite = async (videoId: string): Promise<boolean> => {
  const favs = await readFavorites()
  return favs.includes(videoId)
}

export const listFavorites = async (): Promise<string[]> => {
  return await readFavorites()
}

export const toggleFavorite = async (videoId: string): Promise<boolean> => {
  const favs = await readFavorites()
  const willBeFavorite = !favs.includes(videoId)
  const next = willBeFavorite
    ? [...favs, videoId]
    : favs.filter((id) => id !== videoId)
  await writeJson(FAVORITES_FILE, next)

  try {
    await setVideoFavorite({ videoId, favorite: willBeFavorite })
    // Online success — drop any stale queued op for this video so a later
    // drain doesn't undo what we just did.
    await clearPendingFavoriteFor(videoId)
  } catch {
    await enqueuePendingFavorite({ videoId, favorite: willBeFavorite })
  }
  return willBeFavorite
}

export const syncFavoritesFromServer = async (
  workspaceId: string,
): Promise<void> => {
  // Drain queued offline ops first. If any of them still fail (still
  // offline) we bail out without overwriting the local cache — otherwise
  // a partially-failed drain would clobber unstarred-offline videos with
  // the server's older "starred" snapshot.
  const drainedFully = await drainPendingFavorites()
  if (!drainedFully) return
  try {
    const response = await listMyFavorites({ workspaceId })
    const ids = response.data.map((entry) => entry.videoId)
    await writeJson(FAVORITES_FILE, ids)
  } catch {
    /* offline / auth churn — keep whatever local cache we had */
  }
}

// ---- Recently watched (cross-course) ----

export type RecentEntry = {
  videoId: string
  courseId?: string
  title: string
  thumbnailUrl?: string | null
  watchedAt: string
}

const readRecents = async (): Promise<RecentEntry[]> => {
  await ensureRoot()
  const raw = await safeReadString(RECENTS_FILE)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : []
  } catch {
    return []
  }
}

export const recordRecent = async (entry: Omit<RecentEntry, "watchedAt">) => {
  const list = await readRecents()
  const filtered = list.filter((e) => e.videoId !== entry.videoId)
  const next = [
    { ...entry, watchedAt: new Date().toISOString() },
    ...filtered,
  ].slice(0, 30)
  await writeJson(RECENTS_FILE, next)
}

export const listRecents = async (): Promise<RecentEntry[]> => {
  return await readRecents()
}

export const clearRecents = async () => {
  await writeJson(RECENTS_FILE, [])
}

// ---- Personal video notes ----

type NotesMap = Record<string, { text: string; updatedAt: string }>

const readNotes = async (): Promise<NotesMap> => {
  await ensureRoot()
  const raw = await safeReadString(NOTES_FILE)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed
      ? (parsed as NotesMap)
      : {}
  } catch {
    return {}
  }
}

export const getNote = async (videoId: string): Promise<string> => {
  const notes = await readNotes()
  return notes[videoId]?.text ?? ""
}

export const setNote = async (videoId: string, text: string) => {
  const notes = await readNotes()
  if (text.trim().length === 0) {
    delete notes[videoId]
  } else {
    notes[videoId] = { text, updatedAt: new Date().toISOString() }
  }
  await writeJson(NOTES_FILE, notes)
}

// ---- Video bookmarks (timestamps with optional labels) ----

export type Bookmark = {
  id: string
  position: number
  label: string
  createdAt: string
}

type BookmarksMap = Record<string, Bookmark[]>

const readBookmarks = async (): Promise<BookmarksMap> => {
  await ensureRoot()
  const raw = await safeReadString(BOOKMARKS_FILE)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed
      ? (parsed as BookmarksMap)
      : {}
  } catch {
    return {}
  }
}

const writeBookmarks = async (map: BookmarksMap) => {
  await writeJson(BOOKMARKS_FILE, map)
}

export const listBookmarks = async (videoId: string): Promise<Bookmark[]> => {
  const map = await readBookmarks()
  const list = map[videoId] ?? []
  return [...list].sort((a, b) => a.position - b.position)
}

export const addBookmark = async (
  videoId: string,
  position: number,
  label = "",
): Promise<Bookmark> => {
  const map = await readBookmarks()
  const list = map[videoId] ?? []
  const entry: Bookmark = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    position: Math.max(0, Math.round(position)),
    label,
    createdAt: new Date().toISOString(),
  }
  map[videoId] = [...list, entry]
  await writeBookmarks(map)
  return entry
}

export const removeBookmark = async (videoId: string, bookmarkId: string) => {
  const map = await readBookmarks()
  const list = map[videoId] ?? []
  const next = list.filter((b) => b.id !== bookmarkId)
  if (next.length === 0) {
    delete map[videoId]
  } else {
    map[videoId] = next
  }
  await writeBookmarks(map)
}

export const updateBookmarkLabel = async (
  videoId: string,
  bookmarkId: string,
  label: string,
) => {
  const map = await readBookmarks()
  const list = map[videoId] ?? []
  map[videoId] = list.map((b) => (b.id === bookmarkId ? { ...b, label } : b))
  await writeBookmarks(map)
}


const readPinnedCourses = async (): Promise<string[]> => {
  await ensureRoot()
  const raw = await safeReadString(PINNED_COURSES_FILE)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export const listPinnedCourses = async (): Promise<string[]> => {
  return await readPinnedCourses()
}

export const togglePinnedCourse = async (
  courseId: string,
): Promise<boolean> => {
  const list = await readPinnedCourses()
  const next = list.includes(courseId)
    ? list.filter((id) => id !== courseId)
    : [...list, courseId]
  await writeJson(PINNED_COURSES_FILE, next)
  return next.includes(courseId)
}

// ---- Drill mode (work/rest interval timer for grappling drilling) ----

export type DrillConfig = {
  rounds: number
  workSec: number
  restSec: number
}

const DEFAULT_DRILL_CONFIG: DrillConfig = {
  rounds: 3,
  workSec: 5 * 60,
  restSec: 30,
}

export const getDrillConfig = async (): Promise<DrillConfig> => {
  return readJsonOrDefault(DRILL_CONFIG_FILE, DEFAULT_DRILL_CONFIG)
}

export const setDrillConfig = async (
  config: DrillConfig,
): Promise<DrillConfig> => {
  await writeJson(DRILL_CONFIG_FILE, config)
  return config
}
