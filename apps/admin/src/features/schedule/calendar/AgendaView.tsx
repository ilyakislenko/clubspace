"use client"

import { useMemo } from "react"

import { cn } from "@clubspace/ui-kit/util"

import { pluralRu } from "../../../shared/lib/plural-ru"
import { coachShortName } from "./calendar-format"
import { DOW_LONG, dayMonth, formatRange, isoDow, withAlpha } from "./calendar-helpers"
import { fillLabel, groupByDate, isFull, type CalendarItem } from "./calendar-items"
import { substitutionLabel } from "./substitution"

type Props = {
  items: CalendarItem[]
  today: string
  onOpenItem: (item: CalendarItem) => void
}

/** The month as a list of days (volt's agenda view). */
export function AgendaView({ items, today, onOpenItem }: Props) {
  const byDate = useMemo(() => [...groupByDate(items).entries()], [items])

  if (byDate.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        В этом месяце занятий нет.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {byDate.map(([day, dayItems]) => (
        <section key={day} className="space-y-1.5">
          <h2
            className={cn(
              "flex items-baseline gap-2 text-sm font-medium",
              day === today && "text-primary",
            )}
          >
            <span className="first-letter:uppercase">
              {DOW_LONG[isoDow(day)]}, {dayMonth(day)}
            </span>
            {day === today && <span className="text-xs">· сегодня</span>}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {dayItems.map((it) => {
              const s = it.kind === "class" ? it.session : null
              const fill = s ? fillLabel(s) : null
              const sub = s ? substitutionLabel(s) : null
              return (
                <li key={it.key}>
                  <button
                    type="button"
                    data-calendar-block={it.key}
                    onClick={() => onOpenItem(it)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"
                  >
                    <span
                      aria-hidden
                      className="h-9 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: withAlpha(it.color, 1) }}
                    />
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                      {formatRange(it.startMin, it.endMin)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate font-medium",
                          it.cancelled && "text-muted-foreground line-through",
                        )}
                      >
                        {it.kind === "event" ? `Событие: ${it.title}` : it.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {s
                          ? [s.group.gym?.name, coachShortName(s.group.coach), sub]
                              .filter(Boolean)
                              .join(" · ")
                          : it.kind === "event"
                            ? it.event.gym?.name ?? "Весь клуб"
                            : ""}
                      </span>
                    </span>
                    {it.cancelled && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                        Отменено
                      </span>
                    )}
                    {s?.rescheduledFrom && (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-600/20">
                        Перенесено
                      </span>
                    )}
                    {fill && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ring-inset",
                          s && isFull(s)
                            ? "bg-amber-50 text-amber-700 ring-amber-600/20"
                            : "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
                        )}
                      >
                        {fill}
                      </span>
                    )}
                    {s && !s.booking && s.bookedGuests > 0 && (
                      <span className="text-xs text-muted-foreground">
                        +{s.bookedGuests} {pluralRu(s.bookedGuests, "гость", "гостя", "гостей")}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
