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

// «Пробный период», «Подключён», «Бесплатно до 05.11.2026», «Отключён»,
// «Не подключён» — what a paid module is to the club right now.
export const moduleStateLabel = (m: {
  source: ModuleSource
  compUntil: string | null
}): string => {
  switch (m.source) {
    case "TRIAL":
      return "Пробный период"
    case "PAID":
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

export type Banner = { tone: "info" | "warning" | "danger"; text: string }

export const BANNER_TONE_CLASS: Record<Banner["tone"], string> = {
  info: "border-sky-300 bg-sky-50 text-sky-900",
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
