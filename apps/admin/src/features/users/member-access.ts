// One visible expiry (spec B3): app access (accessUntil) normally follows the
// abonements, so the member card names it only when it differs.

export const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

// The latest end among the current abonements (null = none has an end: no
// abonement, or only open-ended packs / ones waiting for the first visit).
export const abonementEnd = (
  current: ReadonlyArray<{ endDate: string | null }>,
): string | null =>
  current.reduce<string | null>(
    (latest, a) =>
      a.endDate !== null &&
      (latest === null || new Date(a.endDate) > new Date(latest))
        ? a.endDate
        : latest,
    null,
  )

// Show «Доступ к приложению до …» only when it says something the abonements
// don't: a manual grant or early close, unlimited access next to a dated
// abonement, or a window without any dated abonement.
export const accessDiffers = (
  accessUntil: string | null,
  end: string | null,
): boolean => {
  if (accessUntil === null || end === null) return accessUntil !== end
  return !sameLocalDay(new Date(accessUntil), new Date(end))
}
