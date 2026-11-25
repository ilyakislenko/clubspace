"use client"

import { cap } from "@clubspace/ui-kit/brand"
import { cn } from "@clubspace/ui-kit/util"
import Link from "next/link"

import { namesGym } from "../../shared/lib/group-label"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { coachShortName } from "../schedule/calendar/calendar-format"
import { FALLBACK_COLOR, formatRange } from "../schedule/calendar/calendar-helpers"
import { fillLabel, type CalendarItem } from "../schedule/calendar/calendar-items"
import { substitutionLabel } from "../schedule/calendar/substitution"

// Today's classes and events, one line each; a row opens the calendar's day.
// The meta shows only what the title doesn't: a gym the group name already
// names, and the viewer's own name, are left out.
export function TodayClasses({
  workspaceId,
  today,
  nowMin,
  items,
  viewerId,
}: {
  workspaceId: string
  today: string
  nowMin: number
  items: CalendarItem[]
  viewerId: string
}) {
  const vocabulary = useVocabulary()
  const active = items.filter((it) => !it.cancelled).length
  const dayHref = `/workspace/${workspaceId}/schedule?view=day&date=${today}`

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        {cap(vocabulary.session.nomPl)} сегодня
        <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{active}</span>
      </h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {items.map((it) => {
          const session = it.kind === "class" ? it.session : null
          const past = it.endMin <= nowMin
          const running = !it.cancelled && it.startMin <= nowMin && nowMin < it.endMin
          const sub = session ? substitutionLabel(session) : null
          const gym = session ? session.group.gym?.name : it.kind === "event" ? it.event.gym?.name : null
          const coach =
            session && session.group.coach.id !== viewerId ? coachShortName(session.group.coach) : null
          const meta = [gym && !namesGym(it.title, gym) ? gym : null, sub ?? coach]
          const fill = session ? fillLabel(session) : null
          return (
            <li key={it.key}>
              <Link
                href={dayHref}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60",
                  (past || it.cancelled) && "text-muted-foreground",
                )}
              >
                <span className="w-24 shrink-0 tabular-nums">
                  {formatRange(it.startMin, it.endMin)}
                </span>
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: it.color ?? FALLBACK_COLOR }}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className={cn("font-medium", it.cancelled && "line-through")}>
                    {it.title}
                  </span>
                  {meta.some(Boolean) && (
                    <span className="text-muted-foreground"> · {meta.filter(Boolean).join(" · ")}</span>
                  )}
                </span>
                {it.cancelled ? (
                  <span className="shrink-0 text-xs">Отменено</span>
                ) : running ? (
                  <span className="shrink-0 text-xs font-medium text-primary">Идёт</span>
                ) : fill ? (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fill}</span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
