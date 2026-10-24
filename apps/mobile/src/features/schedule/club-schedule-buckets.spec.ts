import {
  buildDayBuckets,
  filterScheduleByGym,
  formatTimezoneLabel,
  resolveGymFilter,
  scheduleGyms,
  withClasses,
} from "./club-schedule-buckets"

const NOW = Date.UTC(2026, 9, 24, 9, 0) // Sat 24 Oct 2026 12:00 in Moscow

const empty = { timezone: "Europe/Moscow", sessions: [], events: [] }

const session = (startAt: string, timezone: string) =>
  ({ occurrenceId: startAt + timezone, startAt, timezone }) as never

describe("buildDayBuckets", () => {
  it("makes one bucket per day, 14 by default window", () => {
    const buckets = buildDayBuckets(empty as never, 14, NOW)
    expect(buckets).toHaveLength(14)
    expect(buckets[0]!.dateKey).toBe("2026-10-24")
    expect(buckets[0]!.dateShort).toBe("24.10")
    expect(buckets[13]!.dateKey).toBe("2026-11-06")
  })

  it("puts a session on its own timezone's calendar day", () => {
    // 21:30 UTC on the 24th is already the 25th in Moscow (UTC+3)...
    const s = session("2026-10-24T21:30:00.000Z", "Europe/Moscow")
    // ...but still the 24th in UTC.
    const u = session("2026-10-24T21:30:00.000Z", "UTC")
    const buckets = buildDayBuckets(
      { ...empty, sessions: [s, u] } as never,
      14,
      NOW,
    )
    expect(buckets[0]!.sessions).toEqual([u])
    expect(buckets[1]!.sessions).toEqual([s])
  })
})

describe("withClasses", () => {
  it("drops every day when nothing is scheduled", () => {
    expect(withClasses(buildDayBuckets(empty as never, 14, NOW))).toEqual([])
  })

  it("keeps days with a session or an event", () => {
    const s = session("2026-10-26T15:00:00.000Z", "Europe/Moscow")
    const e = {
      id: "e1",
      startAt: "2026-10-28T15:00:00.000Z",
      timezone: "Europe/Moscow",
    }
    const kept = withClasses(
      buildDayBuckets(
        { ...empty, sessions: [s], events: [e] } as never,
        14,
        NOW,
      ),
    )
    expect(kept.map((b) => b.dateKey)).toEqual(["2026-10-26", "2026-10-28"])
  })
})

describe("formatTimezoneLabel", () => {
  it("never returns an empty label", () => {
    expect(formatTimezoneLabel("Europe/Moscow").length).toBeGreaterThan(0)
    expect(formatTimezoneLabel("Not/AZone")).toBe("Not/AZone")
  })
})

describe("gym filter", () => {
  const gym = (id: string, name: string) => ({ id, name, address: "ул. 1" })
  const sess = (id: string, g: ReturnType<typeof gym> | null) =>
    ({ occurrenceId: id, group: { gym: g } }) as never
  const ev = (id: string, g: ReturnType<typeof gym> | null) =>
    ({ id, gym: g }) as never
  const schedule = {
    timezone: "Europe/Moscow",
    sessions: [
      sess("s1", gym("g2", "Яблоко")),
      sess("s2", gym("g1", "Арена")),
      sess("s3", null),
    ],
    events: [ev("e1", gym("g1", "Арена")), ev("e2", null), ev("e3", gym("g3", "Ёлка"))],
  }

  it("lists each gym once, sorted by name", () => {
    expect(scheduleGyms(schedule as never)).toEqual([
      { id: "g1", name: "Арена" },
      { id: "g3", name: "Ёлка" },
      { id: "g2", name: "Яблоко" },
    ])
  })

  it("keeps everything for «Все залы»", () => {
    expect(filterScheduleByGym(schedule as never, null)).toBe(schedule)
  })

  it("keeps one gym's classes and every club-wide event", () => {
    const out = filterScheduleByGym(schedule as never, "g1")
    expect(out.sessions.map((s) => s.occurrenceId)).toEqual(["s2"])
    expect(out.events.map((e) => e.id)).toEqual(["e1", "e2"])
  })

  it("falls back to «Все залы» for a gym that is gone", () => {
    const gyms = scheduleGyms(schedule as never)
    expect(resolveGymFilter("g1", gyms)).toBe("g1")
    expect(resolveGymFilter("gone", gyms)).toBeNull()
    expect(resolveGymFilter(null, gyms)).toBeNull()
  })
})
