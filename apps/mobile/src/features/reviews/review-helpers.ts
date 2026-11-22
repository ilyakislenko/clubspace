import type {
  MyReviews,
  ReviewCard,
  ReviewGrade,
} from "../../shared/api/bookmark-reviews"
import { pluralRu } from "../../shared/format-ru"

// Grades made on this device: bookmark id → the grade's `reviewedAt` (ISO).
// A card stays hidden while the server's copy is older than its local grade
// (the grade may still sit in the outbox), so it never comes back for another
// round before the server has it.
export type LocalGrades = Record<string, string>

export const GRADES: readonly { grade: ReviewGrade; label: string }[] = [
  { grade: "again", label: "Снова" },
  { grade: "hard", label: "Трудно" },
  { grade: "good", label: "Хорошо" },
  { grade: "easy", label: "Легко" },
]

// The server's «again» step (review-scheduler AGAIN_DELAY_MINUTES): an
// interval of 0 days means due again this many minutes later.
const AGAIN_DELAY_MINUTES = 10
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

const gradedLocally = (card: ReviewCard, grades: LocalGrades): boolean => {
  const local = grades[card.bookmark.id]
  if (!local) return false
  const server = card.schedule.lastReviewedAt
  return server === null || Date.parse(local) > Date.parse(server)
}

/** The due list as this device sees it: cards graded here are gone. */
export const applyLocalGrades = (
  data: MyReviews,
  grades: LocalGrades,
): MyReviews => {
  const items = data.items.filter((card) => !gradedLocally(card, grades))
  const hidden = data.items.length - items.length
  return { ...data, items, dueCount: Math.max(0, data.dueCount - hidden) }
}

/**
 * Local grades still worth keeping after a fresh due list: only those the
 * server hasn't applied to a card it still lists. A card missing from the list
 * is no longer due — the grade reached the server, or the bookmark is gone.
 */
export const pruneLocalGrades = (
  grades: LocalGrades,
  items: readonly ReviewCard[],
): LocalGrades => {
  const kept: LocalGrades = {}
  for (const card of items) {
    if (gradedLocally(card, grades)) kept[card.bookmark.id] = grades[card.bookmark.id]
  }
  return kept
}

// How long a local grade hides its card with nothing pending in the outbox.
// The outbox drops a grade refused with a 4xx on replay without telling us;
// past this age such a stamp no longer hides the card.
export const LOCAL_GRADE_TTL_MS = DAY_MS

// A queued grade's outbox url → its bookmark id (see reviewMyBookmarkUrl).
const GRADE_URL = /\/my-bookmarks\/([^/]+)\/review$/

/** Bookmark ids with a grade still waiting in the outbox, from op urls. */
export const pendingGradeIds = (urls: readonly string[]): Set<string> => {
  const ids = new Set<string>()
  for (const url of urls) {
    const match = GRADE_URL.exec(url)
    if (match) ids.add(match[1])
  }
  return ids
}

/**
 * Local grades that still count: those with a grade pending in the outbox, or
 * younger than LOCAL_GRADE_TTL_MS (being sent right now, or just sent).
 */
export const liveLocalGrades = (
  grades: LocalGrades,
  pending: ReadonlySet<string>,
  now: number,
): LocalGrades => {
  const kept: LocalGrades = {}
  for (const [id, stamp] of Object.entries(grades)) {
    if (pending.has(id) || now - Date.parse(stamp) < LOCAL_GRADE_TTL_MS) {
      kept[id] = stamp
    }
  }
  return kept
}

/** When a card graded at `reviewedAt` with this interval comes due (ms). */
export const dueAfterGrade = (reviewedAt: number, intervalDays: number): number =>
  reviewedAt +
  (intervalDays === 0 ? AGAIN_DELAY_MINUTES * MINUTE_MS : intervalDays * DAY_MS)

/** A grade button's hint: «10 мин», «3 дня», «2 мес.», «1 год». */
export const formatInterval = (days: number): string => {
  if (days <= 0) return `${AGAIN_DELAY_MINUTES} мин`
  if (days < 30) return `${days} ${pluralRu(days, "день", "дня", "дней")}`
  if (days < 365) return `${Math.round(days / 30)} мес.`
  const years = Math.round(days / 365)
  return `${years} ${pluralRu(years, "год", "года", "лет")}`
}

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** «сегодня в 18:40», «завтра», «через 5 дней» — in the device's time zone. */
export const formatNextDue = (dueAt: number, now: number): string => {
  // Rounded: a DST switch makes one calendar day 23 or 25 hours long.
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY_MS)
  if (days <= 0) {
    if (dueAt <= now) return "сейчас"
    const d = new Date(dueAt)
    return `сегодня в ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  if (days === 1) return "завтра"
  return `через ${days} ${pluralRu(days, "день", "дня", "дней")}`
}
