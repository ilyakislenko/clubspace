import {
  MAX_PULL,
  REFRESH_THRESHOLD,
  isPullGesture,
  pullDistance,
  shouldRefresh,
} from "./pull-to-refresh"

describe("pullDistance", () => {
  it("tracks the finger exactly up to the trigger point", () => {
    // This is the part that has to feel like the native gesture.
    expect(pullDistance(0)).toBe(0)
    expect(pullDistance(20)).toBe(20)
    expect(pullDistance(REFRESH_THRESHOLD)).toBe(REFRESH_THRESHOLD)
  })

  it("gets heavier past the trigger point instead of following 1:1", () => {
    const past = pullDistance(REFRESH_THRESHOLD + 40)
    expect(past).toBeGreaterThan(REFRESH_THRESHOLD)
    expect(past).toBeLessThan(REFRESH_THRESHOLD + 40)
  })

  it("never lets the list be dragged halfway down the screen", () => {
    expect(pullDistance(1000)).toBe(MAX_PULL)
  })

  it("ignores an upward drag", () => {
    expect(pullDistance(-50)).toBe(0)
  })
})

describe("shouldRefresh", () => {
  it("fires only once the member pulled far enough to mean it", () => {
    expect(shouldRefresh(REFRESH_THRESHOLD - 1)).toBe(false)
    expect(shouldRefresh(REFRESH_THRESHOLD)).toBe(true)
  })
})

describe("isPullGesture", () => {
  it("is a pull when the list was at the top and the finger moves down", () => {
    expect(isPullGesture(true, 100, 160)).toBe(true)
  })

  it("is NOT a pull when the list was scrolled — that's just scrolling", () => {
    expect(isPullGesture(false, 100, 160)).toBe(false)
  })

  it("is NOT a pull when the finger moves up", () => {
    expect(isPullGesture(true, 160, 100)).toBe(false)
    expect(isPullGesture(true, 100, 100)).toBe(false)
  })
})
