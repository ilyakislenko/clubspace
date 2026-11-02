import type { ScheduleEvent } from "../../shared/api/groups"
import {
  eventStatusLine,
  formatEventWhen,
  greetingName,
  isCoachView,
  pickCoachClassesToday,
  pickNextEvent,
  pickNextTraining,
  showCheckInButton,
  showHomeFallback,
  showSubscriptionCard,
  type MyEventRegistration,
} from "./home-helpers"

describe("greetingName", () => {
  it("uses the trimmed first name", () => {
    expect(greetingName({ firstname: "  Илья " })).toBe("Илья")
  })

  it("is null when there is no usable name", () => {
    expect(greetingName({ firstname: null })).toBeNull()
    expect(greetingName({ firstname: "   " })).toBeNull()
    expect(greetingName(null)).toBeNull()
  })
})

describe("showSubscriptionCard", () => {
  const none = { abonements: [], history: [] }

  it("always shows the card to a member", () => {
    expect(showSubscriptionCard(false, none)).toBe(true)
  })

  it("hides «не оформлен» from staff", () => {
    expect(showSubscriptionCard(true, none)).toBe(false)
  })

  it("shows staff their own current or past abonement", () => {
    expect(showSubscriptionCard(true, { abonements: [{}], history: [] })).toBe(true)
    expect(showSubscriptionCard(true, { abonements: [], history: [{}] })).toBe(
      true,
    )
  })

  it("reads a cache without abonements as none", () => {
    expect(showSubscriptionCard(true, { history: [] })).toBe(false)
  })
})

describe("showHomeFallback", () => {
  const off = {
    groupsOn: false,
    attendanceOn: false,
    subscriptionOn: false,
    hasRecents: false,
    hasAnnouncement: false,
  }

  it("shows when nothing else can render", () => {
    expect(showHomeFallback(off)).toBe(true)
  })

  it.each(["groupsOn", "attendanceOn", "subscriptionOn", "hasRecents", "hasAnnouncement"] as const)(
    "hides when %s",
    (key) => {
      expect(showHomeFallback({ ...off, [key]: true })).toBe(false)
    },
  )
})

describe("pickNextTraining", () => {
  const now = new Date("2026-10-27T09:00:00Z")
  const groupNext = (iso: string) =>
    ({
      next: { startAt: new Date(iso) },
      group: { id: "g" },
    }) as never
  const booking = (startAt: string, over: Record<string, unknown> = {}) =>
    ({
      id: "b",
      startAt,
      endAt: new Date(new Date(startAt).getTime() + 90 * 60_000).toISOString(),
      cancelled: false,
      ...over,
    }) as never

  it("is null with nothing to show", () => {
    expect(pickNextTraining(null, [], now)).toBeNull()
  })

  it("takes the earlier of the group's class and a booking", () => {
    const g = groupNext("2026-10-29T14:00:00Z")
    expect(pickNextTraining(g, [booking("2026-10-28T14:00:00Z")], now)?.kind).toBe(
      "dropin",
    )
    expect(pickNextTraining(g, [booking("2026-10-30T14:00:00Z")], now)?.kind).toBe(
      "group",
    )
  })

  it("gives a tie to the group", () => {
    const g = groupNext("2026-10-28T14:00:00Z")
    expect(pickNextTraining(g, [booking("2026-10-28T14:00:00Z")], now)?.kind).toBe(
      "group",
    )
  })

  it("skips cancelled and finished bookings", () => {
    const out = pickNextTraining(
      null,
      [
        booking("2026-10-28T14:00:00Z", { cancelled: true }),
        booking("2026-10-26T14:00:00Z"),
      ],
      now,
    )
    expect(out).toBeNull()
  })

  it("keeps a booking that is under way", () => {
    const out = pickNextTraining(null, [booking("2026-10-27T08:30:00Z")], now)
    expect(out?.kind).toBe("dropin")
  })

  describe("personal sessions", () => {
    const personal = (startAt: string, over: Record<string, unknown> = {}) =>
      ({
        id: "p",
        displayStatus: "CONFIRMED",
        confirmedStartAt: startAt,
        confirmedDurationMin: 60,
        ...over,
      }) as never

    it("wins when it is the soonest", () => {
      const g = groupNext("2026-10-29T14:00:00Z")
      const out = pickNextTraining(
        g,
        [booking("2026-10-30T14:00:00Z")],
        now,
        [personal("2026-10-28T14:00:00Z")],
      )
      expect(out?.kind).toBe("personal")
    })

    it("loses a tie to the group and to a booking", () => {
      const at = "2026-10-28T14:00:00Z"
      expect(
        pickNextTraining(groupNext(at), [], now, [personal(at)])?.kind,
      ).toBe("group")
      expect(
        pickNextTraining(null, [booking(at)], now, [personal(at)])?.kind,
      ).toBe("dropin")
    })

    it("skips unconfirmed, finished and under-way-but-over sessions", () => {
      const out = pickNextTraining(null, [], now, [
        personal("2026-10-28T14:00:00Z", { displayStatus: "PENDING_COACH" }),
        personal("2026-10-27T07:00:00Z"),
        personal("2026-10-28T14:00:00Z", { displayStatus: "CANCELLED" }),
      ])
      expect(out).toBeNull()
    })

    it("keeps a session that is under way", () => {
      const out = pickNextTraining(null, [], now, [
        personal("2026-10-27T08:30:00Z"),
      ])
      expect(out?.kind).toBe("personal")
    })
  })

  describe("class bookings", () => {
    const held = (startAt: string, over: Record<string, unknown> = {}) =>
      ({
        id: "cb",
        status: "BOOKED",
        classCancelled: false,
        startAt,
        endAt: new Date(new Date(startAt).getTime() + 3_600_000).toISOString(),
        ...over,
      }) as never

    it("counts a held place when the member has no group", () => {
      const out = pickNextTraining(null, [], now, [], [
        held("2026-10-28T12:00:00Z"),
      ])
      expect(out?.kind).toBe("classBooking")
      expect(out?.startAt.toISOString()).toBe("2026-10-28T12:00:00.000Z")
    })

    it("wins over a later group class", () => {
      const out = pickNextTraining(groupNext("2026-10-29T14:00:00Z"), [], now, [], [
        held("2026-10-28T12:00:00Z"),
      ])
      expect(out?.kind).toBe("classBooking")
    })

    it("skips the waitlist, cancelled classes and finished ones", () => {
      const out = pickNextTraining(null, [], now, [], [
        held("2026-10-28T12:00:00Z", { status: "WAITLISTED" }),
        held("2026-10-28T12:00:00Z", { classCancelled: true }),
        held("2026-10-27T06:00:00Z"),
      ])
      expect(out).toBeNull()
    })
  })

  it("picks the earliest booking", () => {
    const out = pickNextTraining(
      null,
      [booking("2026-10-30T14:00:00Z"), booking("2026-10-28T14:00:00Z")],
      now,
    )
    expect(out?.startAt.toISOString()).toBe("2026-10-28T14:00:00.000Z")
  })
})

describe("isCoachView", () => {
  const group = (role: "coach" | "student") => ({ role }) as never

  it("is on for the coaching roles", () => {
    for (const role of ["coach", "head_coach", "admin"]) {
      expect(isCoachView(role, [])).toBe(true)
    }
  })

  it("is on for anyone who coaches a group", () => {
    expect(isCoachView("user", [group("student"), group("coach")])).toBe(true)
  })

  it("stays off for a pure student", () => {
    expect(isCoachView("user", [group("student")])).toBe(false)
    expect(isCoachView(undefined, [])).toBe(false)
  })
})

describe("showCheckInButton", () => {
  const group = (role: "coach" | "student") => ({ role }) as never

  it("is on for a pure student", () => {
    expect(showCheckInButton("user", [group("student")])).toBe(true)
    expect(showCheckInButton("user", [])).toBe(true)
  })

  it("stays on for a coach who also trains as a student", () => {
    expect(
      showCheckInButton("coach", [group("coach"), group("student")]),
    ).toBe(true)
  })

  it("is off for a coach who only leads groups", () => {
    expect(showCheckInButton("coach", [group("coach")])).toBe(false)
    expect(showCheckInButton("user", [group("coach")])).toBe(false)
  })

  it("is on for staff with no groups at all", () => {
    for (const role of ["coach", "head_coach", "admin"]) {
      expect(showCheckInButton(role, [])).toBe(true)
    }
  })
})

describe("pickCoachClassesToday", () => {
  // Tue 27 Oct 2026, 12:00 in Moscow.
  const now = new Date("2026-10-27T09:00:00Z")
  const slot = (id: string, dayOfWeek: number, startTime: string) => ({
    id,
    dayOfWeek,
    startTime,
    durationMin: 60,
    effectiveFrom: null,
    effectiveUntil: null,
  })
  const group = (over: Record<string, unknown>) =>
    ({
      id: "g",
      name: "Группа",
      role: "coach",
      timezone: "Europe/Moscow",
      gym: { id: "z", name: "Зал", address: "ул. А" },
      slots: [],
      exceptions: [],
      ...over,
    }) as never

  it("lists today's classes of coached groups, earliest first", () => {
    const out = pickCoachClassesToday(
      [
        group({
          id: "a",
          name: "Взрослые",
          slots: [slot("s2", 2, "19:00"), slot("s9", 3, "10:00")],
        }),
        group({
          id: "b",
          name: "Дети 6–9",
          gym: null,
          slots: [slot("s1", 2, "18:00")],
        }),
      ],
      now,
    )
    expect(out.map((c) => [c.startTime, c.groupName, c.gymName])).toEqual([
      ["18:00", "Дети 6–9", null],
      ["19:00", "Взрослые", "Зал"],
    ])
    expect(out[0]).toMatchObject({ slotId: "s1", sessionDate: "2026-10-27" })
  })

  it("ignores groups the user only studies in", () => {
    expect(
      pickCoachClassesToday(
        [group({ role: "student", slots: [slot("s1", 2, "18:00")] })],
        now,
      ),
    ).toEqual([])
  })

  it("drops a cancelled class", () => {
    const out = pickCoachClassesToday(
      [
        group({
          slots: [slot("s1", 2, "18:00"), slot("s2", 2, "19:00")],
          exceptions: [
            {
              id: "e",
              slotId: "s1",
              fromDate: "2026-10-27",
              untilDate: "2026-10-27",
              reason: null,
            },
          ],
        }),
      ],
      now,
    )
    expect(out.map((c) => c.slotId)).toEqual(["s2"])
  })

  it("reads «today» in the group's own zone", () => {
    // 21:30 UTC on Tue is already Wed 00:30 in Moscow.
    const late = new Date("2026-10-27T21:30:00Z")
    const wed = group({ slots: [slot("s1", 3, "10:00")] })
    expect(pickCoachClassesToday([wed], late).map((c) => c.slotId)).toEqual([
      "s1",
    ])
    expect(pickCoachClassesToday([wed], now)).toEqual([])
  })
})

describe("pickCoachClassesToday with personal sessions", () => {
  // Tue 27 Oct 2026, 12:00 in Moscow.
  const now = new Date("2026-10-27T09:00:00Z")
  const pt = (over: Record<string, unknown>) =>
    ({
      id: "p1",
      status: "CONFIRMED",
      member: { userId: "m1", displayName: "Анна" },
      coach: { userId: "me", displayName: "Я" },
      gym: { id: "z", name: "Зал", address: "ул. А" },
      timezone: "Europe/Moscow",
      confirmedStartAt: "2026-10-27T15:30:00Z", // 18:30 Moscow
      sessionId: "sess1",
      ...over,
    }) as never

  it("lists the coach's confirmed personal sessions today with their session id", () => {
    const out = pickCoachClassesToday([], now, [pt({})], "me")
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      groupName: "Персональная · Анна",
      gymName: "Зал",
      startTime: "18:30",
      sessionId: "sess1",
      slotId: null,
    })
  })

  it("skips other days, unconfirmed ones and sessions where I am the member", () => {
    expect(
      pickCoachClassesToday(
        [],
        now,
        [
          pt({ id: "a", confirmedStartAt: "2026-10-28T15:30:00Z" }),
          pt({ id: "b", status: "PENDING_COACH" }),
          pt({ id: "c", coach: { userId: "x", displayName: "Х" } }),
          pt({ id: "d", member: { userId: "me", displayName: "Я" } }),
        ],
        "me",
      ),
    ).toEqual([])
  })

  it("orders them with the group classes by start", () => {
    const group = {
      id: "g",
      name: "Группа",
      role: "coach",
      timezone: "Europe/Moscow",
      gym: null,
      slots: [
        {
          id: "s1",
          dayOfWeek: 2,
          startTime: "19:00",
          durationMin: 60,
          effectiveFrom: null,
          effectiveUntil: null,
        },
      ],
      exceptions: [],
    } as never
    const out = pickCoachClassesToday([group], now, [pt({})], "me")
    expect(out.map((c) => c.startTime)).toEqual(["18:30", "19:00"])
  })
})

describe("pickCoachClassesToday with substitutions", () => {
  // Tue 27 Oct 2026, 12:00 in Moscow.
  const now = new Date("2026-10-27T09:00:00Z")
  const own = {
    id: "g",
    name: "Взрослые",
    role: "coach",
    timezone: "Europe/Moscow",
    gym: { id: "z", name: "Зал", address: "ул. А" },
    slots: [
      {
        id: "s1",
        dayOfWeek: 2,
        startTime: "19:00",
        durationMin: 60,
        effectiveFrom: null,
        effectiveUntil: null,
      },
    ],
    exceptions: [],
  } as never
  const sub = (over: Record<string, unknown>) =>
    ({
      id: "sub1",
      slotId: "s1",
      sessionDate: "2026-10-27",
      groupName: "Взрослые",
      gym: { id: "z", name: "Зал" },
      startAt: "2026-10-27T16:00:00Z", // 19:00 Moscow
      timezone: "Europe/Moscow",
      status: "APPROVED",
      substitute: { id: "c2", email: null, firstname: "Олег", lastname: "Петров" },
      ...over,
    }) as never

  it("keeps an own class somebody else runs, noted with who", () => {
    const out = pickCoachClassesToday([own], now, [], "me", [sub({})])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ slotId: "s1", note: "Замена: О. Петров" })
  })

  it("ignores a pending request on an own class", () => {
    const out = pickCoachClassesToday([own], now, [], "me", [
      sub({ status: "PENDING" }),
    ])
    expect(out[0].note).toBeUndefined()
  })

  it("lists today's class the viewer substitutes in, noted «Замена»", () => {
    const out = pickCoachClassesToday([], now, [], "c2", [
      sub({ slotId: "x1", groupName: "Дети", startAt: "2026-10-27T15:00:00Z" }),
      // Not today, or not approved: left out.
      sub({ slotId: "x2", startAt: "2026-10-28T15:00:00Z", sessionDate: "2026-10-28" }),
      sub({ slotId: "x3", status: "PENDING" }),
    ])
    expect(out).toEqual([
      {
        key: "x1:2026-10-27",
        groupName: "Дети",
        gymName: "Зал",
        slotId: "x1",
        sessionDate: "2026-10-27",
        sessionId: null,
        startTime: "18:00",
        note: "Замена",
      },
    ])
    // Without a known viewer nothing is theirs.
    expect(pickCoachClassesToday([], now, [], null, [sub({})])).toEqual([])
  })
})

describe("pickNextEvent", () => {
  const now = new Date("2026-11-03T12:00:00Z")
  const mine = (
    over: Partial<MyEventRegistration> = {},
  ): MyEventRegistration => ({
    id: "r",
    eventId: "e",
    status: "BOOKED",
    waitlistPosition: null,
    isPaid: false,
    promotedAt: null,
    cancelledAt: null,
    createdAt: "2026-11-01T00:00:00Z",
    ...over,
  })
  const event = (
    id: string,
    startAt: string,
    my: MyEventRegistration | null,
    endAt = new Date(new Date(startAt).getTime() + 2 * 3_600_000).toISOString(),
  ): ScheduleEvent => ({
    id,
    workspaceId: "w",
    title: `Мастер-класс ${id}`,
    description: null,
    link: null,
    startAt,
    endAt,
    timezone: "Asia/Tomsk",
    gym: null,
    coach: null,
    createdById: "u",
    price: 1500,
    capacity: 10,
    registration: { booked: 1, waitlist: 0, mine: my },
  })

  it("takes the soonest upcoming event the member signed up for", () => {
    const picked = pickNextEvent(
      [
        event("later", "2026-11-20T10:00:00Z", mine()),
        event("sooner", "2026-11-10T10:00:00Z", mine({ status: "WAITLISTED" })),
        event("not-mine", "2026-11-05T10:00:00Z", null),
      ],
      now,
    )
    expect(picked?.event.id).toBe("sooner")
    expect(picked?.mine.status).toBe("WAITLISTED")
  })

  it("skips finished events and cancelled registrations", () => {
    const picked = pickNextEvent(
      [
        event("past", "2026-11-01T10:00:00Z", mine()),
        event("cancelled", "2026-11-04T10:00:00Z", mine({ status: "CANCELLED" })),
        event("next", "2026-11-12T10:00:00Z", mine({ isPaid: true })),
      ],
      now,
    )
    expect(picked?.event.id).toBe("next")
  })

  it("keeps an event under way", () => {
    const picked = pickNextEvent(
      [event("now", "2026-11-03T11:00:00Z", mine())],
      now,
    )
    expect(picked?.event.id).toBe("now")
  })

  it("is null without a registration (an open event has none)", () => {
    const open = { ...event("open", "2026-11-05T10:00:00Z", null), registration: null }
    expect(pickNextEvent([open], now)).toBeNull()
    expect(pickNextEvent([], now)).toBeNull()
  })
})

describe("eventStatusLine", () => {
  const base = {
    id: "r",
    eventId: "e",
    status: "BOOKED" as const,
    waitlistPosition: null,
    isPaid: false,
    paymentMethod: null,
    promotedAt: null,
    cancelledAt: null,
    createdAt: "2026-11-01T00:00:00Z",
  }

  it("tells booked unpaid, paid and free apart", () => {
    expect(eventStatusLine(base, 1500)).toBe("Вы записаны · оплата в клубе")
    expect(eventStatusLine({ ...base, isPaid: true }, 1500)).toBe("Оплачено")
    expect(eventStatusLine(base, null)).toBe("Вы записаны")
    expect(eventStatusLine(base, 1500, true)).toBe(
      "Вы записаны · можно оплатить онлайн",
    )
  })

  it("shows the waitlist position when known", () => {
    const waiting = { ...base, status: "WAITLISTED" as const }
    expect(eventStatusLine({ ...waiting, waitlistPosition: 2 }, 1500)).toBe(
      "В листе ожидания, 2-я",
    )
    expect(eventStatusLine(waiting, 1500)).toBe("В листе ожидания")
  })
})

describe("formatEventWhen", () => {
  const now = new Date("2026-11-03T05:00:00Z") // 12:00 in Tomsk

  it("reads today, tomorrow or a date in the event's zone", () => {
    expect(formatEventWhen(new Date("2026-11-03T12:00:00Z"), "Asia/Tomsk", now)).toBe(
      "Сегодня в 19:00",
    )
    expect(formatEventWhen(new Date("2026-11-04T12:00:00Z"), "Asia/Tomsk", now)).toBe(
      "Завтра в 19:00",
    )
    expect(formatEventWhen(new Date("2026-11-14T12:00:00Z"), "Asia/Tomsk", now)).toBe(
      "14 ноября в 19:00",
    )
  })
})
