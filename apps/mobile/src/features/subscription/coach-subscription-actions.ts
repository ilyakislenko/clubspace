import type {
  MemberSubscription,
  MemberSubscriptionFreeze,
  MemberSubscriptions,
} from "../../shared/api/member-subscriptions"
import { localYmd } from "./subscription-state"

export type CoachSubscriptionActions = {
  // Sell a new abonement: no live one, or only a used-up class pack.
  canAssign: boolean
  // Renew over a live abonement: the new one starts the (device-local) day the
  // current one ends — the server allows exactly this back-to-back sale. Null
  // when there is nothing to renew from (no live abonement, or one without an
  // end date: a class pack with days left, or one awaiting its first visit).
  renewFromYmd: string | null
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
 * Over a live abonement the coach renews instead of selling («Продлить»):
 * a plain sale would answer 400 «Снимите его…», and only admins can cancel.
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
  const usedUp =
    current !== null &&
    current.classesTotal !== null &&
    (current.classesRemaining ?? 0) <= 0
  const live = current !== null && !usedUp
  const renewFromYmd =
    canManage && live && current.endDate !== null
      ? localYmd(new Date(current.endDate))
      : null
  return {
    canAssign: canManage && !live,
    renewFromYmd,
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
 * Sold-but-unpaid abonements other than the current one (an expired debt is
 * still a debt; a cancelled sale is not), newest first as the server sends them.
 */
export const pastDebts = (
  data: Pick<MemberSubscriptions, "current" | "history">,
): MemberSubscription[] =>
  data.history.filter(
    (s) =>
      !s.isPaid &&
      (s.status === "ACTIVE" || s.status === "EXPIRED") &&
      s.id !== data.current?.id,
  )

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
