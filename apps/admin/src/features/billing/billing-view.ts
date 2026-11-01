import { pluralRu } from "../../shared/lib/plural-ru"

// Pure helpers for the «Тариф и лимиты» page, the billing banners and the
// platform console. Unit-tested in billing-view.spec.ts.

export type BillingStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED"

export type BillingSnapshot = {
  status: BillingStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  suspendsAt: string | null
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

// 0–100 for a usage bar; null when the limit is unlimited.
export const usagePercent = (used: number, max: number | null): number | null => {
  if (max === null) return null
  if (max === 0) return 100
  return Math.min(100, Math.round((used / max) * 100))
}

export type Banner = { tone: "info" | "warning" | "danger"; text: string }

// What the club admin is told at the top of every page, or null. A trial gets
// a reminder in its last week, a past-due club the suspension date, a
// suspended club what to do.
export const billingBanner = (
  billing: BillingSnapshot,
  now: Date,
): Banner | null => {
  if (billing.status === "SUSPENDED") {
    return {
      tone: "danger",
      text: "Клуб приостановлен: участники не могут пользоваться приложением. Продлите тариф, чтобы вернуть доступ.",
    }
  }
  if (billing.status === "PAST_DUE") {
    return {
      tone: "danger",
      text: billing.suspendsAt
        ? `Оплаченный период закончился. ${formatDay(billing.suspendsAt)} клуб будет приостановлен — продлите тариф.`
        : "Оплаченный период закончился — продлите тариф.",
    }
  }
  if (billing.status === "TRIAL" && billing.trialEndsAt) {
    const days = daysUntil(billing.trialEndsAt, now)
    if (days > 7) return null
    return {
      tone: "warning",
      text:
        days <= 0
          ? "Пробный период закончился — выберите тариф."
          : `Пробный период закончится через ${days} ${pluralRu(days, "день", "дня", "дней")} (${formatDay(billing.trialEndsAt)}).`,
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

export const limitLabel = (max: number | null, unit = ""): string =>
  max === null ? "без ограничений" : `${max}${unit}`
