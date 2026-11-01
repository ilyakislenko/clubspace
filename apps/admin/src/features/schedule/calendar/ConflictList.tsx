"use client"

import { AlertTriangle } from "lucide-react"

import { coachShortName } from "./calendar-format"
import { formatRange, type Conflict } from "./calendar-helpers"
import type { CalendarItem } from "./calendar-items"

const describe = (c: Conflict<CalendarItem>): string => {
  const it = c.item
  const when = formatRange(it.startMin, it.endMin)
  const what = it.kind === "event" ? `событие «${it.title}»` : `«${it.title}»`
  if (c.reason === "gym") {
    const gym = it.kind === "class" ? it.session.group.gym?.name : it.event.gym?.name
    return `Зал ${gym ?? "—"} занят: ${what} ${when}`
  }
  const coach =
    it.kind === "class" ? coachShortName(it.session.group.coach) : it.event.coach ? coachShortName(it.event.coach) : "Тренер"
  return `${coach} в это время ведёт ${what} ${when}`
}

/** Same gym or same coach at the same time — a warning, not a refusal. */
export function ConflictList({ conflicts }: { conflicts: Conflict<CalendarItem>[] }) {
  if (conflicts.length === 0) return null
  return (
    <div
      data-calendar-conflicts
      className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" /> Пересечение
      </div>
      <ul className="list-disc space-y-0.5 pl-6">
        {conflicts.map((c) => (
          <li key={`${c.reason}:${c.item.key}`}>{describe(c)}</li>
        ))}
      </ul>
    </div>
  )
}
