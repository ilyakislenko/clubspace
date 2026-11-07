import {
  arrowHead,
  canAddStroke,
  containRect,
  DRAWING_MAX_POINTS,
  DRAWING_MAX_STROKES,
  drawingPointCount,
  finishStroke,
  simplifyStroke,
  toFrame,
  toScreen,
} from "./drawing-math"

describe("containRect", () => {
  it("pillarboxes a 4:3 picture in a 16:9 player", () => {
    expect(containRect({ width: 1600, height: 900 }, { width: 640, height: 480 })).toEqual({
      x: 200,
      y: 0,
      width: 1200,
      height: 900,
    })
  })

  it("letterboxes a 16:9 picture in a tall player", () => {
    expect(containRect({ width: 400, height: 800 }, { width: 1920, height: 1080 })).toEqual({
      x: 0,
      y: 287.5,
      width: 400,
      height: 225,
    })
  })

  it("uses the whole player while the video size is unknown", () => {
    expect(containRect({ width: 400, height: 300 }, null)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    })
    expect(containRect({ width: 400, height: 300 }, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    })
  })
})

describe("toFrame / toScreen", () => {
  const rect = { x: 200, y: 0, width: 1200, height: 900 }

  it("maps a touch into frame coordinates past the bars", () => {
    expect(toFrame(200, 0, rect, false)).toEqual([0, 0])
    expect(toFrame(800, 450, rect, false)).toEqual([0.5, 0.5])
    expect(toFrame(500, 225, rect, false)).toEqual([0.25, 0.25])
  })

  it("clamps touches on the bars to the picture's edge", () => {
    expect(toFrame(50, -10, rect, false)).toEqual([0, 0])
    expect(toFrame(1590, 950, rect, false)).toEqual([1, 1])
  })

  it("flips x while the picture is mirrored", () => {
    expect(toFrame(500, 225, rect, true)).toEqual([0.75, 0.25])
    expect(toScreen(0.75, 0.25, rect, true)).toEqual([500, 225])
  })

  it("lands a frame point on the same spot of the picture at another size", () => {
    const [fx, fy] = toFrame(500, 225, rect, false)
    const phone = containRect({ width: 400, height: 800 }, { width: 640, height: 480 })
    expect(toScreen(fx, fy, phone, false)).toEqual([100, 325])
  })

  it("rounds to 4 decimals", () => {
    expect(toFrame(1 / 3, 0, { x: 0, y: 0, width: 1, height: 1 }, false)).toEqual([0.3333, 0])
  })
})

describe("simplifyStroke", () => {
  it("drops points on a straight line, keeping its ends", () => {
    expect(simplifyStroke([0, 0, 0.1, 0.1, 0.2, 0.2, 0.3, 0.3])).toEqual([0, 0, 0.3, 0.3])
  })

  it("keeps a corner", () => {
    expect(simplifyStroke([0, 0, 0.25, 0, 0.5, 0, 0.5, 0.25, 0.5, 0.5])).toEqual([
      0, 0, 0.5, 0, 0.5, 0.5,
    ])
  })

  it("keeps wobble below the tolerance out", () => {
    expect(simplifyStroke([0, 0, 0.5, 0.001, 1, 0])).toEqual([0, 0, 1, 0])
  })

  it("leaves one or two points alone and drops a dangling coordinate", () => {
    expect(simplifyStroke([0.1, 0.2, 0.3, 0.4])).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(simplifyStroke([0.1, 0.2, 0.3])).toEqual([0.1, 0.2])
  })
})

describe("finishStroke", () => {
  it("keeps only the ends of an arrow or an ellipse", () => {
    expect(finishStroke("arrow", "red", [0, 0, 0.2, 0.3, 0.5, 0.5])).toEqual({
      tool: "arrow",
      color: "red",
      points: [0, 0, 0.5, 0.5],
    })
  })

  it("simplifies a pen path", () => {
    expect(finishStroke("pen", "white", [0, 0, 0.1, 0.1, 0.2, 0.2])?.points).toEqual([
      0, 0, 0.2, 0.2,
    ])
  })

  it("ignores a tap (no movement)", () => {
    expect(finishStroke("pen", "red", [0.3, 0.3])).toBeNull()
    expect(finishStroke("ellipse", "red", [0.3, 0.3, 0.3001, 0.3])).toBeNull()
  })
})

describe("limits", () => {
  const stroke = (points: number) => ({
    tool: "pen" as const,
    color: "red" as const,
    points: new Array<number>(points * 2).fill(0.5),
  })

  it("counts points across strokes", () => {
    expect(drawingPointCount([stroke(3), stroke(4)])).toBe(7)
  })

  it("refuses a stroke past the stroke limit", () => {
    const full = new Array(DRAWING_MAX_STROKES).fill(stroke(2))
    expect(canAddStroke(full.slice(1), stroke(2))).toBe(true)
    expect(canAddStroke(full, stroke(2))).toBe(false)
  })

  it("refuses a stroke past the point limit", () => {
    const strokes = [stroke(DRAWING_MAX_POINTS - 10)]
    expect(canAddStroke(strokes, stroke(10))).toBe(true)
    expect(canAddStroke(strokes, stroke(11))).toBe(false)
  })
})

describe("arrowHead", () => {
  it("draws both barbs behind the tip, symmetric about the shaft", () => {
    const [ax, ay, bx, by] = arrowHead(0, 0, 100, 0, 10)
    expect(ax).toBeCloseTo(100 - 10 * Math.cos((28 * Math.PI) / 180))
    expect(bx).toBeCloseTo(ax)
    expect(ay).toBeCloseTo(-by)
    expect(ay).toBeGreaterThan(0)
  })
})
