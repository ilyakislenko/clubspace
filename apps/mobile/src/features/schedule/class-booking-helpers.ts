import type {
  ClassBooking,
  ClassBookingStatus,
} from "../../shared/api/class-bookings"
import type { ScheduleSessionBooking } from "../../shared/api/groups"
import { formatTimeInTz } from "./club-schedule-buckets"

/** «Свободно 3 из 12» / «Мест нет · в листе ожидания 2» / «Записано 5». */
export const spotsLine = (b: {
  capacity: number | null
  booked: number
  waitlist: number
}): string => {
  if (b.capacity === null) {
    return b.booked > 0 ? `Без ограничения мест · записано ${b.booked}` : "Без ограничения мест"
  }
  const free = Math.max(0, b.capacity - b.booked)
  if (free > 0) return `Свободно ${free} из ${b.capacity}`
  return b.waitlist > 0 ? `Мест нет · в листе ожидания ${b.waitlist}` : "Мест нет"
}

export type ClassBookingAction =
  | "cancelled"
  | "started"
  | "cancel"
  | "leave_waitlist"
  | "not_open"
  | "waitlist"
  | "book"

/**
 * What the member can do with one booking-mode class. Booking opens on the
 * club calendar day `opensOn` (the class's zone) and closes at the start; a
 * held place or waitlist place can be given up until then.
 */
export const classBookingActionFor = (
  s: {
    startAt: string
    timezone: string
    cancelled: boolean
  },
  b: ScheduleSessionBooking,
  now: number,
): ClassBookingAction => {
  if (s.cancelled) return "cancelled"
  if (new Date(s.startAt).getTime() <= now) return "started"
  if (b.myBookingId && b.myStatus === "BOOKED") return "cancel"
  if (b.myBookingId && b.myStatus === "WAITLISTED") return "leave_waitlist"
  const today = formatTimeInTz(new Date(now).toISOString(), s.timezone).dateKey
  if (today < b.opensOn) return "not_open"
  if (b.capacity !== null && b.booked >= b.capacity) return "waitlist"
  return "book"
}

/** "2026-11-14" → «14.11». */
export const formatDayMonth = (dateKey: string): string => {
  const [, month, day] = dateKey.split("-")
  return `${day}.${month}`
}

/** An instant as «14.11 в 07:00» in the class's zone. */
export const formatDeadline = (iso: string, timeZone: string): string => {
  const { dateKey, hourMinute } = formatTimeInTz(iso, timeZone)
  return `${formatDayMonth(dateKey)} в ${hourMinute}`
}

/**
 * Whether giving up this place now is a late cancel: a held place past the
 * free-cancel deadline. The server's `lateCancelNow` wins when known (it also
 * spares a member promoted from the waitlist after the deadline).
 */
export const isLateCancel = (
  b: { status: ClassBookingStatus; cancelDeadline: string },
  now: number,
  lateCancelNow?: boolean,
): boolean => {
  if (b.status !== "BOOKED") return false
  if (lateCancelNow !== undefined) return lateCancelNow
  return now > new Date(b.cancelDeadline).getTime()
}

/**
 * The confirmation before giving up a place or a waitlist place. `burns` is
 * the club's late-cancel switch when known (from «Мои записи»); without it the
 * text explains the rule instead.
 */
export const cancelPrompt = (p: {
  status: ClassBookingStatus
  late: boolean
  promoted: boolean
  cancelDeadline: string
  timezone: string
  burns: boolean | null
}): { title: string; message: string; confirm: string } => {
  if (p.status === "WAITLISTED") {
    return {
      title: "Покинуть лист ожидания?",
      message: "Ваше место в очереди займут следующие.",
      confirm: "Покинуть",
    }
  }
  if (!p.late) {
    return {
      title: p.promoted ? "Отказаться от места?" : "Отменить запись?",
      message: "Место освободится для других. Занятие с абонемента не спишется.",
      confirm: p.promoted ? "Отказаться" : "Отменить запись",
    }
  }
  const deadline = formatDeadline(p.cancelDeadline, p.timezone)
  const burn =
    p.burns === true
      ? "С абонемента спишется занятие (безлимитный абонемент не затрагивается)."
      : p.burns === false
        ? "Занятие с абонемента не спишется."
        : "Если клуб списывает занятие за позднюю отмену, оно спишется с абонемента."
  return {
    title: "Поздняя отмена",
    message: `Бесплатно отменить можно было до ${deadline}. ${burn}`,
    confirm: "Всё равно отменить",
  }
}

export const CLASS_BOOKING_STATUS_LABEL: Record<ClassBookingStatus, string> = {
  BOOKED: "Вы записаны",
  WAITLISTED: "Лист ожидания",
  ATTENDED: "Пришёл",
  CANCELLED: "Отменено",
  LATE_CANCELLED: "Поздняя отмена",
  NO_SHOW: "Неявка",
  CANCELLED_BY_CLUB: "Занятие отменено клубом",
  EXPIRED: "Место не освободилось",
}

/** «Списано занятие с абонемента «Йога 8»», or null when nothing was taken. */
export const burnLine = (b: {
  classBurned: boolean
  burnedPlanName: string | null
}): string | null => {
  if (!b.classBurned) return null
  return b.burnedPlanName
    ? `Списано занятие с абонемента «${b.burnedPlanName}»`
    : "Списано занятие с абонемента"
}

/** The toast after a booking: a place, or the waitlist position. */
export const bookedToast = (b: ClassBooking): string =>
  b.status === "WAITLISTED"
    ? b.waitlistPosition
      ? `Вы в листе ожидания, место №${b.waitlistPosition}`
      : "Вы в листе ожидания"
    : "Вы записаны на занятие"

/**
 * The class's booking block after the member's own booking or cancel, until
 * the refetch brings the server's counts (a cancel may promote somebody). A
 * repeated booking of a held place changes nothing.
 */
export const withMyBooking = (
  b: ScheduleSessionBooking,
  result: ClassBooking,
): ScheduleSessionBooking => {
  const { status } = result
  if (status === "BOOKED" || status === "WAITLISTED") {
    if (b.myBookingId === result.id && b.myStatus === status) return b
    return {
      ...b,
      booked: b.booked + (status === "BOOKED" ? 1 : 0),
      waitlist: b.waitlist + (status === "WAITLISTED" ? 1 : 0),
      myBookingId: result.id,
      myStatus: status,
      myWaitlistPosition: result.waitlistPosition,
    }
  }
  if (b.myBookingId !== result.id) return b
  return {
    ...b,
    booked: Math.max(0, b.booked - (b.myStatus === "BOOKED" ? 1 : 0)),
    waitlist: Math.max(0, b.waitlist - (b.myStatus === "WAITLISTED" ? 1 : 0)),
    myBookingId: null,
    myStatus: null,
    myWaitlistPosition: null,
  }
}
