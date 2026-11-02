import { eventAt, sessionAt } from "./calendar-fixtures"
import {
  activeFilterCount,
  buildCalendarItems,
  EMPTY_FILTERS,
  fillLabel,
  groupByDate,
  hallColumns,
  isFull,
  type HallColumn,
} from "./calendar-items"
import { substitutionLabel } from "./substitution"

const opts = {
  filters: EMPTY_FILTERS,
  canEdit: () => true,
  onlyGroupIds: null,
}

describe("buildCalendarItems", () => {
  it("places a class on its club day and wall-clock minutes", () => {
    const [item] = buildCalendarItems(
      { sessions: [sessionAt("2026-11-04", "19:00", { durationMin: 90 })], events: [] },
      opts,
    )
    expect(item).toMatchObject({
      kind: "class",
      date: "2026-11-04",
      startMin: 19 * 60,
      endMin: 20 * 60 + 30,
      title: "Группа g1",
      color: "#2563eb",
      gymId: "gym1",
      coachIds: ["c1"],
      editable: true,
    })
  })

  it("hides the cancelled original of a moved class and locks cancelled ones", () => {
    const items = buildCalendarItems(
      {
        sessions: [
          sessionAt("2026-11-04", "19:00", {
            cancelled: true,
            rescheduledTo: { slotId: "x", sessionDate: "2026-11-05", startAt: "2026-11-05T12:00:00.000Z" },
          }),
          sessionAt("2026-11-05", "19:00", { groupId: "g2", cancelled: true }),
        ],
        events: [],
      },
      opts,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: "slot-g2:2026-11-05", cancelled: true, editable: false })
  })

  it("filters by gym, coach, group and own groups; events drop out under a group filter", () => {
    const schedule = {
      sessions: [
        sessionAt("2026-11-04", "10:00", { groupId: "g1", gymId: "gym1", coachId: "c1" }),
        sessionAt("2026-11-04", "11:00", { groupId: "g2", gymId: "gym2", coachId: "c2" }),
      ],
      events: [eventAt("2026-11-04T05:00:00.000Z", "2026-11-04T07:00:00.000Z")],
    }
    const keys = (filters: Partial<typeof EMPTY_FILTERS>, onlyGroupIds: Set<string> | null = null) =>
      buildCalendarItems(schedule, {
        ...opts,
        filters: { ...EMPTY_FILTERS, ...filters },
        onlyGroupIds,
      }).map((i) => i.key)

    expect(keys({})).toEqual(["slot-g1:2026-11-04", "slot-g2:2026-11-04", "event:e1"])
    expect(keys({ gymId: "gym2" })).toEqual(["slot-g2:2026-11-04"])
    expect(keys({ coachId: "c1" })).toEqual(["slot-g1:2026-11-04"])
    expect(keys({ groupId: "g1" })).toEqual(["slot-g1:2026-11-04"])
    expect(keys({}, new Set(["g2"]))).toEqual(["slot-g2:2026-11-04", "event:e1"])
    expect(keys({ directionId: "nope" })).toEqual([])
    expect(activeFilterCount({ ...EMPTY_FILTERS, gymId: "gym1", groupId: "g1" })).toBe(2)
  })

  it("draws a multi-day event on its first day up to midnight", () => {
    const [item] = buildCalendarItems(
      { sessions: [], events: [eventAt("2026-11-04T10:00:00.000Z", "2026-11-05T10:00:00.000Z")] },
      opts,
    )
    expect(item).toMatchObject({ kind: "event", date: "2026-11-04", startMin: 17 * 60, endMin: 24 * 60 })
  })

  it("counts the approved substitute as the busy coach", () => {
    const s = {
      ...sessionAt("2026-11-04", "19:00"),
      substitution: {
        id: "sub1",
        status: "APPROVED" as const,
        kind: "ASSIGN" as const,
        substitute: { id: "c9", email: null, firstname: "Иван", lastname: "Старокоров" },
        requestedById: "u1",
      },
    }
    const [item] = buildCalendarItems({ sessions: [s], events: [] }, opts)
    expect(item.coachIds).toEqual(["c9"])
    expect(substitutionLabel(s)).toBe("Замена: И. Старокоров")
    expect(substitutionLabel({ ...s, substitution: { ...s.substitution, status: "PENDING" } })).toBe(
      "Запрос на замену",
    )
    expect(substitutionLabel(sessionAt("2026-11-04", "19:00"))).toBeNull()
  })
})

describe("fill", () => {
  const booking = {
    capacity: 12,
    booked: 11,
    waitlist: 0,
    opensOn: "2026-10-28",
    cancelDeadline: "2026-11-04T09:00:00.000Z",
    myBookingId: null,
    myStatus: "BOOKED" as const,
    myWaitlistPosition: null,
  }

  it("labels booking classes «11/12» and flags full ones", () => {
    expect(fillLabel(sessionAt("2026-11-04", "19:00", { booking }))).toBe("11/12")
    expect(isFull(sessionAt("2026-11-04", "19:00", { booking }))).toBe(false)
    expect(isFull(sessionAt("2026-11-04", "19:00", { booking: { ...booking, booked: 12 } }))).toBe(true)
    expect(fillLabel(sessionAt("2026-11-04", "19:00", { booking: { ...booking, capacity: null } }))).toBe("11")
    expect(fillLabel(sessionAt("2026-11-04", "19:00"))).toBeNull()
  })

  it("groups items by day", () => {
    const map = groupByDate([{ date: "a" }, { date: "b" }, { date: "a" }])
    expect([...map.keys()]).toEqual(["a", "b"])
    expect(map.get("a")).toHaveLength(2)
  })
})

describe("hallColumns", () => {
  const gyms = [
    { id: "gym1", name: "Зал gym1", address: "ул. Ленина, 1" },
    { id: "gym2", name: "Зал gym2", address: "—" },
    { id: "gym3", name: "Зал gym3", address: "—" },
  ]
  const day = buildCalendarItems(
    {
      sessions: [
        sessionAt("2026-11-04", "19:00", { groupId: "g3", gymId: "gym3" }),
        sessionAt("2026-11-04", "18:00"),
        sessionAt("2026-11-04", "18:00", { groupId: "g9", gymId: "gym9" }),
      ],
      events: [eventAt("2026-11-04T13:00:00.000Z", "2026-11-04T14:00:00.000Z", { gym: null })],
    },
    opts,
  )
  const ids = (cols: HallColumn[]) => cols.map((c) => c.id)

  it("keeps the club's order of halls, then halls the list lacks, then «Без зала»", () => {
    const cols = hallColumns(gyms, day, { creatableGymIds: new Set(["gym1", "gym2"]), showEmpty: true })
    expect(ids(cols)).toEqual(["gym1", "gym2", "gym3", "gym9", null])
    expect(cols[0]).toEqual({ id: "gym1", name: "Зал gym1", address: "ул. Ленина, 1", canCreate: true })
    expect(cols[2].canCreate).toBe(false)
    expect(cols[3].name).toBe("Зал gym9")
    expect(cols[4]).toMatchObject({ name: "Без зала", canCreate: false })
  })

  it("drops an empty hall under a filter or when the viewer cannot add a class there", () => {
    expect(ids(hallColumns(gyms, day, { creatableGymIds: new Set(["gym2"]), showEmpty: false }))).toEqual([
      "gym1",
      "gym3",
      "gym9",
      null,
    ])
    expect(ids(hallColumns(gyms, [], { creatableGymIds: new Set(), showEmpty: true }))).toEqual([])
  })
})
