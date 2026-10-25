import type { AtRiskMember, AtRiskReason } from "../api/retention"

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

// Reason chips filter locally so the counts in the server summary stay whole.
export const filterAtRisk = (
  data: AtRiskMember[],
  reason: AtRiskReason | null,
  showSnoozed: boolean,
): AtRiskMember[] =>
  data.filter(
    (m) => (showSnoozed || !m.snoozed) && (reason === null || m.reason === reason),
  )

// The realtime events fire on every check-in; the list recomputes club-wide.
export const AT_RISK_REFRESH_MS = 60_000
