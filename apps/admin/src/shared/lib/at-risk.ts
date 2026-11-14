import type { AtRiskLevel, AtRiskReason } from "../api/retention"

export const AT_RISK_LABEL: Record<AtRiskReason, string> = {
  lapsed: "Абонемент кончился",
  newcomer: "Новичок",
  absent: "Давно не был",
  declining: "Реже, чем раньше",
}

export const AT_RISK_CHIP: Record<AtRiskReason, string> = {
  lapsed: "bg-destructive/10 text-destructive",
  newcomer: "bg-primary/10 text-primary",
  absent: "bg-muted text-foreground",
  declining: "bg-muted text-foreground",
}

// The churn score from the hourly snapshot, next to the reason.
export const AT_RISK_LEVEL_LABEL: Record<AtRiskLevel, string> = {
  high: "высокий риск",
  medium: "средний риск",
  low: "низкий риск",
}

export const AT_RISK_LEVEL_TEXT: Record<AtRiskLevel, string> = {
  high: "text-destructive",
  medium: "text-amber-700 dark:text-amber-400",
  low: "text-muted-foreground",
}

// The realtime events fire on every check-in; the server caches the list for
// a minute, so polling faster shows nothing new.
export const AT_RISK_REFRESH_MS = 60_000
