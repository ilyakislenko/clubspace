import type {
  JournalMethod,
  PaymentJournalEntry,
  PaymentJournalFilters,
  PaymentJournalTotals,
} from "../../shared/api/payment-journal"
import {
  ANALYTICS_ALL,
  EMPTY_ANALYTICS_FILTER,
  analyticsScope,
  type AnalyticsFilter,
} from "../../shared/lib/analytics"
import { pluralRu } from "../../shared/lib/plural-ru"
import { PAYMENT_METHOD_LABEL } from "../subscriptions/payment-method"
import { formatAmount } from "../subscriptions/subscription-display"

// Pure helpers of «Абонементы → Платежи» (the payments journal): the URL
// state, the period presets in club-local days, and the row / summary texts.

// ---- State (the URL is the state) ----

export type JournalState = {
  // Club-local days, inclusive; both or neither. Neither = the dashboard's
  // «Выручка за 30 дней» window.
  from: string | null
  to: string | null
  method: JournalMethod | null
  markedById: string | null
  scope: AnalyticsFilter
  q: string
  // The open row: `sub:<uuid>` / `reg:<uuid>`.
  entry: string | null
}

export const EMPTY_JOURNAL_STATE: JournalState = {
  from: null,
  to: null,
  method: null,
  markedById: null,
  scope: EMPTY_ANALYTICS_FILTER,
  q: "",
  entry: null,
}

export const JOURNAL_METHODS: readonly JournalMethod[] = [
  "CASH",
  "TRANSFER",
  "CARD",
  "ONLINE",
  "NONE",
]

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTRY_RE = /^(sub|reg|ref):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The server's search bound (`ListPaymentJournalQuery.q`, max 100). Query
// parameters are not in the generated body schemas, so FORM_LIMITS can't carry it.
export const JOURNAL_Q_MAX = 100

const isMethod = (v: string | null): v is JournalMethod =>
  JOURNAL_METHODS.includes(v as JournalMethod)

const idOrNull = (v: string | null): string | null =>
  v && UUID_RE.test(v) ? v : null

const SCOPE_KEYS = ["gymId", "directionId", "groupId", "coachId"] as const

// A hand-edited or stale link falls back to the default of each broken part.
export const parseJournalSearch = (search: string): JournalState => {
  const p = new URLSearchParams(search)
  const from = p.get("from")
  const to = p.get("to")
  const datesOk = !!from && !!to && YMD_RE.test(from) && YMD_RE.test(to) && from <= to
  const method = p.get("method")
  const entry = p.get("entry")
  const scope = { ...EMPTY_ANALYTICS_FILTER }
  for (const key of SCOPE_KEYS) scope[key] = idOrNull(p.get(key)) ?? ANALYTICS_ALL
  return {
    from: datesOk ? from : null,
    to: datesOk ? to : null,
    method: isMethod(method) ? method : null,
    markedById: idOrNull(p.get("markedById")),
    scope,
    q: (p.get("q") ?? "").slice(0, JOURNAL_Q_MAX),
    entry: entry && ENTRY_RE.test(entry) ? entry : null,
  }
}

// `?from=…&to=…` with only the parts that differ from the default ("" when
// none), in a fixed order so equal views give equal links.
export const journalSearch = (s: JournalState): string => {
  const p = new URLSearchParams()
  if (s.from && s.to) {
    p.set("from", s.from)
    p.set("to", s.to)
  }
  if (s.method) p.set("method", s.method)
  if (s.markedById) p.set("markedById", s.markedById)
  for (const key of SCOPE_KEYS) if (s.scope[key] !== ANALYTICS_ALL) p.set(key, s.scope[key])
  const q = s.q.trim()
  if (q) p.set("q", q)
  if (s.entry) p.set("entry", s.entry)
  const text = p.toString()
  return text ? `?${text}` : ""
}

// The list's and the CSV's filters (the open row is not one).
export const journalFilters = (s: JournalState): PaymentJournalFilters => ({
  from: s.from ?? undefined,
  to: s.to ?? undefined,
  method: s.method ?? undefined,
  markedById: s.markedById ?? undefined,
  ...analyticsScope(s.scope),
  q: s.q.trim() || undefined,
})

// Filters behind the «Фильтры» button (the panel), for its count.
export const panelFilterCount = (s: JournalState): number =>
  (s.markedById ? 1 : 0) + SCOPE_KEYS.filter((k) => s.scope[k] !== ANALYTICS_ALL).length

// Anything narrowing the rows besides the period.
export const isFiltered = (s: JournalState): boolean =>
  s.method !== null || s.q.trim() !== "" || panelFilterCount(s) > 0

export const emptyText = (s: JournalState): string =>
  isFiltered(s) ? "Ничего не нашлось — измените фильтры" : "За этот период оплат нет"

// ---- Period (club-local days) ----

export type JournalPeriod = "30d" | "month" | "prevMonth" | "custom"

export const JOURNAL_PERIODS: readonly JournalPeriod[] = ["30d", "month", "prevMonth", "custom"]

export const PERIOD_LABEL: Record<JournalPeriod, string> = {
  "30d": "За 30 дней",
  month: "Этот месяц",
  prevMonth: "Прошлый месяц",
  custom: "Выбрать даты…",
}

// The calendar day an instant has in the club's time zone.
export const clubToday = (timezone: string, now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)

const ymdOfUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

// The dates of a calendar preset; null for «За 30 дней» (no dates) and the
// custom range. «Этот месяц» runs to today: nothing is paid in the future.
export const presetRange = (
  period: JournalPeriod,
  today: string,
): { from: string; to: string } | null => {
  const [y, m] = today.split("-").map(Number)
  if (period === "month") return { from: `${today.slice(0, 8)}01`, to: today }
  if (period === "prevMonth") {
    return {
      from: ymdOfUtc(Date.UTC(y, m - 2, 1)),
      to: ymdOfUtc(Date.UTC(y, m - 1, 0)),
    }
  }
  return null
}

// The preset a range is, so a shared link shows «Этот месяц», not two dates.
export const periodOf = (s: Pick<JournalState, "from" | "to">, today: string): JournalPeriod => {
  if (!s.from || !s.to) return "30d"
  for (const period of ["month", "prevMonth"] as const) {
    const r = presetRange(period, today)
    if (r && r.from === s.from && r.to === s.to) return period
  }
  return "custom"
}

const DAY_MS = 86_400_000
// The server's bound on one request (ListPaymentJournalQuery: ≤ 366 days).
export const MAX_RANGE_DAYS = 366

// Why a picked range can't be sent, or null when it can.
export const customRangeError = (from: string, to: string): string | null => {
  if (!YMD_RE.test(from) || !YMD_RE.test(to)) return "Укажите обе даты"
  if (to < from) return "Дата «по» раньше даты «с»"
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1
  if (days > MAX_RANGE_DAYS) return `Период — не больше ${MAX_RANGE_DAYS} дней`
  return null
}

// ---- Rows ----

export const methodLabel = (method: JournalMethod | null): string =>
  method === null || method === "NONE" ? "Не указан" : PAYMENT_METHOD_LABEL[method]

// «3 нояб., 18:40» on the club's clock; another year adds it.
export const formatEntryAt = (iso: string, timezone: string, now: Date = new Date()): string => {
  const sameYear =
    clubToday(timezone, new Date(iso)).slice(0, 4) === clubToday(timezone, now).slice(0, 4)
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))
}

type EntryText = Pick<
  PaymentJournalEntry,
  "kind" | "source" | "itemName" | "amount" | "currency" | "reason"
>

// The row's second line: what the money was for.
export const entryWhat = (e: EntryText): string =>
  e.kind === "refund"
    ? ["Возврат", e.reason].filter(Boolean).join(" · ")
    : e.source === "abonement"
      ? `Абонемент «${e.itemName}»`
      : `Событие «${e.itemName}»`

// Refunds read as «−1 000 ₽».
export const entryAmount = (e: EntryText): string =>
  `${e.kind === "refund" ? "−" : ""}${formatAmount(e.amount, e.currency)}`

export const entryTitle = (e: EntryText): string =>
  `${e.kind === "refund" ? "Возврат" : "Оплата"} ${formatAmount(e.amount, e.currency)}`

// Under a partly refunded payment's amount.
export const refundedNote = (
  e: Pick<PaymentJournalEntry, "kind" | "refundedAmount" | "currency">,
): string | null =>
  e.kind === "payment" && e.refundedAmount > 0
    ? `возвращено ${formatAmount(e.refundedAmount, e.currency)}`
    : null

// An online payment the provider can still return (full refund through the
// payment's own endpoint until partial refunds exist).
export const canRefundOnline = (
  e: Pick<PaymentJournalEntry, "kind" | "online" | "refundable">,
): boolean => e.kind === "payment" && e.online?.status === "SUCCEEDED" && e.refundable > 0

export const onlineRefundHint = (e: Pick<PaymentJournalEntry, "source">): string =>
  e.source === "ticket"
    ? "Отметка об оплате билета снимется сама, место на событии за участником останется."
    : "Абонемент сам не отменится — решите в карточке ученика, отменять ли его."

// ---- Summary ----

// Line 1 of one currency: «Получено … · возвращено … · итого N» while there
// are refunds, else «Итого N»; split so the net can be bold.
export const summaryLine = (
  t: PaymentJournalTotals,
): { before: string; net: string; after: string } => {
  const count = t.byMethod.reduce((sum, m) => sum + m.count, 0)
  return {
    before:
      t.refunded > 0
        ? `Получено ${formatAmount(t.received, t.currency)} · возвращено ${formatAmount(t.refunded, t.currency)} · итого `
        : "Итого ",
    net: formatAmount(t.net, t.currency),
    after: ` · ${count.toLocaleString("ru-RU")} ${pluralRu(count, "оплата", "оплаты", "оплат")}`,
  }
}

// Line 2: each method that took money, at its net, in a fixed order.
export const methodsLine = (t: PaymentJournalTotals): string | null => {
  const parts = JOURNAL_METHODS.flatMap((method) => {
    const m = t.byMethod.find((x) => x.method === method)
    if (!m || (m.received === 0 && m.refunded === 0)) return []
    return [`${methodLabel(method)} ${formatAmount(m.received - m.refunded, t.currency)}`]
  })
  return parts.length > 0 ? parts.join(" · ") : null
}

export const unappliedTitle = (total: number): string =>
  `Оплачено онлайн, но не зачислено · ${total.toLocaleString("ru-RU")}`
