import type { AgendaItem, AgendaKind } from "../../shared/api/agenda"
import { formatRuDay } from "../../shared/format-ru"
import { formatTimeInTz } from "../schedule/club-schedule-buckets"
import {
  foreignTzSuffix,
  isoDateString,
} from "../schedule/schedule-helpers"

/** The week view: today plus the next six days. */
export const AGENDA_WEEK_DAYS = 7

export type DateRange = { from: string; to: string }

// Calendar arithmetic on a «YYYY-MM-DD» string, in UTC so the device zone
// and DST can't shift the day.
export const addDaysYmd = (ymd: string, days: number): string => {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// «Today» is the member's own calendar day; the server reads it in each
// club's zone. Derived from `now` on every call — Home is a tab that stays
// mounted across midnight.
export const todayRange = (now: Date): DateRange => {
  const today = isoDateString(now)
  return { from: today, to: today }
}

export const weekRange = (now: Date, days = AGENDA_WEEK_DAYS): DateRange => {
  const from = isoDateString(now)
  return { from, to: addDaysYmd(from, days - 1) }
}

// The range is part of the key, so a new day never paints yesterday's list.
export const agendaCacheKey = (range: DateRange): string =>
  `agenda:${range.from}:${range.to}`

export const showAgendaCard = (clubCount: number): boolean => clubCount > 1

const KIND_LABEL: Record<AgendaKind, string> = {
  class: "Тренировка",
  event: "Событие",
  dropIn: "Гостевое посещение",
  personalTraining: "Персональная",
}

export const agendaKindLabel = (kind: AgendaKind): string => KIND_LABEL[kind]

// Nominative, capitalised for a section header; index = Date#getUTCDay.
const WEEKDAY_RU = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
]

const weekdayOf = (ymd: string): string => {
  const [y, m, d] = ymd.split("-").map(Number)
  return WEEKDAY_RU[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// «Сегодня, 1 ноября» / «Завтра, 2 ноября» / «Вторник, 3 ноября».
export const agendaDayHeader = (date: string, today: string): string => {
  const prefix =
    date === today
      ? "Сегодня"
      : date === addDaysYmd(today, 1)
        ? "Завтра"
        : weekdayOf(date)
  return `${prefix}, ${formatRuDay(date)}`
}

export type AgendaDay = { date: string; items: AgendaItem[] }

// Days that have something on them, in date order; within a day by start.
// Grouped by the item's own (club-local) date, not the device's.
export const groupAgendaByDay = (items: readonly AgendaItem[]): AgendaDay[] => {
  const byDate = new Map<string, AgendaItem[]>()
  for (const item of items) {
    const list = byDate.get(item.date)
    if (list) list.push(item)
    else byDate.set(item.date, [item])
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, list]) => ({
      date,
      items: [...list].sort(
        (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
      ),
    }))
}

export const itemsOn = (
  items: readonly AgendaItem[],
  date: string,
): AgendaItem[] => groupAgendaByDay(items).find((d) => d.date === date)?.items ?? []

// «19:00–20:30» on the club's own clock, plus « GMT+7» when that clock isn't
// the phone's.
export const agendaTimeLabel = (
  item: Pick<AgendaItem, "startAt" | "endAt" | "timezone">,
  device?: string,
): string => {
  const start = formatTimeInTz(item.startAt, item.timezone).hourMinute
  const end =
    Date.parse(item.endAt) > Date.parse(item.startAt)
      ? `–${formatTimeInTz(item.endAt, item.timezone).hourMinute}`
      : ""
  return `${start}${end}${foreignTzSuffix(item.timezone, new Date(item.startAt), device)}`
}

// «Отменено — тренер заболел».
export const agendaCancelledText = (
  item: Pick<AgendaItem, "cancelled" | "cancellationReason">,
): string | null => {
  if (!item.cancelled) return null
  const reason = item.cancellationReason?.trim()
  return reason ? `Отменено — ${reason}` : "Отменено"
}

export type AgendaTarget =
  | { screen: "Schedule" }
  | { screen: "Events" }
  | { screen: "PersonalTraining"; requestId: string }
  | { screen: "PersonalTrainings" }

// Where a tap on an item leads, and which club to switch to first (null when
// it is the current one). Null overall when the club isn't in the member's
// list any more (left it since the agenda loaded) — there is nothing to open.
export const resolveAgendaOpen = (
  item: Pick<AgendaItem, "kind" | "workspaceId" | "personalTrainingId">,
  currentWorkspaceId: string | null | undefined,
  knownWorkspaceIds: readonly string[],
): { switchTo: string | null; target: AgendaTarget } | null => {
  if (!knownWorkspaceIds.includes(item.workspaceId)) return null
  const switchTo =
    item.workspaceId === currentWorkspaceId ? null : item.workspaceId
  const target: AgendaTarget =
    item.kind === "event"
      ? { screen: "Events" }
      : item.kind === "personalTraining"
        ? item.personalTrainingId
          ? { screen: "PersonalTraining", requestId: item.personalTrainingId }
          : { screen: "PersonalTrainings" }
        : { screen: "Schedule" }
  return { switchTo, target }
}
