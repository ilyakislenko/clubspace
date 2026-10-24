import {
  buildDateChoices,
  emptyTimeOption,
  groupForList,
  isFutureWallClock,
  latestCoachOption,
  needsMyAction,
  primaryTime,
  PT_STATUS_LABEL,
  ptStatusTone,
  TIME_CHOICES,
  toWallClock,
  upcomingConfirmed,
  viewerRole,
  wallClockOf,
} from "./personal-training-helpers"

const NOW = new Date("2026-10-27T09:00:00Z")

const option = (id: string, startAt: string, proposedBy = "member") =>
  ({ id, startAt, durationMin: 60, proposedBy }) as never

const pt = (over: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    status: "PENDING_COACH",
    displayStatus: "PENDING_COACH",
    member: { userId: "m1", displayName: "Мария" },
    coach: { userId: "c1", displayName: "Иван" },
    gym: null,
    timezone: "Asia/Tomsk",
    options: [option("o1", "2026-10-29T12:00:00Z")],
    confirmedStartAt: null,
    confirmedDurationMin: null,
    updatedAt: "2026-10-26T10:00:00.000Z",
    ...over,
  }) as never

describe("PT_STATUS_LABEL", () => {
  it("names every status in Russian", () => {
    expect(PT_STATUS_LABEL).toEqual({
      PENDING_COACH: "Ожидает тренера",
      PENDING_MEMBER: "Тренер предложил другое время",
      CONFIRMED: "Подтверждена",
      DECLINED: "Отклонена",
      CANCELLED: "Отменена",
      COMPLETED: "Прошла",
      EXPIRED: "Время прошло",
    })
  })
})

describe("ptStatusTone", () => {
  it.each([
    ["PENDING_COACH", "warning"],
    ["PENDING_MEMBER", "accent"],
    ["CONFIRMED", "success"],
    ["DECLINED", "danger"],
    ["CANCELLED", "muted"],
    ["COMPLETED", "muted"],
    ["EXPIRED", "muted"],
  ] as const)("%s -> %s", (status, tone) => {
    expect(ptStatusTone(status)).toBe(tone)
  })
})

describe("viewerRole", () => {
  it("tells member, coach and an admin acting for the coach apart", () => {
    expect(viewerRole(pt(), "m1")).toBe("member")
    expect(viewerRole(pt(), "c1")).toBe("coach")
    expect(viewerRole(pt(), "a1")).toBe("admin")
  })
})

describe("needsMyAction", () => {
  it("is the coach's turn on a fresh request", () => {
    expect(needsMyAction(pt(), "c1")).toBe(true)
    expect(needsMyAction(pt(), "m1")).toBe(false)
  })

  it("is the member's turn after a counter-proposal", () => {
    const counter = pt({ displayStatus: "PENDING_MEMBER" })
    expect(needsMyAction(counter, "m1")).toBe(true)
    expect(needsMyAction(counter, "c1")).toBe(false)
  })

  it("is nobody's turn once the times have passed", () => {
    const expired = pt({ displayStatus: "EXPIRED" })
    expect(needsMyAction(expired, "c1")).toBe(false)
    expect(needsMyAction(expired, "m1")).toBe(false)
  })
})

describe("latestCoachOption / primaryTime", () => {
  it("takes the newest coach proposal", () => {
    const options = [
      option("o1", "2026-10-29T12:00:00Z"),
      option("o2", "2026-10-30T12:00:00Z", "coach"),
      option("o3", "2026-10-31T12:00:00Z", "coach"),
    ]
    expect(latestCoachOption(options)?.id).toBe("o3")
    expect(latestCoachOption([options[0]!])).toBeNull()
  })

  it("leads with the confirmed time, then the coach's, then the member's", () => {
    expect(
      primaryTime(
        pt({
          confirmedStartAt: "2026-11-01T10:00:00Z",
          confirmedDurationMin: 90,
        }),
      ),
    ).toEqual({ startAt: "2026-11-01T10:00:00Z", durationMin: 90 })
    expect(
      primaryTime(
        pt({
          options: [
            option("o1", "2026-10-29T12:00:00Z"),
            option("o2", "2026-10-30T12:00:00Z", "coach"),
          ],
        }),
      )?.startAt,
    ).toBe("2026-10-30T12:00:00Z")
    expect(primaryTime(pt())?.startAt).toBe("2026-10-29T12:00:00Z")
    expect(primaryTime(pt({ options: [] }))).toBeNull()
  })
})

describe("upcomingConfirmed", () => {
  const confirmed = (id: string, startAt: string) =>
    pt({
      id,
      displayStatus: "CONFIRMED",
      confirmedStartAt: startAt,
      confirmedDurationMin: 60,
    })

  it("keeps confirmed sessions that have not ended, soonest first", () => {
    const out = upcomingConfirmed(
      [
        confirmed("late", "2026-11-02T10:00:00Z"),
        confirmed("soon", "2026-10-28T10:00:00Z"),
        confirmed("under-way", "2026-10-27T08:30:00Z"),
        confirmed("over", "2026-10-27T07:00:00Z"),
        pt(),
      ],
      NOW,
    )
    expect(out.map((p) => p.id)).toEqual(["under-way", "soon", "late"])
  })
})

describe("groupForList", () => {
  const confirmed = pt({
    id: "up",
    displayStatus: "CONFIRMED",
    confirmedStartAt: "2026-10-30T10:00:00Z",
    confirmedDurationMin: 60,
  })

  it("splits the coach's list into the four sections", () => {
    const list = [
      pt({ id: "ask-late", options: [option("a", "2026-11-03T10:00:00Z")] }),
      pt({ id: "ask-soon", options: [option("b", "2026-10-28T10:00:00Z")] }),
      confirmed,
      pt({ id: "wait", displayStatus: "PENDING_MEMBER" }),
      pt({
        id: "old-1",
        displayStatus: "DECLINED",
        updatedAt: "2026-10-20T10:00:00.000Z",
      }),
      pt({
        id: "old-2",
        displayStatus: "COMPLETED",
        updatedAt: "2026-10-25T10:00:00.000Z",
      }),
      pt({ id: "gone", displayStatus: "EXPIRED" }),
    ]
    const out = groupForList(list, "c1", NOW)
    expect(out.needsAction.map((p) => p.id)).toEqual(["ask-soon", "ask-late"])
    expect(out.upcoming.map((p) => p.id)).toEqual(["up"])
    expect(out.waiting.map((p) => p.id)).toEqual(["wait"])
    expect(out.history.map((p) => p.id)).toEqual(["gone", "old-2", "old-1"])
  })

  it("flips the sections for the member", () => {
    const out = groupForList(
      [pt({ id: "a" }), pt({ id: "b", displayStatus: "PENDING_MEMBER" })],
      "m1",
      NOW,
    )
    expect(out.needsAction.map((p) => p.id)).toEqual(["b"])
    expect(out.waiting.map((p) => p.id)).toEqual(["a"])
  })
})

describe("buildDateChoices", () => {
  it("labels today, tomorrow, then weekday and date", () => {
    const out = buildDateChoices(NOW, "Asia/Tomsk", 4)
    expect(out).toEqual([
      { dateKey: "2026-10-27", label: "Сегодня" },
      { dateKey: "2026-10-28", label: "Завтра" },
      { dateKey: "2026-10-29", label: "чт, 29 окт." },
      { dateKey: "2026-10-30", label: "пт, 30 окт." },
    ])
  })

  it("starts on the zone's calendar day, not the phone's, across midnight", () => {
    // 21:30 UTC is already the 28th in Tomsk (UTC+7) but still the 27th in UTC.
    const late = new Date("2026-10-27T21:30:00Z")
    expect(buildDateChoices(late, "Asia/Tomsk", 1)[0]!.dateKey).toBe(
      "2026-10-28",
    )
    expect(buildDateChoices(late, "UTC", 1)[0]!.dateKey).toBe("2026-10-27")
  })

  it("covers three weeks by default", () => {
    expect(buildDateChoices(NOW, "UTC")).toHaveLength(21)
  })
})

describe("TIME_CHOICES", () => {
  it("runs 07:00 to 22:00 in half hours", () => {
    expect(TIME_CHOICES[0]).toBe("07:00")
    expect(TIME_CHOICES[1]).toBe("07:30")
    expect(TIME_CHOICES[TIME_CHOICES.length - 1]).toBe("22:00")
    expect(TIME_CHOICES).toHaveLength(31)
  })
})

describe("isFutureWallClock", () => {
  it("reads the wall clock in the given zone", () => {
    // NOW is 16:00 in Tomsk.
    expect(isFutureWallClock("2026-10-27", "15:30", "Asia/Tomsk", NOW)).toBe(
      false,
    )
    expect(isFutureWallClock("2026-10-27", "16:30", "Asia/Tomsk", NOW)).toBe(
      true,
    )
    // The same wall time is hours away in Moscow (UTC+3, NOW = 12:00).
    expect(isFutureWallClock("2026-10-27", "15:30", "Europe/Moscow", NOW)).toBe(
      true,
    )
  })
})

describe("wall-clock values", () => {
  it("joins a date and time the way the server parses it", () => {
    expect(toWallClock("2026-10-29", "19:00")).toBe("2026-10-29T19:00")
  })

  it("is null until both a date and a time are picked", () => {
    expect(wallClockOf(emptyTimeOption())).toBeNull()
    expect(
      wallClockOf({ dateKey: "2026-10-29", time: null, durationMin: 60 }),
    ).toBeNull()
    expect(
      wallClockOf({ dateKey: "2026-10-29", time: "19:00", durationMin: 60 }),
    ).toBe("2026-10-29T19:00")
  })
})
