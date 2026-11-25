// «Нужно решение» on «Сегодня»: one row per kind of thing waiting for staff,
// in this order, each only while its count is above zero. A count is null
// when the viewer's role has no such list (a coach has no «Продлить») or its
// request failed — the row is then absent too.
const DECISION_KEYS = [
  "call", // «Кому позвонить» (B1 call list)
  "renew", // «Продлить» (renewals_due)
  "awaiting", // «Ожидают оплаты» (awaiting_payment, people)
  "requests", // «Заявки»: join, freeze, personal, video (GET requests, server-scoped)
  "leads", // «Заявки на пробное»: new + past trials without a mark (sport leads only)
  "video", // videos processing or failed
] as const

export type DecisionKey = (typeof DECISION_KEYS)[number]

export type DecisionCounts = Record<DecisionKey, number | null>

export const openDecisions = (
  counts: DecisionCounts,
): Array<{ key: DecisionKey; count: number }> =>
  DECISION_KEYS.flatMap((key) => {
    const count = counts[key]
    return count !== null && count > 0 ? [{ key, count }] : []
  })

// Revenue of the last 30 days against the 30 before, in whole percent; null
// when there is nothing to compare with (no sales in the previous period).
export const revenueChangePct = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 100) : null
