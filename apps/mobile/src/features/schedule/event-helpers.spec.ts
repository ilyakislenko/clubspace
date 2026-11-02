import { bookedLine, eventViewer } from "./event-helpers"

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
