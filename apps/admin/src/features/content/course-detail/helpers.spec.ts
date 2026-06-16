import { type CoursePlaylistDetail } from "../../../shared/api/playlists"
import {
  buildGroups,
  chapterDragId,
  chapterIdFromDragId,
  formatDuration,
  isChapterDragId,
} from "./helpers"

const makeCourse = (
  videos: Array<{ id: string; chapterId: string | null; order: number }>,
  chapters: Array<{ id: string; order: number; title: string }>,
): CoursePlaylistDetail =>
  ({ videos, chapters }) as unknown as CoursePlaylistDetail

describe("buildGroups", () => {
  it("puts the ungrouped pseudo-chapter first, then chapters in order", () => {
    const groups = buildGroups(
      makeCourse(
        [{ id: "v1", chapterId: null, order: 0 }],
        [
          { id: "c2", order: 1, title: "B" },
          { id: "c1", order: 0, title: "A" },
        ],
      ),
    )
    expect(groups.map((g) => g.chapter?.id ?? null)).toEqual([null, "c1", "c2"])
  })

  it("groups videos under their chapter and sorts each group by order", () => {
    const groups = buildGroups(
      makeCourse(
        [
          { id: "v2", chapterId: "c1", order: 1 },
          { id: "v1", chapterId: "c1", order: 0 },
          { id: "u2", chapterId: null, order: 1 },
          { id: "u1", chapterId: null, order: 0 },
        ],
        [{ id: "c1", order: 0, title: "A" }],
      ),
    )
    const [ungrouped, c1] = groups
    expect(ungrouped.videos.map((v) => v.id)).toEqual(["u1", "u2"])
    expect(c1.videos.map((v) => v.id)).toEqual(["v1", "v2"])
  })

  it("always renders the ungrouped group, even with no loose videos", () => {
    const groups = buildGroups(
      makeCourse(
        [{ id: "v1", chapterId: "c1", order: 0 }],
        [{ id: "c1", order: 0, title: "A" }],
      ),
    )
    expect(groups[0].chapter).toBeNull()
    expect(groups[0].videos).toEqual([])
  })
})

describe("chapter drag-id helpers", () => {
  it("round-trips a real chapter id", () => {
    expect(chapterDragId("c1")).toBe("chapter:c1")
    expect(chapterIdFromDragId(chapterDragId("c1"))).toBe("c1")
  })

  it("maps the ungrouped pseudo-chapter to/from null", () => {
    expect(chapterDragId(null)).toBe("chapter:none")
    expect(chapterIdFromDragId("chapter:none")).toBeNull()
  })

  it("distinguishes chapter drag ids from video ids", () => {
    expect(isChapterDragId("chapter:c1")).toBe(true)
    expect(isChapterDragId("chapter:none")).toBe(true)
    expect(isChapterDragId("v1")).toBe(false)
  })
})

describe("formatDuration", () => {
  it("returns null for missing or zero duration", () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(0)).toBeNull()
  })

  it("formats seconds as m:ss", () => {
    expect(formatDuration(5)).toBe("0:05")
    expect(formatDuration(65)).toBe("1:05")
    expect(formatDuration(600)).toBe("10:00")
  })
})
