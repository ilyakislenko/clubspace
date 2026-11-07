/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs, which is the standard jest ordering. */
// What happens to a grade: kept locally at once, sent straight away, queued in
// the outbox when offline, forgotten when the server refuses it — and how a
// fresh due list prunes the local grades.

const files = new Map<string, unknown>()
jest.mock("../../shared/cache/resource-cache", () => ({
  readResource: jest.fn(async (key: string) =>
    files.has(key) ? { data: files.get(key), savedAt: 0 } : null,
  ),
  writeResource: jest.fn(async (key: string, data: unknown) => {
    files.set(key, data)
  }),
}))

const listMyReviews = jest.fn()
const reviewMyBookmark = jest.fn()
jest.mock("../../shared/api/bookmark-reviews", () => ({
  listMyReviews: (...args: unknown[]) => listMyReviews(...args),
  reviewMyBookmark: (...args: unknown[]) => reviewMyBookmark(...args),
  reviewMyBookmarkUrl: (videoId: string, bookmarkId: string) =>
    `/videos/${videoId}/my-bookmarks/${bookmarkId}/review`,
}))

const enqueue = jest.fn(async (_op: unknown) => undefined)
const flushOutbox = jest.fn(async () => undefined)
const pendingOps = jest.fn(async (): Promise<{ url: string }[]> => [])
jest.mock("../../shared/outbox/outbox", () => ({
  enqueue: (op: unknown) => enqueue(op),
  flushOutbox: () => flushOutbox(),
  pendingOps: () => pendingOps(),
  isPermanentError: (err: { response?: { status?: number } }) => {
    const status = err?.response?.status
    return typeof status === "number" && status >= 400 && status < 500
  },
}))

import type { ReviewCard } from "../../shared/api/bookmark-reviews"
import { fetchMyReviews, gradeCard, readLocalGrades } from "./review-store"

const AT = new Date("2026-03-10T09:00:00.000Z")
const NOW = AT.getTime()

const card = (id: string, lastReviewedAt: string | null = null) =>
  ({
    bookmark: { id },
    video: { id: "v1" },
    schedule: { lastReviewedAt },
  }) as ReviewCard

// Lets the background send (and its catch handlers) settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  files.clear()
  jest.clearAllMocks()
})

describe("gradeCard", () => {
  it("remembers the grade locally and sends it", async () => {
    reviewMyBookmark.mockResolvedValue({})
    const grades = await gradeCard("w1", card("b1"), "good", AT)
    expect(grades).toEqual({ b1: AT.toISOString() })
    expect(await readLocalGrades("w1", NOW)).toEqual({ b1: AT.toISOString() })
    await settle()
    expect(reviewMyBookmark).toHaveBeenCalledWith({
      videoId: "v1",
      bookmarkId: "b1",
      data: { grade: "good", reviewedAt: AT.toISOString() },
    })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("queues the grade in the outbox when the request fails offline", async () => {
    reviewMyBookmark.mockRejectedValue(new Error("Network Error"))
    await gradeCard("w1", card("b1"), "again", AT)
    await settle()
    expect(enqueue).toHaveBeenCalledWith({
      label: "Повторение",
      method: "post",
      url: "/videos/v1/my-bookmarks/b1/review",
      data: { grade: "again", reviewedAt: AT.toISOString() },
    })
    expect(await readLocalGrades("w1", NOW)).toEqual({ b1: AT.toISOString() })
  })

  it("forgets a grade the server refused (the card comes back)", async () => {
    reviewMyBookmark.mockRejectedValue({ response: { status: 400 } })
    await gradeCard("w1", card("b1"), "easy", AT)
    await settle()
    expect(enqueue).not.toHaveBeenCalled()
    expect(await readLocalGrades("w1", NOW)).toEqual({})
  })

  it("keeps other cards' grades apart, per club", async () => {
    reviewMyBookmark.mockResolvedValue({})
    await gradeCard("w1", card("a"), "good", AT)
    await gradeCard("w1", card("b"), "hard", AT)
    await gradeCard("w2", card("c"), "hard", AT)
    expect(Object.keys(await readLocalGrades("w1", NOW))).toEqual(["a", "b"])
    expect(Object.keys(await readLocalGrades("w2", NOW))).toEqual(["c"])
  })

  it("stops hiding a day-old grade the outbox no longer holds (dropped on replay)", async () => {
    reviewMyBookmark.mockRejectedValue(new Error("Network Error"))
    await gradeCard("w1", card("dropped"), "good", AT)
    await gradeCard("w1", card("queued"), "good", AT)
    await settle()
    pendingOps.mockResolvedValue([{ url: "/videos/v1/my-bookmarks/queued/review" }])
    const dayLater = NOW + 24 * 60 * 60 * 1000
    expect(await readLocalGrades("w1", dayLater)).toEqual({ queued: AT.toISOString() })
  })
})

describe("fetchMyReviews", () => {
  it("flushes queued grades first, then prunes the ones the server applied", async () => {
    const order: string[] = []
    flushOutbox.mockImplementation(async () => {
      order.push("flush")
    })
    const fresh = {
      items: [card("pending", "2026-03-09T09:00:00.000Z"), card("other")],
      dueCount: 2,
      upcomingCount: 0,
      nextDueAt: null,
      totalCount: 3,
    }
    listMyReviews.mockImplementation(async () => {
      order.push("list")
      return fresh
    })
    reviewMyBookmark.mockResolvedValue({})
    await gradeCard("w1", card("pending"), "good", AT)
    await gradeCard("w1", card("applied"), "good", AT)

    expect(await fetchMyReviews("w1")).toBe(fresh)
    expect(order).toEqual(["flush", "list"])
    expect(listMyReviews).toHaveBeenCalledWith({ workspaceId: "w1" })
    expect(await readLocalGrades("w1", NOW)).toEqual({ pending: AT.toISOString() })
  })
})
