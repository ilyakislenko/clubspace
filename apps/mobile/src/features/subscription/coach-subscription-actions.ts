import type {
  MemberSubscriptionFreeze,
  MemberSubscriptions,
} from "../../shared/api/member-subscriptions"

export type CoachSubscriptionActions = {
  canAssign: boolean
  canMarkPaid: boolean
  canFreeze: boolean
  canEndFreeze: boolean
  // The running or planned freeze of the current abonement, if any.
  openFreeze: MemberSubscriptionFreeze | null
}

/**
 * Which actions the coach screen offers for a student. Everything hangs off the
 * server's `permissions.canManage` (admin scope, or a coach of the student's
 * group) — without it nothing is offered. `todayYmd` is the device-local day.
 *
 * Freezing needs a started abonement with an end date (a pack without an end,
 * or one still waiting for the first visit, has nothing to pause) and no freeze
 * running or planned already.
 */
export const coachSubscriptionActions = (
  data: Pick<MemberSubscriptions, "current" | "freezes" | "permissions">,
  todayYmd: string,
): CoachSubscriptionActions => {
  const { current, freezes, permissions } = data
  const openFreeze = current
    ? (freezes
        .filter((f) => f.subscriptionId === current.id && f.untilDate >= todayYmd)
        .sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1))[0] ?? null)
    : null
  const canManage = permissions.canManage
  return {
    canAssign: canManage,
    canMarkPaid: canManage && current !== null && !current.isPaid,
    canFreeze:
      canManage &&
      current !== null &&
      current.startDate !== null &&
      current.endDate !== null &&
      openFreeze === null,
    canEndFreeze: canManage && openFreeze !== null,
    openFreeze,
  }
}

/**
 * A whole number typed into a field. Spaces (also the no-break ones a money
 * format leaves) are stripped; anything that is not plain digits afterwards is
 * rejected, never coerced. Null = invalid, so the screen can keep its button
 * off instead of sending a guess.
 */
export const parseWholeNumber = (
  raw: string,
  range: { min: number; max: number },
): number | null => {
  const s = raw.replace(/\s/g, "")
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n < range.min || n > range.max) return null
  return n
}
