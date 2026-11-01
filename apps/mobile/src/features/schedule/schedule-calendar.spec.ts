import {
  CALENDAR_PAGES,
  DEFAULT_AXIS,
  blockFrame,
  blockStateLine,
  calendarItems,
  dayKeysFrom,
  fetchRange,
  fetchWindowOf,
  firstDayOfPage,
  fitLines,
  fitTimeAxis,
  formatDayLong,
  formatWeekRange,
  nowOffset,
  pageOfDay,
  placeOverlaps,
  segmentsByDay,
  shortPersonName,
  splitByDay,
  tintColor,
  todayKeyIn,
  weekdayShort,
  windowDayKeys,
  zonedDayMinute,
  type CalendarItem,
  type Segment,
} from "./schedule-calendar"

const item = (
  key: string,
  startAt: string,
  endAt: string,
  timezone = "Europe/Moscow",
): CalendarItem =>
  ({ kind: "session", key, startAt, endAt, timezone, session: {} }) as never

const seg = (startMin: number, endMin: number, key = `${startMin}`): Segment => ({
  item: { key } as never,
  dateKey: "2026-11-02",
  startMin,
  endMin,
  continuesBefore: false,
  continuesAfter: false,
})

describe("zonedDayMinute", () => {
  it("reads the day and minute in the given zone", () => {
    // 17:30 UTC = 20:30 in Moscow, 00:30 next day in Tomsk.
    expect(zonedDayMinute("2026-11-02T17:30:00.000Z", "Europe/Moscow")).toEqual({
      dateKey: "2026-11-02",
      minute: 20 * 60 + 30,
    })
    expect(zonedDayMinute("2026-11-02T17:30:00.000Z", "Asia/Tomsk")).toEqual({
      dateKey: "2026-11-03",
      minute: 30,
    })
  })

  it("puts midnight at minute 0", () => {
    expect(zonedDayMinute("2026-11-02T21:00:00.000Z", "Europe/Moscow")).toEqual({
      dateKey: "2026-11-03",
      minute: 0,
    })
  })

  it("gives the club's today", () => {
    expect(todayKeyIn("Asia/Tomsk", Date.UTC(2026, 10, 1, 18, 0))).toBe(
      "2026-11-02",
    )
  })
})

describe("calendarItems", () => {
  it("joins classes, events and confirmed personal sessions", () => {
    const items = calendarItems(
      {
        timezone: "Europe/Moscow",
        sessions: [
          {
            occurrenceId: "o1",
            startAt: "2026-11-02T15:00:00.000Z",
            endAt: "2026-11-02T16:00:00.000Z",
            timezone: "Europe/Moscow",
          },
        ],
        events: [
          {
            id: "e1",
            startAt: "2026-11-03T09:00:00.000Z",
            endAt: "2026-11-03T12:00:00.000Z",
            timezone: "Europe/Moscow",
          },
        ],
      } as never,
      [
        {
          id: "p1",
          confirmedStartAt: "2026-11-04T08:00:00.000Z",
          confirmedDurationMin: 90,
          timezone: "Asia/Tomsk",
        },
        { id: "p2", confirmedStartAt: null, timezone: "Asia/Tomsk" },
      ] as never,
    )
    expect(items.map((i) => [i.kind, i.key, i.endAt])).toEqual([
      ["session", "s:o1", "2026-11-02T16:00:00.000Z"],
      ["event", "e:e1", "2026-11-03T12:00:00.000Z"],
      ["personal", "p:p1", "2026-11-04T09:30:00.000Z"],
    ])
  })

  it("gives a personal session without a length one hour", () => {
    const [pt] = calendarItems({ timezone: "UTC", sessions: [], events: [] }, [
      {
        id: "p",
        confirmedStartAt: "2026-11-04T08:00:00.000Z",
        confirmedDurationMin: null,
        timezone: "UTC",
      },
    ] as never)
    expect(pt!.endAt).toBe("2026-11-04T09:00:00.000Z")
  })
})

describe("splitByDay", () => {
  it("keeps a same-day class whole", () => {
    const [s, ...rest] = splitByDay(
      item("a", "2026-11-02T15:30:00.000Z", "2026-11-02T17:00:00.000Z"),
    )
    expect(rest).toEqual([])
    expect(s).toMatchObject({
      dateKey: "2026-11-02",
      startMin: 18 * 60 + 30,
      endMin: 20 * 60,
      continuesBefore: false,
      continuesAfter: false,
    })
  })

  it("splits a class crossing midnight in its zone", () => {
    // 23:00–01:00 Moscow.
    const parts = splitByDay(
      item("a", "2026-11-02T20:00:00.000Z", "2026-11-02T22:00:00.000Z"),
    )
    expect(
      parts.map((p) => [p.dateKey, p.startMin, p.endMin, p.continuesBefore, p.continuesAfter]),
    ).toEqual([
      ["2026-11-02", 23 * 60, 24 * 60, false, true],
      ["2026-11-03", 0, 60, true, false],
    ])
  })

  it("buckets by the item's own zone, not the device's", () => {
    // 21:30 UTC on the 2nd is the 3rd in Tomsk (UTC+7).
    const [tomsk] = splitByDay(
      item("t", "2026-11-02T21:30:00.000Z", "2026-11-02T22:30:00.000Z", "Asia/Tomsk"),
    )
    const [utc] = splitByDay(
      item("u", "2026-11-02T21:30:00.000Z", "2026-11-02T22:30:00.000Z", "UTC"),
    )
    expect(tomsk!.dateKey).toBe("2026-11-03")
    expect(utc!.dateKey).toBe("2026-11-02")
  })

  it("drops an empty tail that ends exactly at midnight", () => {
    const parts = splitByDay(
      item("a", "2026-11-02T19:00:00.000Z", "2026-11-02T21:00:00.000Z"),
    )
    expect(parts.map((p) => [p.dateKey, p.endMin, p.continuesAfter])).toEqual([
      ["2026-11-02", 24 * 60, false],
    ])
  })

  it("covers every day of a multi-day event", () => {
    const parts = splitByDay(
      item("e", "2026-11-02T07:00:00.000Z", "2026-11-04T12:00:00.000Z"),
    )
    expect(parts.map((p) => [p.dateKey, p.startMin, p.endMin])).toEqual([
      ["2026-11-02", 10 * 60, 24 * 60],
      ["2026-11-03", 0, 24 * 60],
      ["2026-11-04", 0, 15 * 60],
    ])
  })

  it("treats an end before the start as an instant", () => {
    const [s] = splitByDay(
      item("a", "2026-11-02T15:00:00.000Z", "2026-11-02T14:00:00.000Z"),
    )
    expect([s!.startMin, s!.endMin]).toEqual([18 * 60, 18 * 60])
  })
})

describe("segmentsByDay", () => {
  it("fills only the requested days, earliest first", () => {
    const byDay = segmentsByDay(
      [
        item("late", "2026-11-02T16:00:00.000Z", "2026-11-02T17:00:00.000Z"),
        item("early", "2026-11-02T06:00:00.000Z", "2026-11-02T07:00:00.000Z"),
        item("outside", "2026-11-10T06:00:00.000Z", "2026-11-10T07:00:00.000Z"),
        item("night", "2026-11-02T20:00:00.000Z", "2026-11-02T22:00:00.000Z"),
      ],
      ["2026-11-02", "2026-11-03"],
    )
    expect([...byDay.keys()]).toEqual(["2026-11-02", "2026-11-03"])
    expect(byDay.get("2026-11-02")!.map((s) => s.item.key)).toEqual([
      "early",
      "late",
      "night",
    ])
    expect(byDay.get("2026-11-03")!.map((s) => s.item.key)).toEqual(["night"])
  })
})

describe("placeOverlaps", () => {
  const layout = (segs: Segment[]) =>
    placeOverlaps(segs).map((p) => [p.item.key, p.column, p.columns])

  it("gives a lone class the whole column", () => {
    expect(layout([seg(600, 660, "a")])).toEqual([["a", 0, 1]])
  })

  it("puts overlapping classes side by side", () => {
    expect(
      layout([seg(18 * 60 + 30, 19 * 60 + 30, "a"), seg(18 * 60 + 30, 20 * 60, "b"), seg(19 * 60, 20 * 60, "c")]),
    ).toEqual([
      ["b", 0, 3],
      ["a", 1, 3],
      ["c", 2, 3],
    ])
  })

  it("reuses a freed column and sizes the cluster by its busiest moment", () => {
    // a 10–12, b 10–11, c 11–12: c takes b's column; two columns, not three.
    expect(
      layout([seg(600, 720, "a"), seg(600, 660, "b"), seg(660, 720, "c")]),
    ).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 1, 2],
    ])
  })

  it("starts a new cluster after a gap", () => {
    expect(
      layout([seg(600, 660, "a"), seg(630, 690, "b"), seg(700, 760, "c")]),
    ).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 1],
    ])
  })

  it("keeps back-to-back classes in one column", () => {
    expect(layout([seg(600, 660, "a"), seg(660, 720, "b")])).toEqual([
      ["a", 0, 1],
      ["b", 0, 1],
    ])
  })

  it("separates two instants at the same minute", () => {
    expect(layout([seg(600, 600, "a"), seg(600, 600, "b")])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
    ])
  })

  it("widens a block over the free columns to its right", () => {
    // a 18–20 beside b and c 18–19; d 19–20 takes b's column and, with c
    // done by then, c's too.
    const spans = placeOverlaps([
      seg(18 * 60, 20 * 60, "a"),
      seg(18 * 60, 19 * 60, "b"),
      seg(18 * 60, 19 * 60, "c"),
      seg(19 * 60, 20 * 60, "d"),
    ]).map((p) => [p.item.key, p.column, p.span, p.columns])
    expect(spans).toEqual([
      ["a", 0, 1, 3],
      ["b", 1, 1, 3],
      ["c", 2, 1, 3],
      ["d", 1, 2, 3],
    ])
  })

  it("never widens over an overlapping neighbour", () => {
    expect(
      placeOverlaps([seg(600, 720, "a"), seg(630, 700, "b")]).map((p) => p.span),
    ).toEqual([1, 1])
  })
})

describe("fitTimeAxis", () => {
  it("falls back without segments", () => {
    expect(fitTimeAxis([])).toEqual(DEFAULT_AXIS)
  })

  it("spans the earliest start to the latest end on whole hours", () => {
    expect(fitTimeAxis([seg(8 * 60 + 30, 10 * 60), seg(21 * 60, 22 * 60 + 15)])).toEqual({
      startHour: 8,
      endHour: 23,
    })
  })

  it("doesn't stretch to midnight for a class crossing it", () => {
    const parts = splitByDay(
      item("a", "2026-11-02T20:00:00.000Z", "2026-11-02T22:00:00.000Z"),
    )
    expect(fitTimeAxis([seg(10 * 60, 11 * 60), ...parts])).toEqual({
      startHour: 0,
      endHour: 24,
    })
    // Only the evening part in view: the axis ends at midnight, starts at 10.
    expect(fitTimeAxis([seg(10 * 60, 11 * 60), parts[0]!])).toEqual({
      startHour: 10,
      endHour: 24,
    })
    // Only the continuation: the axis starts at midnight.
    expect(fitTimeAxis([seg(10 * 60, 11 * 60), parts[1]!])).toEqual({
      startHour: 0,
      endHour: 11,
    })
  })

  it("is at least an hour long", () => {
    expect(fitTimeAxis([seg(9 * 60, 9 * 60)])).toEqual({ startHour: 9, endHour: 10 })
  })
})

describe("blockFrame / nowOffset", () => {
  const axis = { startHour: 8, endHour: 22 }

  it("maps minutes to pixels from the axis start", () => {
    expect(blockFrame({ startMin: 9 * 60 + 30, endMin: 11 * 60 }, axis, 60)).toEqual({
      top: 90,
      height: 90,
    })
  })

  it("clips to the axis and keeps a minimum height", () => {
    expect(blockFrame({ startMin: 0, endMin: 8 * 60 + 30 }, axis, 60)).toEqual({
      top: 0,
      height: 30,
    })
    expect(blockFrame({ startMin: 600, endMin: 605 }, axis, 60, 20)).toEqual({
      top: 120,
      height: 20,
    })
    // A short block at the very end stays inside the grid.
    expect(blockFrame({ startMin: 22 * 60, endMin: 22 * 60 }, axis, 60, 20)).toEqual({
      top: 14 * 60 - 20,
      height: 20,
    })
  })

  it("places the now line only inside the axis", () => {
    expect(nowOffset(12 * 60, axis, 60)).toBe(240)
    expect(nowOffset(7 * 60, axis, 60)).toBeNull()
    expect(nowOffset(23 * 60, axis, 60)).toBeNull()
  })
})

describe("paging", () => {
  it("pages days by week", () => {
    expect([0, 6, 7, 13, 14].map(pageOfDay)).toEqual([0, 0, 1, 1, 2])
    expect(firstDayOfPage(2)).toBe(14)
    expect(CALENDAR_PAGES).toBe(12)
  })

  it("fetches two weeks at a time, padded by a day", () => {
    expect([0, 13, 14, 27, 28].map(fetchWindowOf)).toEqual([0, 0, 1, 1, 2])
    expect(fetchRange("2026-11-01", 0)).toEqual({
      from: "2026-10-31",
      to: "2026-11-16",
    })
    expect(fetchRange("2026-11-01", 1)).toEqual({
      from: "2026-11-14",
      to: "2026-11-30",
    })
    const keys = windowDayKeys("2026-11-01", 1)
    expect([keys[0], keys[13], keys.length]).toEqual(["2026-11-15", "2026-11-28", 14])
  })

  it("lists consecutive days across a month end", () => {
    expect(dayKeysFrom("2026-10-30", 4)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ])
  })
})

describe("labels", () => {
  it("names weekdays and dates", () => {
    expect(weekdayShort("2026-11-01")).toBe("Вс")
    expect(weekdayShort("2026-11-02")).toBe("Пн")
    expect(formatDayLong("2026-11-02")).toBe("2 ноября")
  })

  it("titles a week in one month or across two", () => {
    expect(formatWeekRange("2026-11-02", "2026-11-08")).toBe("2 – 8 ноября")
    expect(formatWeekRange("2026-11-29", "2026-12-05")).toBe(
      "29 ноября – 5 декабря",
    )
  })

  it("shortens a coach's name", () => {
    expect(
      shortPersonName({ firstname: "Роман", lastname: "Савельев", email: "r@x" }),
    ).toBe("Р. Савельев")
    expect(shortPersonName({ firstname: null, lastname: "Власов", email: "v@x" })).toBe(
      "Власов",
    )
    expect(shortPersonName({ firstname: " ", lastname: null, email: "v@x" })).toBe(
      "v@x",
    )
  })
})

describe("blockStateLine", () => {
  const booking = (over: Record<string, unknown>) =>
    ({
      capacity: 12,
      booked: 11,
      waitlist: 0,
      myBookingId: null,
      myStatus: null,
      myWaitlistPosition: null,
      ...over,
    }) as never

  it("says nothing for a fixed group's class", () => {
    expect(blockStateLine({ cancelled: false, booking: null }, false)).toBeNull()
    expect(blockStateLine({ cancelled: false }, false)).toBeNull()
  })

  it("marks a cancelled class", () => {
    expect(blockStateLine({ cancelled: true, booking: booking({}) }, true)).toEqual({
      text: "Отменено",
      tone: "cancelled",
    })
  })

  it("shows the member's own place first", () => {
    expect(blockStateLine({ cancelled: false }, true)).toEqual({
      text: "Вы записаны",
      tone: "mine",
    })
    expect(
      blockStateLine(
        { cancelled: false, booking: booking({ myBookingId: "b", myStatus: "BOOKED" }) },
        false,
      ),
    ).toEqual({ text: "Вы записаны", tone: "mine" })
    expect(
      blockStateLine(
        {
          cancelled: false,
          booking: booking({
            myBookingId: "b",
            myStatus: "WAITLISTED",
            myWaitlistPosition: 2,
          }),
        },
        false,
      ),
    ).toEqual({ text: "лист ожидания №2", tone: "mine" })
    expect(
      blockStateLine(
        { cancelled: false, booking: booking({ myBookingId: "b", myStatus: "WAITLISTED" }) },
        false,
      ),
    ).toEqual({ text: "лист ожидания", tone: "mine" })
  })

  it("shows the places otherwise", () => {
    expect(blockStateLine({ cancelled: false, booking: booking({}) }, false)).toEqual({
      text: "11/12",
      tone: "normal",
    })
    expect(
      blockStateLine({ cancelled: false, booking: booking({ booked: 12, waitlist: 3 }) }, false),
    ).toEqual({ text: "Мест нет · очередь 3", tone: "full" })
    expect(
      blockStateLine({ cancelled: false, booking: booking({ booked: 12 }) }, false),
    ).toEqual({ text: "Мест нет", tone: "full" })
    expect(
      blockStateLine({ cancelled: false, booking: booking({ capacity: null, booked: 4 }) }, false),
    ).toEqual({ text: "записано 4", tone: "normal" })
    expect(
      blockStateLine({ cancelled: false, booking: booking({ capacity: null, booked: 0 }) }, false),
    ).toBeNull()
  })
})

describe("fitLines", () => {
  const lines = [
    { k: "time", priority: 0 },
    { k: "title", priority: 0 },
    { k: "gym", priority: 3 },
    { k: "coach", priority: 4 },
    { k: "state", priority: 1 },
  ]

  it("keeps everything that fits", () => {
    expect(fitLines(lines, 9).map((l) => l.k)).toEqual([
      "time",
      "title",
      "gym",
      "coach",
      "state",
    ])
  })

  it("drops the least important lines, keeping the order", () => {
    expect(fitLines(lines, 3).map((l) => l.k)).toEqual(["time", "title", "state"])
    expect(fitLines(lines, 4).map((l) => l.k)).toEqual([
      "time",
      "title",
      "gym",
      "state",
    ])
    expect(fitLines(lines, 0)).toEqual([])
  })
})

describe("tintColor", () => {
  it("turns a hex color into a translucent fill", () => {
    expect(tintColor("#3b82f6", 0.2)).toBe("rgba(59, 130, 246, 0.2)")
    expect(tintColor("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)")
  })

  it("gives null for anything else", () => {
    expect(tintColor(null, 0.2)).toBeNull()
    expect(tintColor("red", 0.2)).toBeNull()
    expect(tintColor("#12345", 0.2)).toBeNull()
  })
})
