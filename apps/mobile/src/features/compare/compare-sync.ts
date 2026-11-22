// Pure timing rules of «Сравнить рядом»: two players side by side, optionally
// locked together («Синхронно») at the offset they had when locked, each with
// an optional A–B segment. Kept free of React / the players so the edge cases
// are unit-tested.
import { clampSeek, PLAYBACK_RATES } from "../video/player-math"

export type CompareSide = "left" | "right"

// A clip's span on its video: a moment (`endSec: null`) or an A–B segment.
export type Segment = { startSec: number; endSec: number | null }

// Comparing is about details: slow speeds only.
export const COMPARE_RATES = PLAYBACK_RATES.filter((r) => r <= 1)

// A segment shorter than this is no segment (a moment).
export const MIN_SEGMENT_SEC = 0.5

// While both play locked, a follower farther than this off its place is
// nudged back (the two decoders drift apart over a minute or two).
export const DRIFT_TOLERANCE_SEC = 0.25

export const otherSide = (side: CompareSide): CompareSide =>
  side === "left" ? "right" : "left"

/** The lock's offset: how far the right clip runs ahead of the left one. */
export const syncOffset = (leftTime: number, rightTime: number): number =>
  rightTime - leftTime

/**
 * Where the other side goes when `leader` moved to `leaderTime` with the two
 * locked at `offset` (right − left): the same move, kept inside the other
 * video.
 */
export const followerTarget = (
  leader: CompareSide,
  leaderTime: number,
  offset: number,
  followerDuration?: number | null,
): number =>
  clampSeek(
    leader === "left" ? leaderTime + offset : leaderTime - offset,
    followerDuration,
  )

/**
 * While both play locked: where the right side must be put back to, or null
 * while it is close enough — and also when the left side's partner moment is
 * outside the right video (before its start or past its end), where there is
 * nothing to line up with.
 */
export const driftCorrection = (
  leftTime: number,
  rightTime: number,
  offset: number,
  rightDuration?: number | null,
  tolerance: number = DRIFT_TOLERANCE_SEC,
): number | null => {
  const target = leftTime + offset
  if (target < 0 || (rightDuration != null && target > rightDuration)) return null
  return Math.abs(rightTime - target) > tolerance ? target : null
}

/**
 * A segment fitted to a video of `duration` (unknown = trusted as is): the
 * start inside the video, the end after the start and not past the end; an
 * end too close to the start leaves a plain moment.
 */
export const clampSegment = (
  segment: Segment,
  duration?: number | null,
): Segment => {
  const startSec = clampSeek(segment.startSec, duration)
  if (segment.endSec == null) return { startSec, endSec: null }
  const end = clampSeek(segment.endSec, duration)
  return end - startSec >= MIN_SEGMENT_SEC
    ? { startSec, endSec: end }
    : { startSec, endSec: null }
}

/** Where an A–B loop sends a side at `time`: back to A once past B, else null. */
export const loopWrapTarget = (time: number, segment: Segment | null): number | null =>
  segment?.endSec != null && time >= segment.endSec ? segment.startSec : null
