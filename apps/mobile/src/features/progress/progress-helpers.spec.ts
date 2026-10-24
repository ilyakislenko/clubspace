import {
  addMonths,
  attendedDays,
  inMonth,
  monthGrid,
  monthRange,
  monthWindow,
  yearMonth,
} from "./progress-helpers"

describe("yearMonth", () => {
  it("formats the device calendar month", () => {
    expect(yearMonth(new Date(2026, 9, 24))).toBe("2026-10")
    expect(yearMonth(new Date(2026, 0, 5))).toBe("2026-01")
  })
})

describe("addMonths", () => {
  it("wraps backwards over the year", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12")
  })

  it("wraps forwards over the year", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01")
  })

  it("moves within a year", () => {
    expect(addMonths("2026-10", -3)).toBe("2026-07")
  })
})

describe("monthRange", () => {
  it("spans the whole month", () => {
    expect(monthRange("2026-10")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    })
  })

  it("handles February in a leap year", () => {
    expect(monthRange("2028-02").to).toBe("2028-02-29")
    expect(monthRange("2026-02").to).toBe("2026-02-28")
  })
})

describe("monthGrid", () => {
  it("pads the first row up to the weekday (Oct 1 2026 is a Thursday)", () => {
    const grid = monthGrid("2026-10")
    expect(grid[0]).toEqual([null, null, null, 1, 2, 3, 4])
  })

  it("ends with the last day then nulls, every row 7 wide", () => {
    const grid = monthGrid("2026-10")
    expect(grid.every((r) => r.length === 7)).toBe(true)
    const last = grid[grid.length - 1]
    expect(last[last.indexOf(31) + 1]).toBeNull()
    expect(last).toContain(31)
  })

  it("is four rows for a Monday-start 28-day February (2027)", () => {
    expect(monthGrid("2027-02")).toHaveLength(4)
  })
})

describe("attendedDays", () => {
  it("uses the session's own timezone for the day", () => {
    const sessions = [
      { startAt: "2026-10-31T22:30:00Z", timezone: "Europe/Moscow" },
    ]
    expect(attendedDays(sessions, "2026-10").size).toBe(0)
    expect(attendedDays(sessions, "2026-11").get(1)).toBe(1)
  })

  it("counts two sessions on the same day as 2", () => {
    const sessions = [
      { startAt: "2026-10-10T08:00:00Z", timezone: "Europe/Moscow" },
      { startAt: "2026-10-10T15:00:00Z", timezone: "Europe/Moscow" },
    ]
    expect(attendedDays(sessions, "2026-10").get(10)).toBe(2)
  })
})

describe("monthWindow", () => {
  const now = new Date(2026, 9, 24)

  it("reaches a day past both ends of a past month", () => {
    expect(monthWindow("2026-09", now)).toEqual({
      from: "2026-08-31",
      to: "2026-10-01",
    })
  })

  it("wraps the padding over the year", () => {
    expect(monthWindow("2025-12", now)).toEqual({
      from: "2025-11-30",
      to: "2026-01-01",
    })
  })

  it("leaves `to` open for the current month", () => {
    expect(monthWindow("2026-10", now)).toEqual({ from: "2026-09-30" })
  })
})

describe("inMonth", () => {
  it("keeps a 07:00 Vladivostok class on Nov 1 out of October", () => {
    const vlad = { startAt: "2026-10-31T21:00:00Z", timezone: "Asia/Vladivostok" }
    const moscow = { startAt: "2026-10-31T16:00:00Z", timezone: "Europe/Moscow" }
    expect(inMonth([vlad, moscow], "2026-10")).toEqual([moscow])
    expect(inMonth([vlad, moscow], "2026-11")).toEqual([vlad])
  })
})
