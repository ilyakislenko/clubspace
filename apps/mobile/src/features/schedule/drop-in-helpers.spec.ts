import { rsvpStateFor } from "./drop-in-helpers"

const NOW = Date.UTC(2026, 9, 27, 12, 0)

const session = (over: Record<string, unknown> = {}) =>
  ({
    occurrenceId: "slot-1:2026-10-28",
    groupId: "g-1",
    startAt: "2026-10-28T14:00:00.000Z",
    cancelled: false,
    ...over,
  }) as never

const ctx = (over: Record<string, unknown> = {}) => ({
  featureOn: true,
  isOwner: false,
  memberGroupIds: new Set<string>(),
  coachGroupIds: new Set<string>(),
  bookedOccurrenceIds: new Set<string>(),
  canBook: true,
  now: NOW,
  ...over,
})

describe("rsvpStateFor", () => {
  it("offers a booking for a future class of another group", () => {
    expect(rsvpStateFor(session(), ctx())).toBe("can_book")
  })

  it("is blocked when the member can't book", () => {
    expect(rsvpStateFor(session(), ctx({ canBook: false }))).toBe("blocked")
  })

  it("marks a cancelled class first, even when booked", () => {
    const booked = new Set(["slot-1:2026-10-28"])
    expect(
      rsvpStateFor(
        session({ cancelled: true }),
        ctx({ bookedOccurrenceIds: booked }),
      ),
    ).toBe("cancelled")
  })

  it("shows a booked class, or started once it began", () => {
    const booked = new Set(["slot-1:2026-10-28"])
    expect(rsvpStateFor(session(), ctx({ bookedOccurrenceIds: booked }))).toBe(
      "booked",
    )
    expect(
      rsvpStateFor(
        session({ startAt: "2026-10-27T11:00:00.000Z" }),
        ctx({ bookedOccurrenceIds: booked }),
      ),
    ).toBe("started")
  })

  it("keeps a booked class visible with the feature off", () => {
    const booked = new Set(["slot-1:2026-10-28"])
    expect(
      rsvpStateFor(session(), ctx({ featureOn: false, bookedOccurrenceIds: booked })),
    ).toBe("booked")
  })

  it("hides the action with the feature off and for the owner", () => {
    expect(rsvpStateFor(session(), ctx({ featureOn: false }))).toBe("hidden")
    expect(rsvpStateFor(session(), ctx({ isOwner: true }))).toBe("hidden")
  })

  it("tells members and coaches it is their own group", () => {
    expect(
      rsvpStateFor(session(), ctx({ memberGroupIds: new Set(["g-1"]) })),
    ).toBe("own_group")
    expect(
      rsvpStateFor(session(), ctx({ coachGroupIds: new Set(["g-1"]) })),
    ).toBe("own_group")
  })

  it("closes a class that has started", () => {
    expect(
      rsvpStateFor(session({ startAt: "2026-10-27T11:59:00.000Z" }), ctx()),
    ).toBe("started")
  })

  it("checks own group before started", () => {
    expect(
      rsvpStateFor(
        session({ startAt: "2026-10-27T11:00:00.000Z" }),
        ctx({ memberGroupIds: new Set(["g-1"]) }),
      ),
    ).toBe("own_group")
  })
})
