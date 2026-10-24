// Pure display helpers for an abonement's period. An abonement sold on a
// «срок с первой тренировки» tariff has no dates until the member's first visit.

type PeriodSubscription = {
  startDate: string | null
  endDate: string | null
  durationDays: number | null
}

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("ru-RU") : "—"

export const isPending = (s: { startDate: string | null }): boolean =>
  s.startDate === null

export const periodLabel = (s: PeriodSubscription): string => {
  if (s.startDate === null) {
    return s.durationDays != null
      ? `с первой тренировки · ${s.durationDays} дн.`
      : "с первой тренировки"
  }
  return `${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}`
}
