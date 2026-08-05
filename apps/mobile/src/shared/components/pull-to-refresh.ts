/**
 * The decision logic behind web pull-to-refresh, kept pure so it can be tested
 * without a browser. See `RefreshControl.web.tsx` for the gesture plumbing.
 */

/** How far the member has to pull before letting go triggers a refresh. */
export const REFRESH_THRESHOLD = 64

/** Past the threshold the indicator stops following the finger 1:1. */
const RESISTANCE = 0.45
export const MAX_PULL = 96

/**
 * How far the indicator should be dragged for a given finger travel.
 *
 * The first `REFRESH_THRESHOLD` pixels track the finger exactly — that's the
 * part that has to feel like the native gesture. Beyond it the pull gets
 * progressively heavier and stops at `MAX_PULL`, so the list can't be dragged
 * halfway down the screen.
 */
export const pullDistance = (deltaY: number): number => {
  if (deltaY <= 0) return 0
  if (deltaY <= REFRESH_THRESHOLD) return deltaY
  const extra = (deltaY - REFRESH_THRESHOLD) * RESISTANCE
  return Math.min(REFRESH_THRESHOLD + extra, MAX_PULL)
}

export const shouldRefresh = (deltaY: number): boolean =>
  deltaY >= REFRESH_THRESHOLD

/**
 * Whether a touch that started at `startY` and is now at `currentY` counts as a
 * pull-to-refresh gesture.
 *
 * It only does when the list was already scrolled to the very top when the
 * finger went down — otherwise the member is scrolling, and hijacking that
 * would make the list feel broken. `startedAtTop` is sampled once on touchstart
 * on purpose: re-checking mid-gesture would let a fast upward fling turn into a
 * refresh as soon as it bounced off the top.
 */
export const isPullGesture = (
  startedAtTop: boolean,
  startY: number,
  currentY: number,
): boolean => startedAtTop && currentY > startY
