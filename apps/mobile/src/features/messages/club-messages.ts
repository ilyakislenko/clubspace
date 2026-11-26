import { MONTHS_OF_RU, pluralRu } from "../../shared/format-ru"
import { formatTimeInTz } from "../schedule/club-schedule-buckets"

// «Сообщения клуба» (docs/design/2026-11-26-broadcast-and-direct-messages.md §6):
// the member's list and one message, and the staff's compose screen. Pure, so
// the wording and the read state are unit-tested.

/** The part of a member's message row the read state needs. */
export type MessageRow = { id: string; readAt: string | null }

/**
 * The list after opening a message: its dot goes at once (the server stamped
 * `readAt`; the next fetch agrees). An already-read row keeps its first stamp.
 */
export const markReadInList = <T extends MessageRow>(
  list: readonly T[],
  id: string,
  readAt: string,
): T[] =>
  list.map((m) => (m.id === id && m.readAt === null ? { ...m, readAt } : m))

/**
 * When it came, in the member's own clock: «сегодня, 18:40», «вчера, 9:05»,
 * «12 ноября», «12 ноября 2025» (another year).
 */
export const formatMessageDate = (iso: string, now: Date): string => {
  const d = new Date(iso)
  const dayStart = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000)
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
  if (days === 0) return `сегодня, ${time}`
  if (days === 1) return `вчера, ${time}`
  const date = `${d.getDate()} ${MONTHS_OF_RU[d.getMonth()]}`
  return d.getFullYear() === now.getFullYear()
    ? date
    : `${date} ${d.getFullYear()}`
}

/** «от Анна Смирнова, 12 ноября» under a message. */
export const messageByline = (
  m: { authorName: string; sentAt: string | null },
  now: Date,
): string =>
  m.sentAt
    ? `от ${m.authorName}, ${formatMessageDate(m.sentAt, now)}`
    : `от ${m.authorName}`

// ---- Staff: compose ----

/**
 * Route params survive a web reload only as a query string: an id list comes
 * back as one string (one id) or an array, a flag as "true".
 */
export const asIdList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
    : typeof v === "string" && v.length > 0
      ? v.split(",").filter(Boolean)
      : []

export const asFlag = (v: unknown): boolean => v === true || v === "true"

/** What the preview endpoint answers, as far as the sentence needs it. */
export type PreviewCounts = {
  recipients: number
  children: number
  withPush: number
  optedOut: number
  muted: number
  noDevice: number
  capped: number
  withEmail: number
  emailAllowance: number | null
  deferredByQuietHours: boolean
}

/**
 * The line under the form: «Получат 52 ученика (3 ребёнка — их родителям).
 * В приложении — 40, отключили сообщения — 4, без приложения — 8. Сейчас тихие часы:
 * уйдёт в 09:00.» Parts that are zero are left out. Quiet hours always end at
 * 09:00 club time (domains/notifications/quiet-hours.ts).
 */
export const previewSentence = (
  p: PreviewCounts,
  flags: { urgent: boolean; withEmail: boolean },
): string => {
  const n = p.recipients
  if (n === 0) return "Сейчас этому адресату писать некому."
  const kids =
    p.children > 0
      ? ` (${p.children} ${pluralRu(p.children, "ребёнок", "ребёнка", "детей")} — ${p.children === 1 ? "его" : "их"} родителям)`
      : ""
  // «В приложении» (a push), not «Push»: the coach's words, not the channel's.
  const channels = [
    `в приложении — ${p.withPush}`,
    p.optedOut > 0 ? `отключили сообщения — ${p.optedOut}` : null,
    p.muted > 0 ? `выключили уведомления клуба — ${p.muted}` : null,
    p.capped > 0 ? `уже получили 3 рассылки сегодня — ${p.capped}` : null,
    p.noDevice > 0 ? `без приложения — ${p.noDevice}` : null,
    flags.withEmail ? `e-mail — ${p.withEmail}` : null,
  ]
    .filter(Boolean)
    .join(", ")
  // The trial's e-mail allowance runs out before everyone gets a copy.
  const allowance =
    flags.withEmail && p.emailAllowance !== null && p.emailAllowance < p.withEmail
      ? ` E-mail: осталось ${p.emailAllowance} ${pluralRu(p.emailAllowance, "письмо", "письма", "писем")} пробного периода.`
      : ""
  const quiet =
    p.deferredByQuietHours && !flags.urgent
      ? " Сейчас тихие часы: уйдёт в 09:00 по времени клуба."
      : ""
  const sentence = channels.charAt(0).toUpperCase() + channels.slice(1)
  return `${n === 1 ? "Получит" : "Получат"} ${n} ${pluralRu(n, "ученик", "ученика", "учеников")}${kids}. ${sentence}.${allowance}${quiet}`
}

// Quiet hours on the club clock, the server's QUIET_START_HOUR / QUIET_END_HOUR
// (domains/notifications/quiet-hours.ts). An urgent message's preview no longer
// says it is held, so «Сейчас ночь у учеников» is judged here.
const QUIET_START_HOUR = 22
const QUIET_END_HOUR = 9

export const isQuietHour = (now: Date, timeZone: string): boolean => {
  // `% 24`: some engines spell midnight «24:00» with hour12 off.
  const hour =
    Number(formatTimeInTz(now.toISOString(), timeZone).hourMinute.slice(0, 2)) % 24
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

/** The confirm before sending; none for one recipient (a direct message). */
export const sendConfirmTitle = (recipients: number): string | null =>
  recipients > 1
    ? `Отправить ${recipients} ${pluralRu(recipients, "ученику", "ученикам", "ученикам")}?`
    : null

/** The primary button: a deferred message is scheduled, not sent. */
export const sendButtonLabel = (deferred: boolean, urgent: boolean): string =>
  deferred && !urgent ? "Запланировать" : "Отправить"

/** The toast after the server answered. */
export const sentToast = (status: string): string =>
  status === "SCHEDULED" ? "Сообщение уйдёт в 09:00" : "Сообщение отправлено"

/** Why the form can't be sent yet, or null. */
export const composeError = (
  title: string,
  body: string,
  limits: { title: number; body: number },
): string | null => {
  if (!title.trim()) return "Введите заголовок"
  if (!body.trim()) return "Введите текст"
  if (title.trim().length > limits.title)
    return `Заголовок — до ${limits.title} символов`
  if (body.trim().length > limits.body) return `Текст — до ${limits.body} символов`
  return null
}
