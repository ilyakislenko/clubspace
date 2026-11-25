import type { ClubMessageSegment, PushSkip } from "../../shared/api/messages"
import { pluralRu } from "../../shared/lib/plural-ru"

// Words and lines of «Ученики → Сообщения», kept pure for the spec. Each line
// reads only the few server fields it needs.

export type Segment = ClubMessageSegment

// Mirror of the server's quiet hours (domains/notifications/quiet-hours.ts):
// 22:00–09:00 club time a non-urgent message waits for the morning.
export const QUIET_START_HOUR = 22
export const QUIET_END_HOUR = 9

export type Viewer = {
  isSportLead: boolean
  isDirectionManager: boolean
}

// «Кому» in the compose panel. A coach writes only to students of own groups,
// so «Все» says «мои»; MEMBERS comes only prefilled from a card or a row.
export const segmentLabel = (segment: Segment, viewer: Viewer): string => {
  switch (segment) {
    case "ALL":
      return viewer.isSportLead ? "Все ученики" : "Все мои ученики"
    case "GROUPS":
      return "Группы"
    case "DIRECTION":
      return "Направление"
    case "RENEW":
      return "Пора продлить"
    case "UNPAID":
      return "Не оплатили"
    case "INACTIVE":
      return "Не были 30 дней"
    case "CALL_LIST":
      return "Кому позвонить"
    case "MEMBERS":
      return "Выбранные ученики"
  }
}

// The segments a role may pick (server rule, design §2): «Продлить» and «Не
// оплатили» are the sport leads' (renewals and receivables); a direction is
// a lead's or its manager's; groups need groups to pick from.
export const segmentsFor = (
  viewer: Viewer,
  available: { groups: boolean; directions: boolean },
): Segment[] => [
  "ALL",
  ...(available.groups ? (["GROUPS"] as const) : []),
  ...(available.directions && (viewer.isSportLead || viewer.isDirectionManager)
    ? (["DIRECTION"] as const)
    : []),
  ...(viewer.isSportLead ? (["RENEW", "UNPAID"] as const) : []),
  "INACTIVE",
  "CALL_LIST",
]

export const studentsCount = (n: number): string =>
  `${n} ${pluralRu(n, "ученик", "ученика", "учеников")}`

// «52 ученикам» — the dative of «отправить …».
export const toStudents = (n: number): string =>
  `${n} ${pluralRu(n, "ученику", "ученикам", "ученикам")}`

// ---- club time -------------------------------------------------------------

const partsFmt = new Map<string, Intl.DateTimeFormat>()
const fmtFor = (tz: string): Intl.DateTimeFormat => {
  let f = partsFmt.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
    partsFmt.set(tz, f)
  }
  return f
}

// «2026-11-26T18:40» — the wall clock an instant shows in `tz`.
export const clubWallClock = (instant: Date, tz: string): string => {
  const parts = fmtFor(tz).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  const hour = String(Number(get("hour")) % 24).padStart(2, "0")
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`
}

const asUtcMs = (wall: string): number => {
  const [d, t] = wall.split("T")
  const [y, m, day] = d.split("-").map(Number)
  const [h, min] = t.split(":").map(Number)
  return Date.UTC(y, m - 1, day, h, min)
}

// The instant a `datetime-local` value means on the club's clock. Two passes
// settle the offset on either side of a DST change.
export const clubWallClockToIso = (wall: string, tz: string): string => {
  const target = asUtcMs(wall)
  let guess = target
  for (let i = 0; i < 2; i++) {
    guess += target - asUtcMs(clubWallClock(new Date(guess), tz))
  }
  return new Date(guess).toISOString()
}

export const isQuietHour = (now: Date, tz: string): boolean => {
  const hour = Number(clubWallClock(now, tz).slice(11, 13))
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

const dayOf = (wall: string) => wall.slice(0, 10)

// «сегодня в 09:00», «завтра в 09:00», «28 ноября в 09:00» on the club clock.
export const whenLabel = (iso: string, tz: string, now: Date): string => {
  const at = new Date(iso)
  const wall = clubWallClock(at, tz)
  const time = wall.slice(11)
  const today = dayOf(clubWallClock(now, tz))
  const tomorrow = dayOf(clubWallClock(new Date(now.getTime() + 86_400_000), tz))
  if (dayOf(wall) === today) return `сегодня в ${time}`
  if (dayOf(wall) === tomorrow) return `завтра в ${time}`
  const day = at.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: tz })
  return `${day} в ${time}`
}

// «12 нояб. в 18:40» (the year only when not this year's), club clock.
export const sentLabel = (iso: string, tz: string, now: Date): string => {
  const at = new Date(iso)
  const wall = clubWallClock(at, tz)
  const sameYear = wall.slice(0, 4) === clubWallClock(now, tz).slice(0, 4)
  const day = at.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: tz,
  })
  return `${day} в ${wall.slice(11)}`
}

// ---- the list --------------------------------------------------------------

type ListedMessage = {
  status: "SCHEDULED" | "SENT" | "CANCELLED"
  sendAt: string
  sentAt: string | null
  createdAt: string
  recipientCount: number
  readCount: number
  isService: boolean
  urgent: boolean
  withEmail: boolean
}

// The row's time: when it went, when it will go, or that it won't.
export const statusLabel = (m: ListedMessage, tz: string, now: Date): string => {
  if (m.status === "CANCELLED") return "Отменено"
  if (m.status === "SCHEDULED") return `Отправится ${whenLabel(m.sendAt, tz, now)}`
  return sentLabel(m.sentAt ?? m.createdAt, tz, now)
}

// «Открыли 34 из 52»; nothing before it went out.
export const readLine = (m: ListedMessage): string | null =>
  m.status === "SENT" ? `Открыли ${m.readCount} из ${m.recipientCount}` : null

// The dot's tooltip: what is special about how it went.
export const flagsText = (m: Pick<ListedMessage, "isService" | "urgent" | "withEmail">): string | null => {
  const flags = [
    m.isService && "служебное",
    m.urgent && "срочное",
    m.withEmail && "с копией на e-mail",
  ].filter((f): f is string => Boolean(f))
  if (flags.length === 0) return null
  const text = flags.join(", ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// The detail panel's counters (push «отправлен», not «доставлен»: a written
// push can still fail at the provider).
export const countersLine = (
  m: Pick<ListedMessage, "recipientCount" | "readCount" | "withEmail"> & {
    pushCount: number
    emailCount: number
  },
): string =>
  [
    `Получили ${m.recipientCount}`,
    `push отправлен ${m.pushCount}`,
    ...(m.withEmail ? [`на e-mail ${m.emailCount}`] : []),
    `открыли ${m.readCount}`,
  ].join(" · ")

// ---- the recipients --------------------------------------------------------

export const PUSH_SKIP_TEXT: Record<PushSkip, string> = {
  muted: "без push: отключил(а) уведомления клуба",
  opted_out: "без push: отключил(а) сообщения",
  no_device: "без push: нет приложения",
  cap: "без push: уже три сообщения за день",
}

export const readState = (readAt: string | null, tz: string): string =>
  readAt
    ? `Открыл(а) ${new Date(readAt).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        timeZone: tz,
      })}`
    : "Не открыл(а)"

// ---- the compose preview ---------------------------------------------------

type Preview = {
  recipients: number
  children: number
  withPush: number
  optedOut: number
  muted: number
  noDevice: number
  capped: number
  withEmail: number
  emailAllowance: number | null
  sendAt: string
  deferredByQuietHours: boolean
  timezone: string
}

// «Получат 52 ученика (3 ребёнка — их родителям). Push — 40, отключили
// сообщения — 4, без приложения — 8. Сейчас тихие часы: уйдёт завтра в 09:00.»
export const previewSentence = (
  p: Preview,
  opts: { scheduled: boolean; now: Date },
): string => {
  if (p.recipients === 0) return "Сейчас в этом списке нет учеников."
  const children =
    p.children > 0
      ? ` (${p.children} ${pluralRu(p.children, "ребёнок", "ребёнка", "детей")} — их родителям)`
      : ""
  const verb = p.recipients === 1 ? "Получит" : "Получат"
  const push = [
    `Push — ${p.withPush}`,
    ...(p.optedOut > 0 ? [`отключили сообщения — ${p.optedOut}`] : []),
    ...(p.muted > 0 ? [`отключили уведомления клуба — ${p.muted}`] : []),
    ...(p.capped > 0 ? [`уже получили три за день — ${p.capped}`] : []),
    ...(p.noDevice > 0 ? [`без приложения — ${p.noDevice}`] : []),
  ].join(", ")
  const when = p.deferredByQuietHours
    ? ` Сейчас тихие часы: уйдёт ${whenLabel(p.sendAt, p.timezone, opts.now)}.`
    : opts.scheduled
      ? ` Уйдёт ${whenLabel(p.sendAt, p.timezone, opts.now)}.`
      : ""
  return `${verb} ${studentsCount(p.recipients)}${children}. ${push}.${when}`
}

// Shown only when the trial allowance won't cover every e-mail.
export const emailAllowanceText = (p: Pick<Preview, "withEmail" | "emailAllowance">): string | null =>
  p.emailAllowance !== null && p.emailAllowance < p.withEmail
    ? `E-mail: осталось ${p.emailAllowance} ${pluralRu(p.emailAllowance, "письмо", "письма", "писем")} пробного периода`
    : null
