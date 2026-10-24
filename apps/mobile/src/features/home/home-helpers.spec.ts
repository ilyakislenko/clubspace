import { greetingName, pickNextTraining, showHomeFallback } from "./home-helpers"

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
