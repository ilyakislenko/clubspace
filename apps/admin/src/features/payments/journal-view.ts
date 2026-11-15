import type {
  CreateRefundInput,
  JournalKind,
  JournalMethod,
  PaymentJournalEntry,
  PaymentJournalEntryDetail,
  PaymentJournalFilters,
  PaymentJournalTotals,
  PaymentJournalUnapplied,
  RefundMethod,
} from "../../shared/api/payment-journal"
import {
  ANALYTICS_ALL,
  EMPTY_ANALYTICS_FILTER,
  analyticsScope,
  type AnalyticsFilter,
} from "../../shared/lib/analytics"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { pluralRu } from "../../shared/lib/plural-ru"
import {
  CLUB_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type ClubPaymentMethod,
} from "../subscriptions/payment-method"
import { formatAmount } from "../subscriptions/subscription-display"
import { PROVIDER_LABEL } from "./payment-labels"

// Pure helpers of «Абонементы → Платежи» (the payments journal): the URL
// state, the period presets in club-local days, the row / summary texts and
// the refund form's rules.

// ---- State (the URL is the state) ----

export type JournalState = {
  // Club-local days, inclusive; both or neither. Neither = the dashboard's
  // «Выручка за 30 дней» window.
  from: string | null
  to: string | null
  method: JournalMethod | null
  // «Показывать»: null = payments and refunds.
  kind: Exclude<JournalKind, "all"> | null
  markedById: string | null
  // «Скидка»: rows with any discount (named or one-off), or one discount's.
  // One select, so at most one of the two is set.
  discounted: boolean
  discountId: string | null
  // «Дал скидку»: rows whose price this staff member set.
  pricedById: string | null
  scope: AnalyticsFilter
  q: string
  // The open row: `sub:<uuid>` / `reg:<uuid>` / `ref:<uuid>`.
  entry: string | null
}

export const EMPTY_JOURNAL_STATE: JournalState = {
  from: null,
  to: null,
  method: null,
  kind: null,
  markedById: null,
  discounted: false,
  discountId: null,
  pricedById: null,
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

// «Показывать», «Оплаты и возвраты» first (the default).
export const JOURNAL_KINDS: readonly JournalKind[] = ["all", "payment", "refund"]

export const KIND_LABEL: Record<JournalKind, string> = {
  all: "Оплаты и возвраты",
  payment: "Только оплаты",
  refund: "Только возвраты",
}

const isMethod = (v: string | null): v is JournalMethod =>
  JOURNAL_METHODS.includes(v as JournalMethod)

const kindOrNull = (v: string | null): JournalState["kind"] =>
  v === "payment" || v === "refund" ? v : null

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
  const discountId = idOrNull(p.get("discountId"))
  return {
    from: datesOk ? from : null,
    to: datesOk ? to : null,
    method: isMethod(method) ? method : null,
    kind: kindOrNull(p.get("kind")),
    markedById: idOrNull(p.get("markedById")),
    discounted: discountId === null && p.get("discounted") === "1",
    discountId,
    pricedById: idOrNull(p.get("pricedById")),
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
  if (s.kind) p.set("kind", s.kind)
  if (s.markedById) p.set("markedById", s.markedById)
  if (s.discounted) p.set("discounted", "1")
  if (s.discountId) p.set("discountId", s.discountId)
  if (s.pricedById) p.set("pricedById", s.pricedById)
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
  kind: s.kind ?? undefined,
  markedById: s.markedById ?? undefined,
  discounted: s.discounted || undefined,
  discountId: s.discountId ?? undefined,
  pricedById: s.pricedById ?? undefined,
  ...analyticsScope(s.scope),
  q: s.q.trim() || undefined,
})

// Filters behind the «Фильтры» button (the panel), for its count.
export const panelFilterCount = (s: JournalState): number =>
  (s.markedById ? 1 : 0) +
  (s.kind ? 1 : 0) +
  (s.discounted || s.discountId ? 1 : 0) +
  (s.pricedById ? 1 : 0) +
  SCOPE_KEYS.filter((k) => s.scope[k] !== ANALYTICS_ALL).length

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

type EntryDiscount = Pick<
  PaymentJournalEntry,
  "kind" | "discountName" | "discountAmount" | "oneOffDiscount" | "pricedBy" | "currency"
>

// Under a discounted payment's amount: «скидка «Семейная» −400 ₽» /
// «Разовая скидка 1 000 ₽ · Петров» / «скидка «ВЕСНА» −500 ₽ и разовая
// 200 ₽ · Петров». The name is whoever set the price.
export const entryDiscountNote = (e: EntryDiscount): string | null => {
  if (e.kind !== "payment") return null
  const named =
    e.discountName !== null && e.discountAmount > 0
      ? `скидка «${e.discountName}» −${formatAmount(e.discountAmount, e.currency)}`
      : null
  const oneOff = e.oneOffDiscount > 0 ? formatAmount(e.oneOffDiscount, e.currency) : null
  const who = e.pricedBy ? ` · ${e.pricedBy.name}` : ""
  if (named && oneOff) return `${named} и разовая ${oneOff}${who}`
  if (oneOff) return `Разовая скидка ${oneOff}${who}`
  return named
}

// The entry panel's price facts, only when the sale recorded its list price:
// «Цена по тарифу» · «Скидка» · «Разовая скидка» · «Получено».
export const entryPriceFacts = (
  e: EntryDiscount & Pick<PaymentJournalEntry, "listPrice" | "amount" | "source">,
): { label: string; value: string }[] => {
  if (e.kind !== "payment" || e.listPrice === null) return []
  return [
    {
      label: e.source === "abonement" ? "Цена по тарифу" : "Цена билета",
      value: formatAmount(e.listPrice, e.currency),
    },
    e.discountName !== null && e.discountAmount > 0
      ? {
          label: "Скидка",
          value: `«${e.discountName}» −${formatAmount(e.discountAmount, e.currency)}`,
        }
      : null,
    e.oneOffDiscount > 0
      ? {
          label: "Разовая скидка",
          value: [formatAmount(e.oneOffDiscount, e.currency), e.pricedBy?.name]
            .filter(Boolean)
            .join(" · "),
        }
      : null,
    { label: "Получено", value: formatAmount(e.amount, e.currency) },
  ].filter((f): f is { label: string; value: string } => f !== null)
}

// ---- Refund form ----

const REFUND = FORM_LIMITS.refund

// A refund row's id on the server (`ref:<uuid>` → `<uuid>`).
export const refundIdOf = (entryId: string): string => entryId.replace(/^ref:/, "")

// An offline refund is only a record and may be deleted; an online one is final.
export const canDeleteRefund = (e: Pick<PaymentJournalEntry, "kind" | "method">): boolean =>
  e.kind === "refund" && e.method !== "ONLINE"

// What the refund form returns money for: a sale (journal row) or an online
// payment that never became one.
export type RefundSubject =
  | { kind: "sale"; entry: PaymentJournalEntryDetail }
  | { kind: "unapplied"; payment: PaymentJournalUnapplied }

// The refund's `target` / `targetId`; null for a row that can't be refunded
// (a refund row).
export const refundTargetOf = (
  s: RefundSubject,
): Pick<CreateRefundInput, "target" | "targetId"> | null => {
  if (s.kind === "unapplied") return { target: "unapplied", targetId: s.payment.paymentId }
  const e = s.entry
  if (e.kind !== "payment") return null
  if (e.source === "abonement") {
    return e.subscriptionId ? { target: "abonement", targetId: e.subscriptionId } : null
  }
  return e.eventRegistrationId ? { target: "ticket", targetId: e.eventRegistrationId } : null
}

// What the provider can still send back of the sale's online payment (0 = no
// online refund: paid offline, or already returned through the provider).
export const onlineRefundable = (s: RefundSubject): number =>
  s.kind === "unapplied"
    ? s.payment.refundable
    : s.entry.kind === "payment"
      ? (s.entry.online?.refundable ?? 0)
      : 0

// «Вернуть деньги» shows while some of the money is still the club's.
export const subjectRefundable = (s: RefundSubject): number =>
  refundTargetOf(s) === null
    ? 0
    : s.kind === "unapplied"
      ? s.payment.refundable
      : s.entry.refundable

// «Как вернули»: through the provider first while it can, then the club's own
// ways. An unapplied payment goes back online only (the server refuses the rest).
export const refundMethods = (s: RefundSubject): RefundMethod[] => {
  const online: RefundMethod[] = onlineRefundable(s) > 0 ? ["ONLINE"] : []
  return s.kind === "unapplied" ? online : [...online, ...CLUB_PAYMENT_METHODS]
}

const isClubMethod = (m: string | null): m is ClubPaymentMethod =>
  CLUB_PAYMENT_METHODS.includes(m as ClubPaymentMethod)

// Online when possible, else the way the sale was paid, else cash.
export const defaultRefundMethod = (s: RefundSubject): RefundMethod =>
  onlineRefundable(s) > 0
    ? "ONLINE"
    : s.kind === "sale" && isClubMethod(s.entry.method)
      ? s.entry.method
      : "CASH"

export const refundMethodLabel = (
  method: RefundMethod,
  provider: keyof typeof PROVIDER_LABEL | null,
): string =>
  method === "ONLINE"
    ? `На карту через ${provider ? PROVIDER_LABEL[provider] : "платёжную систему"}`
    : PAYMENT_METHOD_LABEL[method]

const subjectCurrency = (s: RefundSubject): string =>
  s.kind === "unapplied" ? s.payment.currency : s.entry.currency

// The most this method may return: what is left of the sale, and online also
// what is left of the provider's payment.
export const refundMax = (s: RefundSubject, method: RefundMethod): number =>
  Math.min(
    REFUND.amount.max,
    subjectRefundable(s),
    method === "ONLINE" ? onlineRefundable(s) : Number.POSITIVE_INFINITY,
  )

// The typed amount, or why it can't be sent («Вернуть можно от 1 до N ₽», the
// server's text).
export const parseRefundAmount = (
  raw: string,
  s: RefundSubject,
  method: RefundMethod,
): { amount: number } | { error: string } => {
  const max = refundMax(s, method)
  const amount = parseIntInput(raw, { min: REFUND.amount.min, max })
  return amount === null
    ? { error: `Вернуть можно от ${REFUND.amount.min} до ${formatAmount(max, subjectCurrency(s))}` }
    : { amount }
}

// The one hint under the form, only when it is true.
export const refundHint = (s: RefundSubject, amount: number | null): string | null => {
  if (s.kind !== "sale") return null
  if (s.entry.source === "abonement") {
    return "Абонемент останется действующим — отменить его можно в карточке ученика"
  }
  return s.entry.fullRefundCancelsRegistration && amount === s.entry.refundable
    ? "Запись на событие будет отменена, место перейдёт следующему в листе ожидания"
    : null
}

// ---- Summary ----

// A total that may go below zero (a period of refunds only): «−6 000 ₽».
const signedAmount = (amount: number, currency: string): string =>
  `${amount < 0 ? "−" : ""}${formatAmount(Math.abs(amount), currency)}`

// Line 1 of one currency: «Получено … · возвращено … · итого N», split so the
// net can be bold.
export const summaryLine = (t: PaymentJournalTotals): { before: string; net: string } => ({
  before: `Получено ${formatAmount(t.received, t.currency)} · возвращено ${formatAmount(t.refunded, t.currency)} · итого `,
  net: signedAmount(t.net, t.currency),
})

// Line 2: each method that took money, at its net, in a fixed order.
export const methodsLine = (t: PaymentJournalTotals): string | null => {
  const parts = JOURNAL_METHODS.flatMap((method) => {
    const m = t.byMethod.find((x) => x.method === method)
    if (!m || (m.received === 0 && m.refunded === 0)) return []
    return [`${methodLabel(method)} ${signedAmount(m.received - m.refunded, t.currency)}`]
  })
  return parts.length > 0 ? parts.join(" · ") : null
}

// Line 3, only when > 0: «Скидки: 12 400 ₽ по 31 оплате, из них разовые
// 3 400 ₽». Not part of «итого»: revenue is already after discounts.
export const discountsLine = (t: PaymentJournalTotals): string | null => {
  const d = t.discounted
  if (d.amount <= 0) return null
  const base = `Скидки: ${formatAmount(d.amount, t.currency)} по ${d.count} ${pluralRu(d.count, "оплате", "оплатам", "оплатам")}`
  return d.oneOffAmount > 0
    ? `${base}, из них разовые ${formatAmount(d.oneOffAmount, t.currency)}`
    : base
}

export const unappliedTitle = (total: number): string =>
  `Оплачено онлайн, но не зачислено · ${total.toLocaleString("ru-RU")}`
