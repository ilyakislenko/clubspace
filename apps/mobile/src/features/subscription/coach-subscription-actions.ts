import type {
  MemberAbonement,
  MemberSubscription,
  MemberSubscriptionFreeze,
  MemberSubscriptions,
} from "../../shared/api/member-subscriptions"

export type CoachAbonementActions = {
  // Renew over this live time-only abonement: the new one starts on the
  // server's `renewFrom` (the club-local day this one ends) — sent back
  // verbatim, never recomputed on the device. Null when there is nothing to
  // renew from.
  renewFromYmd: string | null
  // A live class pack with classes left: it can't be renewed until they run
  // out (a same-scope sale would strand the paid classes).
  waitsForClasses: boolean
  canMarkPaid: boolean
  canFreeze: boolean
  canEndFreeze: boolean
  // The running or planned freeze of this abonement, if any.
  openFreeze: MemberSubscriptionFreeze | null
}

type ScopeLike = { directions: readonly { id: string }[] }

// A direction set as a comparable key; "" = club-wide.
const scopeKey = (s: ScopeLike): string =>
  s.directions
    .map((d) => d.id)
    .sort()
    .join(",")

const usedUp = (a: Pick<MemberAbonement, "classesTotal" | "classesRemaining">) =>
  a.classesTotal !== null && (a.classesRemaining ?? 0) <= 0

/**
 * Which actions the coach screen offers on one of the student's current
 * abonements. Everything hangs off the server's `permissions.canManage` (admin
 * scope, or a coach of the student's group) — without it nothing is offered.
 * `todayYmd` is the device-local day.
 *
 * Over a live time-only abonement the coach renews it («Продлить»): a plain
 * same-scope sale would answer 400 «Снимите его…», and only admins can
 * cancel. Over a live class pack with classes left no renewal is offered.
 *
 * Freezing needs a started abonement with an end date (a pack without an end,
 * or one still waiting for the first visit, has nothing to pause) and no freeze
 * running or planned already, and no pending request from the student on it
 * (the server refuses a direct freeze then: decide the request instead).
 */
export const coachAbonementActions = (
  abonement: MemberAbonement,
  data: Pick<MemberSubscriptions, "freezes" | "permissions">,
  todayYmd: string,
): CoachAbonementActions => {
  const { freezes, permissions } = data
  const openFreeze =
    freezes
      .filter((f) => f.subscriptionId === abonement.id && f.untilDate >= todayYmd)
      .sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1))[0] ?? null
  const canManage = permissions.canManage
  const live = !usedUp(abonement)
  return {
    renewFromYmd: canManage && live ? abonement.renewFrom : null,
    waitsForClasses: canManage && live && abonement.classesTotal !== null,
    canMarkPaid: canManage && !abonement.isPaid,
    canFreeze:
      canManage &&
      abonement.startDate !== null &&
      abonement.endDate !== null &&
      openFreeze === null &&
      abonement.freezeRequest?.status !== "PENDING",
    canEndFreeze: canManage && openFreeze !== null,
    openFreeze,
  }
}

/**
 * Tariffs a new (parallel) abonement can be sold on: a tariff whose direction
 * set equals that of a live current abonement (club-wide = the empty set)
 * would collide with it — that one is renewed instead. A used-up pack doesn't
 * block (the server closes it on sale).
 */
export const sellablePlans = <P extends ScopeLike>(
  plans: readonly P[],
  abonements: readonly MemberAbonement[],
): P[] => {
  const taken = new Set(abonements.filter((a) => !usedUp(a)).map(scopeKey))
  return plans.filter((p) => !taken.has(scopeKey(p)))
}

/**
 * Whether to offer «Оформить абонемент»: a manager, and either nothing live
 * (also when the club has no tariffs yet — the form says so) or a tariff left
 * that doesn't collide with a live abonement. A club without directions with a
 * live abonement therefore offers no sale, exactly as before.
 */
export const canSellAbonement = (
  data: Pick<MemberSubscriptions, "abonements" | "permissions">,
  plans: readonly ScopeLike[],
): boolean => {
  if (!data.permissions.canManage) return false
  if (!data.abonements.some((a) => !usedUp(a))) return true
  return sellablePlans(plans, data.abonements).length > 0
}

/**
 * Sold-but-unpaid abonements other than the current ones (an expired debt is
 * still a debt; a cancelled sale is not), newest first as the server sends them.
 */
export const pastDebts = (
  data: Pick<MemberSubscriptions, "abonements" | "history">,
): MemberSubscription[] => {
  const current = new Set(data.abonements.map((a) => a.id))
  return data.history.filter(
    (s) =>
      !s.isPaid &&
      (s.status === "ACTIVE" || s.status === "EXPIRED") &&
      !current.has(s.id),
  )
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
