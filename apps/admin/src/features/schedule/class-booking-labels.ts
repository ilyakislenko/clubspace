import type { ClassBookingStatus } from "../../shared/api/class-bookings"

export const CLASS_BOOKING_STATUS_LABEL: Record<ClassBookingStatus, string> = {
  BOOKED: "Записан",
  WAITLISTED: "В листе ожидания",
  ATTENDED: "Пришёл",
  CANCELLED: "Отменил",
  LATE_CANCELLED: "Поздняя отмена",
  NO_SHOW: "Не пришёл",
  CANCELLED_BY_CLUB: "Занятие отменено",
  EXPIRED: "Место не освободилось",
}

export const CLASS_BOOKING_STATUS_TONE: Record<ClassBookingStatus, string> = {
  BOOKED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  WAITLISTED: "bg-sky-50 text-sky-700 ring-sky-600/20",
  ATTENDED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-zinc-100 text-zinc-700 ring-zinc-600/20",
  LATE_CANCELLED: "bg-amber-50 text-amber-700 ring-amber-600/20",
  NO_SHOW: "bg-red-50 text-red-700 ring-red-600/20",
  CANCELLED_BY_CLUB: "bg-zinc-100 text-zinc-700 ring-zinc-600/20",
  EXPIRED: "bg-zinc-100 text-zinc-700 ring-zinc-600/20",
}
