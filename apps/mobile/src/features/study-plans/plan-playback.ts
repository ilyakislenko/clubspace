// Pure rules for playing a study plan back to back (VideoScreen with
// `planId` + `planItemIndex`).

export type PlanItemLike = {
  videoId: string
  startSec: number
  endSec: number | null
  accessible: boolean
}

// A segment counts as played once the time is this close to its end (the
// player is polled, and a seek lands a little short)…
export const ITEM_END_TOLERANCE_SEC = 0.3
// …and no further past it than this: a member who scrubbed well beyond the
// end chose to keep watching the lesson.
export const ITEM_END_WINDOW_SEC = 2

/** The nearest playable item after (1) / before (-1) `from`, or null. */
export const adjacentPlayableIndex = (
  items: readonly PlanItemLike[],
  from: number,
  direction: 1 | -1,
): number | null => {
  for (let i = from + direction; i >= 0 && i < items.length; i += direction) {
    if (items[i].accessible) return i
  }
  return null
}

/**
 * Which item of the plan this lesson plays: the requested one when it is in
 * this lesson (the usual case), else the first item of this lesson (the plan
 * changed meanwhile), else null — the lesson isn't in the plan any more.
 */
export const resolvePlanIndex = (
  items: readonly PlanItemLike[],
  requested: number | null,
  videoId: string,
): number | null => {
  if (requested != null && items[requested]?.videoId === videoId) return requested
  const first = items.findIndex((item) => item.videoId === videoId)
  return first >= 0 ? first : null
}

/** Whether playback just reached the end of a segment item. */
export const reachedItemEnd = (time: number, item: PlanItemLike): boolean =>
  item.endSec != null &&
  time >= item.endSec - ITEM_END_TOLERANCE_SEC &&
  time <= item.endSec + ITEM_END_WINDOW_SEC

export type PlanStep =
  | { kind: "seek"; startSec: number }
  | { kind: "open"; videoId: string; startSec: number }

/** Moving to `target`: seek within the lesson on screen, or open another. */
export const planStep = (target: PlanItemLike, currentVideoId: string): PlanStep =>
  target.videoId === currentVideoId
    ? { kind: "seek", startSec: target.startSec }
    : { kind: "open", videoId: target.videoId, startSec: target.startSec }
