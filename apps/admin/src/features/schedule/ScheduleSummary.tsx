"use client"

import { cap } from "@clubspace/ui-kit/brand"

import {
  type GroupScheduleException,
  type GroupScheduleSlot,
} from "../../shared/api/groups"
import { formatMinutes } from "../../shared/lib/format-minutes"
import { formatYmd } from "../../shared/lib/format-ymd"
import { useVocabulary } from "../../shared/lib/vocabulary"

const DAY_SHORT: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
}

const isOneOff = (s: GroupScheduleSlot) =>
  s.effectiveFrom !== null && s.effectiveFrom === s.effectiveUntil

// A group's running and upcoming classes and its cancellations, read-only.
// Time is edited in the calendar; the group card links there.
export function ScheduleSummary({
  slots,
  exceptions,
}: {
  slots: GroupScheduleSlot[]
  exceptions: GroupScheduleException[]
}) {
  const vocabulary = useVocabulary()
  const byTime = (a: GroupScheduleSlot, b: GroupScheduleSlot) =>
    a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)
  const weekly = slots.filter((s) => !isOneOff(s)).sort(byTime)
  const oneOff = slots
    .filter(isOneOff)
    .sort((a, b) => (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? ""))
  const cancellations = [...exceptions].sort((a, b) => a.fromDate.localeCompare(b.fromDate))
  const slotById = new Map(slots.map((s) => [s.id, s]))

  return (
    <div className="space-y-3 text-sm">
      {weekly.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {weekly.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="w-6 font-medium">{DAY_SHORT[s.dayOfWeek]}</span>
              <span className="tabular-nums">{s.startTime}</span>
              <span className="text-muted-foreground">{formatMinutes(s.durationMin)}</span>
              {(s.effectiveFrom || s.effectiveUntil) && (
                <span className="text-xs text-muted-foreground">
                  {s.effectiveFrom && `с ${formatYmd(s.effectiveFrom)}`}
                  {s.effectiveFrom && s.effectiveUntil && " "}
                  {s.effectiveUntil && `по ${formatYmd(s.effectiveUntil)}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {oneOff.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Разовые {vocabulary.session.nomPl}</div>
          <ul className="space-y-0.5">
            {oneOff.map((s) => (
              <li key={s.id} className="tabular-nums">
                {formatYmd(s.effectiveFrom ?? "")}, {s.startTime} · {formatMinutes(s.durationMin)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {cancellations.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Отмены и перерывы</div>
          <ul className="space-y-0.5">
            {cancellations.map((e) => {
              const slot = e.slotId ? slotById.get(e.slotId) : undefined
              return (
                <li key={e.id}>
                  <span className="tabular-nums">
                    {e.fromDate === e.untilDate
                      ? formatYmd(e.fromDate)
                      : `${formatYmd(e.fromDate)} — ${formatYmd(e.untilDate)}`}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    ·{" "}
                    {e.slotId === null
                      ? `все ${vocabulary.session.nomPl} группы`
                      : slot
                        ? `${vocabulary.session.nom} ${DAY_SHORT[slot.dayOfWeek]} ${slot.startTime}`
                        : `${vocabulary.session.nomPl} прежнего времени`}
                    {e.reason && ` · ${e.reason}`}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {weekly.length === 0 && oneOff.length === 0 && (
        <p className="text-muted-foreground">{cap(vocabulary.session.nomPl)} пока не назначены.</p>
      )}
    </div>
  )
}
