import type { PersonalTraining } from "../../shared/api/personal-trainings"
import {
  foreignTzSuffix,
  formatDuration,
  formatSessionStart,
  zonedParts,
  zonedWallTimeToDate,
} from "../schedule/schedule-helpers"

export type PtDisplayStatus = PersonalTraining["displayStatus"]
export type PtOption = PersonalTraining["options"][number]
export type PtTone = "warning" | "accent" | "success" | "muted" | "danger"

export const PT_STATUS_LABEL: Record<PtDisplayStatus, string> = {
  PENDING_COACH: "Ожидает тренера",
  PENDING_MEMBER: "Тренер предложил другое время",
  CONFIRMED: "Подтверждена",
  DECLINED: "Отклонена",
  CANCELLED: "Отменена",
  COMPLETED: "Прошла",
  EXPIRED: "Время прошло",
}

export const ptStatusTone = (status: PtDisplayStatus): PtTone => {
  switch (status) {
    case "PENDING_COACH":
      return "warning"
    case "PENDING_MEMBER":
      return "accent"
    case "CONFIRMED":
      return "success"
    case "DECLINED":
      return "danger"
    case "CANCELLED":
    case "COMPLETED":
    case "EXPIRED":
      return "muted"
  }
}

// «admin» = neither participant: an admin acting for the coach.
export type PtViewer = "member" | "coach" | "admin"

export const viewerRole = (pt: PersonalTraining, meId: string): PtViewer =>
  pt.member.userId === meId
    ? "member"
    : pt.coach.userId === meId
      ? "coach"
      : "admin"

// The coach's side of the table: the coach, or an admin acting for them.
export const actsAsCoach = (viewer: PtViewer): boolean => viewer !== "member"

// The ball is in my court: the coach owes an answer to a request, the member
// owes one to a counter-proposal. An expired request needs nobody.
export const needsMyAction = (pt: PersonalTraining, meId: string): boolean => {
  const viewer = viewerRole(pt, meId)
  return (
    (viewer === "coach" && pt.displayStatus === "PENDING_COACH") ||
    (viewer === "member" && pt.displayStatus === "PENDING_MEMBER")
  )
}

// The newest proposal by the coach (options arrive oldest first).
export const latestCoachOption = (
  options: readonly PtOption[],
): PtOption | null => {
  const mine = options.filter((o) => o.proposedBy === "coach")
  return mine.length > 0 ? mine[mine.length - 1]! : null
}

// The time a row leads with: the confirmed slot, else the coach's latest
// proposal, else the member's first option.
export const primaryTime = (
  pt: PersonalTraining,
): { startAt: string; durationMin: number } | null => {
  if (pt.confirmedStartAt) {
    return {
      startAt: pt.confirmedStartAt,
      durationMin: pt.confirmedDurationMin ?? 0,
    }
  }
  const option = latestCoachOption(pt.options) ?? pt.options[0]
  return option
    ? { startAt: option.startAt, durationMin: option.durationMin }
    : null
}

const timeOf = (pt: PersonalTraining): number => {
  const t = primaryTime(pt)
  return t ? new Date(t.startAt).getTime() : 0
}

const byTimeAsc = (a: PersonalTraining, b: PersonalTraining) =>
  timeOf(a) - timeOf(b)
const byUpdatedDesc = (a: PersonalTraining, b: PersonalTraining) =>
  b.updatedAt.localeCompare(a.updatedAt)

// Confirmed sessions that have not ended yet, soonest first.
export const upcomingConfirmed = (
  list: readonly PersonalTraining[],
  now: Date,
): PersonalTraining[] =>
  list
    .filter(
      (pt) =>
        pt.displayStatus === "CONFIRMED" &&
        !!pt.confirmedStartAt &&
        new Date(pt.confirmedStartAt).getTime() +
          (pt.confirmedDurationMin ?? 0) * 60_000 >
          now.getTime(),
    )
    .sort(byTimeAsc)

export type PtGroups = {
  needsAction: PersonalTraining[]
  upcoming: PersonalTraining[]
  waiting: PersonalTraining[]
  history: PersonalTraining[]
}

export const groupForList = (
  list: readonly PersonalTraining[],
  meId: string,
  now: Date,
): PtGroups => {
  const upcoming = upcomingConfirmed(list, now)
  const upcomingIds = new Set(upcoming.map((pt) => pt.id))
  const rest = list.filter((pt) => !upcomingIds.has(pt.id))
  const needsAction = rest.filter((pt) => needsMyAction(pt, meId))
  const waiting = rest.filter(
    (pt) =>
      !needsMyAction(pt, meId) &&
      (pt.displayStatus === "PENDING_COACH" ||
        pt.displayStatus === "PENDING_MEMBER"),
  )
  const placed = new Set([...needsAction, ...waiting].map((pt) => pt.id))
  return {
    needsAction: needsAction.sort(byTimeAsc),
    upcoming,
    waiting: waiting.sort(byUpdatedDesc),
    history: rest.filter((pt) => !placed.has(pt.id)).sort(byUpdatedDesc),
  }
}

// «Время — по часовому поясу…» pickers ------------------------------------

export const DURATION_CHOICES = [45, 60, 90] as const

// 07:00 … 22:00 in half-hour steps.
export const TIME_CHOICES: string[] = Array.from({ length: 31 }, (_, i) => {
  const minutes = 7 * 60 + i * 30
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
})

const MONTH_SHORT = [
  "янв.",
  "февр.",
  "мар.",
  "апр.",
  "мая",
  "июн.",
  "июл.",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
]
const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]

export type DateChoice = { dateKey: string; label: string }

// `days` calendar days starting from today in `timeZone` (the zone the times
// are entered in, which is not necessarily the phone's).
export const buildDateChoices = (
  now: Date,
  timeZone: string,
  days = 21,
): DateChoice[] => {
  const today = zonedParts(now, timeZone)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i))
    const dateKey = d.toISOString().slice(0, 10)
    const label =
      i === 0
        ? "Сегодня"
        : i === 1
          ? "Завтра"
          : `${WEEKDAY_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`
    return { dateKey, label }
  })
}

// Whether the zone's clock has not yet reached this date and time.
export const isFutureWallClock = (
  dateKey: string,
  hhmm: string,
  timeZone: string,
  now: Date,
): boolean => {
  const [y, m, d] = dateKey.split("-").map(Number)
  const [h, min] = hhmm.split(":").map(Number)
  return (
    zonedWallTimeToDate(y!, m!, d!, h!, min!, timeZone).getTime() >
    now.getTime()
  )
}

// What the server takes as a start: `YYYY-MM-DDTHH:MM`, no offset — it reads
// it in the request's zone.
export const toWallClock = (dateKey: string, hhmm: string): string =>
  `${dateKey}T${hhmm}`

export type TimeOptionValue = {
  dateKey: string | null
  time: string | null
  durationMin: number
}

export const emptyTimeOption = (): TimeOptionValue => ({
  dateKey: null,
  time: null,
  durationMin: 60,
})

export const wallClockOf = (v: TimeOptionValue): string | null =>
  v.dateKey && v.time ? toWallClock(v.dateKey, v.time) : null

const capitalize = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s

// «Четверг, 29 октября, 19:00 · 1 ч» in the request's own zone.
export const formatPtTime = (
  startAt: string,
  durationMin: number,
  timeZone: string,
): string =>
  `${capitalize(formatSessionStart(startAt, timeZone))}${
    durationMin > 0 ? ` · ${formatDuration(durationMin)}` : ""
  }${foreignTzSuffix(timeZone, new Date(startAt))}`
