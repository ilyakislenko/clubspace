import { STAFF_ROLES } from "../retention/retention-helpers"
import { isAdminScope } from "./substitution-helpers"

// How the viewer stands to a master class. Its teacher and the club's staff
// run it rather than sign up; the teacher and admin scope mark who came
// (the server lets exactly them open the event's session).
export type EventViewer = { signsUp: boolean; marks: boolean }

export const eventViewer = (
  event: { coach: { id: string } | null },
  meId: string | null,
  ws: { roleName: string; isOwner: boolean },
): EventViewer => {
  const hosts = meId !== null && event.coach?.id === meId
  const staff = ws.isOwner || STAFF_ROLES.includes(ws.roleName)
  return {
    signsUp: !hosts && !staff,
    marks: hosts || isAdminScope(ws),
  }
}

// «Записано 2 из 3 · в листе ожидания 1» — the staff's view of the places.
export const bookedLine = (b: {
  capacity: number | null
  booked: number
  waitlist: number
}): string =>
  (b.capacity === null ? `Записано ${b.booked}` : `Записано ${b.booked} из ${b.capacity}`) +
  (b.waitlist > 0 ? ` · в листе ожидания ${b.waitlist}` : "")
