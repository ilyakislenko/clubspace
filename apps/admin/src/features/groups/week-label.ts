import type { GroupSummary } from "../../shared/api/groups"

const DAY_SHORT: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
}

/**
 * A group's week in one line: days sharing a start time are listed together,
 * «Пн, Ср 19:00 · Сб 11:00». Empty string when the group has no weekly class.
 */
export const weekLabel = (week: GroupSummary["week"]): string => {
  const byTime = new Map<string, number[]>()
  for (const c of [...week].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
  )) {
    byTime.set(c.startTime, [...(byTime.get(c.startTime) ?? []), c.dayOfWeek])
  }
  return [...byTime.entries()]
    .map(([time, days]) => `${days.map((d) => DAY_SHORT[d]).join(", ")} ${time}`)
    .join(" · ")
}
