import { pluralRu } from "../../shared/lib/plural-ru"
import { formatAmount } from "../subscriptions/subscription-display"

// Pure helpers for the «Тариф» page, the billing banners and the platform
// console. Unit-tested in billing-view.spec.ts.

export type BillingStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED"

export type BillingTierRef = { code: string; name: string; upTo: number | null }

export type ModuleSource = "PAID" | "COMP" | "TRIAL" | "OFF" | "NONE" | "SELF_HOSTED"

export type BillingSnapshot = {
  status: BillingStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  suspendsAt: string | null
  activeMembers: number
  tier: BillingTierRef
  paidTier: BillingTierRef | null
  modules: { code: string; entitled: boolean }[]
  videoUsage: {
    storageBytes: number
    includedStorageGb: number
    viewedSecondsThisMonth: number
    includedViewHours: number
  }
}

export const STATUS_LABEL: Record<BillingStatus, string> = {
  TRIAL: "Пробный период",
  ACTIVE: "Активен",
  PAST_DUE: "Ожидает оплаты",
  SUSPENDED: "Приостановлен",
}

const DAY_MS = 24 * 60 * 60 * 1000

// Whole days from now until `iso`, rounded up; negative once it has passed.
export const daysUntil = (iso: string, now: Date): number =>
  Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS)

export const formatDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

const GB = 1024 ** 3
const MB = 1024 ** 2

export const formatBytes = (bytes: number): string => {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace(".0", "")} ГБ`
  if (bytes >= MB) return `${Math.round(bytes / MB)} МБ`
  return `${Math.round(bytes / 1024)} КБ`
}

// 0–100 for a usage bar, capped at 100.
export const usagePercent = (used: number, max: number): number => {
  if (max <= 0) return 100
  return Math.min(100, Math.round((used / max) * 100))
}

// 05.11.2026 — compact date for badges.
export const formatShortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })

const HOUR_S = 3600

// Hours with at most one decimal: 12, 3.5, 0.2.
export const formatHours = (seconds: number): string =>
  String(Math.round((seconds / HOUR_S) * 10) / 10)

// «Пробный период», «Подключён», «Подключён до 05.11.2026» (the club
// disconnected it), «Бесплатно до 05.11.2026», «Отключён», «Не подключён» —
// what a paid module is to the club right now.
export const moduleStateLabel = (m: {
  source: ModuleSource
  compUntil: string | null
  cancelAt?: string | null
}): string => {
  switch (m.source) {
    case "TRIAL":
      return "Пробный период"
    case "PAID":
      return m.cancelAt ? `Подключён до ${formatShortDate(m.cancelAt)}` : "Подключён"
    case "SELF_HOSTED":
      return "Подключён"
    case "COMP":
      return m.compUntil ? `Бесплатно до ${formatShortDate(m.compUntil)}` : "Бесплатно"
    case "OFF":
      return "Отключён"
    case "NONE":
      return "Не подключён"
  }
}

export type TierRow = {
  code: string
  name: string
  range: string
  price: string
}

// The price table: «до 50» … and the open-ended top tier «400+» priced as
// «16 990 ₽ / мес + 35 ₽ за каждого сверх 400».
export const tierRows = (
  tiers: {
    code: string
    name: string
    upTo: number | null
    priceMonthly: number
    extraMemberPrice: number
  }[],
  currency: string,
): TierRow[] =>
  tiers.map((t, i) => {
    const prevUpTo = i > 0 ? tiers[i - 1].upTo : null
    const base = `${formatAmount(t.priceMonthly, currency)} / мес`
    if (t.upTo !== null) {
      return { code: t.code, name: t.name, range: `до ${t.upTo}`, price: base }
    }
    const from = prevUpTo ?? 0
    return {
      code: t.code,
      name: t.name,
      range: `${from}+`,
      price:
        t.extraMemberPrice > 0
          ? `${base} + ${formatAmount(t.extraMemberPrice, currency)} за каждого сверх ${from}`
          : base,
    }
  })

// Tiers are ordered by their member cap; the open-ended one is the highest.
const tierRank = (t: BillingTierRef): number => t.upTo ?? Number.POSITIVE_INFINITY

// The club grew past the tier its last payment covered.
export const isOverPaidTier = (b: Pick<BillingSnapshot, "tier" | "paidTier">): boolean =>
  b.paidTier !== null && tierRank(b.tier) > tierRank(b.paidTier)

// VIDEO allowance overrun this month, as readable parts; empty when within.
export const videoOverage = (b: Pick<BillingSnapshot, "modules" | "videoUsage">): string[] => {
  const video = b.modules.find((m) => m.code === "VIDEO")
  if (!video?.entitled) return []
  const u = b.videoUsage
  const parts: string[] = []
  if (u.storageBytes > u.includedStorageGb * GB) {
    parts.push(`хранилище ${formatBytes(u.storageBytes)} из ${u.includedStorageGb} ГБ`)
  }
  if (u.viewedSecondsThisMonth > u.includedViewHours * HOUR_S) {
    parts.push(
      `просмотры ${formatHours(u.viewedSecondsThisMonth)} ч из ${u.includedViewHours} ч в этом месяце`,
    )
  }
  return parts
}

export type Banner = { tone: "info" | "success" | "warning" | "danger"; text: string }

export const BANNER_TONE_CLASS: Record<Banner["tone"], string> = {
  info: "border-sky-300 bg-sky-50 text-sky-900",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
}

// What the club admin is told at the top of every page, or null — the single
// most important thing: suspension, a missed payment, the trial's last week,
// growth past the paid tier, a video allowance overrun, then a tier about to
// fill up.
export const billingBanner = (
  billing: BillingSnapshot,
  now: Date,
): Banner | null => {
  if (billing.status === "SUSPENDED") {
    return {
      tone: "danger",
      text: "Клуб приостановлен: участники не могут пользоваться приложением. Оплатите тариф, чтобы вернуть доступ.",
    }
  }
  if (billing.status === "PAST_DUE") {
    return {
      tone: "danger",
      text: billing.suspendsAt
        ? `Оплаченный период закончился. ${formatDay(billing.suspendsAt)} клуб будет приостановлен — оплатите тариф.`
        : "Оплаченный период закончился — оплатите тариф.",
    }
  }
  if (billing.status === "TRIAL" && billing.trialEndsAt) {
    const days = daysUntil(billing.trialEndsAt, now)
    if (days <= 7) {
      return {
        tone: "warning",
        text:
          days <= 0
            ? "Пробный период закончился — оплатите тариф, чтобы клуб продолжил работать."
            : `Пробный период закончится через ${days} ${pluralRu(days, "день", "дня", "дней")} (${formatDay(billing.trialEndsAt)}). Неподключённые модули после него отключатся.`,
      }
    }
  }
  if (isOverPaidTier(billing) && billing.paidTier) {
    const cap = billing.paidTier.upTo
    return {
      tone: "warning",
      text: `Активных учеников ${billing.activeMembers} — больше лимита тарифа «${billing.paidTier.name}»${cap !== null ? ` (${cap})` : ""}. Следующее списание — по тарифу «${billing.tier.name}».`,
    }
  }
  const overage = videoOverage(billing)
  if (overage.length > 0) {
    return {
      tone: "warning",
      text: `Видео: ${overage.join(", ")}. Сверх лимита оплачивается в следующем счёте.`,
    }
  }
  const cap = billing.tier.upTo
  if (cap !== null && billing.activeMembers >= cap * 0.9) {
    const left = Math.max(0, cap - billing.activeMembers)
    return {
      tone: "info",
      text:
        left === 0
          ? `Достигнут лимит тарифа «${billing.tier.name}»: ${cap} активных. Со следующими учениками клуб перейдёт на тариф выше.`
          : `До лимита тарифа «${billing.tier.name}» ${pluralRu(left, "остался", "осталось", "осталось")} ${left} ${pluralRu(left, "активный", "активных", "активных")}.`,
    }
  }
  return null
}

// The suspended-club error the API returns on club routes.
export type SuspendedInfo = {
  workspaceName: string
  reason: "INACTIVE" | "SUSPENDED"
  message: string
}

export const readSuspended = (error: unknown): SuspendedInfo | null => {
  if (typeof error !== "object" || error === null) return null
  if (!("response" in error)) return null
  const data = (error as { response?: { data?: unknown } }).response?.data
  if (typeof data !== "object" || data === null) return null
  const body = data as {
    code?: unknown
    message?: unknown
    metadata?: { workspaceName?: unknown; reason?: unknown }
  }
  if (body.code !== "WORKSPACE_SUSPENDED") return null
  return {
    workspaceName:
      typeof body.metadata?.workspaceName === "string"
        ? body.metadata.workspaceName
        : "",
    reason: body.metadata?.reason === "INACTIVE" ? "INACTIVE" : "SUSPENDED",
    message: typeof body.message === "string" ? body.message : "",
  }
}

// The 403 a club route answers while its paid module is off.
export type ModuleNotEntitled = { module: string; message: string }

export const readModuleNotEntitled = (error: unknown): ModuleNotEntitled | null => {
  if (typeof error !== "object" || error === null) return null
  const data = (error as { response?: { data?: unknown } }).response?.data
  if (typeof data !== "object" || data === null) return null
  const body = data as {
    code?: unknown
    message?: unknown
    metadata?: { module?: unknown }
  }
  if (body.code !== "MODULE_NOT_ENTITLED") return null
  return {
    module: typeof body.metadata?.module === "string" ? body.metadata.module : "",
    message: typeof body.message === "string" ? body.message : "",
  }
}

// ─── Card payments, autopay and self-serve modules ─────────────────────

export const MODULE_NAME: Record<string, string> = {
  VIDEO: "Видео",
  ONLINE_PAYMENTS: "Онлайн-оплата",
  BRANDED_APP: "Приложение под брендом клуба",
}

export type PaymentStatus = "PENDING" | "SUCCEEDED" | "CANCELED" | "REFUNDED"

export type PaymentView = {
  kind: "PERIOD" | "MODULE"
  initiator: "OWNER" | "AUTOPAY" | "PLATFORM"
  // Null at runtime for a period payment (the generated type misses it).
  module: string | null
  status: PaymentStatus
  amount: number
  refundedAmount: number
  periodMonths: number
  lines: { title: string }[]
  failureReason: string | null
}

// YooKassa cancellation_details.reason → plain Russian (mirrors the server's
// e-mail wording).
const DECLINE_REASON_RU: Record<string, string> = {
  insufficient_funds: "на карте недостаточно средств",
  card_expired: "истёк срок действия карты",
  permission_revoked: "карта отвязана — автосписание по ней больше невозможно",
  payment_method_restricted: "операции по карте ограничены банком",
  payment_method_limit_exceeded: "превышен лимит операций по карте",
  issuer_unavailable: "банк карты не ответил",
  fraud_suspected: "банк заподозрил мошенничество",
  general_decline: "банк отклонил платёж",
  country_forbidden: "карты этой страны не принимаются",
  expired_on_confirmation: "время на оплату истекло",
  canceled_by_merchant: "платёж отменён",
  "3d_secure_failed": "не пройдено подтверждение 3-D Secure",
  call_issuer: "банк отклонил платёж — свяжитесь с банком",
}

const CYRILLIC = /[А-Яа-яЁё]/

// A YooKassa reason code, or the server's own Russian text, as shown to people.
export const declineReasonRu = (reason: string | null | undefined): string => {
  if (!reason) return "платёж отклонён"
  if (DECLINE_REASON_RU[reason]) return DECLINE_REASON_RU[reason]
  return CYRILLIC.test(reason) ? reason : "платёж отклонён"
}

export const paymentStatusLabel = (
  p: Pick<PaymentView, "status" | "amount" | "refundedAmount">,
): string => {
  switch (p.status) {
    case "PENDING":
      return "Обрабатывается"
    case "SUCCEEDED":
      if (p.amount === 0) return "Продлено бесплатно"
      return p.refundedAmount > 0 ? "Частично возвращён" : "Оплачен"
    case "CANCELED":
      return "Не прошёл"
    case "REFUNDED":
      return "Возвращён"
  }
}

export const PAYMENT_STATUS_CLASS: Record<PaymentStatus, string> = {
  PENDING: "border-sky-300 bg-sky-50 text-sky-900",
  SUCCEEDED: "border-emerald-300 bg-emerald-50 text-emerald-900",
  CANCELED: "border-destructive/40 bg-destructive/10 text-destructive",
  REFUNDED: "border-border bg-muted text-muted-foreground",
}

export const PAYMENT_INITIATOR_LABEL: Record<PaymentView["initiator"], string> = {
  OWNER: "оплата картой",
  AUTOPAY: "автосписание",
  PLATFORM: "списание командой ClubSpace",
}

const periodWord = (months: number): string =>
  months === 12 ? "год" : `${months} ${pluralRu(months, "месяц", "месяца", "месяцев")}`

// What the payment was for: «Модуль «Видео»» or the bill's lines.
export const paymentSubject = (
  p: Pick<PaymentView, "kind" | "module" | "periodMonths" | "lines">,
): string => {
  if (p.kind === "MODULE") {
    const name = p.module ? (MODULE_NAME[p.module] ?? p.module) : "?"
    return `Модуль «${name}»`
  }
  const titles = p.lines.map((l) => l.title).filter(Boolean)
  return titles.length > 0
    ? `За ${periodWord(p.periodMonths)}: ${titles.join(", ")}`
    : `Тариф за ${periodWord(p.periodMonths)}`
}

// Why a payment did not go through, or null when it did.
export const paymentFailure = (p: Pick<PaymentView, "status" | "failureReason">): string | null =>
  p.status === "CANCELED" ? declineReasonRu(p.failureReason) : null

// What is left to refund: a paid, non-zero, not fully refunded payment.
export const refundableAmount = (
  p: Pick<PaymentView, "status" | "amount" | "refundedAmount">,
): number =>
  p.status === "SUCCEEDED" && p.amount > 0 ? Math.max(0, p.amount - p.refundedAmount) : 0

// Refund amount field: empty = the whole remainder, else a whole number of
// rubles in 1…max; null when invalid.
export const parseRefundAmount = (raw: string, max: number): "full" | number | null => {
  const s = raw.trim()
  if (s === "") return "full"
  const n = Number(s)
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null
}

// The `?payment=<id>` YooKassa returns to after the payment page.
export const paymentReturnId = (search: string): string | null => {
  const id = new URLSearchParams(search).get("payment")
  return id && id.trim() ? id.trim() : null
}

// The notice after coming back from YooKassa.
export const paymentReturnBanner = (
  p: Pick<PaymentView, "status" | "failureReason">,
): Banner => {
  switch (p.status) {
    case "SUCCEEDED":
      return { tone: "success", text: "Оплата прошла. Спасибо!" }
    case "CANCELED":
      return {
        tone: "danger",
        text: `Платёж не прошёл: ${declineReasonRu(p.failureReason)}. Попробуйте ещё раз или другой картой.`,
      }
    case "PENDING":
      return {
        tone: "info",
        text: "Платёж обрабатывается — как только банк его подтвердит, тариф обновится. Обновите страницу через пару минут.",
      }
    case "REFUNDED":
      return { tone: "info", text: "Платёж возвращён." }
  }
}

export type ModuleActionKind = "connect" | "disconnect" | "restore"

// What the club itself can do with a paid module, and what it is told when it
// cannot: TRIAL/NONE → connect (unless the platform switched it off), PAID →
// disconnect at the end of the paid period, or restore one already scheduled
// to go off. COMP and self-hosted need nothing.
export const moduleAction = (m: {
  source: ModuleSource
  mode: string | null
  cancelAt: string | null
}): { action: ModuleActionKind | null; note: string | null } => {
  if (m.source === "OFF" || ((m.source === "TRIAL" || m.source === "NONE") && m.mode === "OFF")) {
    return { action: null, note: "Отключён командой ClubSpace — напишите нам" }
  }
  if (m.source === "TRIAL" || m.source === "NONE") return { action: "connect", note: null }
  if (m.source === "PAID") {
    return m.cancelAt
      ? { action: "restore", note: `Отключится ${formatDay(m.cancelAt)}` }
      : { action: "disconnect", note: null }
  }
  return { action: null, note: null }
}

export const MODULE_ACTION_LABEL: Record<ModuleActionKind, string> = {
  connect: "Подключить",
  disconnect: "Отключить",
  restore: "Не отключать",
}

// The confirm() text before a module change, or null when none is needed
// (connecting for free / onto the next bill, keeping a module on).
export const moduleActionConfirm = (
  action: ModuleActionKind,
  m: { name: string; connectPrice: number | null },
  ctx: { currency: string; cardLast4: string | null; currentPeriodEnd: string | null },
): string | null => {
  if (action === "connect") {
    if (m.connectPrice === null || m.connectPrice <= 0) return null
    const how = ctx.cardLast4
      ? `с карты •••• ${ctx.cardLast4}`
      : "— откроется страница оплаты"
    return `Подключить модуль «${m.name}»? Будет списано ${formatAmount(m.connectPrice, ctx.currency)} за остаток оплаченного периода ${how}.`
  }
  if (action === "disconnect") {
    return ctx.currentPeriodEnd
      ? `Отключить модуль «${m.name}»? Модуль отключится ${formatDay(ctx.currentPeriodEnd)} — до этого он работает, деньги за оплаченный период не возвращаются.`
      : `Отключить модуль «${m.name}»? Он отключится сразу.`
  }
  return null
}

export type ModuleOutcome =
  | "CONNECTED"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_PENDING"
  | "RESTORED"
  | "DISCONNECTED"
  | "DISCONNECT_SCHEDULED"

export const moduleOutcomeBanner = (
  outcome: ModuleOutcome,
  name: string,
  currentPeriodEnd: string | null,
): Banner => {
  switch (outcome) {
    case "CONNECTED":
      return { tone: "success", text: `Модуль «${name}» подключён.` }
    case "PAYMENT_REQUIRED":
      return { tone: "info", text: `Переходим к оплате модуля «${name}»…` }
    case "PAYMENT_PENDING":
      return {
        tone: "info",
        text: `Списываем оплату модуля «${name}» с карты — он подключится, как только банк подтвердит платёж. Обновите страницу через минуту.`,
      }
    case "RESTORED":
      return { tone: "success", text: `Модуль «${name}» останется подключённым.` }
    case "DISCONNECTED":
      return { tone: "info", text: `Модуль «${name}» отключён.` }
    case "DISCONNECT_SCHEDULED":
      return {
        tone: "info",
        text: currentPeriodEnd
          ? `Модуль «${name}» отключится ${formatDay(currentPeriodEnd)}.`
          : `Модуль «${name}» отключится в конце оплаченного периода.`,
      }
  }
}

export type RetryOutcome = "CHARGED" | "EXTENDED_FREE" | "PENDING" | "FAILED" | "SKIPPED"

// The console's «Повторить списание сейчас» result.
export const retryOutcomeBanner = (outcome: RetryOutcome, reason: string | null): Banner => {
  switch (outcome) {
    case "CHARGED":
      return { tone: "success", text: "Списание прошло, период продлён." }
    case "EXTENDED_FREE":
      return { tone: "success", text: "Период продлён бесплатно (к оплате 0 ₽)." }
    case "PENDING":
      return { tone: "info", text: "Списание обрабатывается банком — проверьте позже." }
    case "FAILED":
      return { tone: "danger", text: `Списание не прошло: ${declineReasonRu(reason)}.` }
    case "SKIPPED":
      return {
        tone: "warning",
        text: reason ? `Списание не выполнено: ${reason}.` : "Списание не выполнено.",
      }
  }
}
