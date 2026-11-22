import type {
  BookmarkDrawing,
  MyVideoBookmark,
  MyVideoNote,
  MyVideoNotesItem,
} from "../../shared/api/video-study"
import { randomUuid, UUID_RE } from "../../shared/uuid"

// Pure rules behind the offline-first sync of a member's lesson bookmarks and
// notes (preferences-store does the I/O). The device copy is what the UI
// shows; every local edit stamps `updatedAt` and sets `dirty` until the server
// has acknowledged it. Conflicts resolve last-write-wins on `updatedAt`, on
// the server as here:
//
// - a dirty local record is never overwritten by a pull — it is pushed, and the
//   server answers with whichever version won;
// - removing a bookmark is an edit too: a dirty tombstone (`deleted`) is PUT
//   like any change. Once the server has it, the server's tombstone is what
//   keeps an older copy from coming back, so the local one is dropped.
// - a cleared note is an empty text with its own `updatedAt`, so a clear and
//   an edit on two devices order like any other two edits.

export type LocalBookmark = Omit<MyVideoBookmark, "drawing"> & {
  // Absent on records saved by a build without drawings: shown as none and
  // not sent, so the server keeps whatever it has.
  drawing?: BookmarkDrawing | null
  // Edited (or removed) here and not yet acknowledged by the server.
  dirty: boolean
}

// `text: ""` = cleared (kept for its `updatedAt`).
export type LocalNote = { text: string; updatedAt: string; dirty: boolean }

export type BookmarksMap = Record<string, LocalBookmark[]>
export type NotesMap = Record<string, LocalNote>

// Server-side limits (PutMyVideoBookmarkInput / PutMyVideoNoteInput): a longer
// value would be refused forever, so it is cut to fit before sending.
const LABEL_MAX = 255
const BOOKMARK_NOTE_MAX = 5000
const NOTE_MAX = 20000

const time = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/** The bookmarks to show: live ones, by position. */
export const visibleBookmarks = (
  list: readonly LocalBookmark[],
): MyVideoBookmark[] =>
  list
    .filter((b) => !b.deleted)
    .map((b) => ({
      id: b.id,
      videoId: b.videoId,
      positionSec: b.positionSec,
      endSec: b.endSec,
      label: b.label,
      note: b.note,
      drawing: b.drawing ?? null,
      deleted: false,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }))
    .sort(
      (a, b) =>
        a.positionSec - b.positionSec || time(a.createdAt) - time(b.createdAt),
    )

const clean = (row: MyVideoBookmark): LocalBookmark => ({ ...row, dirty: false })

/**
 * Merge a pulled list (the server's complete set of live bookmarks for one
 * video) into the local one. Dirty records — edits and tombstones — are kept
 * as they are (their push settles the conflict); clean ones take the newer of
 * the two copies; clean records the server no longer lists were deleted
 * elsewhere and go.
 */
export const mergePulledBookmarks = (
  local: readonly LocalBookmark[],
  server: readonly MyVideoBookmark[],
): LocalBookmark[] => {
  const live = server.filter((row) => !row.deleted)
  const serverById = new Map(live.map((row) => [row.id, row]))
  const out: LocalBookmark[] = []
  const seen = new Set<string>()

  for (const mine of local) {
    seen.add(mine.id)
    if (mine.dirty) {
      out.push(mine)
      continue
    }
    const theirs = serverById.get(mine.id)
    if (mine.deleted || !theirs) continue
    out.push(time(mine.updatedAt) > time(theirs.updatedAt) ? mine : clean(theirs))
  }

  for (const row of live) {
    if (!seen.has(row.id)) out.push(clean(row))
  }
  return out
}

/**
 * Merge the pulled note into the local one. `updatedAt: null` = the server has
 * none at all; an empty text with a stamp is a clear, kept for ordering.
 */
export const mergePulledNote = (
  local: LocalNote | undefined,
  server: MyVideoNote,
): LocalNote | undefined => {
  if (local?.dirty) return local
  if (server.updatedAt === null) return undefined
  if (local && time(local.updatedAt) > time(server.updatedAt)) return local
  return { text: server.text, updatedAt: server.updatedAt, dirty: false }
}

/**
 * The server answered a PUT with the row it now stores (ours, or a newer one
 * that won — possibly a tombstone). Applied only if the record wasn't edited
 * again meanwhile; otherwise the newer local edit stays dirty for the next
 * push. A stored tombstone means the bookmark is gone for good here.
 */
export const applyBookmarkPushed = (
  list: readonly LocalBookmark[],
  sent: LocalBookmark,
  stored: MyVideoBookmark,
): LocalBookmark[] =>
  list.flatMap((b) => {
    if (b.id !== sent.id || b.updatedAt !== sent.updatedAt) return [b]
    return stored.deleted ? [] : [clean(stored)]
  })

/** Same idea for the note. */
export const applyNotePushed = (
  local: LocalNote | undefined,
  sent: LocalNote,
  stored: MyVideoNote,
): LocalNote | undefined => {
  if (!local || local.updatedAt !== sent.updatedAt) return local
  if (stored.updatedAt === null) return undefined
  return { text: stored.text, updatedAt: stored.updatedAt, dirty: false }
}

export const bookmarkPayload = (b: LocalBookmark) => ({
  positionSec: Math.max(0, Math.round(b.positionSec)),
  endSec: b.endSec,
  label: b.label.slice(0, LABEL_MAX),
  note: b.note.slice(0, BOOKMARK_NOTE_MAX),
  ...(b.drawing !== undefined && { drawing: b.drawing }),
  deleted: b.deleted,
  updatedAt: b.updatedAt,
})

export const notePayload = (n: LocalNote) => ({
  text: n.text.trim().length === 0 ? "" : n.text.slice(0, NOTE_MAX),
  updatedAt: n.updatedAt,
})

/** A segment's whole seconds: the start rounds down, the end up and after it. */
export const segmentBounds = (
  a: number,
  b: number,
): { positionSec: number; endSec: number } => {
  const positionSec = Math.max(0, Math.floor(Math.min(a, b)))
  const endSec = Math.max(positionSec + 1, Math.ceil(Math.max(a, b)))
  return { positionSec, endSec }
}

/**
 * The live moment bookmark (not a segment) at whole second `positionSec`, which
 * a drawing saved there attaches to instead of adding a second bookmark.
 */
export const pointBookmarkAt = <B extends Omit<LocalBookmark, "dirty">>(
  list: readonly B[],
  positionSec: number,
): B | undefined =>
  list.find((b) => !b.deleted && b.endSec === null && b.positionSec === positionSec)

// ---- One-time migration of the pre-sync files ----
//
// Before sync, bookmarks were `{ id: "<ms>-<rand>", position, label, note?,
// createdAt }` and notes `{ text, updatedAt }`, none of them with `dirty`. A
// record without a boolean `dirty` is such a leftover: it gets a uuid (the
// server keys rows by client uuids), `updatedAt = createdAt`, and `dirty` so
// the first sync uploads it. Nothing readable is dropped.

type LegacyBookmark = {
  id?: unknown
  position?: unknown
  positionSec?: unknown
  endSec?: unknown
  label?: unknown
  note?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  dirty?: unknown
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const str = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v : fallback

const migrateBookmark = (
  raw: LegacyBookmark,
  videoId: string,
  newId: () => string,
  nowIso: string,
): LocalBookmark => {
  const position = Number(raw.positionSec ?? raw.position)
  const positionSec = Number.isFinite(position)
    ? Math.max(0, Math.round(position))
    : 0
  const end = Number(raw.endSec)
  const createdAt = str(raw.createdAt, nowIso)
  return {
    id: typeof raw.id === "string" && UUID_RE.test(raw.id) ? raw.id : newId(),
    videoId,
    positionSec,
    endSec:
      raw.endSec != null && Number.isFinite(end) && Math.round(end) > positionSec
        ? Math.round(end)
        : null,
    label: str(raw.label, ""),
    note: str(raw.note, ""),
    drawing: null,
    createdAt,
    updatedAt: str(raw.updatedAt, createdAt),
    deleted: false,
    dirty: true,
  }
}

export const migrateStudyData = (
  rawBookmarks: unknown,
  rawNotes: unknown,
  newId: () => string = randomUuid,
  nowIso: string = new Date().toISOString(),
): { bookmarks: BookmarksMap; notes: NotesMap; changed: boolean } => {
  let changed = false
  const bookmarks: BookmarksMap = {}
  if (isRecord(rawBookmarks)) {
    for (const [videoId, list] of Object.entries(rawBookmarks)) {
      if (!Array.isArray(list)) continue
      const out: LocalBookmark[] = []
      for (const raw of list) {
        if (!isRecord(raw)) continue
        if (typeof raw.dirty === "boolean") {
          // Already in the sync format (`deleted` may be absent on early copies).
          out.push({ ...(raw as unknown as LocalBookmark), deleted: raw.deleted === true })
        } else {
          out.push(migrateBookmark(raw, videoId, newId, nowIso))
          changed = true
        }
      }
      if (out.length > 0) bookmarks[videoId] = out
    }
  }
  const notes: NotesMap = {}
  if (isRecord(rawNotes)) {
    for (const [videoId, raw] of Object.entries(rawNotes)) {
      if (!isRecord(raw) || typeof raw.text !== "string") continue
      if (typeof raw.dirty === "boolean") {
        notes[videoId] = raw as unknown as LocalNote // already in the sync format
        continue
      }
      changed = true
      if (raw.text.trim().length === 0) continue
      notes[videoId] = {
        text: raw.text,
        updatedAt: str(raw.updatedAt, nowIso),
        dirty: true,
      }
    }
  }
  return { bookmarks, notes, changed }
}

// ---- «Мои заметки» overview ----

const matches = (haystack: string, q: string) =>
  haystack.toLowerCase().includes(q)

/** The server's search, for the cached list while offline. */
export const filterVideoNotes = (
  items: readonly MyVideoNotesItem[],
  query: string,
): MyVideoNotesItem[] => {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter(
    (item) =>
      matches(item.video.title, q) ||
      (item.note !== null && matches(item.note.text, q)) ||
      item.bookmarks.some((b) => matches(b.label, q) || matches(b.note, q)),
  )
}

/**
 * Lay the device's own (possibly newer, unsynced) copy over a cached overview,
 * so notes written offline show up there too. A video the device has no
 * record of keeps its cached data; one left with neither note nor bookmarks
 * drops out, as it would from the server's list.
 */
export const overlayLocalStudy = (
  items: readonly MyVideoNotesItem[],
  bookmarks: BookmarksMap,
  notes: NotesMap,
): MyVideoNotesItem[] =>
  items
    .map((item) => {
      const localList = bookmarks[item.video.id]
      const localNote = notes[item.video.id]
      return {
        ...item,
        bookmarks: localList ? visibleBookmarks(localList) : item.bookmarks,
        note: localNote
          ? localNote.text.trim().length > 0
            ? { text: localNote.text, updatedAt: localNote.updatedAt }
            : null
          : item.note,
      }
    })
    .filter((item) => item.note !== null || item.bookmarks.length > 0)
