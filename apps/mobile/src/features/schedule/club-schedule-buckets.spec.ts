import {
  MY_GROUPS_FILTER,
  filterSchedule,
  filterScheduleByGym,
  formatTimezoneLabel,
  resolveScheduleFilter,
  scheduleChips,
  scheduleFilterSummary,
  scheduleGyms,
  toggleScheduleFilter,
} from "./club-schedule-buckets"

describe("formatTimezoneLabel", () => {
  it("never returns an empty label", () => {
    expect(formatTimezoneLabel("Europe/Moscow").length).toBeGreaterThan(0)
    expect(formatTimezoneLabel("Not/AZone")).toBe("Not/AZone")
  })

  it("shows the zone's offset from UTC", () => {
    const now = new Date("2026-11-02T05:00:00Z")
    expect(formatTimezoneLabel("Asia/Tomsk", now)).toBe("GMT+7")
    expect(formatTimezoneLabel("Europe/Moscow", now)).toBe("GMT+3")
    expect(formatTimezoneLabel("UTC", now)).toBe("GMT")
    expect(formatTimezoneLabel("Asia/Kolkata", now)).toBe("GMT+5:30")
    expect(formatTimezoneLabel("America/New_York", now)).toBe("GMT-5")
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
    expect(filterScheduleByGym(schedule as never, [])).toBe(schedule)
  })

  it("keeps one gym's classes and every club-wide event", () => {
    const out = filterScheduleByGym(schedule as never, ["g1"])
    expect(out.sessions.map((s) => s.occurrenceId)).toEqual(["s2"])
    expect(out.events.map((e) => e.id)).toEqual(["e1", "e2"])
  })

  it("keeps the classes of any picked gym", () => {
    const out = filterScheduleByGym(schedule as never, ["g1", "g2"])
    expect(out.sessions.map((s) => s.occurrenceId)).toEqual(["s1", "s2"])
    expect(out.events.map((e) => e.id)).toEqual(["e1", "e2"])
  })

  it("drops picked gyms that are gone, in the gyms' order", () => {
    const gyms = scheduleGyms(schedule as never)
    expect(resolveScheduleFilter(["g2", "gone", "g1"], gyms, false)).toEqual([
      "g1",
      "g2",
    ])
    expect(resolveScheduleFilter(["gone"], gyms, false)).toEqual([])
    expect(resolveScheduleFilter([], gyms, false)).toEqual([])
  })

  it("reads every gym picked as «Все залы»", () => {
    const gyms = scheduleGyms(schedule as never)
    expect(resolveScheduleFilter(["g1", "g2", "g3"], gyms, false)).toEqual([])
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
    const out = filterSchedule(schedule as never, [MY_GROUPS_FILTER], own)
    expect(out.sessions.map((s) => s.occurrenceId)).toEqual(["s1", "s3"])
    expect(out.events).toEqual([])
  })

  it("shows nothing when the member has no groups", () => {
    const out = filterSchedule(schedule as never, [MY_GROUPS_FILTER], new Set())
    expect(out.sessions).toEqual([])
  })

  it("falls through to the gym filter otherwise", () => {
    expect(filterSchedule(schedule as never, [], own)).toBe(schedule)
    const out = filterSchedule(schedule as never, ["g1"], own)
    expect(out.sessions.map((s) => s.occurrenceId)).toEqual(["s1", "s2"])
  })

  it("keeps a stored «Мои группы» only while the member has a group", () => {
    const gyms = [
      { id: "g1", name: "Арена" },
      { id: "g2", name: "Север" },
    ]
    expect(resolveScheduleFilter([MY_GROUPS_FILTER], gyms, true)).toEqual([
      MY_GROUPS_FILTER,
    ])
    expect(resolveScheduleFilter([MY_GROUPS_FILTER], gyms, false)).toEqual([])
    expect(resolveScheduleFilter(["g1"], gyms, false)).toEqual(["g1"])
    expect(resolveScheduleFilter(["gone"], gyms, true)).toEqual([])
  })
})

describe("toggleScheduleFilter", () => {
  const gyms = [
    { id: "g1", name: "Арена" },
    { id: "g2", name: "Север" },
    { id: "g3", name: "Юг" },
  ]

  it("adds and removes gyms", () => {
    expect(toggleScheduleFilter([], "g2", gyms, true)).toEqual(["g2"])
    expect(toggleScheduleFilter(["g2"], "g1", gyms, true)).toEqual(["g1", "g2"])
    expect(toggleScheduleFilter(["g1", "g2"], "g2", gyms, true)).toEqual(["g1"])
  })

  it("clears on «Все залы»", () => {
    expect(toggleScheduleFilter(["g1", "g2"], null, gyms, true)).toEqual([])
    expect(toggleScheduleFilter([MY_GROUPS_FILTER], null, gyms, true)).toEqual([])
  })

  it("keeps «Мои группы» apart from the gyms", () => {
    expect(
      toggleScheduleFilter(["g1", "g2"], MY_GROUPS_FILTER, gyms, true),
    ).toEqual([MY_GROUPS_FILTER])
    expect(
      toggleScheduleFilter([MY_GROUPS_FILTER], "g3", gyms, true),
    ).toEqual(["g3"])
    expect(
      toggleScheduleFilter([MY_GROUPS_FILTER], MY_GROUPS_FILTER, gyms, true),
    ).toEqual([])
  })

  it("collapses back to «Все залы» once every gym is picked", () => {
    expect(toggleScheduleFilter(["g1", "g2"], "g3", gyms, false)).toEqual([])
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
    expect(resolveScheduleFilter(["g1"], [arena], false)).toEqual([])
    expect(resolveScheduleFilter(["g1"], [arena, north], false)).toEqual(["g1"])
  })
})

describe("scheduleFilterSummary", () => {
  const directions = [
    { id: "bjj", name: "БЖЖ" },
    { id: "mma", name: "ММА" },
    { id: "box", name: "Бокс" },
    { id: "yoga", name: "Йога" },
  ]
  const gyms = [
    { id: "g1", name: "Зал на Ленина" },
    { id: "g2", name: "Центр" },
    { id: "g3", name: "Север" },
  ]

  it("says «everything» by default, not accented", () => {
    expect(
      scheduleFilterSummary({
        directions,
        directionIds: [],
        chips: scheduleChips(gyms, true),
        filterIds: [],
      }),
    ).toEqual({ label: "Все направления · Все залы", active: false })
  })

  it("names up to two directions, then counts them", () => {
    const label = (directionIds: string[]) =>
      scheduleFilterSummary({
        directions,
        directionIds,
        chips: scheduleChips(gyms, false),
        filterIds: [],
      })
    expect(label(["bjj"])).toEqual({ label: "БЖЖ · Все залы", active: true })
    expect(label(["mma", "bjj"])).toEqual({
      label: "БЖЖ, ММА · Все залы",
      active: true,
    })
    expect(label(["bjj", "mma", "box"])?.label).toBe("3 направления · Все залы")
  })

  it("names «Мои группы» or one gym, counts several", () => {
    const label = (filterIds: string[]) =>
      scheduleFilterSummary({
        directions,
        directionIds: [],
        chips: scheduleChips(gyms, true),
        filterIds,
      })
    expect(label([MY_GROUPS_FILTER])).toEqual({
      label: "Все направления · Мои группы",
      active: true,
    })
    expect(label(["g2"])?.label).toBe("Все направления · Центр")
    expect(label(["g1", "g2"])?.label).toBe("Все направления · 2 зала")
  })

  it("leaves out what the club can't filter by", () => {
    expect(
      scheduleFilterSummary({
        directions: [],
        directionIds: [],
        chips: scheduleChips(gyms, false),
        filterIds: ["g1"],
      }),
    ).toEqual({ label: "Зал на Ленина", active: true })
    expect(
      scheduleFilterSummary({
        directions,
        directionIds: ["mma"],
        chips: null,
        filterIds: [],
      }),
    ).toEqual({ label: "ММА", active: true })
    expect(
      scheduleFilterSummary({
        directions: [],
        directionIds: [],
        chips: null,
        filterIds: [],
      }),
    ).toBeNull()
  })
})
