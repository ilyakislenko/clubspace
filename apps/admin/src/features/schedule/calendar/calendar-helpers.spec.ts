import {
  addDaysYmd,
  addMonthsYmd,
  chunkRange,
  dayLabel,
  findConflicts,
  formatRange,
  isCalendarView,
  isoDow,
  layoutDay,
  minuteToY,
  monthGridDays,
  monthTitle,
  navigateAnchor,
  rangeLabel,
  snapMinutes,
  viewRange,
  visibleHours,
  wallClock,
  weekDays,
  withAlpha,
  yToMinute,
} from "./calendar-helpers"

describe("calendar days", () => {
  it("adds days and months across boundaries", () => {
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28")
    expect(addMonthsYmd("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonthsYmd("2026-01-15", -1)).toBe("2025-12-15")
  })

  it("weeks start on Monday", () => {
    expect(isoDow("2026-11-01")).toBe(7)
    expect(weekDays("2026-11-01")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ])
  })

  it("builds a Monday-first month grid of whole weeks", () => {
    const days = monthGridDays("2026-11-15")
    expect(days[0]).toBe("2026-10-26")
    expect(days[days.length - 1]).toBe("2026-12-06")
    expect(days.length % 7).toBe(0)
  })

  it("maps a view to the days it fetches", () => {
    expect(viewRange("day", "2026-11-04")).toEqual({ from: "2026-11-04", to: "2026-11-04" })
    expect(viewRange("week", "2026-11-04")).toEqual({ from: "2026-11-02", to: "2026-11-08" })
    expect(viewRange("agenda", "2026-11-04")).toEqual({ from: "2026-11-01", to: "2026-11-30" })
    expect(viewRange("year", "2026-11-04")).toEqual({ from: "2026-01-01", to: "2026-12-31" })
    expect(viewRange("month", "2026-11-04").from).toBe("2026-10-26")
  })

  it("splits a long range into API-sized chunks", () => {
    const chunks = chunkRange({ from: "2026-01-01", to: "2026-12-31" })
    expect(chunks[0]).toEqual({ from: "2026-01-01", to: "2026-03-31" })
    expect(chunks[chunks.length - 1].to).toBe("2026-12-31")
    expect(chunks.length).toBe(5)
  })

  it("navigates by the view's unit", () => {
    expect(navigateAnchor("day", "2026-11-04", 1)).toBe("2026-11-05")
    expect(navigateAnchor("week", "2026-11-04", -1)).toBe("2026-10-28")
    expect(navigateAnchor("month", "2026-11-04", 1)).toBe("2026-12-04")
    expect(navigateAnchor("agenda", "2026-11-04", -1)).toBe("2026-10-04")
    expect(navigateAnchor("year", "2026-11-04", 1)).toBe("2027-11-04")
  })

  it("labels in Russian", () => {
    expect(monthTitle("2026-11-04")).toBe("Ноябрь 2026")
    expect(dayLabel("2026-11-04")).toBe("ср, 4 ноября")
    expect(rangeLabel("week", "2026-11-04")).toBe("2–8 ноября 2026")
    expect(rangeLabel("week", "2026-10-28")).toBe("26 октября – 1 ноября 2026")
    expect(rangeLabel("week", "2026-12-30")).toBe("28 декабря 2026 – 3 января 2027")
    expect(rangeLabel("day", "2026-11-04")).toBe("среда, 4 ноября 2026")
    expect(rangeLabel("month", "2026-02-10")).toBe("1–28 февраля 2026")
    expect(rangeLabel("year", "2026-02-10")).toBe("2026")
    expect(isCalendarView("week")).toBe(true)
    expect(isCalendarView("list")).toBe(false)
  })
})

describe("wall clock", () => {
  it("reads the day and minute in the given zone", () => {
    expect(wallClock("2026-11-04T12:00:00.000Z", "Asia/Tomsk")).toEqual({
      ymd: "2026-11-04",
      minutes: 19 * 60,
    })
    expect(wallClock("2026-11-04T20:30:00.000Z", "Asia/Tomsk")).toEqual({
      ymd: "2026-11-05",
      minutes: 3 * 60 + 30,
    })
    expect(formatRange(19 * 60, 20 * 60 + 30)).toBe("19:00–20:30")
  })
})

describe("time grid", () => {
  it("snaps to 15 minutes and converts minutes to pixels and back", () => {
    expect(snapMinutes(607)).toBe(600)
    expect(snapMinutes(608)).toBe(615)
    const range = { from: 8, to: 22 }
    expect(minuteToY(9 * 60 + 30, range)).toBe(144)
    expect(yToMinute(144, range)).toBe(9 * 60 + 30)
  })

  it("widens the visible hours to fit every item", () => {
    expect(visibleHours({ from: 8, to: 21 }, [])).toEqual({ from: 8, to: 21 })
    expect(
      visibleHours({ from: 8, to: 21 }, [
        { startMin: 7 * 60 + 30, endMin: 9 * 60 },
        { startMin: 21 * 60, endMin: 22 * 60 + 15 },
      ]),
    ).toEqual({ from: 7, to: 23 })
  })

  it("puts overlapping items side by side and lets free ones stretch", () => {
    const layout = layoutDay([
      { key: "a", startMin: 600, endMin: 660 },
      { key: "b", startMin: 630, endMin: 690 },
      { key: "c", startMin: 670, endMin: 720 },
      { key: "d", startMin: 800, endMin: 860 },
    ])
    expect(layout.get("a")).toEqual({ left: 0, width: 0.5 })
    expect(layout.get("b")).toEqual({ left: 0.5, width: 0.5 })
    expect(layout.get("c")).toEqual({ left: 0, width: 0.5 })
    expect(layout.get("d")).toEqual({ left: 0, width: 1 })
  })

  it("stretches an item over free columns to its right", () => {
    const layout = layoutDay([
      { key: "a", startMin: 600, endMin: 720 },
      { key: "b", startMin: 600, endMin: 630 },
      { key: "c", startMin: 600, endMin: 630 },
      { key: "d", startMin: 640, endMin: 700 },
    ])
    expect(layout.get("d")).toEqual({ left: 1 / 3, width: 2 / 3 })
  })
})

describe("conflicts", () => {
  const base = { date: "2026-11-04", startMin: 600, endMin: 660 }
  const items = [
    { key: "same-gym", ...base, gymId: "g1", coachIds: ["c9"] },
    { key: "same-coach", ...base, gymId: "g2", coachIds: ["c1"] },
    { key: "other-day", ...base, date: "2026-11-05", gymId: "g1", coachIds: ["c1"] },
    { key: "touching", date: "2026-11-04", startMin: 660, endMin: 720, gymId: "g1", coachIds: ["c1"] },
    { key: "self", ...base, gymId: "g1", coachIds: ["c1"] },
  ]

  it("reports gym and coach overlaps on the same day, skipping itself", () => {
    const found = findConflicts(
      { key: "self", ...base, gymId: "g1", coachIds: ["c1"] },
      items,
    )
    expect(found.map((c) => [c.reason, c.item.key])).toEqual([
      ["gym", "same-gym"],
      ["coach", "same-coach"],
    ])
  })
})

describe("colors", () => {
  it("adds alpha to a hex color and falls back on garbage", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)")
    expect(withAlpha(null, 1)).toBe("rgba(100, 116, 139, 1)")
  })
})
