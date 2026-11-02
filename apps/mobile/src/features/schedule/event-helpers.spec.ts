import { bookedLine, eventOfferLine, eventViewer } from "./event-helpers"

const member = { roleName: "student", isOwner: false }
const coach = { roleName: "coach", isOwner: false }
const admin = { roleName: "admin", isOwner: false }
const event = { coach: { id: "teacher" } }

describe("eventViewer", () => {
  it("lets a member sign up but not mark", () => {
    expect(eventViewer(event, "me", member)).toEqual({ signsUp: true, marks: false })
  })

  it("lets the event's teacher mark, not sign up — whatever their role", () => {
    expect(eventViewer(event, "teacher", member)).toEqual({ signsUp: false, marks: true })
    expect(eventViewer(event, "teacher", coach)).toEqual({ signsUp: false, marks: true })
  })

  it("keeps another coach off the sign-up and the marking", () => {
    expect(eventViewer(event, "me", coach)).toEqual({ signsUp: false, marks: false })
  })

  it("lets admin scope and the owner mark any event", () => {
    expect(eventViewer(event, "me", admin)).toEqual({ signsUp: false, marks: true })
    expect(eventViewer({ coach: null }, null, { roleName: "student", isOwner: true })).toEqual({
      signsUp: false,
      marks: true,
    })
  })
})

describe("bookedLine", () => {
  it("counts places taken out of the limit and the queue", () => {
    expect(bookedLine({ capacity: 3, booked: 2, waitlist: 0 })).toBe("Записано 2 из 3")
    expect(bookedLine({ capacity: 3, booked: 3, waitlist: 1 })).toBe(
      "Записано 3 из 3 · в листе ожидания 1",
    )
    expect(bookedLine({ capacity: null, booked: 5, waitlist: 0 })).toBe("Записано 5")
  })
})

describe("eventOfferLine", () => {
  // Intl puts a no-break space into «1 500».
  const plain = (s: string | null) => s?.replace(/\s/g, " ") ?? null
  const paid = { price: 1500, currency: "RUB", capacity: 10 }
  const listed = { registration: { booked: 7, waitlist: 0, mine: null } }

  it("shows the price and the free places from the events list", () => {
    expect(plain(eventOfferLine(paid, listed))).toBe("1 500 ₽ · Свободно 3 из 10")
  })

  it("falls back to the limit before the events list arrives", () => {
    expect(plain(eventOfferLine(paid, undefined))).toBe("1 500 ₽ · Мест: 10")
  })

  it("reads a free event with a limit and a paid one without", () => {
    expect(eventOfferLine({ price: null, currency: "RUB", capacity: 10 }, listed)).toBe(
      "Бесплатно · Свободно 3 из 10",
    )
    expect(plain(eventOfferLine({ price: 900, currency: "RUB", capacity: null }, listed))).toBe(
      "900 ₽",
    )
  })

  it("is null for an open event without price or limit", () => {
    expect(eventOfferLine({ price: null, currency: "RUB", capacity: null }, listed)).toBeNull()
    expect(eventOfferLine({}, null)).toBeNull()
  })
})
