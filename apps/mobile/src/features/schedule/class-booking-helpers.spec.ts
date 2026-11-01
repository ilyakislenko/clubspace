import {
  cancelPrompt,
  classBookingActionFor,
  formatDayMonth,
  isLateCancel,
  spotsLine,
  withMyBooking,
} from "./class-booking-helpers"

const NOW = Date.UTC(2026, 10, 1, 9, 0)
const TZ = "Europe/Moscow"

const session = (over: Record<string, unknown> = {}) => ({
  startAt: "2026-11-03T15:00:00.000Z",
  timezone: TZ,
  cancelled: false,
  ...over,
})

const spots = (over: Record<string, unknown> = {}) =>
  ({
    capacity: 12,
    booked: 9,
    waitlist: 0,
    opensOn: "2026-10-20",
    cancelDeadline: "2026-11-03T03:00:00.000Z",
    myBookingId: null,
    myStatus: null,
    myWaitlistPosition: null,
    ...over,
  }) as never

const booking = (over: Record<string, unknown> = {}) =>
  ({ id: "b1", status: "BOOKED", waitlistPosition: null, ...over }) as never

describe("spotsLine", () => {
  it("counts free places, the waitlist and unlimited classes", () => {
    expect(spotsLine({ capacity: 12, booked: 9, waitlist: 0 })).toBe(
      "Свободно 3 из 12",
    )
    expect(spotsLine({ capacity: 8, booked: 8, waitlist: 2 })).toBe(
      "Мест нет · в листе ожидания 2",
    )
    expect(spotsLine({ capacity: 8, booked: 9, waitlist: 0 })).toBe("Мест нет")
    expect(spotsLine({ capacity: null, booked: 4, waitlist: 0 })).toBe(
      "Без ограничения мест · записано 4",
    )
  })
})

describe("classBookingActionFor", () => {
  it("offers a place, the waitlist when full, or waits for the window", () => {
    expect(classBookingActionFor(session(), spots(), NOW)).toBe("book")
    expect(classBookingActionFor(session(), spots({ booked: 12 }), NOW)).toBe(
      "waitlist",
    )
    expect(
      classBookingActionFor(session(), spots({ opensOn: "2026-11-02" }), NOW),
    ).toBe("not_open")
  })

  it("offers to give up the member's own place or waitlist place", () => {
    expect(
      classBookingActionFor(
        session(),
        spots({ myBookingId: "b1", myStatus: "BOOKED" }),
        NOW,
      ),
    ).toBe("cancel")
    expect(
      classBookingActionFor(
        session(),
        spots({ myBookingId: "b1", myStatus: "WAITLISTED", booked: 12 }),
        NOW,
      ),
    ).toBe("leave_waitlist")
  })

  it("closes a cancelled or started class", () => {
    expect(
      classBookingActionFor(session({ cancelled: true }), spots(), NOW),
    ).toBe("cancelled")
    expect(
      classBookingActionFor(
        session({ startAt: "2026-11-01T08:00:00.000Z" }),
        spots(),
        NOW,
      ),
    ).toBe("started")
  })
})

describe("isLateCancel / cancelPrompt", () => {
  const deadline = "2026-11-01T08:00:00.000Z"
  it("is late only for a held place past the deadline, unless the server says otherwise", () => {
    expect(isLateCancel({ status: "BOOKED", cancelDeadline: deadline }, NOW)).toBe(true)
    expect(
      isLateCancel({ status: "WAITLISTED", cancelDeadline: deadline }, NOW),
    ).toBe(false)
    expect(
      isLateCancel({ status: "BOOKED", cancelDeadline: deadline }, NOW, false),
    ).toBe(false)
  })

  it("warns about a burn on a late cancel", () => {
    const p = cancelPrompt({
      status: "BOOKED",
      late: true,
      promoted: false,
      cancelDeadline: deadline,
      timezone: TZ,
      burns: true,
    })
    expect(p.title).toBe("Поздняя отмена")
    expect(p.message).toContain("01.11 в 11:00")
    expect(p.message).toContain("спишется занятие")
  })
})

describe("withMyBooking", () => {
  it("adds the member's place or waitlist place once", () => {
    const placed = withMyBooking(spots(), booking())
    expect(placed).toMatchObject({ booked: 10, myBookingId: "b1", myStatus: "BOOKED" })
    expect(withMyBooking(placed, booking())).toBe(placed)
    expect(
      withMyBooking(
        spots({ booked: 12 }),
        booking({ status: "WAITLISTED", waitlistPosition: 1 }),
      ),
    ).toMatchObject({ waitlist: 1, myStatus: "WAITLISTED", myWaitlistPosition: 1 })
  })

  it("frees the place on a cancel", () => {
    const b = spots({ booked: 10, myBookingId: "b1", myStatus: "BOOKED" })
    expect(withMyBooking(b, booking({ status: "LATE_CANCELLED" }))).toMatchObject(
      { booked: 9, myBookingId: null, myStatus: null },
    )
  })
})

describe("formatDayMonth", () => {
  it("formats a club day as DD.MM", () => {
    expect(formatDayMonth("2026-11-14")).toBe("14.11")
  })
})
