import {
  clampSeek,
  DOUBLE_TAP_MS,
  frameStepTarget,
  INITIAL_TAP_STATE,
  positionOnTrack,
  registerTap,
  tapZone,
} from "./player-math"

describe("clampSeek", () => {
  it("never seeks before the start", () => {
    expect(clampSeek(-7)).toBe(0)
  })

  it("stops at the end when the duration is known", () => {
    expect(clampSeek(130, 120)).toBe(120)
  })

  it("leaves the target alone when the duration is unknown", () => {
    expect(clampSeek(130, undefined)).toBe(130)
    expect(clampSeek(130, 0)).toBe(130)
  })

  it("treats a non-finite target as the start", () => {
    expect(clampSeek(Number.NaN, 60)).toBe(0)
  })
})

describe("frameStepTarget", () => {
  it("lands mid-way into the next frame", () => {
    // 1.0 s at 25 fps is frame 25; the next is frame 26 → (26 + 0.5) / 25.
    expect(frameStepTarget(1, 1, 25)).toBeCloseTo(26.5 / 25, 9)
  })

  it("lands mid-way into the previous frame", () => {
    expect(frameStepTarget(1, -1, 25)).toBeCloseTo(24.5 / 25, 9)
  })

  it("moves exactly one frame per press when chained", () => {
    let t = 2
    for (let i = 0; i < 5; i++) t = frameStepTarget(t, 1, 30)
    expect(Math.floor(t * 30)).toBe(60 + 5)
    for (let i = 0; i < 3; i++) t = frameStepTarget(t, -1, 30)
    expect(Math.floor(t * 30)).toBe(60 + 2)
  })

  it("survives a currentTime read back with millisecond rounding", () => {
    const target = frameStepTarget(10, 1, 29.97)
    const readBack = Math.round(target * 1000) / 1000
    const frame = Math.floor(target * 29.97)
    expect(Math.floor(frameStepTarget(readBack, 1, 29.97) * 29.97)).toBe(
      frame + 1,
    )
  })

  it("falls back to 30 fps when the rate is unknown", () => {
    expect(frameStepTarget(1, 1, null)).toBeCloseTo(31.5 / 30, 9)
    expect(frameStepTarget(1, 1, 0)).toBeCloseTo(31.5 / 30, 9)
  })

  it("stays on the first frame when stepping back from the start", () => {
    expect(frameStepTarget(0, -1, 25)).toBeCloseTo(0.5 / 25, 9)
  })

  it("does not step past the end", () => {
    expect(frameStepTarget(9.99, 1, 25, 10)).toBe(10)
  })
})

describe("positionOnTrack", () => {
  it("maps the touch to the matching share of the duration", () => {
    expect(positionOnTrack(50, 200, 120)).toBe(30)
  })

  it("clamps touches dragged beyond either end of the track", () => {
    expect(positionOnTrack(-20, 200, 120)).toBe(0)
    expect(positionOnTrack(260, 200, 120)).toBe(120)
  })

  it("is 0 before the layout or the duration is known", () => {
    expect(positionOnTrack(50, 0, 120)).toBe(0)
    expect(positionOnTrack(50, 200, undefined)).toBe(0)
  })
})

describe("tapZone", () => {
  it("splits the picture into thirds", () => {
    expect(tapZone(10, 300)).toBe("left")
    expect(tapZone(150, 300)).toBe("center")
    expect(tapZone(290, 300)).toBe("right")
  })

  it("treats an unmeasured surface as the center", () => {
    expect(tapZone(10, 0)).toBe("center")
  })
})

describe("registerTap", () => {
  it("toggles controls immediately on a center tap", () => {
    expect(registerTap(INITIAL_TAP_STATE, "center", 0).decision).toEqual({
      kind: "single",
    })
  })

  it("holds a first side tap as pending", () => {
    expect(registerTap(INITIAL_TAP_STATE, "right", 0).decision).toEqual({
      kind: "pending",
    })
  })

  it("seeks forward on a quick double tap on the right", () => {
    const first = registerTap(INITIAL_TAP_STATE, "right", 1000)
    expect(registerTap(first.state, "right", 1000 + DOUBLE_TAP_MS).decision).toEqual({
      kind: "seek",
      delta: 10,
      total: 10,
    })
  })

  it("adds 10 s for every further quick tap on the same side", () => {
    let s = registerTap(INITIAL_TAP_STATE, "left", 0).state
    s = registerTap(s, "left", 200).state
    const third = registerTap(s, "left", 400)
    expect(third.decision).toEqual({ kind: "seek", delta: -10, total: -20 })
  })

  it("does not seek when the second tap is too slow", () => {
    const first = registerTap(INITIAL_TAP_STATE, "right", 0)
    expect(registerTap(first.state, "right", DOUBLE_TAP_MS + 1).decision).toEqual({
      kind: "pending",
    })
  })

  it("does not seek when the second tap is on the other side", () => {
    const first = registerTap(INITIAL_TAP_STATE, "left", 0)
    const second = registerTap(first.state, "right", 100)
    expect(second.decision).toEqual({ kind: "pending" })
    expect(second.state.streak).toBe(0)
  })

  it("ends a seek run on a center tap", () => {
    let s = registerTap(INITIAL_TAP_STATE, "right", 0).state
    s = registerTap(s, "right", 100).state
    const center = registerTap(s, "center", 200)
    expect(center.decision).toEqual({ kind: "single" })
    expect(registerTap(center.state, "right", 250).decision).toEqual({
      kind: "pending",
    })
  })
})
