import { cap, type ClubVocabulary } from "@clubspace/ui-kit/brand"

import { pluralRu } from "../../shared/lib/plural-ru"
import { formatAmount } from "../subscriptions/subscription-display"

// View helpers of the federation console and the club's «Федерация»
// settings (docs/design/2026-11-26-federation-hub-mvp.md §4). Pure: the
// pages pass in what the API returned.

export type OrgRole = "ORG_ADMIN" | "ORG_COACH"

export const isOrgAdminRole = (role: string | null | undefined): boolean =>
  role === "ORG_ADMIN"

export const ORG_ROLES: readonly OrgRole[] = ["ORG_ADMIN", "ORG_COACH"]

// The coach in the federation's words (its discipline, as a club's).
export const orgRoleLabel = (role: string, v: ClubVocabulary): string =>
  role === "ORG_ADMIN"
    ? "Администратор федерации"
    : role === "ORG_COACH"
      ? `${cap(v.coach.nom)} федерации`
      : "Команда федерации"

// A figure the club keeps to itself (money is off until it opts in).
export const NOT_SHARED = "не открыт"

export const formatCount = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("ru-RU")

// Retention is a share 0…1; null = nobody to measure yet.
export const formatRate = (rate: number | null | undefined): string =>
  rate == null ? "—" : `${Math.round(rate * 100)}%`

export type Money = { amount: number; currency: string | null }

export const formatMoney = (money: Money | null | undefined): string =>
  money ? formatAmount(money.amount, money.currency ?? "RUB") : NOT_SHARED

export const clubsCount = (n: number): string =>
  `${n} ${pluralRu(n, "клуб", "клуба", "клубов")}`

// Under a money total: how many of the active clubs it covers.
export const moneyCoverage = (shared: number, active: number): string =>
  `по ${shared} из ${active} ${pluralRu(active, "клуба", "клубов", "клубов")}`

export const stripesText = (n: number): string =>
  `${n} ${pluralRu(n, "полоска", "полоски", "полосок")}`

// «Синий пояс · 2 полоски»; no stripes, no tail.
export const beltText = (level: { levelName: string; stripes: number }): string =>
  level.stripes > 0 ? `${level.levelName} · ${stripesText(level.stripes)}` : level.levelName

export const confirmedByText = (clubName: string): string => `подтверждён клубом ${clubName}`

// A calendar date (YYYY-MM-DD or an ISO instant) as «12 марта 2026», never
// shifted by the browser zone.
export const formatDate = (value: string): string => {
  const ymd = value.slice(0, 10)
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

export type OrgClubStatus = "INVITED" | "ACTIVE" | "DECLINED" | "LEFT" | "REMOVED"

// Shown for a link that is not (or no longer) active; ACTIVE needs no word.
export const CLUB_STATUS_LABEL: Record<Exclude<OrgClubStatus, "ACTIVE">, string> = {
  INVITED: "Приглашён",
  DECLINED: "Отклонил приглашение",
  LEFT: "Вышел из федерации",
  REMOVED: "Исключён",
}

export type OrgEventKind = "COMPETITION" | "SEMINAR" | "CAMP" | "GRADING" | "MEETING" | "OTHER"

export const EVENT_KIND_LABEL: Record<OrgEventKind, string> = {
  COMPETITION: "Турнир",
  SEMINAR: "Семинар",
  CAMP: "Сборы",
  GRADING: "Аттестация",
  MEETING: "Собрание",
  OTHER: "Другое",
}

export const EVENT_KINDS = Object.keys(EVENT_KIND_LABEL) as OrgEventKind[]

export type OrgAudience = "STAFF" | "STAFF_AND_MEMBERS"

export const ORG_AUDIENCES: readonly OrgAudience[] = ["STAFF", "STAFF_AND_MEMBERS"]

export const audienceLabel = (audience: OrgAudience, v: ClubVocabulary): string =>
  audience === "STAFF" ? `${cap(v.coach.datPl)} клубов` : `${cap(v.coach.datPl)} и ученикам`

// Who registered an athlete for a federation event.
export const bookedByLabel = (by: "SELF" | "COACH", v: ClubVocabulary): string =>
  by === "COACH" ? `записал ${v.coach.nom}` : "сам"

// «Записано 23 из 200» / «Записано 23».
export const bookedText = (booked: number, capacity: number | null): string =>
  capacity != null ? `Записано ${booked} из ${capacity}` : `Записано ${booked}`

// Registrations grouped by the club they came through, clubs by name.
export const groupByClub = <T extends { clubName: string }>(
  rows: readonly T[],
): { clubName: string; rows: T[] }[] => {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const list = groups.get(row.clubName) ?? []
    list.push(row)
    groups.set(row.clubName, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ru"))
    .map(([clubName, list]) => ({ clubName, rows: list }))
}

const csvCell = (value: string): string =>
  /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

// «Скачать список»: `;`-separated (Excel in a Russian locale) with a BOM.
export const toCsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`

// «Принят в клубах: ACADEMY (v2), Беркут (v1)».
export const adoptedText = (adopters: readonly { clubName: string; version: number }[]): string | null =>
  adopters.length === 0
    ? null
    : `Принят в клубах: ${adopters.map((a) => `${a.clubName} (v${a.version})`).join(", ")}`

// Month heading of the calendar: «Декабрь 2026», in the federation's zone.
export const monthKey = (iso: string, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(
    new Date(iso),
  )
  const year = parts.find((p) => p.type === "year")?.value ?? ""
  const month = parts.find((p) => p.type === "month")?.value ?? ""
  return `${year}-${month}`
}

export const monthTitle = (key: string): string => {
  const title = new Date(`${key}-01T00:00:00Z`).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
  return title.charAt(0).toUpperCase() + title.slice(1).replace(/\s*г\.$/, "")
}

// «14 дек, 10:00 – 18:00» / across days «14 дек, 10:00 – 15 дек, 18:00», in `timeZone`.
export const eventWhen = (startIso: string, endIso: string | null, timeZone: string): string => {
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "short" })
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false })
  const key = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  const start = new Date(startIso)
  const head = `${day.format(start)}, ${time.format(start)}`
  if (!endIso) return head
  const end = new Date(endIso)
  return key.format(start) === key.format(end)
    ? `${head} – ${time.format(end)}`
    : `${head} – ${day.format(end)}, ${time.format(end)}`
}

// An instant as the «YYYY-MM-DDTHH:MM» a datetime-local input holds, read in
// `timeZone` (the event's zone, never the browser's).
export const wallClockInput = (iso: string, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  // Intl may write midnight as «24».
  const hour = get("hour") === "24" ? "00" : get("hour")
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`
}
