import { freezePhase, todayYmd } from "./freeze-utils"

// What an abonement IS right now, for display. The stored status alone lies:
// nothing flips a row to EXPIRED when its end date passes (only a renewal
// sale does), and a freeze is a separate row, not a status. So the state is
// derived from status + dates + freezes, with the same expiry rule the server
// uses for "current" (ACTIVE and endDate still ahead; no endDate = a class pack
// or one waiting for its first visit — never expired).
export type AbonementState =
  | "active"
  | "upcoming"
  | "expired"
  | "frozen"
  | "cancelled"

export const ABONEMENT_STATE_LABEL: Record<AbonementState, string> = {
  active: "Действует",
  upcoming: "Начнётся",
  expired: "Истёк",
  frozen: "Заморожен",
  cancelled: "Отменён",
}

type StateSubscription = {
  id: string
  status: string
  startDate: string | null
  endDate: string | null
}

type StateFreeze = {
  subscriptionId: string
  fromDate: string
  untilDate: string
}

export const abonementState = (
  s: StateSubscription,
  freezes: readonly StateFreeze[],
  now: Date,
): AbonementState => {
  if (s.status === "CANCELLED") return "cancelled"
  if (s.status === "EXPIRED") return "expired"
  if (s.endDate && new Date(s.endDate).getTime() <= now.getTime()) {
    return "expired"
  }
  // SUSPENDED is a legacy pause status no code sets any more; it reads as one.
  if (s.status === "SUSPENDED") return "frozen"
  if (s.status !== "ACTIVE") return "expired"
  const today = todayYmd(now)
  if (
    freezes.some(
      (f) => f.subscriptionId === s.id && freezePhase(f, today) === "current",
    )
  ) {
    return "frozen"
  }
  // Waiting for the first visit, or sold to start later (a back-to-back
  // renewal) — the same instant rule as the server.
  if (s.startDate === null) return "upcoming"
  if (new Date(s.startDate).getTime() > now.getTime()) return "upcoming"
  return "active"
}

// Lifecycle actions (cancel, renew, freeze) belong to an abonement that still
// counts; an expired or cancelled row is history.
export const isLiveState = (state: AbonementState): boolean =>
  state === "active" || state === "upcoming" || state === "frozen"
