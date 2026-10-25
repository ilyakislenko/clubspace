import {
  addDaysYmd,
  approvalStartYmd,
  daysInclusive,
  requestSummary,
  START_CHOICES,
  startChoices,
  untilChoices,
} from "./freeze-request-helpers"

describe("freeze request helpers", () => {
  it("addDaysYmd and daysInclusive agree, across a month end", () => {
    expect(addDaysYmd("2026-10-30", 3)).toBe("2026-11-02")
    expect(daysInclusive("2026-10-24", "2026-10-30")).toBe(7)
    expect(daysInclusive("2026-10-30", "2026-10-30")).toBe(1)
  })

  it("startChoices labels today and tomorrow against the club's today", () => {
    const out = startChoices({
      today: "2026-10-25",
      firstDate: "2026-10-25",
      lastDate: "2026-10-28",
    })
    expect(out).toEqual([
      { ymd: "2026-10-25", label: "Сегодня" },
      { ymd: "2026-10-26", label: "Завтра" },
      { ymd: "2026-10-27", label: "27 октября" },
      { ymd: "2026-10-28", label: "28 октября" },
    ])
  })

  it("startChoices starts at a later firstDate and caps the list", () => {
    const out = startChoices({
      today: "2026-10-25",
      firstDate: "2026-10-30",
      lastDate: "2027-12-31",
    })
    expect(out).toHaveLength(START_CHOICES)
    expect(out[0]).toEqual({ ymd: "2026-10-30", label: "30 октября" })
  })

  it("startChoices is empty when the window is inverted", () => {
    expect(
      startChoices({
        today: "2026-10-25",
        firstDate: "2026-10-26",
        lastDate: "2026-10-25",
      }),
    ).toEqual([])
  })

  it("untilChoices begins on the start day and respects maxDays", () => {
    const out = untilChoices("2026-10-30", 3)
    expect(out.map((c) => c.ymd)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ])
    expect(untilChoices("2026-10-30", 90)).toHaveLength(31)
  })

  it("requestSummary reads like the freeze line", () => {
    expect(
      requestSummary({ fromDate: "2026-10-24", untilDate: "2026-10-30", days: 7 }),
    ).toBe("с 24 по 30 октября · 7 дн.")
  })

  it("approvalStartYmd is the later of the requested start and today", () => {
    expect(approvalStartYmd("2026-10-30", "2026-10-25")).toBe("2026-10-30")
    expect(approvalStartYmd("2026-10-20", "2026-10-25")).toBe("2026-10-25")
  })
})
