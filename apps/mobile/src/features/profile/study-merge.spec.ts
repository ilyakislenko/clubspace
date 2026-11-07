import type { MyVideoNotesItem } from "../../shared/api/video-study"
import { UUID_RE } from "../../shared/uuid"
import {
  applyBookmarkPushed,
  applyNotePushed,
  bookmarkPayload,
  filterVideoNotes,
  type LocalBookmark,
  mergePulledBookmarks,
  mergePulledNote,
  migrateStudyData,
  overlayLocalStudy,
  segmentBounds,
  visibleBookmarks,
} from "./study-merge"

const T = (min: number) => new Date(Date.UTC(2026, 10, 1, 10, min)).toISOString()

const row = (id: string, updatedMin: number, extra: Partial<LocalBookmark> = {}) => ({
  id,
  videoId: "v1",
  positionSec: 10,
  endSec: null,
  label: `label-${updatedMin}`,
  note: "",
  deleted: false,
  createdAt: T(0),
  updatedAt: T(updatedMin),
  ...extra,
})
const local = (
  id: string,
  updatedMin: number,
  extra: Partial<LocalBookmark> = {},
): LocalBookmark => ({ ...row(id, updatedMin), dirty: false, ...extra })

describe("mergePulledBookmarks", () => {
  it("takes a newer server copy over a clean local one", () => {
    const merged = mergePulledBookmarks([local("a", 1)], [row("a", 5)])
    expect(merged).toEqual([{ ...row("a", 5), dirty: false }])
  })

  it("keeps a clean local copy that is newer than the server's", () => {
    const mine = local("a", 9)
    expect(mergePulledBookmarks([mine], [row("a", 5)])).toEqual([mine])
  })

  it("never overwrites a dirty local edit, even with a newer server copy", () => {
    const mine = local("a", 1, { dirty: true, label: "offline edit" })
    expect(mergePulledBookmarks([mine], [row("a", 5)])).toEqual([mine])
  })

  it("keeps a dirty bookmark the server hasn't seen yet", () => {
    const mine = local("new", 3, { dirty: true })
    expect(mergePulledBookmarks([mine], [])).toEqual([mine])
  })

  it("drops a clean bookmark the server no longer lists (deleted elsewhere)", () => {
    expect(mergePulledBookmarks([local("a", 1)], [])).toEqual([])
  })

  it("adds bookmarks made on another device, never server tombstones", () => {
    expect(
      mergePulledBookmarks([], [row("b", 2), row("gone", 3, { deleted: true })]),
    ).toEqual([{ ...row("b", 2), dirty: false }])
  })

  it("keeps an unpushed tombstone over any pulled copy until its push settles it", () => {
    const tomb = local("a", 4, { deleted: true, dirty: true })
    expect(mergePulledBookmarks([tomb], [row("a", 2)])).toEqual([tomb])
    expect(mergePulledBookmarks([tomb], [row("a", 6)])).toEqual([tomb])
  })

  it("forgets an acknowledged tombstone — the server's own keeps it dead", () => {
    const tomb = local("a", 4, { deleted: true, dirty: false })
    expect(mergePulledBookmarks([tomb], [])).toEqual([])
  })
})

describe("mergePulledNote", () => {
  it("takes a newer server note", () => {
    expect(
      mergePulledNote(
        { text: "old", updatedAt: T(1), dirty: false },
        { text: "new", updatedAt: T(5) },
      ),
    ).toEqual({ text: "new", updatedAt: T(5), dirty: false })
  })

  it("keeps a dirty local note whatever the server says", () => {
    const mine = { text: "gym floor", updatedAt: T(1), dirty: true }
    expect(mergePulledNote(mine, { text: "x", updatedAt: T(9) })).toBe(mine)
    expect(mergePulledNote(mine, { text: "", updatedAt: null })).toBe(mine)
  })

  it("takes a newer clear from another device, keeping its stamp", () => {
    expect(
      mergePulledNote(
        { text: "x", updatedAt: T(1), dirty: false },
        { text: "", updatedAt: T(3) },
      ),
    ).toEqual({ text: "", updatedAt: T(3), dirty: false })
  })

  it("drops a clean note when the server has none at all", () => {
    expect(
      mergePulledNote(
        { text: "x", updatedAt: T(1), dirty: false },
        { text: "", updatedAt: null },
      ),
    ).toBeUndefined()
  })

  it("keeps a clean local note newer than the server's", () => {
    const mine = { text: "mine", updatedAt: T(9), dirty: false }
    expect(mergePulledNote(mine, { text: "theirs", updatedAt: T(2) })).toBe(mine)
  })
})

describe("push results", () => {
  it("cleans a pushed bookmark with the stored row (a newer server row wins)", () => {
    const sent = local("a", 1, { dirty: true })
    expect(applyBookmarkPushed([sent], sent, row("a", 7))).toEqual([
      { ...row("a", 7), dirty: false },
    ])
  })

  it("keeps a bookmark dirty when it was edited again during the push", () => {
    const sent = local("a", 1, { dirty: true })
    const edited = { ...sent, label: "again", updatedAt: T(2) }
    expect(applyBookmarkPushed([edited], sent, row("a", 1))).toEqual([edited])
  })

  it("leaves everything dirty when a push never happened (failed)", () => {
    const pending = local("a", 1, { dirty: true })
    // A failed push applies nothing; the next pull must still keep it.
    expect(mergePulledBookmarks([pending], [])).toEqual([pending])
  })

  it("sends a tombstone as a PUT with deleted and drops it once stored", () => {
    const tomb = local("a", 3, { deleted: true, dirty: true })
    expect(bookmarkPayload(tomb)).toMatchObject({ deleted: true, updatedAt: T(3) })
    expect(applyBookmarkPushed([tomb], tomb, row("a", 3, { deleted: true }))).toEqual([])
  })

  it("drops a local edit that lost to a newer tombstone on the server", () => {
    const sent = local("a", 1, { dirty: true })
    expect(applyBookmarkPushed([sent], sent, row("a", 5, { deleted: true }))).toEqual([])
  })

  it("brings a removed bookmark back when the server holds a newer edit", () => {
    const tomb = local("a", 2, { deleted: true, dirty: true })
    expect(applyBookmarkPushed([tomb], tomb, row("a", 6))).toEqual([
      { ...row("a", 6), dirty: false },
    ])
  })

  it("applies the stored note, keeping a stored clear's stamp", () => {
    const sent = { text: "x", updatedAt: T(1), dirty: true }
    expect(applyNotePushed(sent, sent, { text: "y", updatedAt: T(4) })).toEqual({
      text: "y",
      updatedAt: T(4),
      dirty: false,
    })
    const cleared = { text: "", updatedAt: T(2), dirty: true }
    expect(applyNotePushed(cleared, cleared, { text: "", updatedAt: T(2) })).toEqual({
      text: "",
      updatedAt: T(2),
      dirty: false,
    })
    const retyped = { text: "xy", updatedAt: T(2), dirty: true }
    expect(applyNotePushed(retyped, sent, { text: "x", updatedAt: T(1) })).toBe(
      retyped,
    )
  })
})

describe("migrateStudyData", () => {
  const legacyBookmarks = {
    v1: [
      { id: "1730000000-abc123", position: 72.4, label: "guard pass", createdAt: T(0) },
      { id: "1730000001-def456", position: 5, label: "", note: "hips", createdAt: T(1) },
    ],
  }
  const legacyNotes = {
    v1: { text: "drill this", updatedAt: T(2) },
    v2: { text: "   ", updatedAt: T(3) },
  }

  it("gives legacy bookmarks uuids, updatedAt = createdAt and marks them dirty", () => {
    const { bookmarks, changed } = migrateStudyData(legacyBookmarks, {}, undefined, T(30))
    expect(changed).toBe(true)
    expect(bookmarks.v1).toHaveLength(2)
    const [first, second] = bookmarks.v1
    expect(first.id).toMatch(UUID_RE)
    expect(second.id).toMatch(UUID_RE)
    expect(first.id).not.toBe(second.id)
    expect(first).toMatchObject({
      videoId: "v1",
      positionSec: 72,
      endSec: null,
      label: "guard pass",
      note: "",
      createdAt: T(0),
      updatedAt: T(0),
      dirty: true,
    })
    expect(second).toMatchObject({ positionSec: 5, note: "hips", updatedAt: T(1) })
  })

  it("marks legacy notes dirty and drops blank ones", () => {
    const { notes } = migrateStudyData({}, legacyNotes)
    expect(notes).toEqual({ v1: { text: "drill this", updatedAt: T(2), dirty: true } })
  })

  it("is a no-op on data already in the sync format", () => {
    const once = migrateStudyData(legacyBookmarks, legacyNotes)
    const twice = migrateStudyData(once.bookmarks, once.notes)
    expect(twice.changed).toBe(false)
    expect(twice.bookmarks).toEqual(once.bookmarks)
    expect(twice.notes).toEqual(once.notes)
  })

  it("survives missing or corrupt files", () => {
    expect(migrateStudyData(null, "nope")).toEqual({
      bookmarks: {},
      notes: {},
      changed: false,
    })
  })
})

describe("segmentBounds", () => {
  it("rounds the start down and the end up, keeping end after start", () => {
    expect(segmentBounds(72.6, 85.2)).toEqual({ positionSec: 72, endSec: 86 })
    expect(segmentBounds(10.2, 10.4)).toEqual({ positionSec: 10, endSec: 11 })
  })
})

describe("overview helpers", () => {
  const item = (id: string, title: string, note: string | null): MyVideoNotesItem => ({
    video: { id, title, thumbnailUrl: null, duration: null },
    course: null,
    note: note === null ? null : { text: note, updatedAt: T(1) },
    bookmarks: [{ ...row("b-" + id, 1), videoId: id, label: "Kimura" }],
  })

  it("searches titles, notes and bookmark labels like the server", () => {
    const items = [item("v1", "Guard", "hips"), item("v2", "Pass", null)]
    expect(filterVideoNotes(items, "HIPS").map((i) => i.video.id)).toEqual(["v1"])
    expect(filterVideoNotes(items, "kimura")).toHaveLength(2)
    expect(filterVideoNotes(items, " ")).toHaveLength(2)
  })

  it("lays local edits over the cached overview", () => {
    const items = [item("v1", "Guard", "old"), item("v2", "Pass", null)]
    const overlaid = overlayLocalStudy(
      items,
      { v2: [local("b-v2", 3, { videoId: "v2", deleted: true, dirty: true })] },
      { v1: { text: "fresh offline", updatedAt: T(5), dirty: true } },
    )
    expect(overlaid).toHaveLength(1) // v2 lost its only bookmark
    expect(overlaid[0].note?.text).toBe("fresh offline")
  })

  it("shows live bookmarks only, by position", () => {
    const list = [
      local("b", 1, { positionSec: 30 }),
      local("a", 1, { positionSec: 5 }),
      local("gone", 1, { deleted: true }),
    ]
    expect(visibleBookmarks(list).map((b) => b.id)).toEqual(["a", "b"])
  })
})
