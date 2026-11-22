import { type ThemeKey, type ThemeMode } from "@clubspace/ui-kit/util"

import {
  type BookmarkDrawing,
  getMyVideoNote,
  listMyVideoBookmarks,
  type MyVideoBookmark,
  type MyVideoNotesItem,
  putMyVideoBookmark,
  putMyVideoNote,
} from "../../shared/api/video-study"
import { listMyFavorites, setVideoFavorite } from "../../shared/api/videos"
import {
  DOCUMENT_DIR,
  safeDelete,
  safeGetInfo,
  safeMakeDir,
  safeReadString,
  safeWriteString,
} from "../../shared/fs-safe"
import { isPermanentError } from "../../shared/outbox/outbox"
import { getProfileScopeId, profileSubdir } from "../../shared/profile-scope"
import { randomUuid } from "../../shared/uuid"
import {
  applyBookmarkPushed,
  applyNotePushed,
  bookmarkPayload,
  type BookmarksMap,
  type LocalBookmark,
  type LocalNote,
  mergePulledBookmarks,
  mergePulledNote,
  migrateStudyData,
  notePayload,
  type NotesMap,
  pointBookmarkAt,
  visibleBookmarks,
} from "./study-merge"
import {
  parseSubtitleChoice,
  type SubtitleChoice,
} from "../video/subtitle-choice"

const ROOT = `${DOCUMENT_DIR}prefs/`
const PREFERENCES_FILE = `${ROOT}preferences.json`
const DRILL_CONFIG_FILE = `${ROOT}drill-config.json`
// Each child profile keeps its own favorites, recents, notes, bookmarks and
// pins in a subdirectory; the guardian's stay at the top level.
const PROFILES_DIR = `${ROOT}profiles/`
const userDir = () => `${ROOT}${profileSubdir(getProfileScopeId())}`
const USER_FILE_NAMES = {
  favorites: "favorites.json",
  favoritesPending: "favorites-pending.json",
  recents: "recents.json",
  notes: "notes.json",
  bookmarks: "bookmarks.json",
  pinnedCourses: "pinned-courses.json",
  // The subtitle language picked last (or Off), applied to every lesson.
  subtitleChoice: "subtitle-choice.json",
} as const
const userFile = (name: keyof typeof USER_FILE_NAMES) =>
  `${userDir()}${USER_FILE_NAMES[name]}`

export type Preferences = {
  autoplay: boolean
  // After a lesson ends, count down and open the course's next lesson.
  autoplayNext: boolean
  defaultPlaybackRate: number
  // Show the video picture flipped left↔right (studying the mirrored side).
  mirrorVideo: boolean
  wifiOnlyDownloads: boolean
  onboardingSeen: boolean
  themeKey: ThemeKey
  themeMode: ThemeMode
}

const DEFAULT_PREFERENCES: Preferences = {
  autoplay: true,
  autoplayNext: true,
  defaultPlaybackRate: 1,
  mirrorVideo: false,
  wifiOnlyDownloads: false,
  onboardingSeen: false,
  themeKey: "indigo",
  themeMode: "auto",
}

const ensuredDirs = new Set<string>()
// The active profile's directory (the top level for the guardian), which also
// creates the root for the device-level files.
const ensureRoot = async () => {
  const dir = userDir()
  if (ensuredDirs.has(dir)) return
  const info = await safeGetInfo(dir)
  if (!info.exists) await safeMakeDir(dir)
  ensuredDirs.add(dir)
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

// Per-user files wiped on sign-out, every profile's. preferences.json and
// drill-config.json are device-level settings and deliberately survive.
export const clearUserPrefsData = async () => {
  await Promise.all([
    ...Object.values(USER_FILE_NAMES).map((name) => safeDelete(`${ROOT}${name}`)),
    safeDelete(PROFILES_DIR),
  ])
  ensuredDirs.clear()
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

// ---- Subtitle choice (per profile) ----

/** The member's last subtitle choice; null = never chosen. */
export const getSubtitleChoice = async (): Promise<SubtitleChoice | null> => {
  await ensureRoot()
  const raw = await safeReadString(userFile("subtitleChoice"))
  if (!raw) return null
  try {
    return parseSubtitleChoice(JSON.parse(raw))
  } catch {
    return null
  }
}

export const setSubtitleChoice = async (choice: SubtitleChoice) => {
  await writeJson(userFile("subtitleChoice"), choice)
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
  const raw = await safeReadString(userFile("favorites"))
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
  const raw = await safeReadString(userFile("favoritesPending"))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PendingFavoriteOp[]) : []
  } catch {
    return []
  }
}

const writePendingFavoriteOps = async (ops: PendingFavoriteOp[]) => {
  await writeJson(userFile("favoritesPending"), ops)
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
  await writeJson(userFile("favorites"), next)

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
    await writeJson(userFile("favorites"), ids)
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
  const raw = await safeReadString(userFile("recents"))
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
  await writeJson(userFile("recents"), next)
}

export const listRecents = async (): Promise<RecentEntry[]> => {
  return await readRecents()
}

export const clearRecents = async () => {
  await writeJson(userFile("recents"), [])
}

// ---- Lesson bookmarks and notes (offline-first, synced) ----
//
// notes.json / bookmarks.json are the working copy the video screen reads and
// writes — with no network at all. Each edit stamps `updatedAt` and marks the
// record dirty; a removed bookmark stays as a dirty tombstone until the server
// has it. syncVideoStudy pushes one lesson's dirty records and pulls the
// server's copy back, merging per study-merge (last write wins). Failures are
// silent: records stay dirty and go out on the next sync (lesson opened, app
// foregrounded, back online).

export type StudyFiles = { bookmarks: string; notes: string; scope: string | null }
type StudyData = { bookmarks: BookmarksMap; notes: NotesMap }

// Captured when an operation starts, so one that outlives a switch to another
// child's profile never writes into the new profile's files.
export const studyFiles = (): StudyFiles => ({
  bookmarks: userFile("bookmarks"),
  notes: userFile("notes"),
  scope: getProfileScopeId(),
})

// Every read-modify-write of the two files runs one at a time: the sync
// applies server answers in between the member's edits, and two interleaved
// writers would drop one of them.
let studyQueue: Promise<unknown> = Promise.resolve()
const runExclusive = <T,>(fn: () => Promise<T>): Promise<T> => {
  const run = studyQueue.then(fn, fn)
  studyQueue = run.catch(() => undefined)
  return run
}

const parseJson = (raw: string | null): unknown => {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Reads both files, upgrading pre-sync data in place the first time (its new
// uuids must be stable, so the upgrade is written straight back).
const loadStudy = async (files: StudyFiles): Promise<StudyData> => {
  await ensureRoot()
  const [rawBookmarks, rawNotes] = await Promise.all([
    safeReadString(files.bookmarks),
    safeReadString(files.notes),
  ])
  const { bookmarks, notes, changed } = migrateStudyData(
    parseJson(rawBookmarks),
    parseJson(rawNotes),
  )
  if (changed) {
    await Promise.all([
      writeJson(files.bookmarks, bookmarks),
      writeJson(files.notes, notes),
    ])
  }
  return { bookmarks, notes }
}

// Loads, lets `change` mutate the data, writes back whichever file changed.
const updateStudy = <T,>(
  files: StudyFiles,
  change: (data: StudyData) => T,
): Promise<T> =>
  runExclusive(async () => {
    const data = await loadStudy(files)
    const bookmarksBefore = JSON.stringify(data.bookmarks)
    const notesBefore = JSON.stringify(data.notes)
    const result = change(data)
    await Promise.all([
      JSON.stringify(data.bookmarks) !== bookmarksBefore &&
        writeJson(files.bookmarks, data.bookmarks),
      JSON.stringify(data.notes) !== notesBefore &&
        writeJson(files.notes, data.notes),
    ])
    return result
  })

// An edit's LWW stamp: now, but always after the record's previous stamp (two
// edits within a millisecond, or a clock that stepped back, must still order).
const nextStamp = (previous?: string): string => {
  const now = Date.now()
  const prev = previous ? Date.parse(previous) : Number.NaN
  return new Date(Number.isNaN(prev) || now > prev ? now : prev + 1).toISOString()
}

const setBookmarkList = (
  data: StudyData,
  videoId: string,
  list: LocalBookmark[],
) => {
  if (list.length === 0) delete data.bookmarks[videoId]
  else data.bookmarks[videoId] = list
}

const setLocalNote = (
  data: StudyData,
  videoId: string,
  note: LocalNote | undefined,
) => {
  if (note) data.notes[videoId] = note
  else delete data.notes[videoId]
}

const shownBookmarks = (data: StudyData, videoId: string) =>
  JSON.stringify(visibleBookmarks(data.bookmarks[videoId] ?? []))

export const getNote = async (videoId: string): Promise<string> => {
  const files = studyFiles()
  const data = await runExclusive(() => loadStudy(files))
  return data.notes[videoId]?.text ?? ""
}

export const setNote = async (videoId: string, text: string) => {
  await updateStudy(studyFiles(), (data) => {
    const current = data.notes[videoId]
    if (!current && text.trim().length === 0) return
    if (current?.text === text) return
    // A clear is kept as an empty text: its stamp orders it against edits
    // made on other devices.
    data.notes[videoId] = { text, updatedAt: nextStamp(current?.updatedAt), dirty: true }
  })
}

export const listBookmarks = async (
  videoId: string,
): Promise<MyVideoBookmark[]> => {
  const files = studyFiles()
  const data = await runExclusive(() => loadStudy(files))
  return visibleBookmarks(data.bookmarks[videoId] ?? [])
}

// A moment, or an A–B segment when `endSec` is set (whole seconds, end > start).
export const addBookmark = async (
  videoId: string,
  positionSec: number,
  endSec: number | null = null,
): Promise<MyVideoBookmark> => {
  const now = new Date().toISOString()
  const created: MyVideoBookmark = {
    id: randomUuid(),
    videoId,
    positionSec: Math.max(0, Math.round(positionSec)),
    endSec,
    label: "",
    note: "",
    drawing: null,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  }
  await updateStudy(studyFiles(), (data) => {
    setBookmarkList(data, videoId, [
      ...(data.bookmarks[videoId] ?? []),
      { ...created, dirty: true },
    ])
  })
  return created
}

/**
 * Keeps a drawing made on the frame at `positionSec` (whole seconds): on
 * `bookmarkId` (the bookmark whose drawing was being edited) while it lives,
 * else on the moment bookmark already at that second, else on a new one.
 * `created` tells the screen to open the new bookmark's name field, like
 * «+ закладка». A null drawing removes the one on that bookmark (null result:
 * nothing there).
 */
export const saveBookmarkDrawing = async (
  videoId: string,
  positionSec: number,
  drawing: BookmarkDrawing | null,
  bookmarkId: string | null = null,
): Promise<{ bookmark: MyVideoBookmark; created: boolean } | null> => {
  const second = Math.max(0, Math.round(positionSec))
  const now = new Date().toISOString()
  return await updateStudy(studyFiles(), (data) => {
    const list = data.bookmarks[videoId] ?? []
    const existing =
      list.find((b) => b.id === bookmarkId && !b.deleted) ??
      pointBookmarkAt(list, second)
    if (!existing && !drawing) return null
    const saved: LocalBookmark = existing
      ? {
          ...existing,
          drawing,
          dirty: true,
          updatedAt: nextStamp(existing.updatedAt),
        }
      : {
          id: randomUuid(),
          videoId,
          positionSec: second,
          endSec: null,
          label: "",
          note: "",
          drawing,
          deleted: false,
          createdAt: now,
          updatedAt: now,
          dirty: true,
        }
    setBookmarkList(
      data,
      videoId,
      existing
        ? list.map((b) => (b.id === saved.id ? saved : b))
        : [...list, saved],
    )
    const [bookmark] = visibleBookmarks([saved])
    return { bookmark, created: !existing }
  })
}

export const removeBookmark = async (videoId: string, bookmarkId: string) => {
  await updateStudy(studyFiles(), (data) => {
    const list = data.bookmarks[videoId] ?? []
    setBookmarkList(
      data,
      videoId,
      list.map((b) =>
        b.id === bookmarkId && !b.deleted
          ? { ...b, deleted: true, dirty: true, updatedAt: nextStamp(b.updatedAt) }
          : b,
      ),
    )
  })
}

export const updateBookmark = async (
  videoId: string,
  bookmarkId: string,
  patch: Partial<Pick<MyVideoBookmark, "label" | "note">>,
) => {
  await updateStudy(studyFiles(), (data) => {
    const list = data.bookmarks[videoId] ?? []
    setBookmarkList(
      data,
      videoId,
      list.map((b) => {
        if (b.id !== bookmarkId || b.deleted) return b
        const next = { ...b, ...patch }
        if (next.label === b.label && next.note === b.note) return b
        return { ...next, dirty: true, updatedAt: nextStamp(b.updatedAt) }
      }),
    )
  })
}

// The device's whole copy — the «Мои заметки» screen lays it over its cached
// list while offline.
export const readLocalStudy = (): Promise<StudyData> => {
  const files = studyFiles()
  return runExclusive(() => loadStudy(files))
}

type PushOutcome = {
  // false: stopped on a transient failure (offline / server down).
  ok: boolean
  // The server's answer changed what the screen shows.
  bookmarksChanged: boolean
  noteChanged: boolean
}

// Sends one lesson's dirty records. A 4xx leaves the record dirty (it is the
// member's data — never dropped) and moves on; a network failure stops here.
const pushVideo = async (
  videoId: string,
  files: StudyFiles,
): Promise<PushOutcome> => {
  const outcome: PushOutcome = {
    ok: true,
    bookmarksChanged: false,
    noteChanged: false,
  }
  const data = await runExclusive(() => loadStudy(files))
  const dirtyBookmarks = (data.bookmarks[videoId] ?? []).filter((b) => b.dirty)
  const dirtyNote = data.notes[videoId]?.dirty ? data.notes[videoId] : undefined

  for (const sent of dirtyBookmarks) {
    if (files.scope !== getProfileScopeId()) return { ...outcome, ok: false }
    try {
      // Edits and removals alike: a tombstone goes up as `deleted: true`.
      const stored = await putMyVideoBookmark({
        videoId,
        bookmarkId: sent.id,
        data: bookmarkPayload(sent),
      })
      const changed = await updateStudy(files, (d) => {
        const before = shownBookmarks(d, videoId)
        setBookmarkList(
          d,
          videoId,
          applyBookmarkPushed(d.bookmarks[videoId] ?? [], sent, stored),
        )
        return shownBookmarks(d, videoId) !== before
      })
      outcome.bookmarksChanged ||= changed
    } catch (err) {
      if (!isPermanentError(err)) return { ...outcome, ok: false }
    }
  }

  if (dirtyNote) {
    if (files.scope !== getProfileScopeId()) return { ...outcome, ok: false }
    try {
      const stored = await putMyVideoNote({ videoId, data: notePayload(dirtyNote) })
      const changed = await updateStudy(files, (d) => {
        const before = d.notes[videoId]?.text ?? ""
        setLocalNote(d, videoId, applyNotePushed(d.notes[videoId], dirtyNote, stored))
        return (d.notes[videoId]?.text ?? "") !== before
      })
      outcome.noteChanged ||= changed
    } catch (err) {
      if (!isPermanentError(err)) return { ...outcome, ok: false }
    }
  }
  return outcome
}

export type StudySyncResult = { bookmarksChanged: boolean; noteChanged: boolean }

const runVideoSync = async (videoId: string): Promise<StudySyncResult | null> => {
  const files = studyFiles()
  try {
    const pushed = await pushVideo(videoId, files)
    if (!pushed.ok || files.scope !== getProfileScopeId()) return null
    const [pulled, note] = await Promise.all([
      listMyVideoBookmarks({ videoId }),
      getMyVideoNote({ videoId }),
    ])
    if (files.scope !== getProfileScopeId()) return null
    const merged = await updateStudy(files, (d) => {
      const bookmarksBefore = shownBookmarks(d, videoId)
      const noteBefore = d.notes[videoId]?.text ?? ""
      setBookmarkList(
        d,
        videoId,
        mergePulledBookmarks(d.bookmarks[videoId] ?? [], pulled.items),
      )
      setLocalNote(d, videoId, mergePulledNote(d.notes[videoId], note))
      return {
        bookmarksChanged: shownBookmarks(d, videoId) !== bookmarksBefore,
        noteChanged: (d.notes[videoId]?.text ?? "") !== noteBefore,
      }
    })
    return {
      bookmarksChanged: pushed.bookmarksChanged || merged.bookmarksChanged,
      noteChanged: pushed.noteChanged || merged.noteChanged,
    }
  } catch {
    return null // offline / auth churn — stays dirty, retried next time
  }
}

// At most one sync per lesson runs, plus one queued behind it (which picks up
// every edit made meanwhile) — rapid triggers collapse into that one.
const syncTails = new Map<string, Promise<StudySyncResult | null>>()
const syncQueued = new Map<string, Promise<StudySyncResult | null>>()

/**
 * Push this lesson's unsynced edits, then pull and merge the server's copy.
 * Resolves with what the server changed on screen (reload those from the
 * store), or null when the sync didn't complete (e.g. offline).
 */
export const syncVideoStudy = (
  videoId: string,
): Promise<StudySyncResult | null> => {
  const key = `${getProfileScopeId() ?? ""}:${videoId}`
  const queued = syncQueued.get(key)
  if (queued) return queued
  const tail = syncTails.get(key) ?? Promise.resolve(null)
  const run = tail.then(() => {
    syncQueued.delete(key)
    return runVideoSync(videoId)
  })
  syncQueued.set(key, run)
  syncTails.set(key, run)
  void run.then(() => {
    if (syncTails.get(key) === run) syncTails.delete(key)
  })
  return run
}

let flushInFlight: Promise<void> | null = null

const runFlush = async (): Promise<void> => {
  const files = studyFiles()
  try {
    const data = await runExclusive(() => loadStudy(files))
    const videoIds = new Set([
      ...Object.keys(data.bookmarks).filter((id) =>
        data.bookmarks[id].some((b) => b.dirty),
      ),
      ...Object.keys(data.notes).filter((id) => data.notes[id].dirty),
    ])
    for (const videoId of videoIds) {
      const pushed = await pushVideo(videoId, files)
      if (!pushed.ok) return
    }
  } catch {
    /* offline — the records stay dirty */
  }
}

/**
 * Push every lesson's unsynced edits (no pull). Silent on failure. A call
 * while one runs waits for that one, so «Мои заметки» never lists before the
 * offline edits are up.
 */
export const flushStudyData = (): Promise<void> => {
  flushInFlight ??= runFlush().finally(() => {
    flushInFlight = null
  })
  return flushInFlight
}

/**
 * The overview carries each listed lesson's complete server copy: merge it in,
 * so those lessons' notes are on the device for offline study. `files` must be
 * captured before the request; if the profile changed since, nothing is merged
 * and this resolves false.
 */
export const mergeVideoNotesIntoStudy = async (
  files: StudyFiles,
  items: readonly MyVideoNotesItem[],
): Promise<boolean> => {
  if (files.scope !== getProfileScopeId()) return false
  await updateStudy(files, (data) => {
    for (const item of items) {
      const videoId = item.video.id
      setBookmarkList(
        data,
        videoId,
        mergePulledBookmarks(data.bookmarks[videoId] ?? [], item.bookmarks),
      )
      setLocalNote(
        data,
        videoId,
        mergePulledNote(data.notes[videoId], item.note ?? { text: "", updatedAt: null }),
      )
    }
  })
  return true
}

const readPinnedCourses = async (): Promise<string[]> => {
  await ensureRoot()
  const raw = await safeReadString(userFile("pinnedCourses"))
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
  await writeJson(userFile("pinnedCourses"), next)
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
