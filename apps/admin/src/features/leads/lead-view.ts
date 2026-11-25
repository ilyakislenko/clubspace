// Pure wording of «Ученики → Пробные» (docs/design/2026-11-26-leads.md §4):
// the views and their labels, the row's lines, the panel's one filled action
// per state, the timeline, the «Сегодня» hint and the URL state.

import type {
  Lead,
  LeadCounts,
  LeadLostReason,
  LeadSource,
  LeadView,
} from "../../shared/api/leads"
import { formatPhone } from "../../shared/lib/phone"
import { pluralRu } from "../../shared/lib/plural-ru"
import { formatSentAt, waitingLabel } from "../requests/request-view"

// «Показать», in funnel order; the server's `view` values.
export const LEAD_VIEWS: readonly LeadView[] = [
  "needsAction",
  "new",
  "contacted",
  "trialBooked",
  "came",
  "bought",
  "lost",
  "all",
]

export const VIEW_LABEL: Record<LeadView, string> = {
  needsAction: "Нужно действие",
  new: "Новые",
  contacted: "Связались",
  trialBooked: "Записаны на пробное",
  came: "Пришли",
  bought: "Купили",
  lost: "Отказ",
  all: "Все",
}

// The count beside a view; «Все» has none (the total of a filter is not news).
export const viewCount = (view: LeadView, counts: LeadCounts): number | null =>
  view === "all" ? null : counts[view]

export const LEAD_SOURCES: readonly LeadSource[] = ["PUBLIC_PAGE", "QR", "MANUAL"]

export const SOURCE_LABEL: Record<LeadSource, string> = {
  PUBLIC_PAGE: "Страница клуба",
  QR: "QR-плакат",
  MANUAL: "Вручную",
}

// The reasons in the «Отказ…» form, in the design's order (§1).
export const LOST_REASONS: readonly LeadLostReason[] = [
  "NO_ANSWER",
  "CHANGED_MIND",
  "PRICE",
  "SCHEDULE",
  "LOCATION",
  "CHOSE_OTHER",
  "SPAM",
  "OTHER",
]

export const LOST_REASON_LABEL: Record<LeadLostReason, string> = {
  NO_ANSWER: "Не дозвонились",
  CHANGED_MIND: "Передумал",
  PRICE: "Не подошла цена",
  SCHEDULE: "Не подошло расписание",
  LOCATION: "Далеко",
  CHOSE_OTHER: "Выбрал другой клуб",
  SPAM: "Спам",
  OTHER: "Другое",
}

// The row's short form: «отказ: цена».
const LOST_REASON_SHORT: Record<LeadLostReason, string> = {
  NO_ANSWER: "не дозвонились",
  CHANGED_MIND: "передумал",
  PRICE: "цена",
  SCHEDULE: "расписание",
  LOCATION: "далеко",
  CHOSE_OTHER: "другой клуб",
  SPAM: "спам",
  OTHER: "другое",
}

export const ERASED_NAME = "Данные удалены"

// «8 лет», «1 год», «3 года».
export const ageWords = (age: number): string => `${age} ${pluralRu(age, "год", "года", "лет")}`

// «для ребёнка: Маша, 8 лет»; null for an adult's request.
export const childLine = (lead: Pick<Lead, "forChild" | "childName" | "childAge">): string | null => {
  if (!lead.forChild) return null
  const parts = [lead.childName, lead.childAge !== null ? ageWords(lead.childAge) : null].filter(Boolean)
  return parts.length > 0 ? `для ребёнка: ${parts.join(", ")}` : "для ребёнка"
}

// The muted line under the name: «+7 952 884-94-20 · Дети · QR-плакат».
export const metaLine = (lead: Pick<Lead, "phone" | "directionName" | "source">): string =>
  [lead.phone ? formatPhone(lead.phone) : null, lead.directionName, SOURCE_LABEL[lead.source]]
    .filter(Boolean)
    .join(" · ")

// «2 ч назад», «3 дня назад»; «только что» and a date («3 нояб.») as they are.
export const agoLabel = (iso: string, now: Date): string => {
  const label = waitingLabel(iso, now)
  return /\d (мин|ч|день|дня|дней)$/.test(label) ? `${label} назад` : label
}

// «пт 18:00» (this week) or «пт, 5 дек., 18:00» in the club's zone.
export const formatTrialAt = (iso: string, timeZone: string, now: Date): string => {
  const date = new Date(iso)
  const days = Math.abs(date.getTime() - now.getTime()) / 86_400_000
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    ...(days < 6 ? {} : { day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date)
}

// A trial booked for a time that has passed and nobody marked «пришёл».
export const trialOverdue = (lead: Pick<Lead, "status" | "trialAt">, now: Date): boolean =>
  lead.status === "TRIAL_BOOKED" && lead.trialAt !== null && new Date(lead.trialAt) < now

// The muted right side of a row: where the lead stands, in a few words. The
// lead stores no purchase date, so «купил» stands alone. A trial reads in the
// zone it was booked in (`trialTimezone`: the group's gym, else the club).
export const statusLine = (lead: Lead, now: Date): string => {
  if (lead.displayStatus === "BOUGHT") return "купил абонемент"
  switch (lead.status) {
    case "NEW":
      return `новая · ${waitingLabel(lead.createdAt, now)}`
    case "CONTACTED":
      return `связались ${agoLabel(lead.contactedAt ?? lead.createdAt, now)}`
    case "TRIAL_BOOKED":
      if (trialOverdue(lead, now)) return "пробное прошло — отметьте"
      return lead.trialAt ? `пробное ${formatTrialAt(lead.trialAt, lead.trialTimezone, now)}` : "записан на пробное"
    case "CAME":
      return `пришёл ${agoLabel(lead.cameAt ?? lead.createdAt, now)}`
    case "LOST":
      return lead.lostReason ? `отказ: ${LOST_REASON_SHORT[lead.lostReason]}` : "отказ"
  }
}

// The «Сегодня» hint: «2 новых · 1 ждёт отметки после пробного», non-zero parts.
export const todayHint = (counts: Pick<LeadCounts, "new" | "trialOverdue">): string =>
  [
    counts.new > 0 ? `${counts.new} ${pluralRu(counts.new, "новая", "новых", "новых")}` : null,
    counts.trialOverdue > 0
      ? `${counts.trialOverdue} ${pluralRu(counts.trialOverdue, "ждёт", "ждут", "ждут")} отметки после пробного`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")

// The panel's next step: one filled button per state, at most one outline
// beside it (§4.3). «Отказ…», «Изменить данные», «Удалить данные» live in «⋯».
export type LeadAction =
  | "contacted"
  | "book"
  | "rebook"
  | "came"
  | "addToClub"
  | "link"
  | "openMember"
  | "reopen"

export const ACTION_LABEL: Record<LeadAction, string> = {
  contacted: "Связались",
  book: "Записать на пробное",
  rebook: "Перенести",
  came: "Пришёл",
  addToClub: "Добавить в клуб",
  link: "Связать с учеником",
  openMember: "Открыть карточку ученика",
  reopen: "Вернуть в работу",
}

export const leadActions = (
  lead: Pick<Lead, "status" | "convertedUserId" | "anonymizedAt">,
): { primary: LeadAction | null; secondary: LeadAction | null } => {
  if (lead.convertedUserId) return { primary: "openMember", secondary: null }
  // Nothing to work on once the personal data is gone.
  if (lead.anonymizedAt) return { primary: null, secondary: null }
  switch (lead.status) {
    case "NEW":
      return { primary: "contacted", secondary: "book" }
    case "CONTACTED":
      return { primary: "book", secondary: null }
    case "TRIAL_BOOKED":
      return { primary: "came", secondary: "rebook" }
    case "CAME":
      return { primary: "addToClub", secondary: "link" }
    case "LOST":
      return { primary: "reopen", secondary: null }
  }
}

// The panel's dated steps, oldest first, from the `*At` columns; «Купил
// абонемент» (derived, undated) closes the list.
export const timeline = (lead: Lead, now: Date): Array<{ label: string; at: string }> => [
  ...(
    [
      ["Заявка получена", lead.createdAt],
      ["Повторная заявка", lead.resubmittedAt],
      ["Связались", lead.contactedAt],
      [
        lead.trialAt
          ? `Записан на пробное ${formatTrialAt(lead.trialAt, lead.trialTimezone, now)}`
          : "Записан на пробное",
        lead.trialBookedAt,
      ],
      ["Пришёл на пробное", lead.cameAt],
      ["Добавлен в клуб", lead.convertedAt],
      [lead.lostReason ? `Отказ: ${LOST_REASON_LABEL[lead.lostReason].toLowerCase()}` : "Отказ", lead.lostAt],
      ["Данные удалены", lead.anonymizedAt],
    ] as const
  )
    .flatMap(([label, at]) => (at ? [{ label, at }] : []))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ label, at }) => ({ label, at: formatSentAt(at, now) })),
  ...(lead.displayStatus === "BOUGHT" ? [{ label: "Купил абонемент", at: "" }] : []),
]

// How the consent was given: the form's edition, or the staff member who
// recorded a phone/walk-in request.
export const consentLine = (
  lead: Pick<Lead, "consentAt" | "consentVersion" | "consentRecordedByName" | "source">,
  now: Date,
): string =>
  lead.source === "MANUAL"
    ? `Согласие подтвердил(а) ${lead.consentRecordedByName ?? "сотрудник клуба"}`
    : `Согласие ${formatSentAt(lead.consentAt, now)}, редакция ${lead.consentVersion}`

// `?view=&source=&q=&lead=`: the URL is the state.
export type PipelineState = {
  view: LeadView
  source: LeadSource | null
  q: string
  lead: string | null
}

export const parsePipelineSearch = (search: string): PipelineState => {
  const p = new URLSearchParams(search)
  return {
    view: LEAD_VIEWS.find((v) => v === p.get("view")) ?? "needsAction",
    source: LEAD_SOURCES.find((s) => s === p.get("source")) ?? null,
    q: p.get("q") ?? "",
    lead: p.get("lead") || null,
  }
}

export const pipelineSearch = (s: PipelineState): string => {
  const p = new URLSearchParams()
  if (s.view !== "needsAction") p.set("view", s.view)
  if (s.source) p.set("source", s.source)
  if (s.q.trim()) p.set("q", s.q.trim())
  if (s.lead) p.set("lead", s.lead)
  const text = p.toString()
  return text ? `?${text}` : ""
}

export const emptyText = (view: LeadView): string =>
  view === "needsAction" ? "Всё обработано" : "Заявок нет"

// «Анна Петрова» → first and last name for the invite form (one word = first name).
export const splitName = (name: string): { firstname: string; lastname: string } => {
  const [first = "", ...rest] = name.trim().split(/\s+/)
  return { firstname: first, lastname: rest.join(" ") }
}

// A 409: the lead changed meanwhile (status compare-and-set, another link) or
// a manual request duplicates an open one.
export const isConflict = (error: unknown): boolean =>
  (error as { response?: { status?: unknown } } | null)?.response?.status === 409

// The open lead a manual duplicate points at (409 `metadata.leadId`).
export const duplicateLeadId = (error: unknown): string | null => {
  if (!isConflict(error)) return null
  const data = (error as { response?: { data?: { leadId?: unknown; metadata?: { leadId?: unknown } } } })
    .response?.data
  const id = data?.metadata?.leadId ?? data?.leadId
  return typeof id === "string" ? id : null
}

// The club's calendar day and wall clock of an instant: ["2026-11-28", "18:00"].
export const wallClockIn = (iso: string, timeZone: string): [string, string] => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  )
  return [`${parts.year}-${parts.month}-${parts.day}`, `${parts.hour}:${parts.minute}`]
}
