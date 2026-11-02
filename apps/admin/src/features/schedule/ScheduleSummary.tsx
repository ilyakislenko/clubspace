"use client"

import {
  type GroupScheduleException,
  type GroupScheduleSlot,
} from "../../shared/api/groups"
import { formatMinutes } from "../../shared/lib/format-minutes"

const DAY_LABELS_LONG: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
}

// A group's weekly slots and upcoming cancellations, read-only (the editable
// variant is GroupScheduleBlock).
export function ScheduleSummary({
  slots,
  exceptions,
}: {
  slots: GroupScheduleSlot[]
  exceptions: GroupScheduleException[]
}) {
  if (slots.length === 0 && exceptions.length === 0) {
    return null
  }

  const sortedSlots = [...slots].sort(
    (a, b) =>
      a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
  )
  const sortedExceptions = [...exceptions].sort((a, b) =>
    a.fromDate.localeCompare(b.fromDate),
  )

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {sortedSlots.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs uppercase text-muted-foreground">
            Расписание
          </div>
          <ul className="divide-y divide-border rounded-md border border-border">
            {sortedSlots.map((slot) => (
              <li
                key={slot.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="w-12 font-medium tabular-nums">
                  {DAY_LABELS_LONG[slot.dayOfWeek]}
                </span>
                <span className="tabular-nums">{slot.startTime}</span>
                <span className="text-muted-foreground">
                  · {formatMinutes(slot.durationMin)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sortedExceptions.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs uppercase text-muted-foreground">
            Отмены и отпуска
          </div>
          <ul className="divide-y divide-border rounded-md border border-border">
            {sortedExceptions.map((e) => {
              const sameDay = e.fromDate === e.untilDate
              const slot = e.slotId
                ? sortedSlots.find((s) => s.id === e.slotId)
                : null
              return (
                <li
                  key={e.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <span className="tabular-nums">
                    {sameDay
                      ? e.fromDate
                      : `${e.fromDate} → ${e.untilDate}`}
                  </span>
                  <span className="text-muted-foreground">
                    ·{" "}
                    {slot
                      ? `только ${DAY_LABELS_LONG[slot.dayOfWeek]} ${slot.startTime}`
                      : "вся группа"}
                  </span>
                  {e.reason && (
                    <span className="truncate text-muted-foreground">
                      · {e.reason}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
