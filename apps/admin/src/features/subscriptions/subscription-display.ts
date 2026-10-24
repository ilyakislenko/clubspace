// Pure display helpers for an abonement's period. An abonement sold on a
// «срок с первой тренировки» tariff has no dates until the member's first visit.

type PeriodSubscription = {
  startDate: string | null
  endDate: string | null
  durationDays: number | null
  createdAt: string
}

// A first-visit abonement starts by itself this many days after the sale.
const FIRST_VISIT_AUTO_START_DAYS = 14

// The latest start (dd.mm.yyyy): 14 days after the sale day on the browser's
// calendar.
const latestStart = (createdAt: string): string => {
  const d = new Date(createdAt)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + FIRST_VISIT_AUTO_START_DAYS)
  return d.toLocaleDateString("ru-RU")
}

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("ru-RU") : "—"

export const isPending = (s: { startDate: string | null }): boolean =>
  s.startDate === null

export const periodLabel = (s: PeriodSubscription): string => {
  if (s.startDate === null) {
    const base = `с первой тренировки (не позже ${latestStart(s.createdAt)})`
    return s.durationDays != null ? `${base} · ${s.durationDays} дн.` : base
  }
  return `${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}`
}
