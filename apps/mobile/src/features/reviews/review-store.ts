import {
  listMyReviews,
  type MyReviews,
  type ReviewCard,
  type ReviewGrade,
  reviewMyBookmark,
  reviewMyBookmarkUrl,
} from "../../shared/api/bookmark-reviews"
import { readResource, writeResource } from "../../shared/cache/resource-cache"
import {
  enqueue,
  flushOutbox,
  isPermanentError,
  pendingOps,
} from "../../shared/outbox/outbox"
import {
  type LocalGrades,
  liveLocalGrades,
  pendingGradeIds,
  pruneLocalGrades,
} from "./review-helpers"

// «Повторение», offline-first. The due list is a cached resource (Home and the
// review screen share the key); grades are stamped with the device clock,
// remembered locally (so a graded card never shows again before the server
// has it) and sent — straight away, or through the outbox when offline, which
// useNetworkReconnect flushes on reconnect. Both files live in the
// per-profile resource cache, wiped on sign-out.

export const reviewsCacheKey = (workspaceId: string) => `my-reviews:${workspaceId}`
const gradesKey = (workspaceId: string) => `my-reviews-graded:${workspaceId}`

const readStoredGrades = async (workspaceId: string): Promise<LocalGrades> =>
  (await readResource<LocalGrades>(gradesKey(workspaceId)))?.data ?? {}

/**
 * The local grades that still hide their cards: pending in the outbox, or
 * recent (see liveLocalGrades) — a grade the outbox dropped with a 4xx on
 * replay stops hiding its card once its stamp is old.
 */
export const readLocalGrades = async (
  workspaceId: string,
  now: number = Date.now(),
): Promise<LocalGrades> => {
  const pending = pendingGradeIds((await pendingOps()).map((op) => op.url))
  return liveLocalGrades(await readStoredGrades(workspaceId), pending, now)
}

// Read-modify-writes of the grades file run one at a time.
let gradesQueue: Promise<unknown> = Promise.resolve()
const updateLocalGrades = (
  workspaceId: string,
  change: (grades: LocalGrades) => LocalGrades,
): Promise<LocalGrades> => {
  const run = gradesQueue.then(async () => {
    const next = change(await readStoredGrades(workspaceId))
    await writeResource(gradesKey(workspaceId), next)
    return next
  })
  gradesQueue = run.catch(() => undefined)
  return run
}

/**
 * The fresh due list. Sends grades queued offline first, so the counts
 * include them, and forgets local grades the server has caught up with.
 */
export const fetchMyReviews = async (workspaceId: string): Promise<MyReviews> => {
  await flushOutbox()
  const fresh = await listMyReviews({ workspaceId })
  await updateLocalGrades(workspaceId, (grades) =>
    pruneLocalGrades(grades, fresh.items),
  )
  return fresh
}

/**
 * Grade a card: remembered locally at once (resolves with the updated local
 * grades), then sent in the background — a network failure / 5xx queues it
 * in the outbox. A 4xx is final and the local grade goes too (a deleted
 * bookmark drops out of the next list anyway; any other card comes back).
 */
export const gradeCard = async (
  workspaceId: string,
  card: ReviewCard,
  grade: ReviewGrade,
  reviewedAt: Date = new Date(),
): Promise<LocalGrades> => {
  const stamp = reviewedAt.toISOString()
  const grades = await updateLocalGrades(workspaceId, (prev) => ({
    ...prev,
    [card.bookmark.id]: stamp,
  }))
  const data = { grade, reviewedAt: stamp }
  void reviewMyBookmark({
    videoId: card.video.id,
    bookmarkId: card.bookmark.id,
    data,
  })
    .catch(async (err: unknown) => {
      if (isPermanentError(err)) {
        await updateLocalGrades(workspaceId, (prev) => {
          if (prev[card.bookmark.id] !== stamp) return prev
          const { [card.bookmark.id]: _refused, ...rest } = prev
          return rest
        })
        return
      }
      await enqueue({
        label: "Повторение",
        method: "post",
        url: reviewMyBookmarkUrl(card.video.id, card.bookmark.id),
        data,
      })
    })
    .catch(() => {
      /* the outbox couldn't persist — the card is still hidden locally */
    })
  return grades
}
