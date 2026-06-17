import { formatMinutes } from "./format-minutes"

describe("formatMinutes", () => {
  it("renders just minutes under an hour", () => {
    expect(formatMinutes(45)).toBe("45 мин")
  })

  it("drops the minutes part on a whole hour", () => {
    expect(formatMinutes(120)).toBe("2 ч")
  })

  it("renders hours and minutes together", () => {
    expect(formatMinutes(90)).toBe("1 ч 30 мин")
  })
})
