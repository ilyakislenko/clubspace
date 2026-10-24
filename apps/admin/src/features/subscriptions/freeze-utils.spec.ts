import {
  addDaysYmd,
  extendedEndDate,
  formatDay,
  formatDayRange,
  freezePhase,
  freezePhaseLabel,
  openFreezeOf,
  returnDaysIfEndedToday,
  todayYmd,
  totalFrozenDays,
} from "./freeze-utils"

const f = (fromDate: string, untilDate: string, days = 7) => ({
  subscriptionId: "s1",
  fromDate,
  untilDate,
  days,
  endedEarlyAt: null as string | null,
})

describe("todayYmd", () => {
  it("uses the local calendar day, zero-padded", () => {
    expect(todayYmd(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05")
  })
})

describe("addDaysYmd", () => {
  it("crosses month and year boundaries", () => {
    expect(addDaysYmd("2026-10-30", 3)).toBe("2026-11-02")
    expect(addDaysYmd("2026-12-30", 3)).toBe("2027-01-02")
    expect(addDaysYmd("2026-11-01", -1)).toBe("2026-10-31")
  })
})

describe("freezePhase", () => {
  const x = f("2026-10-24", "2026-10-30")
  it("covers the boundaries", () => {
    expect(freezePhase(x, "2026-10-23")).toBe("upcoming")
    expect(freezePhase(x, "2026-10-24")).toBe("current")
    expect(freezePhase(x, "2026-10-30")).toBe("current")
    expect(freezePhase(x, "2026-10-31")).toBe("past")
  })
})

describe("openFreezeOf", () => {
  it("returns the earliest open freeze of the subscription", () => {
    const past = f("2026-09-01", "2026-09-07")
    const later = f("2026-11-10", "2026-11-16")
    const soon = f("2026-10-26", "2026-11-01")
    const other = { ...f("2026-10-24", "2026-10-30"), subscriptionId: "s2" }
    expect(openFreezeOf([past, later, soon, other], "s1", "2026-10-24")).toBe(
      soon,
    )
  })

  it("is null when everything is over", () => {
    expect(openFreezeOf([f("2026-09-01", "2026-09-07")], "s1", "2026-10-24")).toBeNull()
  })
})

describe("returnDaysIfEndedToday", () => {
  const x = f("2026-10-24", "2026-10-30", 7)
  it("gives all days back before or on the first day", () => {
    expect(returnDaysIfEndedToday(x, "2026-10-20")).toBe(7)
    expect(returnDaysIfEndedToday(x, "2026-10-24")).toBe(7)
  })
  it("gives back today and the rest mid-freeze", () => {
    expect(returnDaysIfEndedToday(x, "2026-10-27")).toBe(4)
    expect(returnDaysIfEndedToday(x, "2026-10-30")).toBe(1)
  })
  it("gives nothing once finished", () => {
    expect(returnDaysIfEndedToday(x, "2026-10-31")).toBe(0)
  })
})

describe("totalFrozenDays", () => {
  it("sums only the given subscription", () => {
    const other = { ...f("2026-01-01", "2026-01-03", 3), subscriptionId: "s2" }
    expect(
      totalFrozenDays([f("a", "b", 7), f("c", "d", 14), other], "s1"),
    ).toBe(21)
  })
})

describe("formatDay / formatDayRange", () => {
  it("formats a plain date without shifting", () => {
    expect(formatDay("2026-10-30")).toBe("30 октября")
  })
  it("collapses a same-month range", () => {
    expect(formatDayRange("2026-10-24", "2026-10-30")).toBe(
      "с 24 по 30 октября",
    )
  })
  it("spells both months across a boundary", () => {
    expect(formatDayRange("2026-10-28", "2026-11-03")).toBe(
      "с 28 октября по 3 ноября",
    )
  })
})

describe("extendedEndDate", () => {
  it("adds whole 24h days", () => {
    expect(extendedEndDate("2026-11-01T00:00:00.000Z", 7).toISOString()).toBe(
      "2026-11-08T00:00:00.000Z",
    )
  })
})

describe("freezePhaseLabel", () => {
  const x = f("2026-10-24", "2026-10-30")
  it("labels each phase", () => {
    expect(freezePhaseLabel(x, "2026-10-20")).toBe("запланирована")
    expect(freezePhaseLabel(x, "2026-10-25")).toBe("идёт")
    expect(freezePhaseLabel(x, "2026-11-05")).toBe("завершена")
    expect(
      freezePhaseLabel({ ...x, endedEarlyAt: "2026-10-26T00:00:00Z" }, "2026-11-05"),
    ).toBe("завершена досрочно")
  })
})
