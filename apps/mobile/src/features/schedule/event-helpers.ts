import type { ScheduleEvent } from "../../shared/api/groups"
import { STAFF_ROLES } from "../retention/retention-helpers"
import { spotsLine } from "./class-booking-helpers"
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

const moneyFmt = new Intl.NumberFormat("ru-RU")

// «1 500 ₽» / «Бесплатно».
export const priceLabel = (price: number | null, currency: string): string =>
  price === null
    ? "Бесплатно"
    : `${moneyFmt.format(price)} ${currency === "RUB" ? "₽" : currency}`

/**
 * «1 500 ₽ · Свободно 3 из 10» for a master class on the schedule: the
 * schedule carries its price and limit, the events list (`listed`, by id)
 * the places taken. null for an event with neither price nor limit.
 */
export const eventOfferLine = (
  event: Pick<ScheduleEvent, "price" | "currency" | "capacity">,
  listed?: Pick<ScheduleEvent, "registration"> | null,
): string | null => {
  const price = event.price ?? null
  const capacity = event.capacity ?? null
  if (price === null && capacity === null) return null
  const reg = listed?.registration
  const places =
    capacity === null
      ? null
      : reg
        ? spotsLine({ capacity, booked: reg.booked, waitlist: reg.waitlist })
        : `Мест: ${capacity}`
  return [priceLabel(price, event.currency ?? "RUB"), places]
    .filter(Boolean)
    .join(" · ")
}
