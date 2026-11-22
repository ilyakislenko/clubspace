import type { MyReviews, ReviewCard } from "../../shared/api/bookmark-reviews"
import {
  applyLocalGrades,
  dueAfterGrade,
  formatInterval,
  formatNextDue,
  LOCAL_GRADE_TTL_MS,
  liveLocalGrades,
  pendingGradeIds,
  pruneLocalGrades,
} from "./review-helpers"

const T = (iso: string) => `2026-03-10T${iso}:00.000Z`

const card = (id: string, lastReviewedAt: string | null): ReviewCard => ({
  bookmark: {
    id,
    videoId: "v1",
    positionSec: 10,
    endSec: null,
    label: "",
    note: "",
    createdAt: T("00:00"),
    updatedAt: T("00:00"),
    deleted: false,
  },
  video: { id: "v1", title: "Lesson", thumbnailUrl: null, duration: 100 },
  course: null,
  schedule: {
    bookmarkId: id,
    dueAt: T("08:00"),
    intervalDays: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    lastReviewedAt,
  },
  nextIntervals: { again: 0, hard: 1, good: 2, easy: 4 },
})

const list = (items: ReviewCard[], dueCount = items.length): MyReviews => ({
  items,
  dueCount,
  upcomingCount: 0,
  nextDueAt: null,
  totalCount: items.length,
})

describe("applyLocalGrades", () => {
  it("hides cards graded here after the server's last grade", () => {
    const data = list(
      [card("new", null), card("old", T("06:00")), card("fresh", T("10:00")), card("untouched", null)],
      40,
    )
    const view = applyLocalGrades(data, {
      new: T("09:00"),
      old: T("09:00"),
      // The server already has a newer grade: the local one is spent.
      fresh: T("09:00"),
    })
    expect(view.items.map((c) => c.bookmark.id)).toEqual(["fresh", "untouched"])
    expect(view.dueCount).toBe(38)
  })

  it("never counts below zero", () => {
    expect(applyLocalGrades(list([card("a", null)], 0), { a: T("09:00") }).dueCount).toBe(0)
  })
})

describe("pruneLocalGrades", () => {
  it("keeps only grades the server hasn't applied to a card it still lists", () => {
    const grades = { pending: T("09:00"), applied: T("09:00"), gone: T("09:00") }
    expect(
      pruneLocalGrades(grades, [card("pending", T("06:00")), card("applied", T("09:00"))]),
    ).toEqual({ pending: T("09:00") })
  })
})

describe("pendingGradeIds", () => {
  it("takes bookmark ids from queued grade urls only", () => {
    expect(
      pendingGradeIds([
        "/videos/v1/my-bookmarks/b1/review",
        "/videos/v1/progress",
        "/videos/v2/my-bookmarks/b2/review",
      ]),
    ).toEqual(new Set(["b1", "b2"]))
  })
})

describe("liveLocalGrades", () => {
  const graded = Date.parse(T("09:00"))
  const grades = { queued: T("09:00"), sent: T("09:00") }

  it("keeps grades younger than the TTL, pending or not", () => {
    expect(liveLocalGrades(grades, new Set(), graded + LOCAL_GRADE_TTL_MS - 1)).toEqual(grades)
  })

  it("past the TTL keeps only grades still pending in the outbox", () => {
    expect(liveLocalGrades(grades, new Set(["queued"]), graded + LOCAL_GRADE_TTL_MS)).toEqual({
      queued: T("09:00"),
    })
  })
})

describe("dueAfterGrade", () => {
  it("puts «again» ten minutes out and other grades whole days out", () => {
    const at = Date.parse(T("09:00"))
    expect(dueAfterGrade(at, 0)).toBe(Date.parse(T("09:10")))
    expect(dueAfterGrade(at, 2)).toBe(Date.parse("2026-03-12T09:00:00.000Z"))
  })
})

describe("formatInterval", () => {
  it.each([
    [0, "10 мин"],
    [1, "1 день"],
    [3, "3 дня"],
    [25, "25 дней"],
    [45, "2 мес."],
    [365, "1 год"],
  ])("%i → %s", (days, text) => {
    expect(formatInterval(days)).toBe(text)
  })
})

describe("formatNextDue", () => {
  // Local-time anchors so the spec holds in any time zone.
  const now = new Date(2026, 2, 10, 9, 0).getTime()
  it.each([
    [new Date(2026, 2, 10, 8, 0).getTime(), "сейчас"],
    [new Date(2026, 2, 10, 18, 5).getTime(), "сегодня в 18:05"],
    [new Date(2026, 2, 11, 7, 0).getTime(), "завтра"],
    [new Date(2026, 2, 15, 7, 0).getTime(), "через 5 дней"],
    [new Date(2026, 2, 12, 23, 0).getTime(), "через 2 дня"],
  ])("%i → %s", (due, text) => {
    expect(formatNextDue(due, now)).toBe(text)
  })
})
