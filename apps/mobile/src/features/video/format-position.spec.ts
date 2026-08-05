import { formatPosition } from "./format-position"

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
