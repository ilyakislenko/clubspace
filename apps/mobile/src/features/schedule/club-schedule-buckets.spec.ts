import {
  MY_GROUPS_FILTER,
  filterSchedule,
  filterScheduleByGym,
  formatTimezoneLabel,
  resolveGymFilter,
  resolveScheduleFilter,
  scheduleChips,
  scheduleGyms,
} from "./club-schedule-buckets"

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

describe("«Мои группы» filter", () => {
  const sess = (id: string, groupId: string, gymId: string | null) => ({
    occurrenceId: id,
    groupId,
    group: { gym: gymId ? { id: gymId, name: gymId } : null },
  })
  const schedule = {
    timezone: "Europe/Moscow",
    sessions: [sess("s1", "a", "g1"), sess("s2", "b", "g1"), sess("s3", "c", "g2")],
    events: [{ id: "e1", gym: null }],
  }
  const own = new Set(["a", "c"])

  it("keeps only the classes of the member's own groups, across gyms", () => {
    const out = filterSchedule(schedule as never, MY_GROUPS_FILTER, own)
    expect(out.sessions.map((s) => s.occurrenceId)).toEqual(["s1", "s3"])
    expect(out.events).toEqual([])
  })

  it("shows nothing when the member has no groups", () => {
    const out = filterSchedule(schedule as never, MY_GROUPS_FILTER, new Set())
    expect(out.sessions).toEqual([])
  })

  it("falls through to the gym filter for any other value", () => {
    expect(filterSchedule(schedule as never, null, own)).toBe(schedule)
    const out = filterSchedule(schedule as never, "g1", own)
    expect(out.sessions.map((s) => s.occurrenceId)).toEqual(["s1", "s2"])
  })

  it("keeps a stored «Мои группы» only while the member has a group", () => {
    const gyms = [
      { id: "g1", name: "Арена" },
      { id: "g2", name: "Север" },
    ]
    expect(resolveScheduleFilter(MY_GROUPS_FILTER, gyms, true)).toBe(
      MY_GROUPS_FILTER,
    )
    expect(resolveScheduleFilter(MY_GROUPS_FILTER, gyms, false)).toBeNull()
    expect(resolveScheduleFilter("g1", gyms, false)).toBe("g1")
    expect(resolveScheduleFilter("gone", gyms, true)).toBeNull()
  })
})

describe("scheduleChips", () => {
  const arena = { id: "g1", name: "Арена" }
  const north = { id: "g2", name: "Север" }

  it("lists «Все залы» and every gym for a multi-gym club", () => {
    expect(scheduleChips([arena, north], true)).toEqual([
      { id: "my-groups", name: "Мои группы" },
      { id: null, name: "Все залы" },
      arena,
      north,
    ])
  })

  it("offers only «Мои группы» and «Всё расписание» for a single gym", () => {
    expect(scheduleChips([arena], true)).toEqual([
      { id: "my-groups", name: "Мои группы" },
      { id: null, name: "Всё расписание" },
    ])
    expect(scheduleChips([arena], false)).toEqual([
      { id: null, name: "Всё расписание" },
    ])
  })

  it("treats a stored gym as «everything» when the club has one gym", () => {
    expect(resolveScheduleFilter("g1", [arena], false)).toBeNull()
    expect(resolveScheduleFilter("g1", [arena, north], false)).toBe("g1")
  })
})
