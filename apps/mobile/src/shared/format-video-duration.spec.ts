import { formatVideoDuration } from "./format-video-duration"

describe("formatVideoDuration", () => {
  it("formats m:ss with a zero-padded second", () => {
    expect(formatVideoDuration(125)).toBe("2:05")
  })

  it("returns null for missing, zero, or negative duration", () => {
    expect(formatVideoDuration(null)).toBeNull()
    expect(formatVideoDuration(undefined)).toBeNull()
    expect(formatVideoDuration(0)).toBeNull()
    expect(formatVideoDuration(-5)).toBeNull()
  })

  it("floors fractional seconds", () => {
    expect(formatVideoDuration(59.9)).toBe("0:59")
  })
})
