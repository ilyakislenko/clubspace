import {
  greetingName,
  isCoachView,
  pickCoachClassesToday,
  pickNextTraining,
  showCheckInButton,
  showHomeFallback,
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
