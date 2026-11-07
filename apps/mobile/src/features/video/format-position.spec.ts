import {
  bookmarkOpenLabel,
  formatBookmarkTime,
  formatPosition,
} from "./format-position"

describe("formatPosition", () => {
  it("formats under a minute as 0:ss with a zero-padded second", () => {
    expect(formatPosition(5)).toBe("0:05")
  })

  it("formats minutes:seconds without zero-padding the minute", () => {
    expect(formatPosition(75)).toBe("1:15")
  })

  it("adds an hours field, padding minutes and seconds, once past 3600s", () => {
    expect(formatPosition(3661)).toBe("1:01:01")
  })

  it("floors fractional seconds", () => {
    expect(formatPosition(9.9)).toBe("0:09")
  })

  it("clamps negative input to zero", () => {
    expect(formatPosition(-10)).toBe("0:00")
  })
})

describe("formatBookmarkTime", () => {
  it("shows a moment as its time and a segment as a looped range", () => {
    expect(formatBookmarkTime({ positionSec: 72, endSec: null })).toBe("1:12")
    expect(formatBookmarkTime({ positionSec: 72, endSec: 85 })).toBe("1:12–1:25 ⟲")
  })
})

describe("bookmarkOpenLabel", () => {
  const drawing = { strokes: [] }

  it("says what a tap does: loop, show the drawing, or seek", () => {
    expect(
      bookmarkOpenLabel({ positionSec: 72, endSec: 85, label: "", drawing: null }),
    ).toBe("Повторять отрезок 1:12–1:25")
    expect(
      bookmarkOpenLabel({ positionSec: 72, endSec: null, label: "хват", drawing }),
    ).toBe("Показать рисунок на 1:12, хват")
    expect(
      bookmarkOpenLabel({ positionSec: 72, endSec: null, label: "", drawing: null }),
    ).toBe("Перейти к 1:12")
  })
})
