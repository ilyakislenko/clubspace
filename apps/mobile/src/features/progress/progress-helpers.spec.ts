import { monthToDate } from "./progress-helpers"

describe("monthToDate", () => {
  it("spans the first of the month to today", () => {
    expect(monthToDate(new Date(2026, 9, 24))).toEqual({
      from: "2026-10-01",
      to: "2026-10-24",
    })
  })

  it("pads single-digit months and days", () => {
    expect(monthToDate(new Date(2026, 0, 5))).toEqual({
      from: "2026-01-01",
      to: "2026-01-05",
    })
  })

  it("is a single day on the first", () => {
    expect(monthToDate(new Date(2026, 4, 1))).toEqual({
      from: "2026-05-01",
      to: "2026-05-01",
    })
  })
})
