// Pure formatting for the public club pages (unit-tested in specs/).

const TYPE_LABELS: Record<string, string> = {
  GRAPPLING: "Единоборства",
  FITNESS: "Фитнес",
  YOGA: "Йога",
  CUSTOM: "Спортивный клуб",
}

export const CLUB_TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
)

export const clubTypeLabel = (type: string): string =>
  TYPE_LABELS[type] ?? TYPE_LABELS.CUSTOM

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

// ISO weekday: 1 = Monday … 7 = Sunday.
export const dayLabel = (dayOfWeek: number): string =>
  DAYS[dayOfWeek - 1] ?? ""

// "19:00" + 90 → "19:00–20:30" (wraps past midnight).
export const slotTimeRange = (startTime: string, durationMin: number) => {
  const [h, m] = startTime.split(":").map(Number)
  const end = (h * 60 + m + durationMin) % (24 * 60)
  const hh = String(Math.floor(end / 60)).padStart(2, "0")
  const mm = String(end % 60).padStart(2, "0")
  return `${startTime}–${hh}:${mm}`
}

// Slots of one group with the same time folded together:
// Пн 19:00, Ср 19:00 → "Пн, Ср · 19:00–20:30".
export const groupSlotLines = (
  slots: { dayOfWeek: number; startTime: string; durationMin: number }[],
): string[] => {
  const byTime = new Map<string, number[]>()
  for (const s of slots) {
    const key = slotTimeRange(s.startTime, s.durationMin)
    byTime.set(key, [...(byTime.get(key) ?? []), s.dayOfWeek])
  }
  return [...byTime.entries()]
    .sort(([, a], [, b]) => Math.min(...a) - Math.min(...b))
    .map(
      ([time, days]) =>
        `${[...new Set(days)].sort((a, b) => a - b).map(dayLabel).join(", ")} · ${time}`,
    )
}

// "+79528849420" → "tel:+79528849420"; the stored phone is already normalised.
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`

// Only http(s) links are rendered as links — the server filters too, this is
// the second lock on the door.
export const isSafeHttpUrl = (url: string): boolean => {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}
