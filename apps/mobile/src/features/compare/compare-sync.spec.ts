import {
  clampSegment,
  COMPARE_RATES,
  driftCorrection,
  followerTarget,
  loopWrapTarget,
  otherSide,
  syncOffset,
} from "./compare-sync"

describe("syncOffset / followerTarget", () => {
  it("keeps the offset when the left side moves", () => {
    const offset = syncOffset(10, 25)
    expect(offset).toBe(15)
    expect(followerTarget("left", 40, offset)).toBe(55)
  })

  it("keeps the offset when the right side moves", () => {
    const offset = syncOffset(30, 12)
    expect(followerTarget("right", 20, offset)).toBe(38)
  })

  it("keeps the follower inside its video", () => {
    expect(followerTarget("left", 5, -20)).toBe(0)
    expect(followerTarget("left", 90, 20, 100)).toBe(100)
  })
})

describe("driftCorrection", () => {
  it("leaves a follower within tolerance alone", () => {
    expect(driftCorrection(10, 15.2, 5)).toBeNull()
  })

  it("puts a drifted follower back at its place", () => {
    expect(driftCorrection(10, 15.6, 5)).toBe(15)
    expect(driftCorrection(10, 14, 5)).toBe(15)
  })

  it("does nothing where the partner moment lies outside the right video", () => {
    expect(driftCorrection(3, 0, -5)).toBeNull()
    expect(driftCorrection(98, 100, 5, 100)).toBeNull()
  })
})

describe("clampSegment", () => {
  it("keeps a segment inside its video", () => {
    expect(clampSegment({ startSec: 50, endSec: 130 }, 120)).toEqual({
      startSec: 50,
      endSec: 120,
    })
    expect(clampSegment({ startSec: -3, endSec: 10 }, 120)).toEqual({
      startSec: 0,
      endSec: 10,
    })
  })

  it("turns a segment squeezed to nothing into a moment", () => {
    expect(clampSegment({ startSec: 125, endSec: 140 }, 120)).toEqual({
      startSec: 120,
      endSec: null,
    })
    expect(clampSegment({ startSec: 10, endSec: 10.2 })).toEqual({
      startSec: 10,
      endSec: null,
    })
  })

  it("trusts the span while the duration is unknown", () => {
    expect(clampSegment({ startSec: 500, endSec: 520 }, null)).toEqual({
      startSec: 500,
      endSec: 520,
    })
  })
})

describe("loopWrapTarget", () => {
  const loop = { startSec: 10, endSec: 20 }

  it("sends a side back to A once past B", () => {
    expect(loopWrapTarget(20.1, loop)).toBe(10)
    expect(loopWrapTarget(19.9, loop)).toBeNull()
  })

  it("never loops a moment or nothing", () => {
    expect(loopWrapTarget(50, { startSec: 10, endSec: null })).toBeNull()
    expect(loopWrapTarget(50, null)).toBeNull()
  })
})

it("offers slow speeds only and names the other side", () => {
  expect(COMPARE_RATES).toEqual([0.25, 0.5, 0.75, 1])
  expect(otherSide("left")).toBe("right")
})
